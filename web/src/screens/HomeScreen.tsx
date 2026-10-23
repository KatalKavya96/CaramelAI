import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, apiErrorMessage, useCapabilities, useProviders, useRuns, useSession, useStartRun } from "../data";
import { BUDGET_PRESETS, defaultRunOptions, ModelPicker, RunComposer, sandboxLabel, type RunOptions } from "../domain";
import type { Capabilities, Provider, StartRunBody } from "../lib/contract";
import { sourceUrl } from "../lib/format";
import { BrandFooter, ErrorBanner, Hero, QuickActions, TopBar } from "../patterns";
import { AlertIcon, Button, CheckIcon, CodeIcon, GearIcon, IconButton, KeyIcon, PencilIcon } from "../ui";
import { useUiState } from "../app/ui-state";
import styles from "./screens.module.css";

import { useDraft } from "../patterns/useDraft";

const OPTIONS_KEY = "caramel-run-options";

function loadOptions(capabilities: Capabilities): RunOptions {
  const fallback = defaultRunOptions(capabilities);
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null") as Partial<RunOptions> | null;
    if (saved === null) return fallback;
    const merged = { ...fallback, ...saved, checks: [] };
    // A choice the server does not offer (saved on another server, or before an update) falls back.
    if (!capabilities.repoKinds.includes(merged.repoKind)) merged.repoKind = fallback.repoKind;
    if (!capabilities.network.choices.includes(merged.network)) merged.network = fallback.network;
    return merged;
  } catch {
    return fallback;
  }
}

const QUICK: { label: string; prefix: string; icon: JSX.Element }[] = [
  { label: "Fix a bug", prefix: "Fix the bug where ", icon: <AlertIcon size={20} /> },
  { label: "Add tests", prefix: "Add tests for ", icon: <CheckIcon size={20} /> },
  { label: "Refactor", prefix: "Refactor ", icon: <CodeIcon size={20} /> },
  { label: "Update docs", prefix: "Update the documentation for ", icon: <PencilIcon size={20} /> },
];

/** The home mockup, as a run launcher: hero, composer with run options, quick task starters. */
export function HomeScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const providers = useProviders();
  const runs = useRuns();
  const start = useStartRun();
  const ui = useUiState();
  const capabilities = useCapabilities();
  const session = useSession();
  const [task, setTask] = useDraft(`new:${session.data?.userId ?? "local"}`);
  const [starterNotice, setStarterNotice] = useState("");
  const [options, setOptions] = useState<RunOptions>(() => loadOptions(capabilities));

  // A repository passed from the Repositories page wins over the remembered one.
  useEffect(() => {
    const repo = params.get("repo");
    if (repo === null) return;
    const local = !/^https?:/.test(repo);
    setOptions((current) => (local ? { ...current, repoKind: "local", localPath: repo } : { ...current, repoKind: "git", repoUrl: repo, gitRef: "" }));
  }, [params]);

  // Pick a connected provider when none is chosen, or the chosen one lost its key.
  const views = providers.data ?? [];
  useEffect(() => {
    const connected = views.filter((view) => view.last4 !== null);
    if (connected.length === 0) {
      if (providers.isSuccess && options.provider !== null) setOptions(current => ({ ...current, provider:null, model:"" }));
      return;
    }
    if (options.provider === null || !connected.some((view) => view.provider === options.provider)) {
      const pick = connected.find((view) => view.verified) ?? connected[0];
      if (pick !== undefined) setOptions((current) => ({ ...current, provider: pick.provider, model: pick.defaultModel }));
    }
  }, [views, options.provider, providers.isSuccess]);

  useEffect(() => {
    try {
      const { checks: _checks, ...rest } = options;
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(rest));
    } catch {
      // ignore
    }
  }, [options]);

  const recentRepos = [...new Map((runs.data ?? []).map((run) => [sourceUrl(run.request.repo), { kind: run.request.repo.kind, value: sourceUrl(run.request.repo) }])).values()].slice(0, 6);
  const pickFolder = window.caramelShell?.pickFolder;
  const noKeys = providers.isSuccess && views.every((view) => view.last4 === null);

  const submit = () => {
    if (options.provider === null) return;
    const preset = BUDGET_PRESETS.find((item) => item.id === options.preset);
    const body: StartRunBody = {
      task: task.trim(),
      repo: options.repoKind === "local" ? { kind: "local", path: options.localPath.trim() } : { kind: "git", url: options.repoUrl.trim(), ...(options.gitRef === "" ? {} : { ref: options.gitRef }) },
      provider: options.provider,
      ...(options.model === "" ? {} : { model: options.model }),
      ...(preset?.budgets === undefined ? {} : { budgets: preset.budgets }),
      ...(options.checks.length === 0 ? {} : { verificationCommands: options.checks }),
      // Sent only when the server lets the user choose; a hosted server rejects "full".
      ...(capabilities.network.choices.length > 1 ? { network: options.network } : {}),
    };
    start.mutate(body, { onSuccess: (run) => { setTask(""); navigate(`/runs/${run.id}`); } });
  };

  const error = start.error instanceof ApiError ? apiErrorMessage(start.error.status, start.error.code, start.error.issues, start.error.detail) : start.error === null ? null : "Could not start the run.";

  // Keep the model choice beside the task instead of duplicating it in the top bar.
  const pickerProps = { providers: views, provider: options.provider, model: options.model, onChange: (provider: Provider, model: string) => setOptions((current) => ({ ...current, provider, model })), onManageKeys: () => navigate("/setup") };


  return (
    <div className={styles.home}>
      <div className={styles.homeTop}>
        <TopBar end={<IconButton label="Settings" icon={<GearIcon size={22} />} onClick={() => ui.openSettings()} />} />
      </div>
      <div className={styles.homeCenter}>
        <Hero title="What should Caramel work on?" subtitle="Describe a change. Caramel makes it in your repository and checks the result with your project’s own commands." />
        {providers.isError ? <ErrorBanner message="Could not load model providers. Your draft is kept." onRetry={() => void providers.refetch()} /> : null}
        {noKeys ? (
          <div className={styles.setupCallout}>
            <KeyIcon size={20} />
            <span>Connect a model provider to start. Caramel runs on your own key.</span>
            <Button size="sm" variant="primary" onClick={() => navigate("/setup")}>Connect</Button>
          </div>
        ) : null}
        <div className={styles.composerWrap}>
          <RunComposer
            task={task}
            onTaskChange={setTask}
            options={options}
            onOptionsChange={setOptions}
            onSubmit={submit}
            busy={start.isPending}
            providerReady={providers.isSuccess && views.some(view => view.provider === options.provider && view.last4 !== null)}
            capabilities={capabilities}
            recentRepos={recentRepos}
            {...(pickFolder === undefined ? {} : { onPickFolder: () => pickFolder() })}
            trailing={<ModelPicker {...pickerProps} short />}
            footnote={`${sandboxLabel(capabilities.sandbox, options.network)}. ${capabilities.canApply ? "Your files change only when you apply the result." : "You get a patch to review; nothing is pushed."}`}
          />
          {error === null ? null : <ErrorBanner message={error} />}
        </div>
        {task !== "" ? <div className={styles.draftBar}><span>Unsent draft</span><Button size="sm" variant="ghost" onClick={() => { setTask(""); setStarterNotice(""); }}>Discard draft</Button></div> : null}
        <p role="status" className={styles.panelNote}>{starterNotice}</p>
        <QuickActions label="Start from" actions={QUICK.map((item) => ({ label: item.label, icon: item.icon, onClick: () => { if (task.trim()) { setStarterNotice("Your draft was kept. Clear it to use a starter."); } else { setTask(item.prefix); setStarterNotice(""); } } }))} />
      </div>
      <BrandFooter />
    </div>
  );
}
