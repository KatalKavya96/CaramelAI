import { Button, Dialog } from "../ui";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}

/** The "Delete this chat?" dialog from the mockups, reused for any confirm. */
export function ConfirmDialog({ open, onOpenChange, title, message, confirmLabel, cancelLabel = "Cancel", destructive = false, busy = false, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={message} width={420}>
      <div className={styles.actions}>
        <Button size="lg" onClick={() => onOpenChange(false)} className={styles.button}>{cancelLabel}</Button>
        <Button size="lg" variant={destructive ? "danger" : "primary"} disabled={busy} onClick={onConfirm} className={styles.button}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}
