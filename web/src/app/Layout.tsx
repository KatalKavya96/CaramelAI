import { useEffect, useState } from "react";
import { Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import { useApi, useCancelRun, useCapabilities, useLogout, useRuns } from "../data";
import { StatusIcon } from "../domain";
import type { RunView } from "../lib/contract";
import { taskTitle } from "../lib/format";
import { isActive } from "../lib/status";
import { AppShell, ConfirmDialog, Sidebar, SidebarRail, type SidebarLink } from "../patterns";
import { BoltIcon, FolderIcon, KeyIcon, SearchIcon, SignOutIcon, GearIcon } from "../ui";
import { SearchPalette } from "../screens/SearchPalette";
import { SettingsDialog } from "../screens/SettingsDialog";
import { useUiState } from "./ui-state";

const COLLAPSE_KEY = "caramel-sidebar-collapsed";

/** Thread roots only: a follow-up lives inside its first run's page, not as its own sidebar row. */
function threadRoots(runs: RunView[]): RunView[] {
  const ids = new Set(runs.map((run) => run.id));
  return runs.filter((run) => run.parentRunId === null || !ids.has(run.parentRunId));
}

export function Layout({ login }: { login: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const runMatch = useMatch("/runs/:id");
  const api = useApi();
  const runs = useRuns();
  const cancel = useCancelRun();
  const logout = useLogout();
  const ui = useUiState();
  const capabilities = useCapabilities();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [cancelId, setCancelId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed]);

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // ⌘K / Ctrl+K starts a new run, as on the mockup's "New chat" button. Browsers do not reserve it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        navigate("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const go = (path: string) => () => navigate(path);
  const all = runs.data ?? [];
  const roots = threadRoots(all);
  const activeThread = (() => {
    if (runMatch?.params.id === undefined) return null;
    const byId = new Map(all.map((run) => [run.id, run]));
    let current = byId.get(runMatch.params.id);
    while (current?.parentRunId != null && byId.has(current.parentRunId)) current = byId.get(current.parentRunId);
    return current?.id ?? runMatch.params.id;
  })();

  const links: SidebarLink[] = [
    { label: "Search", icon: <SearchIcon size={22} />, href: "#search", onSelect: () => ui.setSearchOpen(true) },
    { label: "Repositories", icon: <FolderIcon size={22} />, href: "/repos", active: location.pathname === "/repos", onSelect: go("/repos") },
    // Benchmarks are run from the command line on your own computer, so only the desktop app lists them.
    ...(capabilities.mode === "local" ? [{ label: "Benchmarks", icon: <BoltIcon size={22} />, href: "/benchmarks", active: location.pathname === "/benchmarks", onSelect: go("/benchmarks") }] : []),
  ];

  const latestStatus = (root: RunView): RunView => {
    // The newest run in a thread decides the dot: a running follow-up shows as running.
    let latest = root;
    const children = (id: string) => all.filter((run) => run.parentRunId === id);
    let next = children(latest.id);
    while (next.length > 0) {
      latest = next.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
      next = children(latest.id);
    }
    return latest;
  };

  const sidebar = (
    <Sidebar
      primary={{ label: "New run", shortcut: "⌘K", onClick: go("/") }}
      links={links}
      onCollapse={() => setCollapsed(true)}
      sections={[
        {
          title: "Recent",
          empty: runs.isLoading ? "Loading…" : "Your runs will show up here.",
          // One flat list, newest first, as in the mockup's RECENT section.
          groups: [{
            items: [...roots]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((run) => {
                const latest = latestStatus(run);
                return {
                  id: run.id,
                  label: taskTitle(run.request.task, 60),
                  href: `/runs/${run.id}`,
                  active: activeThread === run.id,
                  trailing: <StatusIcon status={latest.status} size={14} />,
                  onSelect: go(`/runs/${run.id}`),
                  menuItems: [
                    { label: "Open", onSelect: go(`/runs/${run.id}`) },
                    { label: "Copy link", onSelect: () => void navigator.clipboard?.writeText(`${window.location.origin}/runs/${run.id}`) },
                    ...(latest.changedFiles.length > 0 ? [{ label: "Download patch", onSelect: () => window.open(api.patchUrl(latest.id), "_blank") }] : []),
                    ...(isActive(latest.status) ? ["separator" as const, { label: "Cancel run", danger: true, onSelect: () => setCancelId(latest.id) }] : []),
                  ],
                };
              }),
          }],
        },
      ]}
      footerLink={{ label: "Model providers", icon: <KeyIcon size={22} />, href: "/setup", active: location.pathname === "/setup", onSelect: go("/setup") }}
      user={{
        name: login,
        onSettings: () => ui.openSettings(),
        menuItems: [
          { label: "Settings", icon: <GearIcon size={18} />, onSelect: () => ui.openSettings() },
          { label: "Model providers", icon: <KeyIcon size={18} />, onSelect: go("/setup") },
          // The desktop app has one user and no session to end.
          ...(capabilities.mode === "local" ? [] : ["separator" as const, { label: "Sign out", icon: <SignOutIcon size={18} />, onSelect: () => logout.mutate() }]),
        ],
      }}
    />
  );

  return (
    <>
      <AppShell
        sidebar={sidebar}
        rail={<SidebarRail onExpand={() => setCollapsed(false)} onPrimary={go("/")} links={links} />}
        collapsed={collapsed}
        drawerOpen={drawerOpen}
        onDrawerOpenChange={setDrawerOpen}
        onNew={go("/")}
      >
        <Outlet />
      </AppShell>
      <SearchPalette open={ui.searchOpen} onOpenChange={ui.setSearchOpen} runs={all} onOpen={(id) => navigate(`/runs/${id}`)} onNew={go("/")} />
      <SettingsDialog login={login} />
      <ConfirmDialog
        open={cancelId !== null}
        onOpenChange={(open) => !open && setCancelId(null)}
        title="Cancel this run?"
        message="Caramel stops at the next safe point. Work in progress is discarded and no patch is kept."
        confirmLabel="Cancel run"
        cancelLabel="Keep running"
        destructive
        busy={cancel.isPending}
        onConfirm={() => cancelId !== null && cancel.mutate(cancelId, { onSettled: () => setCancelId(null) })}
      />
    </>
  );
}
