import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigurationError,
  DEFAULT_BUDGETS,
  loadRunConfig,
  toPublicRunConfig,
} from "../src/config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "dinner-config-"));
  temporaryDirectories.push(path);
  return path;
}

describe("loadRunConfig", () => {
  test("loads a headless task with defaults", async () => {
    const cwd = await temporaryDirectory();
    const config = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix the bug"],
      cwd,
      env: { AI_API_KEY: "top-secret" },
    });

    expect(config.repoPath).toBe(cwd);
    expect(config.task).toBe("Fix the bug");
    expect(config.budgets).toEqual(DEFAULT_BUDGETS);
    expect(config.repositoryMapEnabled).toBeFalse();
    expect(config.colorEnabled).toBeTrue();
    expect(config.model).toBe("openai/gpt-5.2");
  });

  test("loads a fetched issue as the task", async () => {
    const cwd = await temporaryDirectory();
    const config = await loadRunConfig({
      argv: ["--repo", ".", "--issue", "https://github.com/o/r/issues/1"],
      cwd,
      env: { AI_API_KEY: "secret" },
      issueFetcher: async (url) => ({
        url,
        title: "Fix compact filters",
        body: "Expected behavior.",
      }),
    });

    expect(config.task).toContain("Source issue: https://github.com/o/r/issues/1");
    expect(config.task).toContain("Issue title: Fix compact filters");
    expect(config.task).toContain("Issue description and acceptance criteria:");
    expect(config.task).toContain("Expected behavior.");
  });

  test("reads a task file", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "issue.txt"), "  Repair empty input handling.  \n");

    const config = await loadRunConfig({
      argv: ["--repo", ".", "--task-file", "issue.txt"],
      cwd,
      env: { AI_API_KEY: "secret" },
    });

    expect(config.task).toBe("Repair empty input handling.");
  });

  test("prompts for a task only in interactive mode", async () => {
    const cwd = await temporaryDirectory();
    const config = await loadRunConfig({
      argv: ["--repo", "."],
      cwd,
      env: { AI_API_KEY: "secret" },
      interactive: true,
      promptForTask: () => "Investigate the failure",
    });

    expect(config.task).toBe("Investigate the failure");
  });

  test("rejects a missing task in headless mode", async () => {
    const cwd = await temporaryDirectory();
    expect(
      loadRunConfig({ argv: ["--repo", "."], cwd, env: { AI_API_KEY: "secret" } }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  test("rejects simultaneous inline and file tasks", async () => {
    const cwd = await temporaryDirectory();
    expect(
      loadRunConfig({
        argv: ["--repo", ".", "--task", "one", "--task-file", "two.txt"],
        cwd,
        env: { AI_API_KEY: "secret" },
      }),
    ).rejects.toThrow("Use only one of");
    expect(
      loadRunConfig({
        argv: ["--repo", ".", "--task", "one", "--issue", "https://github.com/o/r/issues/1"],
        cwd,
        env: { AI_API_KEY: "secret" },
        issueFetcher: async () => ({ url: "x", title: "x", body: "" }),
      }),
    ).rejects.toThrow("Use only one of");
  });

  test("requires a credential without printing its value", async () => {
    const cwd = await temporaryDirectory();
    expect(
      loadRunConfig({ argv: ["--repo", ".", "--task", "Fix it"], cwd, env: {} }),
    ).rejects.toThrow("AI_API_KEY is required");
  });

  test("allows deterministic model scripts without a credential", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "script.json"), "[]");
    const config = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it", "--model-script", "script.json"],
      cwd,
      env: {},
    });

    expect(config.apiKey).toBeUndefined();
    expect(config.modelScriptPath).toBe(join(cwd, "script.json"));
    expect(config.outputPath).toContain("dinner-runs");
  });

  test("rejects invalid budget values", async () => {
    const cwd = await temporaryDirectory();
    expect(
      loadRunConfig({
        argv: ["--repo", ".", "--task", "Fix it", "--max-steps", "2.5"],
        cwd,
        env: { AI_API_KEY: "secret" },
      }),
    ).rejects.toThrow("--max-steps must be a positive integer");
  });

  test("rejects a verification reserve that consumes the whole action budget", async () => {
    const cwd = await temporaryDirectory();
    expect(loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it", "--max-steps", "3", "--verification-reserve-steps", "3"],
      cwd,
      env: { AI_API_KEY: "secret" },
    })).rejects.toThrow("must be smaller than --max-steps");
  });

  test("enables the bounded repository map explicitly", async () => {
    const cwd = await temporaryDirectory();
    const config = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it", "--repository-map", "enabled"],
      cwd,
      env: { AI_API_KEY: "secret" },
    });
    expect(config.repositoryMapEnabled).toBeTrue();
  });

  test("accepts an OpenRouter model from the environment or CLI", async () => {
    const cwd = await temporaryDirectory();
    const fromEnvironment = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it"], cwd,
      env: { AI_API_KEY: "secret", OPENROUTER_MODEL: "anthropic/example" },
    });
    const fromCli = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it", "--model", "openai/example"], cwd,
      env: { AI_API_KEY: "secret", OPENROUTER_MODEL: "anthropic/example" },
    });
    expect(fromEnvironment.model).toBe("anthropic/example");
    expect(fromCli.model).toBe("openai/example");
  });

  test("selects direct DeepSeek credentials and model", async () => {
    const cwd = await temporaryDirectory();
    const config = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it", "--provider", "deepseek"],
      cwd,
      env: { DEEPSEEK_API_KEY: "deep-secret" },
    });
    expect(config.provider).toBe("deepseek");
    expect(config.model).toBe("deepseek-flash");
    expect(config.reasoningEffort).toBe("medium");
    expect(config.apiKey).toBe("deep-secret");
    expect(JSON.stringify(toPublicRunConfig(config))).not.toContain("deep-secret");
  });

  test("accepts explicit DeepSeek reasoning effort", async () => {
    const cwd = await temporaryDirectory();
    const config = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it", "--provider", "deepseek", "--reasoning-effort", "high"],
      cwd,
      env: { DEEPSEEK_API_KEY: "deep-secret" },
    });
    expect(config.reasoningEffort).toBe("high");
  });

  test("infers DeepSeek when it is the only configured credential", async () => {
    const cwd = await temporaryDirectory();
    const config = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it"],
      cwd,
      env: { DEEPSEEK_API_KEY: "deep-secret" },
    });

    expect(config.provider).toBe("deepseek");
    expect(config.model).toBe("deepseek-flash");
  });


  test("selects Qwen credentials and model", async () => {
    const cwd = await temporaryDirectory();
    const config = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it", "--provider", "qwen"],
      cwd,
      env: { QWEN_API_KEY: "qwen-secret", QWEN_MODEL: "qwen-max" },
    });

    expect(config.provider).toBe("qwen");
    expect(config.model).toBe("qwen-max");
    expect(config.apiKey).toBe("qwen-secret");
  });

  test("infers Qwen when it is the only configured credential", async () => {
    const cwd = await temporaryDirectory();
    const config = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it"],
      cwd,
      env: { QWEN_API_KEY: "qwen-secret" },
    });

    expect(config.provider).toBe("qwen");
    expect(config.model).toBe("qwen-plus");
  });

  test("honors MODEL_PROVIDER before credential inference", async () => {
    const cwd = await temporaryDirectory();
    expect(loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it"],
      cwd,
      env: { MODEL_PROVIDER: "openrouter", DEEPSEEK_API_KEY: "deep-secret" },
    })).rejects.toThrow("AI_API_KEY is required");
  });

  test("rejects an invalid provider from CLI or environment", async () => {
    const cwd = await temporaryDirectory();

    expect(loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it", "--provider", "made-up"],
      cwd,
      env: { AI_API_KEY: "secret" },
    })).rejects.toThrow("--provider must be openrouter, deepseek, or qwen");

    expect(loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it"],
      cwd,
      env: { MODEL_PROVIDER: "made-up", AI_API_KEY: "secret" },
    })).rejects.toThrow("MODEL_PROVIDER must be openrouter, deepseek, or qwen");
  });

  test("requires the credential belonging to the selected provider", async () => {
    const cwd = await temporaryDirectory();
    expect(loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it", "--provider", "deepseek"],
      cwd,
      env: { AI_API_KEY: "openrouter-only" },
    })).rejects.toThrow("DEEPSEEK_API_KEY is required");
    expect(loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it", "--provider", "qwen"],
      cwd,
      env: { AI_API_KEY: "openrouter-only" },
    })).rejects.toThrow("QWEN_API_KEY is required");
  });

  test("honors NO_COLOR and an explicit color override", async () => {
    const cwd = await temporaryDirectory();
    const plain = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it"], cwd, env: { AI_API_KEY: "secret", NO_COLOR: "1" },
    });
    const colored = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it", "--color", "enabled"], cwd, env: { AI_API_KEY: "secret", NO_COLOR: "1" },
    });
    expect(plain.colorEnabled).toBeFalse();
    expect(colored.colorEnabled).toBeTrue();
  });

  test("omits the credential from public configuration", async () => {
    const cwd = await temporaryDirectory();
    const config = await loadRunConfig({
      argv: ["--repo", ".", "--task", "Fix it"],
      cwd,
      env: { AI_API_KEY: "never-print-this" },
    });

    const serialized = JSON.stringify(toPublicRunConfig(config));
    expect(serialized).not.toContain("never-print-this");
    expect(serialized).not.toContain("apiKey");
  });
});
