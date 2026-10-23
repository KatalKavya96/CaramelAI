import type { AgentEvent, AgentStatus, UsageSummary } from "@web/lib/contract";
import type { EvidenceView } from "@web/domain/EvidenceList";
import type { OutcomeMetrics } from "@web/domain/OutcomeCard";

/**
 * One run the page can replay. "recorded" means the events came from a real events.jsonl via
 * scripts/redact-run.ts; "example" means they were written by hand. The page labels each one,
 * so a hand-written run is never passed off as a real one.
 */
export interface ReplayRun {
  id: string;
  /** Tab label, such as "Verified" or "Not verified". */
  label: string;
  provenance: "recorded" | "example";
  repoUrl: string;
  model: string;
  recordedAt?: string;
  status: AgentStatus;
  summary: string | null;
  terminationReason: string;
  events: AgentEvent[];
  evidence: EvidenceView[];
  patch: string;
  metrics?: OutcomeMetrics;
  usage?: UsageSummary;
}
