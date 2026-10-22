import type { AgentStatus, RunRecordStatus } from "./contract";

export type StatusTone = "neutral" | "active" | "success" | "warning" | "danger";

export interface StatusCopy {
  label: string;
  tone: StatusTone;
  /** One line a person can act on; shown on the outcome card and in tooltips. */
  explanation: string;
}

const COPY: Record<RunRecordStatus, StatusCopy> = {
  queued: { label: "Queued", tone: "neutral", explanation: "Waiting for your other run to finish. Only one run per person runs at a time." },
  preparing: { label: "Preparing", tone: "active", explanation: "Cloning the repository and starting the sandbox." },
  running: { label: "Running", tone: "active", explanation: "Caramel is working on the task." },
  verified: { label: "Verified", tone: "success", explanation: "Changes made and the final checks passed on the final code." },
  partial: { label: "Partial", tone: "warning", explanation: "Changes made, but the final checks did not all pass, or were not run on the final code." },
  blocked: { label: "Blocked", tone: "warning", explanation: "Caramel could not continue without something it does not have. The reason says what." },
  budget_exhausted: { label: "Out of budget", tone: "warning", explanation: "The run hit a step, time or model-call limit before it could finish." },
  failed: { label: "Failed", tone: "danger", explanation: "The run stopped because of an error. The reason says where." },
  cancelled: { label: "Cancelled", tone: "neutral", explanation: "You cancelled this run. Work in progress was discarded." },
};

export function statusCopy(status: RunRecordStatus): StatusCopy {
  return COPY[status];
}

const TERMINAL = new Set<RunRecordStatus>(["verified", "partial", "blocked", "budget_exhausted", "failed", "cancelled"]);

export function isTerminal(status: RunRecordStatus): status is AgentStatus {
  return TERMINAL.has(status);
}

export function isActive(status: RunRecordStatus): boolean {
  return !TERMINAL.has(status);
}
