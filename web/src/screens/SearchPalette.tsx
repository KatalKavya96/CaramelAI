import type { RunView } from "../lib/contract";
import { formatWhen, repoLabel, sourceUrl, taskTitle } from "../lib/format";
import { statusCopy } from "../lib/status";
import { CommandPalette } from "../patterns";
import { DocIcon } from "../ui";

/** The search mockup, over runs: task title, a line of the summary, repository and time. */
export function SearchPalette({ open, onOpenChange, runs, onOpen, onNew }: { open: boolean; onOpenChange: (open: boolean) => void; runs: RunView[]; onOpen: (id: string) => void; onNew: () => void }) {
  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      placeholder="Search runs…"
      groupOrder={["Running", "Recent"]}
      items={runs.map((run) => ({
        id: run.id,
        title: taskTitle(run.request.task),
        ...(run.summary === null ? {} : { snippet: run.summary }),
        meta: `${repoLabel(sourceUrl(run.request.repo))} · ${statusCopy(run.status).label} · ${formatWhen(run.createdAt)}`,
        group: statusCopy(run.status).tone === "active" ? "Running" : "Recent",
        icon: <DocIcon size={20} />,
      }))}
      onSelect={(item) => {
        onOpenChange(false);
        onOpen(item.id);
      }}
      footerAction={{
        label: "New run",
        shortcut: "⌘K",
        onClick: () => {
          onOpenChange(false);
          onNew();
        },
      }}
      emptyTitle="No runs match"
      emptyMessage="Try words from the task or the repository name."
    />
  );
}
