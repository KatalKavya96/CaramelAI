import type { ReactNode } from "react";
import styles from "./SegmentedControl.module.css";

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/** The Light / Dark / System control from the Settings mockup, as a radio group. */
export function SegmentedControl<T extends string>({ label, value, segments, onChange }: { label: string; value: T; segments: Segment<T>[]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.group}>
      {segments.map((segment) => (
        <button
          key={segment.value}
          type="button"
          role="radio"
          aria-checked={segment.value === value}
          tabIndex={segment.value === value || !segments.some(item => item.value === value) && segment === segments[0] ? 0 : -1}
          onKeyDown={(event) => {
            const index = segments.indexOf(segment);
            const next = event.key === "Home" ? 0 : event.key === "End" ? segments.length - 1 : ["ArrowRight", "ArrowDown"].includes(event.key) ? (index + 1) % segments.length : ["ArrowLeft", "ArrowUp"].includes(event.key) ? (index - 1 + segments.length) % segments.length : -1;
            const selected = segments[next];
            if (!selected) return;
            event.preventDefault();
            onChange(selected.value);
            (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next])?.focus();
          }}
          className={[styles.segment, segment.value === value ? styles.active : ""].join(" ")}
          onClick={() => onChange(segment.value)}
        >
          {segment.icon}
          {segment.label}
        </button>
      ))}
    </div>
  );
}
