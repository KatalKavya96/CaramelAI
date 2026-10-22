import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./Pill.module.css";

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Toggle chips (like the mockups' Think/Search) set this; it maps to aria-pressed. */
  pressed?: boolean;
  size?: "sm" | "md" | "lg";
}

/** The rounded outlined chip used throughout the mockups: composer toggles, dropdown triggers, quick actions. */
export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  { icon, trailingIcon, pressed, size = "md", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      className={[styles.pill, styles[size], pressed === true ? styles.pressed : "", className ?? ""].join(" ")}
      {...rest}
    >
      {icon}
      {children === undefined ? null : <span className={styles.text}>{children}</span>}
      {trailingIcon}
    </button>
  );
});
