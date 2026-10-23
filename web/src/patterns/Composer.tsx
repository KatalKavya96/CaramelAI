import { useId, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUpIcon, Button, IconButton, StopIcon } from "../ui";
import styles from "./Composer.module.css";

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** Accessible name for the text box (the placeholder is not a label). */
  label: string;
  submitLabel: string;
  canSubmit: boolean;
  busy?: boolean;
  /** Shown while busy instead of the send button, like the mockup's stop square. */
  onStop?: () => void;
  /** Above the text box: attachments, context chips. */
  header?: ReactNode;
  /** Left of the bottom row: toggle chips. */
  tools?: ReactNode;
  /** Right of the bottom row, before the send button: the model pill. */
  trailing?: ReactNode;
  footnote?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  showSubmitLabel?: boolean;
}

/** The big rounded composer card. Enter sends, Shift+Enter adds a line. */
export function Composer({ value, onChange, onSubmit, placeholder, label, submitLabel, canSubmit, busy = false, onStop, header, tools, trailing, footnote, compact = false, disabled = false, autoFocus = false, showSubmitLabel = false }: ComposerProps) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canSubmit && !busy && !disabled) onSubmit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };
  return (
    <form className={[styles.composer, compact ? styles.compact : ""].join(" ")} onSubmit={submit} onClick={(event) => event.target === event.currentTarget && ref.current?.focus()}>
      {header}
      <label htmlFor={id} className="visually-hidden">{label}</label>
      <textarea
        ref={ref}
        id={id}
        className={styles.input}
        value={value}
        rows={compact ? 1 : 2}
        placeholder={placeholder}
        disabled={disabled}
        aria-describedby={footnote === undefined ? undefined : `${id}-hint`}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.row}>
        <div className={styles.tools}>{tools}</div>
        <div className={styles.trailing}>
          {trailing}
          {busy && onStop !== undefined ? (
            <IconButton variant="stop" size="lg" label="Stop" icon={<StopIcon size={22} />} onClick={onStop} />
          ) : showSubmitLabel ? (
            <Button type="submit" variant="primary" disabled={!canSubmit || busy || disabled}>{busy ? "Starting…" : submitLabel}</Button>
          ) : (
            <IconButton type="submit" variant="send" size="lg" label={submitLabel} disabled={!canSubmit || busy || disabled} icon={<ArrowUpIcon size={22} />} />
          )}
        </div>
      </div>
      {footnote === undefined ? null : <div id={`${id}-hint`} className={styles.footnote}>{footnote}</div>}
    </form>
  );
}
