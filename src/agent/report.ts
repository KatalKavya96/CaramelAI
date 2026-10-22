import type { AgentRunResult } from "./types";

function mark(value: boolean): string {
  return value ? "PASS" : "MISSING";
}

export function renderEvidenceReport(result: AgentRunResult, finalFingerprint: string): string {
  const finalEvidence = result.verification.evidence.filter((item) => item.codeFingerprint === finalFingerprint);
  const staleEvidence = result.verification.evidence.length - finalEvidence.length;
  const lines = [
    "# Dinner run evidence",
    "",
    `- Status: **${result.status}**`,
    `- Termination: ${result.terminationReason}`,
    `- Summary: ${result.summary}`,
    `- Duration: ${result.metrics.durationMs} ms`,
    `- Model calls: ${result.metrics.modelCalls}`,
    `- Tool steps: ${result.metrics.steps}`,
    `- Commands: ${result.metrics.commandsRun}`,
    "",
    "## Changes",
    "",
    ...(result.changedFiles.length === 0 ? ["No changed files."] : result.changedFiles.map((path) => `- ${path}`)),
    "",
    "## Completion gate",
    "",
    `- Final-state verification: ${mark(result.verification.successfulFinalState)}`,
    `- Final diff reviewed: ${mark(result.verification.diffReviewedForFinalState)}`,
    `- Final-state evidence records: ${finalEvidence.length}`,
    `- Stale evidence records: ${staleEvidence}`,
    `- Recorded failures (including recovered attempts): ${result.recovery.failures.length}`,
    "",
    "## Checks",
    "",
    ...(result.verification.evidence.length === 0
      ? ["No verification commands were recorded."]
      : result.verification.evidence.map((evidence) =>
          `- **${evidence.status}**${evidence.trusted ? "" : " (untrusted, not counted)"} \`${evidence.command}\` in \`${evidence.cwd}\` (${evidence.durationMs} ms, fingerprint \`${evidence.codeFingerprint}\`)`,
        )),
    "",
    "## Usage",
    "",
    `- Provider tokens: ${result.usage.providerTotalTokens}`,
    `- Estimated tokens: ${result.usage.estimatedTotalTokens}`,
    `- Calls with unavailable usage: ${result.usage.unavailableCalls}`,
    "",
    "## Artifacts",
    "",
    `- Result JSON: \`${result.resultPath}\``,
    `- Patch: \`${result.patchPath}\``,
    `- Events: \`${result.eventsPath}\``,
    `- Evidence report: \`${result.reportPath}\``,
    "",
  ];
  return `${lines.join("\n")}\n`;
}
