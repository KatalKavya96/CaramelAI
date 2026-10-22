import * as RadixSwitch from "@radix-ui/react-switch";
import { useId } from "react";
import styles from "./Switch.module.css";

/** A labelled toggle row as in the Settings mockup: title, description, switch on the right. */
export function SwitchRow({ label, description, checked, onCheckedChange }: { label: string; description?: string; checked: boolean; onCheckedChange: (value: boolean) => void }) {
  const id = useId();
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <label htmlFor={id} className={styles.label}>{label}</label>
        {description === undefined ? null : <span className={styles.description}>{description}</span>}
      </div>
      <RadixSwitch.Root id={id} className={styles.root} checked={checked} onCheckedChange={onCheckedChange}>
        <RadixSwitch.Thumb className={styles.thumb} />
      </RadixSwitch.Root>
    </div>
  );
}
