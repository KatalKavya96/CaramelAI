import { describe, expect, test } from "bun:test";
import { SYSTEM_PROMPT } from "../src/agent/controller";
import { PLAN_SYSTEM_PROMPT } from "../src/agent/planner";
import {
  AGENT_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT as DIRECT_PLAN_PROMPT,
  SYSTEM_PROMPT as DIRECT_SYSTEM_PROMPT,
} from "../src/prompts";

describe("agent system prompt", () => {
  test("codifies observed run failures and recovery behavior", () => {
    expect(SYSTEM_PROMPT).toBe(DIRECT_SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT).toBe(AGENT_SYSTEM_PROMPT);
    expect(PLAN_SYSTEM_PROMPT).toBe(DIRECT_PLAN_PROMPT);
    expect(SYSTEM_PROMPT).toContain("Return only one valid JSON object");
    expect(SYSTEM_PROMPT).toContain("search must be a non-empty exact snippet");
    expect(SYSTEM_PROMPT).toContain("not a *** Begin Patch block");
    expect(SYSTEM_PROMPT).toContain("Avoid shell file-printing commands");
    expect(SYSTEM_PROMPT).toContain("Do not keep exploring once the relevant file and component are known");
    expect(SYSTEM_PROMPT).toContain("originalTask as the binding implementation contract");
    expect(SYSTEM_PROMPT).toContain("two to four focused inspection actions");
    expect(SYSTEM_PROMPT).toContain("compare the final diff");
    expect(SYSTEM_PROMPT).toContain("inspect_diff, then run the most relevant available verification command");
  });

  test("codifies code quality, security, and plan context standards", () => {
    expect(SYSTEM_PROMPT).toContain("Code quality standards:");
    expect(SYSTEM_PROMPT).toContain("Use meaningful, descriptive names");
    expect(SYSTEM_PROMPT).toContain("Write modular, DRY code");
    expect(SYSTEM_PROMPT).toContain("Handle errors explicitly");
    expect(SYSTEM_PROMPT).toContain("Security and best practices:");
    expect(SYSTEM_PROMPT).toContain("Never hardcode secrets");
    expect(SYSTEM_PROMPT).toContain("Plan context");
  });

  test("defines plan mode architect prompt with schema and question guidelines", () => {
    expect(PLAN_SYSTEM_PROMPT).toContain("senior software architect");
    expect(PLAN_SYSTEM_PROMPT).toContain('"summary"');
    expect(PLAN_SYSTEM_PROMPT).toContain('"questions"');
    expect(PLAN_SYSTEM_PROMPT).toContain("The first option should always be the recommended choice");
  });
});
