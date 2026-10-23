import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronRightIcon, CloseIcon, CopyIcon, SearchIcon, TerminalIcon } from "@web/ui/icons";
import { LINKS } from "../links";
import type { Appearance } from "./useAppearance";
import styles from "./LandingOverlays.module.css";

export type Overlay = "quickstart" | "commands" | null;
export const SETUP_COMMAND = "git clone https://github.com/KatalKavya96/CaramelAI.git\ncd CaramelAI\nmake setup";
export const KEY_COMMAND = 'export DEEPSEEK_API_KEY="your-provider-key"';
const RUN_COMMAND = "make run";

function CopyCommand({ code, label }: { code:string; label:string }) {
  const [status, setStatus] = useState<"idle"|"copied"|"failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setStatus("copied"); }
    catch { setStatus("failed"); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2500);
  };
  return <div className={styles.commandBlock}><pre><code>{code}</code></pre><button type="button" onClick={() => void copy()} aria-label={`Copy ${label}`}>{status === "copied" ? <CheckIcon size={16} /> : <CopyIcon size={16} />}</button><span className={styles.copyStatus} role="status">{status === "copied" ? "Copied" : status === "failed" ? "Select the command to copy it manually." : ""}</span></div>;
}

function QuickStart() {
  return <>
    <div className={styles.drawerEyebrow}><TerminalIcon size={17} />From source to your first run</div>
    <Dialog.Title className={styles.drawerTitle}>Set up the CLI</Dialog.Title>
    <Dialog.Description className={styles.description}>The CLI is available today. Bring a provider key and a repository you want to work on.</Dialog.Description>
    <div className={styles.requirements}><strong>Before you start</strong><p>Bun 1.3.x, GNU Make, and a command sandbox: macOS Seatbelt, Linux with bubblewrap, or Docker.</p></div>
    <ol className={styles.setupSteps}>
      <li><span>01</span><div><h3>Get Caramel</h3><p>Clone the repository and install its dependencies.</p><CopyCommand code={SETUP_COMMAND} label="setup commands" /></div></li>
      <li><span>02</span><div><h3>Connect your model</h3><p>This example uses DeepSeek. Replace the placeholder in your own terminal.</p><CopyCommand code={KEY_COMMAND} label="provider key command" /><a href={`${LINKS.docs.replace('#readme','')}/blob/main/.env.example`}>See provider configuration <span aria-hidden="true">↗</span></a></div></li>
      <li><span>03</span><div><h3>Run the guided setup</h3><p>Choose your repository, describe the task, and set the run budgets.</p><CopyCommand code={RUN_COMMAND} label="run command" /></div></li>
    </ol>
    <div className={styles.drawerFooter}><a href={LINKS.docs}>Read the complete setup guide <ChevronRightIcon size={15} /></a><p>The desktop app is in development. <a href={LINKS.notify}>Follow releases</a>.</p></div>
  </>;
}

interface PaletteProps { openQuickStart:()=>void; toggleTheme:()=>void; theme:"dark"|"light"; appearance:Appearance; toggleAppearance:(key:keyof Appearance)=>void; close:()=>void; navigateToSection:(href:string)=>void }
function CommandPalette({ openQuickStart,toggleTheme,theme,appearance,toggleAppearance,close,navigateToSection }: PaletteProps) {
  const [query,setQuery] = useState("");
  const [active,setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = "caramel-command-results";
  const commands = useMemo(() => [
    {id:"start",label:"Set up the CLI",hint:"Quick-start guide",keywords:"install cli setup run",action:openQuickStart},
    {id:"product",label:"Product demo",hint:"Try three example tasks",keywords:"preview bug refactor tests",href:"#product"},
    {id:"how",label:"How it works",hint:"From issue to evidence",keywords:"steps process",href:"#how"},
    {id:"example-replay",label:"Example runs",hint:"Verified and partial outcomes",keywords:"replay evidence",href:"#example-replay"},
    {id:"updates",label:"What's new",hint:"Development updates",keywords:"release news changelog",href:"#updates"},
    {id:"docs",label:"Documentation",hint:"Open on GitHub",keywords:"help readme",href:LINKS.docs},
    {id:"github",label:"GitHub repository",hint:"Explore the code",keywords:"source star",href:LINKS.github},
    {id:"theme",label:`Switch to ${theme === "dark" ? "light" : "dark"} theme`,hint:"Appearance",keywords:"mode color",action:()=>{toggleTheme();close();}},
  ],[theme,toggleTheme,close,openQuickStart]);
  const filtered = commands.filter(command => `${command.label} ${command.hint} ${command.keywords}`.toLowerCase().includes(query.toLowerCase().trim()));
  const navigate = (href:string) => {
    if (href.startsWith("#")) navigateToSection(href);
    else { close(); window.location.assign(href); }
  };
  const run = (index:number) => { const command=filtered[index]; if(!command)return; if(command.action)command.action(); else if(command.href)navigate(command.href); };
  return <>
    <Dialog.Title className="visually-hidden">Search Caramel</Dialog.Title><Dialog.Description className="visually-hidden">Navigate the landing page, open the setup guide, or adjust your display preferences.</Dialog.Description>
    <div className={styles.searchRow}><SearchIcon size={20} /><input ref={inputRef} autoFocus role="combobox" aria-label="Search commands" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={filtered[active] ? `command-${filtered[active].id}` : undefined} placeholder="Where would you like to go?" value={query} onChange={event=>{setQuery(event.target.value);setActive(0);}} onKeyDown={event=>{
      if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();const next=filtered.length ? (active+(event.key==="ArrowDown"?1:-1)+filtered.length)%filtered.length : 0;setActive(next);document.getElementById(`command-${filtered[next]?.id}`)?.scrollIntoView({block:"nearest"});}
      if(event.key==="Enter"){event.preventDefault();run(active);}
    }}/><kbd>esc</kbd></div>
    <div className={styles.commandResults} role="listbox" id={listId} aria-label="Page commands">{filtered.map((command,index)=><div role="option" aria-selected={index===active} id={`command-${command.id}`} key={command.id} className={styles.option} onMouseMove={()=>setActive(index)} onClick={()=>run(index)}><div><strong>{command.label}</strong><span>{command.hint}</span></div><span aria-hidden="true">↗</span></div>)}{!filtered.length?<p className={styles.noResults} role="status">No commands found. Try “demo”, “setup”, or “theme”.</p>:null}</div>
    <div className={styles.displayOptions}><span>Make it comfortable</span><div>{([['motion','Less motion'],['transparency','Less glass'],['contrast','More contrast']] as const).map(([key,label])=><button key={key} type="button" aria-pressed={appearance[key]} onClick={()=>toggleAppearance(key)}>{appearance[key]?<CheckIcon size={12}/>:null}{label}</button>)}</div></div>
    <div className={styles.paletteFooter}><span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span><span><kbd>↵</kbd> to open</span></div>
  </>;
}

export function LandingOverlays({overlay,setOverlay,...palette}: Omit<PaletteProps,"openQuickStart"|"close"|"navigateToSection"> & {overlay:Overlay;setOverlay:(value:Overlay)=>void}) {
  const previousFocus = useRef<HTMLElement|null>(null);
  const destination = useRef<string|null>(null);

  return <Dialog.Root open={overlay!==null} onOpenChange={open=>{if(!open)setOverlay(null);}}><Dialog.Portal><Dialog.Overlay className={styles.backdrop}/><Dialog.Content className={overlay==="quickstart"?styles.drawer:styles.palette} onOpenAutoFocus={() => { if (!previousFocus.current) previousFocus.current = document.activeElement as HTMLElement; }} onCloseAutoFocus={event=>{
    event.preventDefault();
    if (destination.current) {
      const section = document.getElementById(destination.current.slice(1));
      if (section instanceof HTMLDetailsElement) section.open = true;
      section?.scrollIntoView({behavior: palette.appearance.motion || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block:"start"});
      const heading = section?.querySelector<HTMLElement>("h2, summary");
      if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); }
      previousFocus.current = null; destination.current = null; return;
    }
    const target = previousFocus.current?.isConnected && !previousFocus.current.closest('[aria-hidden="true"]') ? previousFocus.current : document.querySelector<HTMLElement>('[aria-label="Caramel navigation"] button');
    target?.focus({preventScroll:true}); previousFocus.current=null;
  }}>{overlay==="quickstart"?<QuickStart/>:<CommandPalette {...palette} openQuickStart={()=>setOverlay("quickstart")} close={()=>setOverlay(null)} navigateToSection={href=>{destination.current=href;setOverlay(null);}}/>}<Dialog.Close className={styles.close} aria-label="Close dialog"><CloseIcon size={18}/></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
