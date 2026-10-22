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
