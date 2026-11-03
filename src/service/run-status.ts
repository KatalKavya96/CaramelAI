import { isAgentStatus, type AgentStatus } from "../agent/types";

/** A run record is active until the agent reports one of the AgentStatus outcomes. */
export const ACTIVE_RUN_STATUSES = ["queued", "preparing", "running"] as const;
export type RunRecordStatus = (typeof ACTIVE_RUN_STATUSES)[number] | AgentStatus;

/** Kept free of server imports so the web app can share it. */
export function isFinishedRunStatus(status: RunRecordStatus): status is AgentStatus {
  return isAgentStatus(status);
}
