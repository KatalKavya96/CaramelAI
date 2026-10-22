import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./IconButton.module.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Required: an icon-only button has no visible text, so this is its accessible name. */
  label: string;
  icon: ReactNode;
  variant?: "plain" | "outlined" | "send" | "stop";
  size?: "sm" | "md" | "lg";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = "plain", size = "md", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={rest.title ?? label}
      className={[styles.button, styles[variant], styles[size], className ?? ""].join(" ")}
      {...rest}
    >
      {icon}
    </button>
  );
});
