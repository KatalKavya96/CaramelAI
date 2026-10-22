import { useId, useState } from "react";
import { LogoMark } from "@web/ui/Logo";
import { ArrowUpIcon, BranchIcon, CheckIcon, CodeIcon, DocIcon, DownloadIcon, FolderIcon, GearIcon, LibraryIcon, PencilIcon, PlusIcon, SearchIcon, SidebarIcon, TerminalIcon } from "@web/ui/icons";
import styles from "./ProductPreview.module.css";

type PreviewTab = "Diff" | "Terminal" | "Checks";
const patch = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1 +1 @@
-export const DEFAULT_SESSION_TIMEOUT = 5 * 60 * 1000;
+export const DEFAULT_SESSION_TIMEOUT = 30 * 60 * 1000;
`;
const patchUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(patch)}`;

export function PatchPreview() {
  return <div className={styles.codeCard} aria-label="Example code diff increasing a session timeout from 5 to 30 minutes">
    <div className={styles.codeHeader}><span><BranchIcon size={13} />src/auth.ts</span><span className={styles.diffCount}>+1 <span>−1</span></span></div>
    <div className={styles.codeLines}>
      <div><span>21</span><code>export const DEFAULT_SESSION_TIMEOUT =</code></div>
      <div className={styles.deleted}><span>22</span><code>−   5 * 60 * 1000;</code></div>
      <div className={styles.added}><span>22</span><code>+  30 * 60 * 1000;</code></div>
      <div><span>23</span><code /></div>
      <div><span>24</span><code>export interface SessionConfig {'{'}</code></div>
      <div><span>25</span><code>  timeoutMs: number;</code></div>
      <div><span>26</span><code>{'}'}</code></div>
    </div>
  </div>;
}

const actions = [
  { Icon: DocIcon, title: "Read", body: "Read the session configuration and existing tests." },
  { Icon: LibraryIcon, title: "Plan", body: "Update the timeout and cover the change with a test." },
  { Icon: PencilIcon, title: "Edit", body: "Updated src/auth.ts and the session timeout test." },
  { Icon: TerminalIcon, title: "Check", body: "Ran the project's test suite on the final patch." },
];

export function ProductPreview() {
  const [tab, setTab] = useState<PreviewTab>("Diff");
  const id = useId();
  return <figure className={styles.figure} aria-label="Caramel desktop app preview">
    <div className={styles.window}>
      <div className={styles.titlebar}><div className={styles.lights} aria-hidden="true"><i /><i /><i /></div><span>caramel — workspace</span><span className={styles.example}>Example preview</span></div>
      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="Illustrated app sidebar">
          <div className={styles.logo}><LogoMark size={27} /><strong>caramel</strong><SidebarIcon size={15} /></div>
          <div className={styles.newTask}><PlusIcon size={16} /><span>New task</span><kbd>⌘ K</kbd></div>
          <div className={styles.sideItem}><SearchIcon size={15} />Search</div>
          <div className={styles.sideItem}><FolderIcon size={15} />Projects</div>
          <div className={styles.sideItem}><LibraryIcon size={15} />Library</div>
          <p className={styles.sideLabel}>Projects</p><div className={styles.activeProject}><FolderIcon size={14} />caramel-ai</div><div className={styles.sideItem}><FolderIcon size={14} />workspace</div><div className={styles.sideItem}><FolderIcon size={14} />examples</div>
          <p className={styles.sideLabel}>Recent</p><div className={styles.selectedTask}>Fix the session timeout</div><div className={styles.recent}>Add streaming support</div><div className={styles.recent}>Improve error messages</div><div className={styles.recent}>Refactor tool calling</div>
          <div className={styles.profile}><span>K</span><span>Kavya</span><GearIcon size={14} /></div>
        </aside>
        <div className={styles.workspace}>
          <header className={styles.taskHeader}><div><h2>Fix the session timeout</h2><p><BranchIcon size={12} />caramel-ai <span>·</span>main</p></div><span className={styles.status}><CheckIcon size={12} />Checks passed</span></header>
          <div className={styles.workColumns}>
            <div className={styles.timeline}>
              <ol>{actions.map(({ Icon, title, body }) => <li key={title}><span className={styles.stepIcon}><Icon size={18} /></span><div><h3>{title}<CheckIcon size={13} /></h3><p>{body}</p></div></li>)}</ol>
              <div className={styles.outcome}><span><CheckIcon size={17} /></span><div><strong>Checks passed</strong><p>Ready for you to review.</p></div></div>
              <div className={styles.composer} aria-label="Illustrated follow-up composer"><span>Ask for a follow-up…</span><span><PlusIcon size={14} /><i><ArrowUpIcon size={13} /></i></span></div>
            </div>
            <section className={styles.review} aria-label="Example run details">
              <div className={styles.tabs} role="tablist" aria-label="Preview details">{(["Diff", "Terminal", "Checks"] as const).map((name) => <button key={name} type="button" role="tab" id={`${id}-${name}`} aria-selected={tab === name} aria-controls={`${id}-panel`} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={(event) => { const names: PreviewTab[] = ["Diff", "Terminal", "Checks"]; const index = names.indexOf(tab); const next = event.key === "ArrowRight" ? names[(index + 1) % 3] : event.key === "ArrowLeft" ? names[(index + 2) % 3] : event.key === "Home" ? names[0] : event.key === "End" ? names[2] : undefined; if (next) { event.preventDefault(); setTab(next); document.getElementById(`${id}-${next}`)?.focus(); } }}>{name === "Diff" ? <CodeIcon size={13} /> : null}{name}{name === "Checks" ? <span className={styles.tabCount}>12</span> : null}</button>)}</div>
              <div className={styles.tabPanel} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0}>
                {tab === "Diff" ? <><PatchPreview /><div className={styles.testCode}><div className={styles.codeHeader}><span><DocIcon size={12} />tests/session.test.ts</span></div><div className={styles.codeLines}><div><span>28</span><code>it('uses the default timeout', () =&gt; {'{'}</code></div><div className={styles.deleted}><span>29</span><code>− expect(timeout).toBe(5 * MINUTE);</code></div><div className={styles.added}><span>29</span><code>+ expect(timeout).toBe(30 * MINUTE);</code></div><div><span>30</span><code>{'}'});</code></div></div></div></> : tab === "Terminal" ? <div className={styles.terminal}><p>$ npm test</p><p>Running project checks…</p><p>✓ auth/session.test.ts (4)</p><p>✓ auth/middleware.test.ts (3)</p><p>✓ config/env.test.ts (2)</p><p>✓ utils/crypto.test.ts (3)</p><p>Test Files  4 passed (4)</p><p>Tests       12 passed (12)</p><p>Exit code   0</p></div> : <div className={styles.checkList}><h3>Checks on the final patch</h3>{["auth/session.test.ts", "auth/middleware.test.ts", "config/env.test.ts", "utils/crypto.test.ts"].map(file => <div key={file}><CheckIcon size={14} /><span>{file}</span><span>Passed</span></div>)}<p>Example output · 12 tests across 4 files</p></div>}
              </div>
              <div className={styles.testSummary}><CheckIcon size={14} /><strong>npm test</strong><span>12 passed</span><span>2.8s</span></div>
              <div className={styles.reviewActions}><a href={patchUrl} download="caramel-example.patch"><DownloadIcon size={14} />Download example patch</a></div>
            </section>
          </div>
        </div>
      </div>
    </div>
    <figcaption>Illustrative desktop preview. <a href="#example-replay">Explore the example runs <span aria-hidden="true">↗</span></a></figcaption>
  </figure>;
}
