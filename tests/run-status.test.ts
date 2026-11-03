import { describe, expect, test } from "bun:test";
import { AGENT_STATUSES, isAgentStatus } from "../src/agent/types";
import { ACTIVE_RUN_STATUSES, isFinishedRunStatus } from "../src/service/run-status";

describe("run statuses", () => {
  test("every record status is either active or one of the agent's outcomes, never both", () => {
    for (const status of ACTIVE_RUN_STATUSES) expect(isFinishedRunStatus(status)).toBeFalse();
    for (const status of AGENT_STATUSES) expect(isFinishedRunStatus(status)).toBeTrue();
    expect(isAgentStatus("running")).toBeFalse();
  });
});
