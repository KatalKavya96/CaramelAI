import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { CloseIcon } from "./icons";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Hide the title visually but keep it for screen readers (the search palette has no heading). */
  hideTitle?: boolean;
  description?: string;
  children: ReactNode;
  width?: number;
  showClose?: boolean;
  className?: string;
}

/** A centred modal with the mockups' rounded glass panel. Focus trap, Escape and scroll lock come from Radix. */
export function Dialog({ open, onOpenChange, title, hideTitle = false, description, children, width = 560, showClose = true, className }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content
          className={[styles.content, className ?? ""].join(" ")}
          style={{ width: `min(${width}px, calc(100vw - 32px))` }}
          aria-describedby={description === undefined ? undefined : "dialog-description"}
        >
          <RadixDialog.Title className={hideTitle ? "visually-hidden" : styles.title}>{title}</RadixDialog.Title>
          {description === undefined ? null : (
            <RadixDialog.Description id="dialog-description" className={styles.description}>
              {description}
            </RadixDialog.Description>
          )}
          {children}
          {showClose ? (
            <RadixDialog.Close className={styles.close} aria-label="Close">
              <CloseIcon size={18} />
            </RadixDialog.Close>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
