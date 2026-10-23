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
  busy: "save" | "test" | "delete" | "connect" | null;
  lastTest?: KeyTestResult | null;
  error?: string | null;
  /** A custom endpoint also sends its base URL and model; its key may be empty. */
  onSave: (key: string, endpoint?: { baseUrl: string; model: string }) => void;
  /** Present when the provider can be connected by signing in (OpenRouter on the desktop). */
  onConnect?: () => void;
  onTest: () => void;
  onDelete: () => void;
  /** Where the key is kept, for the hint under the field. */
  storage?: "server" | "keychain";
}

/**
 * One provider's key. The key is write-only: once saved, only the last four characters come back,
 * so the field is always empty and "Replace" means pasting a new one.
 */
export function ProviderKeyForm({ view, busy, lastTest = null, error = null, onSave, onConnect, onTest, onDelete, storage = "server" }: ProviderKeyFormProps) {
  const copy = PROVIDER_COPY[view.provider];
  const custom = view.provider === "custom";
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(view.endpoint ?? "");
  const [model, setModel] = useState(custom ? view.defaultModel : "");
  const saved = view.last4 !== null;
  const canSave = custom ? baseUrl.trim() !== "" && model.trim() !== "" : key.trim() !== "";
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
          {custom ? <><code>{view.endpoint}</code> · </> : null}
          {view.last4 === "none" ? "No key" : <>Key ending in <code>{view.last4}</code></>}
          {view.updatedAt === null ? "" : ` · saved ${formatWhen(view.updatedAt)}`} · default model <code>{view.defaultModel}</code>
        </p>
      ) : null}
      {onConnect === undefined ? null : (
        <div className={styles.connect}>
          <Button type="button" variant="primary" disabled={busy !== null} onClick={onConnect}>
            {busy === "connect" ? "Waiting for OpenRouter…" : saved ? "Reconnect with OpenRouter" : "Connect with OpenRouter"}
          </Button>
          <span className={styles.connectHint}>
            {busy === "connect" ? "Finish signing in in your browser. This updates by itself." : "Sign in on openrouter.ai and approve. No key to copy."}
          </span>
        </div>
      )}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          if (custom) onSave(key.trim(), { baseUrl: baseUrl.trim(), model: model.trim() });
          else onSave(key.trim());
        }}
      >
        {custom ? (
          <>
            <TextField
              label="Base URL"
              spellCheck={false}
              placeholder="http://localhost:11434/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              hint="Usually ends in /v1. Plain http works only for this computer (localhost); anything else needs https."
            />
            <TextField
              label="Model"
              spellCheck={false}
              placeholder={copy.modelExample}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              hint="The model name the server expects, as in its model list."
            />
          </>
        ) : null}
        <TextField
          label={custom ? "API key (optional)" : saved ? (onConnect === undefined ? "Replace key" : "Or paste a key") : onConnect === undefined ? "API key" : "Or paste a key"}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={copy.keyHint}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          hint={<>{custom ? "Only if the server needs one, like Groq or Together." : <>Get one at <a href={copy.keyUrl} target="_blank" rel="noreferrer">{new URL(copy.keyUrl).host}</a>.</>} {storage === "keychain" ? "It is kept in your system keychain" : "It is encrypted at rest"} and never shown again.</>}
          {...(error === null ? {} : { error })}
        />
        <div className={styles.actions}>
          <Button type="submit" variant={onConnect === undefined ? "primary" : "secondary"} disabled={!canSave || busy !== null}>{busy === "save" ? "Saving…" : "Save and test"}</Button>
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
