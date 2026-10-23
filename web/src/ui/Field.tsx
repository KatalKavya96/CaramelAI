import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import styles from "./Field.module.css";

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

function FieldShell({ label, hint, error, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      {children(id, describedBy)}
      {hint === undefined ? null : <span id={hintId} className={styles.hint}>{hint}</span>}
      {error === undefined ? null : <span id={errorId} className={styles.error} role="alert">{error}</span>}
    </div>
  );
}

type Base = { label: string; hint?: ReactNode; error?: string };

export const TextField = forwardRef<HTMLInputElement, Base & InputHTMLAttributes<HTMLInputElement>>(function TextField({ label, hint, error, className, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {(id, describedBy) => <input ref={ref} id={id} aria-describedby={describedBy} aria-invalid={error !== undefined} className={[styles.input, className ?? ""].join(" ")} {...rest} />}
    </FieldShell>
  );
});

export const SelectField = forwardRef<HTMLSelectElement, Base & SelectHTMLAttributes<HTMLSelectElement>>(function SelectField({ label, hint, error, className, children, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {(id, describedBy) => (
        <span className={styles.selectWrap}>
          <select ref={ref} id={id} aria-invalid={error !== undefined} aria-describedby={describedBy} className={[styles.input, styles.select, className ?? ""].join(" ")} {...rest}>
            {children}
          </select>
        </span>
      )}
    </FieldShell>
  );
});

export const TextAreaField = forwardRef<HTMLTextAreaElement, Base & TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextAreaField({ label, hint, error, className, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {(id, describedBy) => <textarea ref={ref} id={id} aria-describedby={describedBy} aria-invalid={error !== undefined} className={[styles.input, styles.textarea, className ?? ""].join(" ")} {...rest} />}
    </FieldShell>
  );
});
