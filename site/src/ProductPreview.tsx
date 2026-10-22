import { useId, useState } from "react";
import { LogoMark } from "@web/ui/Logo";
import { ArrowUpIcon, BranchIcon, CheckIcon, CodeIcon, DocIcon, DownloadIcon, FolderIcon, GearIcon, LibraryIcon, PencilIcon, PlusIcon, SearchIcon, SidebarIcon, TerminalIcon } from "@web/ui/icons";
import { DEMO_SCENARIOS, scenarioPatch, testCount, type DemoScenario } from "./experience/demoScenarios";
import styles from "./ProductPreview.module.css";

type PreviewTab = "Diff" | "Terminal" | "Checks";
const DEFAULT = DEMO_SCENARIOS[0]!;

export function PatchPreview({ scenario = DEFAULT }: { scenario?: DemoScenario }) {
  return <div className={styles.codeCard} aria-label={`Example code diff: ${scenario.title}`}>
    <div className={styles.codeHeader}><span><BranchIcon size={13} />{scenario.file}</span><span className={styles.diffCount}>+1 <span>−1</span></span></div>
    <div className={styles.codeLines}>
      <div><span>1</span><code>{`// ${scenario.title}`}</code></div>
      <div className={styles.deleted}><span>2</span><code>− {scenario.before}</code></div>
      <div className={styles.added}><span>2</span><code>+ {scenario.after}</code></div>
      <div><span>3</span><code /></div>
    </div>
  </div>;
}

const actionIcons = [DocIcon, LibraryIcon, PencilIcon, TerminalIcon];
const actionNames = ["Read", "Plan", "Edit", "Check"];

export function ProductPreview() {
  const [scenario, setScenario] = useState(DEFAULT);
  const [tab, setTab] = useState<PreviewTab>("Diff");
  const id = useId();
  const count = testCount(scenario);
  const chooseScenario = (next: DemoScenario) => { setScenario(next); setTab("Diff"); };
  return <figure className={styles.figure} aria-label="Caramel desktop app preview">
    <div className={styles.demoToolbar}>
      <span>Take a closer look</span>
      <div className={styles.scenarioPicker} role="group" aria-label="Demo scenario">{DEMO_SCENARIOS.map((item, index) => <button key={item.id} type="button" aria-pressed={scenario.id === item.id} onClick={() => chooseScenario(item)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? DEMO_SCENARIOS[(index + 1) % 3] : event.key === "ArrowLeft" ? DEMO_SCENARIOS[(index + 2) % 3] : undefined;
        if (next) { event.preventDefault(); chooseScenario(next); document.getElementById(`${id}-scenario-${next.id}`)?.focus(); }
      }} id={`${id}-scenario-${item.id}`}>{item.label}</button>)}</div>
    </div>
    <span className="visually-hidden" role="status">{scenario.label} example: {scenario.title}. {count} tests passed.</span>
    <div className={styles.window}>
      <div className={styles.titlebar}><div className={styles.lights} aria-hidden="true"><i /><i /><i /></div><span>caramel — workspace</span><span className={styles.example}>Example preview</span></div>
      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="Illustrated app sidebar">
          <div className={styles.logo}><LogoMark size={27} /><strong>caramel</strong><SidebarIcon size={15} /></div>
          <div className={styles.newTask}><PlusIcon size={16} /><span>New task</span><kbd>⌘ K</kbd></div>
          <div className={styles.sideItem}><SearchIcon size={15} />Search</div><div className={styles.sideItem}><FolderIcon size={15} />Projects</div><div className={styles.sideItem}><LibraryIcon size={15} />Library</div>
          <p className={styles.sideLabel}>Projects</p><div className={styles.activeProject}><FolderIcon size={14} />caramel-ai</div><div className={styles.sideItem}><FolderIcon size={14} />workspace</div><div className={styles.sideItem}><FolderIcon size={14} />examples</div>
          <p className={styles.sideLabel}>Recent</p><div className={styles.selectedTask}>{scenario.title}</div><div className={styles.recent}>Add streaming support</div><div className={styles.recent}>Improve error messages</div><div className={styles.recent}>Refactor tool calling</div>
          <div className={styles.profile}><span>K</span><span>Kavya</span><GearIcon size={14} /></div>
        </aside>
        <div className={styles.workspace}>
          <header className={styles.taskHeader}><div><h2>{scenario.title}</h2><p><BranchIcon size={12} />caramel-ai <span>·</span>main</p></div><span className={styles.status}><CheckIcon size={12} />Checks passed</span></header>
          <div className={styles.workColumns}>
            <div className={styles.timeline}>
              <p className={styles.taskPrompt}>{scenario.prompt}</p>
              <ol>{scenario.steps.map((body, index) => { const Icon = actionIcons[index]!; return <li key={index}><span className={styles.stepIcon}><Icon size={18} /></span><div><h3>{actionNames[index]}<CheckIcon size={13} /></h3><p>{body}</p></div></li>; })}</ol>
              <div className={styles.outcome}><span><CheckIcon size={17} /></span><div><strong>Checks passed</strong><p>{count} tests. Ready for you to review.</p></div></div>
              <div className={styles.composer} aria-label="Illustrated follow-up composer"><span>Ask for a follow-up…</span><span><PlusIcon size={14} /><i><ArrowUpIcon size={13} /></i></span></div>
            </div>
            <section className={styles.review} aria-label="Example run details">
              <div className={styles.tabs} role="tablist" aria-label="Preview details">{(["Diff", "Terminal", "Checks"] as const).map((name) => <button key={name} type="button" role="tab" id={`${id}-${name}`} aria-selected={tab === name} aria-controls={`${id}-panel`} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => {
                const names: PreviewTab[] = ["Diff", "Terminal", "Checks"]; const index = names.indexOf(tab);
                const next = event.key === "ArrowRight" ? names[(index + 1) % 3] : event.key === "ArrowLeft" ? names[(index + 2) % 3] : event.key === "Home" ? names[0] : event.key === "End" ? names[2] : undefined;
                if (next) { event.preventDefault(); setTab(next); document.getElementById(`${id}-${next}`)?.focus(); }
              }}>{name === "Diff" ? <CodeIcon size={13} /> : null}{name}{name === "Checks" ? <span className={styles.tabCount}>{count}</span> : null}</button>)}</div>
              <div className={styles.tabPanel} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0}>
                <div key={`${scenario.id}-${tab}`} className={styles.panelTransition}>
                {tab === "Diff" ? <><PatchPreview scenario={scenario} /><div className={styles.testCode}><div className={styles.codeHeader}><span><DocIcon size={12} />{scenario.testFile}</span></div><div className={styles.codeLines}><div className={styles.deleted}><span>1</span><code>− {scenario.testBefore}</code></div><div className={styles.added}><span>1</span><code>+ {scenario.testAfter}</code></div></div></div></> : tab === "Terminal" ? <div className={styles.terminal}><p>$ npm test</p><p>Running project checks…</p>{scenario.tests.map(test => <p key={test.file}>✓ {test.file} ({test.count})</p>)}<p>Test Files  {scenario.tests.length} passed ({scenario.tests.length})</p><p>Tests       {count} passed ({count})</p><p>Exit code   0</p></div> : <div className={styles.checkList}><h3>Checks on the final patch</h3>{scenario.tests.map(test => <div key={test.file}><CheckIcon size={14} /><span>{test.file}</span><span>Passed</span></div>)}<p>Example output · {count} tests across {scenario.tests.length} files</p></div>}
                </div>
              </div>
              <div className={styles.testSummary}><CheckIcon size={14} /><strong>npm test</strong><span>{count} passed</span><span>{scenario.duration}</span></div>
              <div className={styles.reviewActions}><a href={`data:text/plain;charset=utf-8,${encodeURIComponent(scenarioPatch(scenario))}`} download={`caramel-${scenario.id}-example.patch`}><DownloadIcon size={14} />Download example patch</a></div>
            </section>
          </div>
        </div>
      </div>
    </div>
    <figcaption>Illustrative desktop preview. <a href="#example-replay">Explore the example runs <span aria-hidden="true">↗</span></a></figcaption>
  </figure>;
}
