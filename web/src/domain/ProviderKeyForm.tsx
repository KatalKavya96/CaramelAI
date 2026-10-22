import { useState } from "react";
import type { KeyTestResult, ProviderKeyView } from "../lib/contract";
import { formatWhen } from "../lib/format";
import { Button, CheckIcon, KeyIcon, TextField } from "../ui";
import { PROVIDER_COPY } from "./providers";
import styles from "./ProviderKeyForm.module.css";

const TEST_COPY: Record<Exclude<KeyTestResult, { ok: true }>["error"], string> = {
  invalid_key: "The provider rejected this key.",
  no_credit: "The key works, but the account has no credit left.",
  rate_limited: "The provider is rate limiting this key. Try again in a minute.",
  provider_error: "The provider did not answer. The key was saved but not verified.",
};

export interface ProviderKeyFormProps {
  view: ProviderKeyView;
  busy: "save" | "test" | "delete" | null;
  lastTest?: KeyTestResult | null;
  error?: string | null;
  onSave: (key: string) => void;
  onTest: () => void;
  onDelete: () => void;
  /** Where the key is kept, for the hint under the field. */
  storage?: "server" | "keychain";
}

/**
 * One provider's key. The key is write-only: once saved, only the last four characters come back,
 * so the field is always empty and "Replace" means pasting a new one.
 */
export function ProviderKeyForm({ view, busy, lastTest = null, error = null, onSave, onTest, onDelete, storage = "server" }: ProviderKeyFormProps) {
  const copy = PROVIDER_COPY[view.provider];
  const [key, setKey] = useState("");
  const saved = view.last4 !== null;
  const testMessage = lastTest === null ? null : lastTest.ok ? "Key works." : TEST_COPY[lastTest.error];
  return (
    <section className={styles.card} aria-labelledby={`provider-${view.provider}`}>
      <header className={styles.head}>
        <span className={styles.icon}><KeyIcon size={18} /></span>
        <div className={styles.titles}>
          <h3 id={`provider-${view.provider}`} className={styles.name}>{copy.name}</h3>
          <p className={styles.blurb}>{copy.blurb}</p>
        </div>
        {saved ? (
          <span className={view.verified ? styles.verified : styles.unverified}>
            {view.verified ? <CheckIcon size={14} /> : null}
            {view.verified ? "Connected" : "Not verified"}
          </span>
        ) : null}
      </header>
      {saved ? (
        <p className={styles.saved}>
          Key ending in <code>{view.last4}</code>
          {view.updatedAt === null ? "" : ` · saved ${formatWhen(view.updatedAt)}`} · default model <code>{view.defaultModel}</code>
        </p>
      ) : null}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (key.trim() !== "") onSave(key.trim());
        }}
      >
        <TextField
          label={saved ? "Replace key" : "API key"}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={copy.keyHint}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          hint={<>Get one at <a href={copy.keyUrl} target="_blank" rel="noreferrer">{new URL(copy.keyUrl).host}</a>. {storage === "keychain" ? "It is kept in your system keychain" : "It is encrypted at rest"} and never shown again.</>}
          {...(error === null ? {} : { error })}
        />
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={key.trim() === "" || busy !== null}>{busy === "save" ? "Saving…" : "Save and test"}</Button>
          {saved ? <Button type="button" variant="secondary" disabled={busy !== null} onClick={onTest}>{busy === "test" ? "Testing…" : "Test"}</Button> : null}
          {saved ? <Button type="button" variant="danger-outline" disabled={busy !== null} onClick={onDelete}>{busy === "delete" ? "Removing…" : "Remove"}</Button> : null}
        </div>
        {testMessage === null ? null : (
          <p role="status" className={lastTest?.ok === true ? styles.ok : styles.bad}>{testMessage}</p>
        )}
      </form>
    </section>
  );
}
