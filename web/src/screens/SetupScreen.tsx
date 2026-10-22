import { useNavigate } from "react-router-dom";
import { useProviders } from "../data";
import { Page, PageHeader } from "../patterns";
import { Button } from "../ui";
import { ProviderKeys } from "./ProviderKeys";
import styles from "./screens.module.css";

/** Bring your own key. Caramel has no shared model account, so this is the first stop for a new user. */
export function SetupScreen() {
  const navigate = useNavigate();
  const providers = useProviders();
  const ready = (providers.data ?? []).some((view) => view.last4 !== null);
  return (
    <Page narrow>
      <PageHeader
        title="Model providers"
        subtitle="Caramel runs on your own model account. Add a key for at least one provider; you pay the provider directly for what your runs use."
        actions={ready ? <Button variant="primary" onClick={() => navigate("/")}>Start a run</Button> : undefined}
      />
      <div className={styles.note}>
        Want Claude, GPT or Grok? Use an OpenRouter key: one key reaches all of them, and you choose the model per run.
      </div>
      <ProviderKeys />
    </Page>
  );
}
