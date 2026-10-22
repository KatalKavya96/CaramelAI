import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { CloseIcon } from "../ui";
import styles from "./TabbedDialog.module.css";

export interface DialogTab {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

/** The Settings modal: tab list on the left, the selected tab's content on the right. */
export function TabbedDialog({ open, onOpenChange, title, tabs, active, onActiveChange }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; tabs: DialogTab[]; active: string; onActiveChange: (id: string) => void }) {
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content className={styles.panel} aria-describedby={undefined}>
          <div role="tablist" aria-orientation="vertical" aria-label={title} className={styles.tabs}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={tab.id === current?.id}
                aria-controls={`panel-${tab.id}`}
                className={[styles.tab, tab.id === current?.id ? styles.tabActive : ""].join(" ")}
                onClick={() => onActiveChange(tab.id)}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
          <div className={styles.body} role="tabpanel" id={`panel-${current?.id ?? ""}`} aria-labelledby={`tab-${current?.id ?? ""}`}>
            <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
            {current?.content}
          </div>
          <RadixDialog.Close className={styles.close} aria-label="Close">
            <CloseIcon size={20} />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
