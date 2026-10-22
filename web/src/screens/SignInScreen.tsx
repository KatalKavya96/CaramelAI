import { BrandFooter, Hero } from "../patterns";
import { Button, GitHubIcon } from "../ui";
import styles from "./screens.module.css";

/** Signed-out landing: the home mockup's hero with one action. */
export function SignInScreen({ loginUrl }: { loginUrl: string }) {
  // The desktop app has no sign-in page: its launch link sets the session. Landing here means the
  // link was from an earlier launch, or the page was opened without it.
  if (window.location.hostname === "127.0.0.1") {
    return (
      <div className={styles.signIn}>
        <Hero title="Caramel" subtitle="This window is not connected to a running Caramel.">
          <p className={styles.signInNote}>Start Caramel again, or open the link it printed when it started. Each launch has its own link.</p>
        </Hero>
        <BrandFooter />
      </div>
    );
  }
  return (
    <div className={styles.signIn}>
      <Hero title="Caramel" subtitle="An agent that makes changes in your repository and proves them with your own checks.">
        <Button variant="primary" size="lg" icon={<GitHubIcon size={20} />} onClick={() => window.location.assign(loginUrl)}>
          Continue with GitHub
        </Button>
        <p className={styles.signInNote}>Caramel reads public repositories over https. Nothing is pushed back.</p>
      </Hero>
      <BrandFooter />
    </div>
  );
}
