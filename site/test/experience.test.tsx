import { fireEvent, render, screen, within, waitFor, act } from "@testing-library/react";
import { Landing } from "../src/Landing";
import { ProductPreview } from "../src/ProductPreview";
import { SETUP_COMMAND } from "../src/experience/LandingOverlays";
import { useUpdates, Updates } from "../src/experience/Updates";

beforeEach(() => {
  document.documentElement.dataset.theme = "dark";
  const storage = new Map<string,string>();
  vi.stubGlobal("sessionStorage", {getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>[]}));
  window.matchMedia = ((query:string)=>({matches:query.includes("reduce"),media:query,addEventListener(){},removeEventListener(){}})) as unknown as typeof window.matchMedia;
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(()=>{vi.unstubAllGlobals();document.documentElement.removeAttribute("data-motion");document.documentElement.removeAttribute("data-transparency");document.documentElement.removeAttribute("data-contrast");});

describe("Scenario demo",()=>{
  it("changes the task, checks and downloadable patch together",()=>{
    render(<ProductPreview/>);
    fireEvent.click(screen.getByRole("button",{name:"Refactor"}));
    expect(screen.getByRole("heading",{name:"Simplify the access check"})).toBeInTheDocument();
    expect(screen.getByRole("tab",{name:"Checks 18"})).toBeInTheDocument();
    const download=screen.getByRole("link",{name:"Download example patch"});
    expect(decodeURIComponent(download.getAttribute("href")!)).toContain("['owner', 'editor'].includes(role)");
    expect(download).toHaveAttribute("download","caramel-refactor-example.patch");
    fireEvent.click(screen.getByRole("tab",{name:"Checks 18"}));
    expect(within(screen.getByRole("tabpanel")).getByText("Example output · 18 tests across 3 files")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Add tests"}));
    expect(screen.getByRole("tab",{name:"Diff"})).toHaveAttribute("aria-selected","true");
    expect(screen.getByRole("tab",{name:"Checks 8"})).toBeInTheDocument();
    expect(decodeURIComponent(download.getAttribute("href")!)).toContain("search([], 'caramel')");
  });
});

describe("Quick-start and command palette",()=>{
  it("opens setup, copies real setup commands, closes with Escape and returns focus",async()=>{
    const copy=vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}});
    render(<Landing/>);
    const trigger=screen.getByRole("button",{name:"Get started"});
    trigger.focus();fireEvent.click(trigger);
    const dialog=screen.getByRole("dialog",{name:"Start building."});
    expect(within(dialog).getByText("Bun 1.3.x",{exact:false})).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button",{name:"Copy setup commands"}));
    await waitFor(()=>expect(copy).toHaveBeenCalledWith(SETUP_COMMAND));
    expect(await within(dialog).findByText("Copied")).toBeInTheDocument();
    fireEvent.keyDown(dialog,{key:"Escape"});
    await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
  it("reports clipboard failure without claiming the command was copied",async()=>{
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:vi.fn().mockRejectedValue(new Error("Denied"))}});
    render(<Landing/>);
    fireEvent.click(screen.getByRole("button",{name:"Get started"}));
    fireEvent.click(screen.getByRole("button",{name:"Copy run command"}));
    expect(await screen.findByText("Select the command to copy it manually.")).toBeInTheDocument();
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });
  it("opens with Ctrl+K, filters commands, and starts the setup guide with Enter",async()=>{
    render(<Landing/>);
    fireEvent.keyDown(window,{key:"k",ctrlKey:true});
    const input=screen.getByRole("combobox",{name:"Search commands"});
    fireEvent.change(input,{target:{value:"setup"}});
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input,{key:"Enter"});
    expect(await screen.findByRole("dialog",{name:"Start building."})).toBeInTheDocument();
  });
  it("shows a useful empty state and applies appearance controls without changing the theme",()=>{
    render(<Landing/>);
    fireEvent.click(screen.getByRole("button",{name:"Search page commands"}));
    fireEvent.change(screen.getByRole("combobox",{name:"Search commands"}),{target:{value:"zzzzzzz"}});
    expect(screen.getByText(/No commands found/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Less glass"}));
    fireEvent.click(screen.getByRole("button",{name:"Less motion"}));
    fireEvent.click(screen.getByRole("button",{name:"More contrast"}));
    expect(document.documentElement.dataset.transparency).toBe("reduced");
    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(document.documentElement.dataset.contrast).toBe("more");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button",{name:"Less glass"})).toHaveAttribute("aria-pressed","true");
  });
  it("opens the hidden replay when navigating to it from the palette",async()=>{
    vi.stubGlobal("requestAnimationFrame",(callback:FrameRequestCallback)=>{callback(0);return 1;});
    render(<Landing/>);
    fireEvent.click(screen.getByRole("button",{name:"Search page commands"}));
    const input=screen.getByRole("combobox",{name:"Search commands"});
    fireEvent.change(input,{target:{value:"Example runs"}});
    fireEvent.keyDown(input,{key:"Enter"});
    await waitFor(()=>expect(document.getElementById("example-replay")).toHaveAttribute("open"));
    expect(document.activeElement?.tagName).toBe("SUMMARY");
  });
});

function UpdateHarness(){const state=useUpdates();return <Updates {...state}/>;}
describe("GitHub updates",()=>{
  it("uses real development entries when no releases have been published",async()=>{
    render(<UpdateHarness/>);
    expect(screen.getByText(/No tagged release/)).toBeInTheDocument();
    expect(screen.getByRole("link",{name:/More balanced execution budgets/})).toHaveAttribute("href",expect.stringContaining("/commit/44cc571"));
    await act(async()=>{});
  });
  it("shows published releases but excludes drafts and unrelated destinations",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>[
      {id:1,name:"Caramel v0.2",tag_name:"v0.2",published_at:"2026-10-22T00:00:00Z",html_url:"https://github.com/KatalKavya96/CaramelAI/releases/tag/v0.2"},
      {id:2,name:"Draft",tag_name:"v0.3",draft:true,published_at:"2026-10-22T00:00:00Z",html_url:"https://github.com/KatalKavya96/CaramelAI/releases/tag/v0.3"},
      {id:3,name:"Other URL",tag_name:"v0.4",published_at:"2026-10-22T00:00:00Z",html_url:"https://example.com/"},
    ]}));
    render(<UpdateHarness/>);
    expect(await screen.findByText("Caramel v0.2")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
    expect(screen.queryByText("Other URL")).not.toBeInTheDocument();
    expect(screen.getByText("The latest published releases from GitHub.")).toBeInTheDocument();
  });
  it("keeps the development snapshot usable when GitHub is unavailable",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("Offline")));
    render(<UpdateHarness/>);
    await act(async()=>{});
    expect(screen.getByText("Controller refactor")).toBeInTheDocument();
  });
});
