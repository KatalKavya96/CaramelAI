import { useState } from "react";
import { apiErrorMessage, ApiError, useCapabilities, useDeleteKey, useProviders, useSaveKey, useTestKey } from "../data";
import { ProviderKeyForm } from "../domain";
import type { KeyTestResult, Provider } from "../lib/contract";
import { ErrorBanner, Skeleton } from "../patterns";
import styles from "./screens.module.css";

function message(error: unknown): string {
  return error instanceof ApiError ? apiErrorMessage(error.status, error.code, error.issues, error.detail) : "Something went wrong.";
}

/** Every provider's key form. Used by the setup page and the settings dialog's provider tab. */
export function ProviderKeys() {
  const providers = useProviders();
  const capabilities = useCapabilities();
  const save = useSaveKey();
  const test = useTestKey();
  const remove = useDeleteKey();
  const [busy, setBusy] = useState<{ provider: Provider; kind: "save" | "test" | "delete" } | null>(null);
  const [tests, setTests] = useState<Partial<Record<Provider, KeyTestResult>>>({});
  const [errors, setErrors] = useState<Partial<Record<Provider, string>>>({});

  if (providers.isLoading) return <Skeleton lines={4} />;
  if (providers.isError) return <ErrorBanner message={message(providers.error)} onRetry={() => void providers.refetch()} />;

  const run = <T,>(provider: Provider, kind: "save" | "test" | "delete", promise: Promise<T>, onDone: (value: T) => void) => {
    setBusy({ provider, kind });
    setErrors((current) => ({ ...current, [provider]: undefined }));
    promise
      .then(onDone)
      .catch((error: unknown) => setErrors((current) => ({ ...current, [provider]: message(error) })))
      .finally(() => setBusy(null));
  };

  return (
    <div className={styles.stack}>
      {(providers.data ?? []).map((view) => (
        <ProviderKeyForm
          key={view.provider}
          view={view}
          storage={capabilities.mode === "local" ? "keychain" : "server"}
          busy={busy?.provider === view.provider ? busy.kind : null}
          lastTest={tests[view.provider] ?? null}
          error={errors[view.provider] ?? null}
          onSave={(key) => run(view.provider, "save", save.mutateAsync({ provider: view.provider, key }), (saved) => setTests((current) => ({ ...current, [view.provider]: saved.test })))}
          onTest={() => run(view.provider, "test", test.mutateAsync(view.provider), (result) => setTests((current) => ({ ...current, [view.provider]: result })))}
          onDelete={() => run(view.provider, "delete", remove.mutateAsync(view.provider), () => setTests((current) => ({ ...current, [view.provider]: undefined })))}
        />
      ))}
    </div>
  );
}
