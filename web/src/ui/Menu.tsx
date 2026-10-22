import * as Dropdown from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import styles from "./Menu.module.css";

export interface MenuItem {
  label: string;
  description?: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  trigger: ReactNode;
  items: (MenuItem | "separator")[];
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  header?: ReactNode;
  width?: number;
}

/** The floating popover menu from the mockups (row actions, model picker, account menu). Keyboard support from Radix. */
export function Menu({ trigger, items, align = "start", side = "bottom", header, width }: MenuProps) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className={styles.content} align={align} side={side} sideOffset={8} style={width === undefined ? undefined : { width }}>
          {header}
          {items.map((item, index) =>
            item === "separator" ? (
              <Dropdown.Separator key={`sep-${index}`} className={styles.separator} />
            ) : (
              <Dropdown.Item
                key={item.label}
                className={[styles.item, item.danger === true ? styles.danger : "", item.selected === true ? styles.selected : ""].join(" ")}
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                {item.icon === undefined ? null : <span className={styles.icon}>{item.icon}</span>}
                <span className={styles.body}>
                  <span>{item.label}</span>
                  {item.description === undefined ? null : <span className={styles.description}>{item.description}</span>}
                </span>
                {item.shortcut === undefined ? null : <span className={styles.shortcut}>{item.shortcut}</span>}
                {item.selected === true ? (
                  <svg className={styles.check} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                ) : null}
              </Dropdown.Item>
            ),
          )}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
