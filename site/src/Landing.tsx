import { useEffect, useState } from "react";
import { LogoMark } from "@web/ui/Logo";
import { BranchIcon, CheckIcon, DocIcon, GitHubIcon, KeyIcon, ShieldIcon } from "@web/ui/icons";
import { LINKS } from "./links";
import { ProductPreview } from "./ProductPreview";
import { ReviewVisual, SandboxVisual, EvidenceVisual } from "./FeaturePreview";
import { RunReplay } from "./replay/RunReplay";
import { RUNS } from "./replay/runs";
import { useThemeToggle } from "./theme";
import { Navbar } from "./navigation/Navbar";
import { LandingOverlays, type Overlay } from "./experience/LandingOverlays";
import { useAppearance } from "./experience/useAppearance";
import { Updates, WhatsNewPill, useUpdates } from "./experience/Updates";
import styles from "./Landing.module.css";

function Brand() {
  return <a href="#top" className={styles.brand} aria-label="Caramel, back to top"><LogoMark size={29} /><span>caramel</span></a>;
}

function BellIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>;
}

function Ctas({ hintId }: { hintId: string }) {
  return <div className={styles.ctas}>
    <div className={styles.ctaRow}>
      <a className={styles.cta} href={LINKS.github}><GitHubIcon size={18} />Star on GitHub</a>
      <a className={styles.ctaSecondary} href={LINKS.notify} aria-describedby={hintId}><BellIcon />Get notified</a>
    </div>
    <p id={hintId} className={styles.hint}>Desktop app coming soon. CLI available now.</p>
  </div>;
}

function ProviderPreview() {
  const [provider, setProvider] = useState("DeepSeek");
  return <div className={styles.providerCard}>
    <label htmlFor="provider-preview">Model provider</label>
    <p>Connect the provider you prefer.</p>
    <div className={styles.providerSelect}><KeyIcon size={17} /><select id="provider-preview" value={provider} onChange={(event) => setProvider(event.target.value)}><option>DeepSeek</option><option>OpenRouter</option><option>Qwen</option></select></div>
    <span className={styles.fieldLabel}>API key</span>
    <div className={styles.exampleKey} aria-label="Illustration of a masked provider key"><span aria-hidden="true">••••••••••••••••••••••••</span><KeyIcon size={15} /></div>
    <span className={styles.cardHint}>Preview only · connect your key in Caramel</span>
  </div>;
}

const steps = [
  { title: "Choose a repo", body: "Point Caramel at a repository and give it the context it needs." },
  { title: "Describe the task", body: "Share an issue, a bug, or an idea in plain language." },
  { title: "Watch the checks", body: "Caramel reads, plans, edits, and runs your project's checks." },
  { title: "Review the patch", body: "See the changes and evidence. Decide what to apply." },
];

export function Landing() {
  const [theme, toggle] = useThemeToggle();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const { appearance, toggleAppearance } = useAppearance();
  const { updates, hasRelease } = useUpdates();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOverlay(current => current === "commands" ? null : "commands");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return <>
    <a className={styles.skip} href="#main">Skip to content</a>
    <Navbar theme={theme} toggleTheme={toggle} reducedMotion={appearance.motion} onOpenCommands={() => setOverlay("commands")} onQuickStart={() => setOverlay("quickstart")} />
    <LandingOverlays overlay={overlay} setOverlay={setOverlay} theme={theme} toggleTheme={toggle} appearance={appearance} toggleAppearance={toggleAppearance} />
    <main id="main" className={styles.main}>
      <section id="top" className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.appIcon}><LogoMark size={49} /></div>
        <h1 id="hero-title">Build anything with Caramel.</h1>
        <p className={styles.lead}>From issue to reviewed patch. Your repo, your model, your checks.</p>
        <div className={styles.heroAction}><button type="button" className={styles.cta} onClick={() => setOverlay("quickstart")}>Get started <span aria-hidden="true">↗</span></button><p className={styles.hint}>Open-source coding agent · bring your own key</p></div>
        <WhatsNewPill hasRelease={hasRelease} latest={updates[0]} />
        <div className={styles.workflowStrip}><p>Built around your workflow</p><div><span><BranchIcon size={22} />Your repositories</span><span><KeyIcon size={22} />Your model</span><span><ShieldIcon size={22} />Your checks</span><span><DocIcon size={22} />Your review</span></div></div>
        <div id="product" className={styles.heroPreview}><ProductPreview /></div>
      </section>
      <section id="get-started" className={styles.getStarted} aria-labelledby="start-title">
        <h2 id="start-title" className={styles.sectionTitle}>Get started</h2><p className={styles.sectionLead}>Start with the CLI today. Follow the desktop app as it takes shape.</p>
        <div className={styles.startCards}>
          <article><h3>Caramel CLI</h3><p>A task, a repository, and the model you choose.</p><span className={styles.availability}>Available now</span><button type="button" className={styles.cta} onClick={() => setOverlay("quickstart")}>Start building <span aria-hidden="true">›</span></button></article>
          <article><h3>Desktop app</h3><p>A focused workspace to follow runs and review the result.</p><span className={styles.availability}>In development</span><a className={styles.cta} href={LINKS.notify}>Get notified <span aria-hidden="true">›</span></a></article>
          <article><h3>Open source</h3><p>Explore the harness, read the code, and make it your own.</p><span className={styles.availability}>Built in the open</span><a className={styles.cta} href={LINKS.github}>Explore GitHub <span aria-hidden="true">›</span></a></article>
        </div>
      </section>
      <section className={styles.features} aria-labelledby="features-title">
        <h2 id="features-title" className={styles.sectionTitle}>A clearer way to build with agents.</h2>
        <article className={styles.featureRow}><div className={styles.featureCopy}><h3>Built for real engineering work</h3><p>Give Caramel a bug, an issue, or a focused task. Follow the plan, see the edits, and review a patch backed by your project's checks.</p><a className={styles.textLink} href="#example-replay">Explore an example <span aria-hidden="true">↗</span></a></div><ReviewVisual /></article>
        <article className={styles.featureRow}><div className={styles.featureCopy}><h3>Room to work. <br />Control to keep.</h3><p>Every run starts in an isolated snapshot. Caramel can read, edit, and run commands while your working directory stays separate.</p><a className={styles.textLink} href={LINKS.docs}>How isolation works <span aria-hidden="true">↗</span></a></div><SandboxVisual /></article>
        <article className={styles.featureRow}><div className={styles.featureCopy}><h3>Checks decide <br />what is verified.</h3><p>Caramel uses checks from your repository and ties their results to the final code. See the evidence behind the outcome, including when a run is only partial.</p><a className={styles.textLink} href="#example-replay">See the evidence <span aria-hidden="true">↗</span></a></div><EvidenceVisual /></article>
      </section>
      <section id="how" className={styles.how} aria-labelledby="how-title">
        <p className={styles.eyebrow}>How it works</p><h2 id="how-title" className={styles.sectionTitle}>From issue to evidence.</h2><p className={styles.sectionLead}>A clear, checkable process, from the first instruction to the final diff.</p>
        <ol className={styles.steps}>{steps.map((step, i) => <li key={step.title}><div className={styles.stepTrack}><span>{i + 1}</span>{i < steps.length - 1 ? <span className={styles.stepArrow} aria-hidden="true">→</span> : null}</div><h3>{step.title}</h3><p>{step.body}</p></li>)}</ol>
      </section>
      <section className={styles.providerSection} aria-labelledby="provider-title"><div><p className={styles.eyebrow}>Bring your own key</p><h2 id="provider-title" className={styles.featureTitle}>Your key. Your model.</h2><p className={styles.body}>Bring your own provider key. Choose the model that works for you and follow each run from task to patch.</p><a href={LINKS.docs} className={styles.textLink}>Explore the docs <span aria-hidden="true">↗</span></a></div><ProviderPreview /></section>
      <details id="example-replay" className={styles.replay}><summary><span><CheckIcon size={18} />Go deeper: replay an example run</span><span className={styles.summaryHint}>Verified and partial outcomes <span aria-hidden="true">+</span></span></summary><div className={styles.replayContent}><p>Hand-written examples demonstrate how the harness checks the work, including a run it refuses to verify.</p><RunReplay runs={RUNS} /></div></details>
      <Updates updates={updates} hasRelease={hasRelease} />
      <section className={styles.closing}><h2 className={styles.sectionTitle}>Start building with Caramel.</h2><p className={styles.sectionLead}>Agents that show their work. From issue to reviewed patch.</p><div className={styles.closingActions}><button type="button" className={styles.cta} onClick={() => setOverlay("quickstart")}>Open the quick-start guide <span aria-hidden="true">↗</span></button></div><Ctas hintId="closing-availability" /><p className={styles.releaseHint}>To hear when the desktop app ships, watch <a href={LINKS.notify}>GitHub releases</a>.</p></section>
    </main>
    <footer className={styles.footer}><Brand /><p>Built for work you can verify.</p><nav aria-label="Footer"><a href="#product">Product</a><a href="#how">How it works</a><a href={LINKS.docs}>Docs</a><a href={LINKS.github}>GitHub</a><button type="button" onClick={() => setOverlay("commands")}>Search & display options</button></nav></footer>
  </>;
}
