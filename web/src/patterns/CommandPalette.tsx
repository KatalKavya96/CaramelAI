import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, DocIcon, IconButton, Kbd, PlusIcon, SearchIcon } from "../ui";
import { EmptyState } from "./StateBlocks";
import styles from "./CommandPalette.module.css";

export interface PaletteItem {
  id: string;
  title: string;
  snippet?: string;
  meta?: string;
  group: string;
  icon?: ReactNode;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaletteItem[];
  groupOrder: string[];
  placeholder: string;
  onSelect: (item: PaletteItem) => void;
  footerAction?: { label: string; shortcut?: string; onClick: () => void };
  emptyTitle: string;
  emptyMessage: string;
}

/** Wraps each case-insensitive match of `query` in <mark>, as the search mockup highlights "launch". */
export function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  if (needle === "") return <>{text}</>;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let index = 0;
  while (index < text.length) {
    const found = lower.indexOf(needle, index);
    if (found === -1) {
      parts.push(text.slice(index));
      break;
    }
    if (found > index) parts.push(text.slice(index, found));
    parts.push(<mark key={found} className={styles.mark}>{text.slice(found, found + needle.length)}</mark>);
    index = found + needle.length;
  }
  return <>{parts}</>;
}

/** The search palette from the mockups: query field, grouped results, keyboard hints. */
export function CommandPalette({ open, onOpenChange, items, groupOrder, placeholder, onSelect, footerAction, emptyTitle, emptyMessage }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle === "" ? items : items.filter((item) => `${item.title} ${item.snippet ?? ""}`.toLowerCase().includes(needle));
    return groupOrder.flatMap((group) => matches.filter((item) => item.group === group));
  }, [items, groupOrder, query]);

  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (item: PaletteItem | undefined) => {
    if (item === undefined) return;
    onSelect(item);
    onOpenChange(false);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(filtered.length - 1, value + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(0, value - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(filtered[active]);
    }
  };

  let lastGroup = "";
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content className={styles.panel} aria-describedby={undefined} onKeyDown={onKeyDown}>
          <RadixDialog.Title className="visually-hidden">Search</RadixDialog.Title>
          <div className={styles.searchRow}>
            <div className={styles.field}>
              <SearchIcon size={22} />
              <input
                className={styles.input}
                value={query}
                placeholder={placeholder}
                aria-label={placeholder}
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-results"
                aria-activedescendant={filtered[active] === undefined ? undefined : `palette-${filtered[active].id}`}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
              />
              <Kbd>Esc</Kbd>
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Close" icon={<CloseIcon size={22} />} />
            </RadixDialog.Close>
          </div>
          {filtered.length === 0 ? (
            <EmptyState title={emptyTitle} message={emptyMessage} />
          ) : (
            <ul id="palette-results" role="listbox" className={styles.list} ref={listRef}>
              {filtered.map((item, index) => {
                const heading = item.group !== lastGroup ? item.group : null;
                lastGroup = item.group;
                return (
                  <li key={item.id} role="presentation">
                    {heading === null ? null : <div className={styles.group} role="presentation">{heading}</div>}
                    <div
                      id={`palette-${item.id}`}
                      role="option"
                      aria-selected={index === active}
                      data-index={index}
                      className={[styles.option, index === active ? styles.active : ""].join(" ")}
                      onMouseMove={() => setActive(index)}
                      onClick={() => choose(item)}
                    >
                      <span className={styles.optionIcon}>{item.icon ?? <DocIcon size={20} />}</span>
                      <span className={styles.optionBody}>
                        <span className={styles.optionTitle}><Highlight text={item.title} query={query} /></span>
                        {item.snippet === undefined ? null : <span className={styles.optionSnippet}><Highlight text={item.snippet} query={query} /></span>}
                      </span>
                      {item.meta === undefined ? null : <span className={styles.optionMeta}>{item.meta}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className={styles.footer}>
            {footerAction === undefined ? <span /> : (
              <button type="button" className={styles.footerAction} onClick={() => { footerAction.onClick(); onOpenChange(false); }}>
                <PlusIcon size={18} />
                {footerAction.label}
                {footerAction.shortcut === undefined ? null : <Kbd>{footerAction.shortcut}</Kbd>}
              </button>
            )}
            <span className={styles.hints} aria-hidden="true">
              <span className={styles.hintKey}><ArrowUpIcon size={16} /></span>
              <span className={styles.hintKey}><ArrowDownIcon size={16} /></span>
              <Kbd>Enter</Kbd>
              to open
            </span>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
