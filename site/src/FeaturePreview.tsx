import { CheckIcon, DocIcon, ShieldIcon, TerminalIcon } from "@web/ui/icons";
import { LogoMark } from "@web/ui/Logo";
import { PatchPreview } from "./ProductPreview";
import styles from "./FeaturePreview.module.css";

export function ReviewVisual() {
  return <div className={styles.stage} aria-label="Illustration of a code review with its supporting checks">
    <div className={styles.diffWindow}><div className={styles.chrome}><i /><i /><i /><span>Changes · 2 files</span></div><PatchPreview /><div className={styles.checkRow}><CheckIcon size={15} />npm test <span>12 passed</span></div></div>
    <div className={styles.message}><LogoMark size={23} /><h3>Fix the session timeout</h3><p>Updated the default timeout to 30 minutes and added a test for the new behavior.</p><div className={styles.messageRule} /><p>The project checks passed on the final patch. The diff is ready for your review.</p><span className={styles.messageStatus}><CheckIcon size={13} />Checks passed</span><span className={styles.example}>Illustrative example</span></div>
  </div>;
}

export function SandboxVisual() {
  return <div className={`${styles.stage} ${styles.terminalStage}`} aria-label="Illustration of an isolated run and its event log"><div className={styles.terminalWindow}><div className={styles.chrome}><i /><i /><i /><span>caramel · isolated workspace</span></div><div className={styles.terminalContent}><p><span>$</span> caramel run --task "Fix the session timeout"</p><p className={styles.terminalMuted}>Preparing a snapshot of caramel-ai…</p><p><ShieldIcon size={14} /><span>Workspace ready</span></p><div className={styles.path}>caramel-ai <span>→</span> isolated snapshot</div><p className={styles.terminalMuted}>Your working directory stays separate.</p><div className={styles.terminalRule} />{["Read session configuration", "Plan the change", "Update timeout and tests", "Run project checks"].map((line, index) => <div className={styles.event} key={line}><span>0{index + 1}</span><CheckIcon size={12} />{line}</div>)}<div className={styles.terminalRule} /><p><span>✓</span> Patch exported for review</p><span className={styles.example}>Illustrative example</span></div></div></div>;
}

export function EvidenceVisual() {
  return <div className={styles.stage} aria-label="Illustration of verification evidence"><div className={styles.evidenceWindow}><div className={styles.chrome}><i /><i /><i /><span>Run evidence</span></div><div className={styles.evidenceContent}><span className={styles.evidenceIcon}><ShieldIcon size={25} /></span><h3>Verified by your checks.</h3><p>The final code. The project’s own tests.</p>{[{Icon:DocIcon,title:"Changes recorded",sub:"src/auth.ts · tests/session.test.ts"},{Icon:TerminalIcon,title:"Project checks passed",sub:"npm test · 12 passed"},{Icon:CheckIcon,title:"Final diff reviewed",sub:"Evidence tied to the final patch"}].map(({Icon,title,sub})=><div className={styles.evidenceRow} key={title}><Icon size={18}/><div><strong>{title}</strong><span>{sub}</span></div><CheckIcon size={14}/></div>)}<span className={styles.example}>Illustrative example</span></div></div></div>;
}
