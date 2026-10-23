import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import { ApiContext, createApiClient, type ApiClient } from "../src/data";
import { HOSTED_CAPABILITIES } from "../src/lib/contract";
import { App } from "../src/app/App";
import { ThemeProvider } from "../src/app/theme";
import { RunScreen } from "../src/screens/RunScreen";
import { UiStateProvider } from "../src/app/ui-state";
import { HomeScreen } from "../src/screens/HomeScreen";
import { SearchPalette } from "../src/screens/SearchPalette";
import { ProviderKeys } from "../src/screens/ProviderKeys";
import { ModelPicker, RunComposer, defaultRunOptions } from "../src/domain";
import { SegmentedControl } from "../src/ui";
import { useDraft } from "../src/patterns/useDraft";
import type { RunView } from "../src/lib/contract";

const provider = { provider:"deepseek",label:"DeepSeek",keyUrl:"https://example.com",reportsCost:false,oauth:false,endpoint:null,last4:"demo",verified:true,defaultModel:"example-model",updatedAt:null };
const api = createApiClient({fetcher:async path => Response.json(path === "/api/me" ? {userId:"test-user",login:"Test",capabilities:HOSTED_CAPABILITIES} : path === "/api/providers" ? [provider] : [])});
function Providers({children,apiClient = api}:{children:React.ReactNode; apiClient?:ApiClient}) {
  const [client] = useState(() => new QueryClient({defaultOptions:{queries:{retry:false}}}));
  return <ApiContext.Provider value={apiClient}><QueryClientProvider client={client}><UiStateProvider>{children}</UiStateProvider></QueryClientProvider></ApiContext.Provider>;
}
beforeEach(() => { for (const name of ["localStorage","sessionStorage"]) { const entries = new Map<string,string>(); vi.stubGlobal(name,{getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>entries.set(key,value),removeItem:(key:string)=>entries.delete(key)}); } HTMLElement.prototype.scrollIntoView = vi.fn(); window.matchMedia = vi.fn().mockReturnValue({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps a task through provider navigation and does not overwrite it with a starter", async () => {
  render(<Providers><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Routes><Route path="/" element={<HomeScreen/>}/><Route path="/setup" element={<Link to="/">Return to draft</Link>}/></Routes></MemoryRouter></Providers>);
  const task = screen.getByRole("textbox",{name:"Task"});
  await userEvent.type(task,"Preserve my work");
  await userEvent.click(screen.getByRole("button",{name:"Add tests"}));
  expect(task).toHaveValue("Preserve my work");
  await userEvent.click(await screen.findByRole("button",{name:/example-model/}));
  await userEvent.click(screen.getByRole("menuitem",{name:"Model providers…"}));
  await userEvent.click(screen.getByRole("link",{name:"Return to draft"}));
  expect(screen.getByRole("textbox",{name:"Task"})).toHaveValue("Preserve my work");
});

it("retains a draft after remount and removes it on discard", async () => {
  function Draft() { const [text,setText] = useDraft("test"); return <input aria-label="Draft" value={text} onChange={event => setText(event.target.value)}/>; }
  const first = render(<Draft/>);
  fireEvent.change(screen.getByLabelText("Draft"),{target:{value:"A saved draft"}});
  first.unmount(); render(<Draft/>);
  expect(screen.getByLabelText("Draft")).toHaveValue("A saved draft");
  fireEvent.change(screen.getByLabelText("Draft"),{target:{value:""}});
  expect(sessionStorage.getItem("caramel-draft:test")).toBeNull();
});

it("discards cancelled repository and check edits when reopened", async () => {
  function Compose() {
    const [options,setOptions] = useState({...defaultRunOptions(HOSTED_CAPABILITIES),repoUrl:"https://github.com/example/saved"});
    return <RunComposer task="Change" onTaskChange={vi.fn()} options={options} onOptionsChange={setOptions} onSubmit={vi.fn()} busy={false} capabilities={HOSTED_CAPABILITIES} recentRepos={[]}/>;
  }
  render(<Compose/>);
  await userEvent.click(screen.getByRole("button",{name:"example/saved"}));
  fireEvent.change(screen.getByLabelText("GitHub URL"),{target:{value:"https://github.com/example/unsaved"}});
  await userEvent.click(screen.getByRole("button",{name:"Cancel"}));
  await waitFor(() => expect(screen.getByRole("button",{name:"example/saved"})).toHaveFocus());
  await userEvent.click(screen.getByRole("button",{name:"example/saved"}));
  expect(screen.getByLabelText("GitHub URL")).toHaveValue("https://github.com/example/saved");
  await userEvent.click(screen.getByRole("button",{name:"Cancel"}));
  await userEvent.click(screen.getByRole("button",{name:"Options"}));
  await userEvent.click(screen.getByRole("button",{name:"Auto checks"}));
  fireEvent.change(screen.getByLabelText("One command per line"),{target:{value:"npm test"}});
  await userEvent.click(screen.getByRole("button",{name:"Close"}));
  await userEvent.click(screen.getByRole("button",{name:"Options"}));
  await userEvent.click(screen.getByRole("button",{name:"Auto checks"}));
  expect(screen.getByLabelText("One command per line")).toHaveValue("");
});

it("finds tasks by repository and branch instead of task text alone", async () => {
  const run = {id:"one",request:{task:"Fix parser",repo:{kind:"git",url:"https://github.com/example/api",ref:"fix-date"}},summary:null,status:"verified",createdAt:new Date().toISOString()} as RunView;
  render(<SearchPalette open onOpenChange={vi.fn()} runs={[run]} onOpen={vi.fn()} onNew={vi.fn()}/>);
  await userEvent.type(screen.getByRole("combobox"),"example/api");
  expect(screen.getByRole("option")).toHaveTextContent("Fix parser");
  await userEvent.clear(screen.getByRole("combobox"));
  await userEvent.type(screen.getByRole("combobox"),"fix-date");
  expect(screen.getByRole("option")).toHaveTextContent("Fix parser");
});

it("uses a single tab stop and arrow keys in segmented controls", async () => {
  function Choice(){const [value,setValue] = useState("light");return <SegmentedControl label="Theme" value={value} onChange={setValue} segments={[{value:"light",label:"Light"},{value:"dark",label:"Dark"}]}/>;}
  render(<Choice/>);
  screen.getByRole("radio",{name:"Light"}).focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio",{name:"Dark"})).toHaveFocus();
  expect(screen.getByRole("radio",{name:"Dark"})).toHaveAttribute("aria-checked","true");
  expect(screen.getByRole("radio",{name:"Light"})).toHaveAttribute("tabindex","-1");
});

it("shows one chosen provider form instead of every provider form", async () => {
  render(<Providers><ProviderKeys/></Providers>);
  const select = await screen.findByLabelText("Choose a model provider");
  await userEvent.selectOptions(select,"deepseek");
  expect(screen.getAllByRole("heading",{name:"DeepSeek"})).toHaveLength(1);
});

it("explains a missing prerequisite and keeps options out of the default composer", () => {
  render(<RunComposer task="Fix parser" onTaskChange={vi.fn()} options={defaultRunOptions(HOSTED_CAPABILITIES)} onOptionsChange={vi.fn()} onSubmit={vi.fn()} busy={false} capabilities={HOSTED_CAPABILITIES} recentRepos={[]}/>);
  expect(screen.getByRole("button",{name:"Start run"})).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Connect a model provider to start.");
  expect(screen.queryByRole("button",{name:"Standard"})).not.toBeInTheDocument();
});

const activeRun: RunView = {
  id:"active", ownerId:"test-user", parentRunId:null,childRunIds:[],status:"running",changedFiles:[],summary:null,terminationReason:null,
  createdAt:"2026-10-23T10:00:00Z",startedAt:"2026-10-23T10:00:00Z",finishedAt:null,
  request:{network:"none",planMode:false,task:"An active task",provider:"deepseek",model:"example-model",repo:{kind:"git",url:"https://github.com/example/api"},budgets:{maxSteps:80,maxMinutes:20,maxModelCalls:50}},
};
function liveApi() {
  vi.stubGlobal("EventSource",class {onopen=null;onerror=null;addEventListener(){}close(){}});
  return createApiClient({fetcher:async(path,init) => {
    if (init?.method === "POST") return Response.json({error:"conflict",message:"Cancellation unavailable. Retry."},{status:409});
    return Response.json(path === "/api/me" ? {userId:"test-user",login:"Test",capabilities:HOSTED_CAPABILITIES} : path === "/api/providers" ? [provider] : path === "/api/runs" ? [activeRun] : activeRun);
  }});
}

it("keeps cancellation failure visible and offers another attempt", async () => {
  render(<Providers apiClient={liveApi()}><MemoryRouter initialEntries={["/runs/active"]} future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Routes><Route path="/runs/:id" element={<RunScreen/>}/></Routes></MemoryRouter></Providers>);
  await userEvent.click(await screen.findByRole("button",{name:"Cancel"}));
  await userEvent.click(screen.getByRole("button",{name:"Cancel run"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Cancellation unavailable. Retry.");
  expect(screen.getByRole("dialog",{name:"Cancel this run?"})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Cancel run"})).toBeEnabled();
});

it("opens search with Cmd+K without leaving an active task", async () => {
  render(<Providers apiClient={liveApi()}><ThemeProvider><MemoryRouter initialEntries={["/runs/active"]} future={{v7_startTransition:true,v7_relativeSplatPath:true}}><App/></MemoryRouter></ThemeProvider></Providers>);
  await screen.findByRole("heading",{name:"An active task"});
  fireEvent.keyDown(window,{key:"k",metaKey:true});
  expect(await screen.findByRole("dialog",{name:"Search"})).toBeInTheDocument();
  expect(screen.getByRole("heading",{name:"An active task",hidden:true})).toBeInTheDocument();
});

it("does not enable Start for a remembered provider without an available connection", () => {
  render(<RunComposer task="Fix parser" onTaskChange={vi.fn()} options={{...defaultRunOptions(HOSTED_CAPABILITIES),repoUrl:"https://github.com/example/api",provider:"deepseek"}} providerReady={false} onOptionsChange={vi.fn()} onSubmit={vi.fn()} busy={false} capabilities={HOSTED_CAPABILITIES} recentRepos={[]}/>);
  expect(screen.getByRole("button",{name:"Start run"})).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Connect a model provider to start.");
});

it("discards a cancelled model id instead of offering it on the next opening", async () => {
  const change = vi.fn();
  render(<ModelPicker providers={[{...provider,provider:"deepseek"}]} provider="deepseek" model="saved-model" onChange={change} onManageKeys={vi.fn()}/>);
  const open = async () => {
    await userEvent.click(screen.getByRole("button",{name:/DeepSeek.*saved-model/}));
    await userEvent.click(screen.getByRole("menuitem",{name:/Another model/}));
  };
  await open();
  fireEvent.change(screen.getByLabelText("Model id"),{target:{value:"unsaved-model"}});
  await userEvent.click(screen.getByRole("button",{name:"Cancel"}));
  await open();
  expect(screen.getByLabelText("Model id")).toHaveValue("saved-model");
  expect(change).not.toHaveBeenCalled();
});
