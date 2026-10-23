import { useEffect, useState } from "react";
import { apiErrorMessage, ApiError, useCapabilities, useConnectProvider, useDeleteKey, useProviders, useSaveKey, useTestKey } from "../data";
import { PROVIDER_COPY } from "../domain/providers";
import { Button, SelectField } from "../ui";
import { ProviderKeyForm } from "../domain";
import type { KeyTestResult, Provider } from "../lib/contract";
import { ErrorBanner, Skeleton } from "../patterns";
import styles from "./screens.module.css";

/** The OpenRouter sign-in gives up after this long, matching how long its one-time link lasts. */
const CONNECT_TIMEOUT_MS = 10 * 60_000;

/**
 * Opens a sign-in page in the user's own browser. In the desktop app, leaving the app's origin is
 * caught by the shell and sent to the system browser, so the window itself stays put.
 */
function openExternal(url: string) {
  if ("caramelShell" in window) window.location.assign(url);
  else window.open(url, "_blank", "noopener");
}

function message(error: unknown): string {
  return error instanceof ApiError ? apiErrorMessage(error.status, error.code, error.issues, error.detail) : "Something went wrong.";
}

/** Every provider's key form. Used by the setup page and the settings dialog's provider tab. */
export function ProviderKeys() {
  const providers = useProviders();
  const [selected, setSelected] = useState<Provider | "">("");
  const capabilities = useCapabilities();
  const save = useSaveKey();
  const test = useTestKey();
  const remove = useDeleteKey();
  const connect = useConnectProvider();
  const [busy, setBusy] = useState<{ provider: Provider; kind: "save" | "test" | "delete" | "connect" } | null>(null);
  // While a sign-in is open in the browser, the key arrives at the server, not here: poll until it shows up.
  const [connecting, setConnecting] = useState<{ provider: Provider; since: number; before: string | null } | null>(null);

  useEffect(() => {
    if (connecting === null) return;
    const timer = window.setInterval(() => void providers.refetch(), 2_000);
    return () => window.clearInterval(timer);
  }, [connecting, providers]);

  useEffect(() => {
    if (connecting === null) return;
    const view = providers.data?.find((candidate) => candidate.provider === connecting.provider);
    const arrived = view !== undefined && view.updatedAt !== connecting.before;
    if (arrived || Date.now() - connecting.since > CONNECT_TIMEOUT_MS) {
      setConnecting(null);
      setBusy(null);
      if (!arrived) setErrors((current) => ({ ...current, [connecting.provider]: "The sign-in was not finished. Press Connect to try again." }));
    }
  }, [connecting, providers.data]);
  const [tests, setTests] = useState<Partial<Record<Provider, KeyTestResult>>>({});
  const [errors, setErrors] = useState<Partial<Record<Provider, string>>>({});

  if (providers.isLoading) return <Skeleton lines={4} />;
  if (providers.isError) return <ErrorBanner message={message(providers.error)} onRetry={() => void providers.refetch()} />;

  const run = <T,>(provider: Provider, kind: "save" | "test" | "delete" | "connect", promise: Promise<T>, onDone: (value: T) => void) => {
    setBusy({ provider, kind });
    setErrors((current) => ({ ...current, [provider]: undefined }));
    promise
      .then(onDone)
      .catch((error: unknown) => setErrors((current) => ({ ...current, [provider]: message(error) })))
      .finally(() => setBusy(null));
  };

  return (
    <div className={styles.stack}>
      <SelectField label="Choose a model provider" value={selected} onChange={event => setSelected(event.target.value as Provider | "")} hint="Connect one provider to get started. You can add others later.">
        <option value="">Choose a provider…</option>
        {(providers.data ?? []).map(view => <option key={view.provider} value={view.provider}>{PROVIDER_COPY[view.provider].name}{view.last4 !== null ? " · connected" : ""}</option>)}
      </SelectField>
      {connecting ? <div role="status">Waiting for provider sign-in. Finish in the opened browser window. <Button size="sm" onClick={() => { setConnecting(null); setBusy(null); }}>Stop waiting</Button></div> : null}
      {(providers.data ?? []).filter(view => selected ? view.provider === selected : view.last4 !== null).map((view) => (
        <ProviderKeyForm
          key={view.provider}
          view={view}
          storage={capabilities.mode === "local" ? "keychain" : "server"}
          busy={busy?.provider === view.provider ? busy.kind : null}
          lastTest={tests[view.provider] ?? null}
          error={errors[view.provider] ?? null}
          onSave={(key, endpoint) => run(view.provider, "save", save.mutateAsync({ provider: view.provider, key, endpoint }), (saved) => setTests((current) => ({ ...current, [view.provider]: saved.test })))}
          onConnect={view.oauth && capabilities.mode === "local" ? () => {
            setBusy({ provider: view.provider, kind: "connect" });
            setErrors((current) => ({ ...current, [view.provider]: undefined }));
            connect.mutateAsync(view.provider).then(({ url }) => {
              setConnecting({ provider: view.provider, since: Date.now(), before: view.updatedAt });
              openExternal(url);
            }).catch((error: unknown) => {
              setBusy(null);
              setErrors((current) => ({ ...current, [view.provider]: message(error) }));
            });
          } : undefined}
          onTest={() => run(view.provider, "test", test.mutateAsync(view.provider), (result) => setTests((current) => ({ ...current, [view.provider]: result })))}
          onDelete={() => run(view.provider, "delete", remove.mutateAsync(view.provider), () => setTests((current) => ({ ...current, [view.provider]: undefined })))}
        />
      ))}
    </div>
  );
}
