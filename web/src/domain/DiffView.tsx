import { useState } from "react";
import type { DiffFile } from "../lib/diff";
import { Button, ChevronDownIcon, ChevronRightIcon, DocIcon } from "../ui";
import styles from "./DiffView.module.css";

const CHANGE: Record<DiffFile["change"], string> = { added: "A", deleted: "D", modified: "M", renamed: "R" };
const CHANGE_LABEL: Record<DiffFile["change"], string> = { added: "Added", deleted: "Deleted", modified: "Modified", renamed: "Renamed" };

function Counts({ file }: { file: DiffFile }) {
  return (
    <span className={styles.counts} aria-label={`${file.additions} added, ${file.deletions} removed`}>
      <span className={styles.plus}>+{file.additions}</span>
      <span className={styles.minus}>−{file.deletions}</span>
    </span>
  );
}

/** Compact list of changed files with their line counts; selecting one scrolls the diff to it. */
export function ChangedFiles({ files, onSelect }: { files: DiffFile[]; onSelect?: (path: string) => void }) {
  return (
    <ul className={styles.files}>
      {files.map((file) => (
        <li key={file.path}>
          <button type="button" className={styles.fileRow} onClick={() => onSelect?.(file.path)}>
            <span className={styles.badge} title={CHANGE_LABEL[file.change]}>{CHANGE[file.change]}</span>
            <code className={styles.path}>{file.path}</code>
            <Counts file={file} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Unified diff, one collapsible block per file, with old and new line numbers. */
export function DiffView({ files }: { files: DiffFile[] }) {
  const [wrap, setWrap] = useState(true);
  if (files.length === 0) return <p className={styles.empty}>No file changes.</p>;
  return (
    <div className={[styles.diff, wrap ? styles.wrapLines : ""].join(" ")}>
      <Button size="sm" onClick={() => setWrap(value => !value)} aria-pressed={wrap}>{wrap ? "Line wrapping on" : "Line wrapping off"}</Button>
      {files.map((file) => <FileDiff key={file.path} file={file} />)}
    </div>
  );
}

function FileDiff({ file }: { file: DiffFile }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={styles.file} id={`diff-${file.path}`} aria-label={file.path}>
      <button type="button" className={styles.header} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
        <DocIcon size={16} />
        <code className={styles.path}>{file.path}</code>
        <Counts file={file} />
      </button>
      {open ? (
        <div className={styles.scroll} tabIndex={0} aria-label={`Changes in ${file.path}`}>
          <table className={styles.table}>
            <colgroup><col className={styles.numberColumn}/><col className={styles.numberColumn}/><col/></colgroup>
            <tbody>
              {file.lines.filter((line) => line.kind !== "meta").map((line, index) =>
                line.kind === "hunk" ? (
                  <tr key={index} className={styles.hunk}>
                    <td colSpan={3}>{line.text}</td>
                  </tr>
                ) : (
                  <tr key={index} className={styles[line.kind]}>
                    <td className={styles.num}>{line.oldNumber ?? ""}</td>
                    <td className={styles.num}>{line.newNumber ?? ""}</td>
                    <td className={styles.code}>
                      <span className={styles.sign} aria-hidden="true">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>
                      <span className="visually-hidden">{line.kind === "add" ? "Added: " : line.kind === "del" ? "Removed: " : ""}</span>
                      {line.text}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
