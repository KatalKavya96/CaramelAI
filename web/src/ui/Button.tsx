import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, trailingIcon, block = false, className, children, type = "button", ...rest },
  ref,
) {
  const classes = [styles.button, styles[variant], styles[size], block ? styles.block : "", className ?? ""].join(" ");
  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {icon}
      {children === undefined ? null : <span>{children}</span>}
      {trailingIcon}
    </button>
  );
});
