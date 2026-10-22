import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { IconButton, Logo, MenuIcon, PlusIcon } from "../ui";
import styles from "./AppShell.module.css";

export interface AppShellProps {
  sidebar: ReactNode;
  /** Shown instead of the sidebar when collapsed on desktop. */
  rail: ReactNode;
  collapsed: boolean;
  /** Mobile drawer state; the drawer reuses the full sidebar. */
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  onNew: () => void;
  children: ReactNode;
}

/**
 * Sidebar + main area. Below 900px the sidebar becomes a drawer behind the mobile header
 * (hamburger, centred logo, new button), as in the mobile mockup.
 */
export function AppShell({ sidebar, rail, collapsed, drawerOpen, onDrawerOpenChange, onNew, children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <div className={styles.desktopSide}>{collapsed ? rail : sidebar}</div>
      <header className={styles.mobileHeader}>
        <IconButton label="Open menu" icon={<MenuIcon size={24} />} onClick={() => onDrawerOpenChange(true)} />
        <Logo size={26} />
        <IconButton label="New run" variant="outlined" icon={<PlusIcon size={20} />} onClick={onNew} />
      </header>
      <RadixDialog.Root open={drawerOpen} onOpenChange={onDrawerOpenChange}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className={styles.scrim} />
          <RadixDialog.Content className={styles.drawer} aria-describedby={undefined}>
            <RadixDialog.Title className="visually-hidden">Menu</RadixDialog.Title>
            {sidebar}
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
      <main className={styles.main} id="main">
        {children}
      </main>
    </div>
  );
}
