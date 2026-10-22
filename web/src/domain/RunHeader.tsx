import type { ReactNode } from "react";
import type { RunRecordStatus } from "../lib/contract";
import { repoLabel, taskTitle } from "../lib/format";
import { BranchIcon, FolderIcon, ShieldIcon } from "../ui";
import { StatusBadge } from "./Status";
import styles from "./RunHeader.module.css";

export interface RunHeaderProps {
  task: string;
  repoUrl: string;
  gitRef?: string;
  model: string;
  /** Where commands ran, e.g. "macOS sandbox · no network". */
  sandbox?: string;
  status: RunRecordStatus;
  statusDetail?: string;
  actions?: ReactNode;
}

/** Title row of the run page: the task, where it runs, and its status. */
export function RunHeader({ task, repoUrl, gitRef, model, sandbox, status, statusDetail, actions }: RunHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.main}>
        <h1 className={styles.title}>{taskTitle(task)}</h1>
        <p className={styles.meta}>
          <span title={repoUrl}><FolderIcon size={16} /> {repoLabel(repoUrl)}</span>
          {gitRef === undefined ? null : <span><BranchIcon size={16} /> {gitRef}</span>}
          <span>{model}</span>
          {sandbox === undefined ? null : <span><ShieldIcon size={16} /> {sandbox}</span>}
        </p>
      </div>
      <div className={styles.side}>
        <StatusBadge status={status} {...(statusDetail === undefined ? {} : { detail: statusDetail })} />
        {actions}
      </div>
    </header>
  );
}
