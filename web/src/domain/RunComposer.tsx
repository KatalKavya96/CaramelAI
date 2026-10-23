import { useState, type ReactNode } from "react";
import type { Capabilities, Provider, ProviderKeyView } from "../lib/contract";
import { repoLabel } from "../lib/format";
import { Composer } from "../patterns";
import { BranchIcon, Button, ChevronDownIcon, Dialog, FolderIcon, GlobeIcon, Menu, Pill, SegmentedControl, ShieldIcon, SlidersIcon, TextAreaField, TextField } from "../ui";
import { PROVIDER_COPY } from "./providers";
import { BUDGET_PRESETS, repoDisplay, repoError, type RepoKind, type RunOptions } from "./run-options";
import styles from "./RunComposer.module.css";

export interface ModelPickerProps {
  providers: ProviderKeyView[];
  provider: Provider | null;
  model: string;
  onChange: (provider: Provider, model: string) => void;
  onManageKeys: () => void;
  /** Model name only (no provider, no vendor prefix), for the pill inside the composer. */
  short?: boolean;
}

/** The top-left pill from the mockups, now listing the providers you have keys for. */
export function ModelPicker({ providers, provider, model, onChange, onManageKeys, short = false }: ModelPickerProps) {
  const connected = providers.filter((view) => view.last4 !== null);
  const [otherOpen, setOtherOpen] = useState(false);
  const label = provider === null ? "Connect a model" : short ? (model.split("/").at(-1) ?? model) : `${PROVIDER_COPY[provider].name} · ${model}`;
  return (
    <>
    <Menu
      width={320}
      header={connected.length === 0 ? "No model connected yet" : "Your models"}
      trigger={<Pill size="md" trailingIcon={<ChevronDownIcon size={16} />}>{label}</Pill>}
      items={[
        ...connected.map((view) => ({
          label: PROVIDER_COPY[view.provider].name,
          description: view.verified ? view.defaultModel : `${view.defaultModel} · key not verified`,
          selected: view.provider === provider,
          onSelect: () => onChange(view.provider, view.defaultModel),
        })),
        ...(connected.length === 0 ? [] : ["separator" as const, { label: "Another model…", description: "Any model id your provider offers", onSelect: () => setOtherOpen(true) }]),
        { label: "Model providers…", onSelect: onManageKeys },
      ]}
    />
    <OtherModelDialog open={otherOpen} onOpenChange={setOtherOpen} connected={connected} provider={provider} model={model} onSave={onChange} />
    </>
  );
}

/** Pick any model a connected provider serves, by id: a free OpenRouter model, a Grok release, a local Ollama tag. */
function OtherModelDialog({ open, onOpenChange, connected, provider, model, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; connected: ProviderKeyView[]; provider: Provider | null; model: string; onSave: (provider: Provider, model: string) => void }) {
  const [draftProvider, setDraftProvider] = useState<Provider | null>(provider);
  const [draftModel, setDraftModel] = useState(model);
  const chosen = draftProvider ?? connected[0]?.provider ?? null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraftProvider(provider !== null && connected.some((view) => view.provider === provider) ? provider : (connected[0]?.provider ?? null));
          setDraftModel(model);
        }
        onOpenChange(next);
      }}
      title="Another model"
      description="Type the model id exactly as the provider lists it. The run fails at the first step if the provider does not know it."
      width={480}
    >
      <form
        className={styles.dialogForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (chosen === null || draftModel.trim() === "") return;
          onSave(chosen, draftModel.trim());
          onOpenChange(false);
        }}
      >
        {connected.length > 1 ? (
          <SegmentedControl<Provider>
            label="Provider"
            value={chosen ?? connected[0]!.provider}
            onChange={setDraftProvider}
            segments={connected.map((view) => ({ value: view.provider, label: PROVIDER_COPY[view.provider].name }))}
          />
        ) : null}
        <TextField
          label="Model id"
          placeholder={chosen === null ? "" : PROVIDER_COPY[chosen].modelExample}
          hint={chosen === "openrouter" ? "For example x-ai/grok-4, or a model ending in :free." : undefined}
          value={draftModel}
          onChange={(event) => setDraftModel(event.target.value)}
          autoFocus
          spellCheck={false}
          className={styles.mono}
        />
        <div className={styles.dialogActions}>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={chosen === null || draftModel.trim() === ""}>Use model</Button>
        </div>
      </form>
    </Dialog>
  );
}

export interface RunComposerProps {
  task: string;
  onTaskChange: (task: string) => void;
  options: RunOptions;
  onOptionsChange: (options: RunOptions) => void;
  onSubmit: () => void;
  busy: boolean;
  capabilities: Capabilities;
  /** Repositories and folders from earlier runs, offered in the repository dialog. */
  recentRepos: { kind: RepoKind; value: string }[];
  /** The desktop shell's native folder dialog, when there is one. */
  onPickFolder?: () => Promise<string | null>;
  /** Right of the pills, before send: the model pill, as in the mockup. */
  trailing?: ReactNode;
  footnote?: ReactNode;
}

/**
 * The home composer, styled like the mockup's: text box on top, option pills along the bottom,
 * caramel send button. The model pill is passed in as `trailing`. Repository and checks open
 * small dialogs so the card keeps its shape.
 */
export function RunComposer({ task, onTaskChange, options, onOptionsChange, onSubmit, busy, capabilities, recentRepos, onPickFolder, trailing, footnote }: RunComposerProps) {
  const [repoOpen, setRepoOpen] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const preset = BUDGET_PRESETS.find((item) => item.id === options.preset) ?? BUDGET_PRESETS[1];
  const repoMissing = repoError(options, capabilities.repoKinds) !== null;
  const canSubmit = task.trim() !== "" && !repoMissing && options.provider !== null;
  const set = (patch: Partial<RunOptions>) => onOptionsChange({ ...options, ...patch });
  const canChooseNetwork = capabilities.network.choices.length > 1;

  return (
    <>
      <Composer
        label="Task"
        placeholder={options.repoKind === "local" ? "Describe the change you want in this folder…" : "Describe the change you want in this repository…"}
        submitLabel="Start run"
        value={task}
        onChange={onTaskChange}
        onSubmit={onSubmit}
        canSubmit={canSubmit}
        busy={busy}
        autoFocus
        tools={
          <>
            <Pill size="md" icon={<FolderIcon size={18} />} onClick={() => setRepoOpen(true)} aria-haspopup="dialog" title={repoMissing ? undefined : repoDisplay(options)}>
              {repoMissing ? (capabilities.repoKinds.includes("local") ? "Choose folder" : "Choose repository") : repoLabel(repoDisplay(options))}
            </Pill>
            {repoMissing || options.repoKind === "local" ? null : (
              <Pill size="md" icon={<BranchIcon size={18} />} onClick={() => setRepoOpen(true)} aria-haspopup="dialog">
                {options.gitRef === "" ? "default branch" : options.gitRef}
              </Pill>
            )}
            <Menu
              width={300}
              header="Budget"
              trigger={<Pill size="md" icon={<SlidersIcon size={18} />} trailingIcon={<ChevronDownIcon size={16} />}>{preset?.label}</Pill>}
              items={BUDGET_PRESETS.map((item) => ({ label: item.label, description: item.description, selected: item.id === options.preset, onSelect: () => set({ preset: item.id }) }))}
            />
            <Pill size="md" icon={<ShieldIcon size={18} />} pressed={options.checks.length > 0} onClick={() => setChecksOpen(true)} aria-haspopup="dialog">
              {options.checks.length === 0 ? "Auto checks" : `${options.checks.length} check${options.checks.length === 1 ? "" : "s"}`}
            </Pill>
            {canChooseNetwork ? (
              <Pill
                size="md"
                icon={<GlobeIcon size={18} />}
                pressed={options.network === "full"}
                title="Whether commands in this run can reach the internet, for example to install packages."
                onClick={() => set({ network: options.network === "full" ? "none" : "full" })}
              >
                {options.network === "full" ? "Network on" : "No network"}
              </Pill>
            ) : null}
          </>
        }
        trailing={trailing}
        footnote={footnote}
      />
      <RepoDialog
        open={repoOpen}
        onOpenChange={setRepoOpen}
        options={options}
        kinds={capabilities.repoKinds}
        recent={recentRepos}
        {...(onPickFolder === undefined ? {} : { onPickFolder })}
        onSave={(patch) => set(patch)}
      />
      <ChecksDialog open={checksOpen} onOpenChange={setChecksOpen} checks={options.checks} onSave={(checks) => set({ checks })} />
    </>
  );
}

type RepoPatch = Pick<RunOptions, "repoKind" | "repoUrl" | "gitRef" | "localPath">;

function RepoDialog({ open, onOpenChange, options, kinds, recent, onPickFolder, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; options: RunOptions; kinds: RepoKind[]; recent: { kind: RepoKind; value: string }[]; onPickFolder?: () => Promise<string | null>; onSave: (patch: RepoPatch) => void }) {
  const [draft, setDraft] = useState<RepoPatch>(options);
  const [touched, setTouched] = useState(false);
  const error = touched ? repoError(draft, kinds) : null;
  const update = (patch: Partial<RepoPatch>) => setDraft((current) => ({ ...current, ...patch }));
  const local = draft.repoKind === "local";
  const shown = recent.filter((item) => item.kind === draft.repoKind);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft({ repoKind: kinds.includes(options.repoKind) ? options.repoKind : (kinds[0] ?? "git"), repoUrl: options.repoUrl, gitRef: options.gitRef, localPath: options.localPath });
          setTouched(false);
        }
        onOpenChange(next);
      }}
      title={kinds.includes("local") ? "Repository or folder" : "Repository"}
      description={
        local
          ? "Caramel copies the folder into a sandbox and works on the copy. Your folder changes only when you choose Apply."
          : "Caramel clones it into a sandbox. Nothing is pushed back; you get a patch to review."
      }
      width={540}
    >
      <form
        className={styles.dialogForm}
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (repoError(draft, kinds) !== null) return;
          onSave({ repoKind: draft.repoKind, repoUrl: draft.repoUrl.trim(), gitRef: draft.gitRef.trim(), localPath: draft.localPath.trim() });
          onOpenChange(false);
        }}
      >
        {kinds.length > 1 ? (
          <SegmentedControl<RepoKind>
            label="Source"
            value={draft.repoKind}
            onChange={(repoKind) => {
              update({ repoKind });
              setTouched(false);
            }}
            segments={kinds.map((kind) => ({ value: kind, label: kind === "local" ? "Folder on this computer" : "Git URL" }))}
          />
        ) : null}
        {local ? (
          <div className={styles.pathRow}>
            <TextField
              label="Folder"
              placeholder="/Users/you/code/project"
              hint="The full path to a git repository on this computer."
              value={draft.localPath}
              onChange={(event) => update({ localPath: event.target.value })}
              onBlur={() => setTouched(true)}
              autoFocus
              spellCheck={false}
              {...(error === null ? {} : { error })}
            />
            {onPickFolder === undefined ? null : (
              <Button
                type="button"
                variant="secondary"
                className={styles.browse}
                onClick={() => {
                  void onPickFolder().then((path) => {
                    if (path !== null) {
                      update({ localPath: path });
                      setTouched(true);
                    }
                  });
                }}
              >
                Browse…
              </Button>
            )}
          </div>
        ) : (
          <>
            <TextField
              label={kinds.includes("local") ? "Git URL" : "GitHub URL"}
              placeholder="https://github.com/owner/repo"
              value={draft.repoUrl}
              onChange={(event) => update({ repoUrl: event.target.value })}
              onBlur={() => setTouched(true)}
              autoFocus
              spellCheck={false}
              {...(error === null ? {} : { error })}
            />
            <TextField label="Branch, tag or commit" hint="Leave empty for the default branch." placeholder="main" value={draft.gitRef} onChange={(event) => update({ gitRef: event.target.value })} />
          </>
        )}
        {shown.length === 0 ? null : (
          <div className={styles.recent}>
            <span className={styles.recentLabel}>Recent</span>
            {shown.map((item) => {
              const selected = local ? item.value === draft.localPath : item.value === draft.repoUrl;
              return (
                <Pill key={item.value} size="sm" icon={<FolderIcon size={16} />} pressed={selected} title={item.value} onClick={() => update(local ? { localPath: item.value } : { repoUrl: item.value })}>
                  {repoLabel(item.value)}
                </Pill>
              );
            })}
          </div>
        )}
        <div className={styles.dialogActions}>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary">{local ? "Use folder" : "Use repository"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ChecksDialog({ open, onOpenChange, checks, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; checks: string[]; onSave: (checks: string[]) => void }) {
  const [draft, setDraft] = useState(checks.join("\n"));
  const lines = draft.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(checks.join("\n"));
        onOpenChange(next);
      }}
      title="Final checks"
      description="Commands that must pass on the final code for a run to count as Verified. Leave empty and Caramel finds the repository's own test, build and lint commands."
      width={520}
    >
      <form
        className={styles.dialogForm}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(lines.slice(0, 10));
          onOpenChange(false);
        }}
      >
        <TextAreaField label="One command per line" rows={5} placeholder={"npm test\nnpm run typecheck"} value={draft} onChange={(event) => setDraft(event.target.value)} className={styles.mono} {...(lines.length > 10 ? { error: "Up to 10 commands." } : {})} />
        <div className={styles.dialogActions}>
          <Button type="button" variant="ghost" onClick={() => setDraft("")}>Use auto checks</Button>
          <Button type="submit" variant="primary" disabled={lines.length > 10}>Save checks</Button>
        </div>
      </form>
    </Dialog>
  );
}

export interface FollowUpComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  /** While the latest turn is still running, the box offers Stop instead of Send. */
  running: boolean;
  onStop: () => void;
  disabledReason?: string;
}

/** The compact composer at the bottom of a run thread. Each follow-up starts a new run on the result. */
export function FollowUpComposer({ value, onChange, onSubmit, busy, running, onStop, disabledReason }: FollowUpComposerProps) {
  return (
    <Composer
      compact
      label="Follow-up"
      placeholder={running ? "Caramel is working. You can stop the run, or wait to follow up." : "Ask for a follow-up change…"}
      submitLabel="Start follow-up run"
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      canSubmit={value.trim() !== "" && disabledReason === undefined}
      busy={busy || running}
      onStop={running ? onStop : undefined}
      disabled={running || disabledReason !== undefined}
      footnote={disabledReason ?? "A follow-up starts a new run from this run's result, with the same repository and model."}
    />
  );
}
