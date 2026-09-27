#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { ConfigurationError, loadRunConfig, toPublicRunConfig } from "./config";
import {
  createAgentEventRenderer,
  formatPlanContext,
  generatePlanRaw,
  loadFakeModelScript,
  runAutonomousTask,
  type AgentPlan,
  type PlanAnswer,
} from "./agent";
import { createDeepSeekModel, createOpenRouterModel, createQwenModel, DEEPSEEK_BASE_URL } from "./model";
import { fetchGitHubIssueTask, type IssueFetcher } from "./issue";
import {
  collectInteractiveRunArguments,
  InteractiveRunCancelled,
  type TerminalPrompt,
} from "./interactive";
import {
  createArrowKeySelector,
  createTuiEventRenderer,
  planQuestionToSelectChoices,
  renderPlanApproval,
  renderPlanSummary,
  renderRunSummary,
} from "./tui";

export const HELP = `Dinner — autonomous coding harness

Usage:
  bun run src/cli.ts run --repo <path> (--task <text> | --task-file <path>) [options]
  bun run src/cli.ts run --repo <path> --issue <github-issue-url> [options]
  bun run src/cli.ts run                    Start the guided terminal wizard

Required environment:
  AI_API_KEY                 OpenRouter API key for live development runs
  DEEPSEEK_API_KEY           DeepSeek API key for direct DeepSeek runs
  QWEN_API_KEY               Qwen DashScope-compatible API key for direct Qwen runs

Options:
  --repo <path>              Target Git repository
  --task <text>              Software-engineering task
  --task-file <path>         Read the task from a UTF-8 file
  --issue <url>              Fetch a GitHub issue and use it as the task
  --output <path>            Artifact directory (default: unique OS temporary directory)
  --max-steps <integer>      Maximum agent actions (default: 120)
  --max-minutes <number>     Wall-clock limit in minutes (default: 60)
  --max-model-calls <int>    Maximum model calls (default: 80)
  --max-repair-attempts <n>  Maximum code-related failures (default: 12)
  --verification-reserve-steps <n>  Steps protected for final checks (default: 10)
  --max-stagnation-interventions <n> Repeated-action limit (default: 6)
  --max-context-chars <n>    Approximate request character limit (default: 64000)
  --repository-map <enabled|disabled>  Add ranked source map to initial context (default: disabled)
  --color <enabled|disabled>  Terminal color; NO_COLOR disables by default
  --model-script <path>      Development-only JSON decisions for the fake model
  --provider <name>          openrouter, deepseek, or qwen (default: inferred from credentials)
  --model <id>               Provider model (DeepSeek default: deepseek-flash)
  --reasoning-effort <level> DeepSeek reasoning effort: low, medium, high (default: medium)
  --plan <enabled|disabled>  Enable Plan mode: agent proposes plan with questions first (default: disabled)
  --help                     Show this help
`;

async function runGitApplyCheck(repoPath: string, patch: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const check = Bun.spawnSync(["git", "apply", "--check", "--binary", "--whitespace=nowarn", "-"], {
    cwd: repoPath,
    stdin: Buffer.from(patch),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (check.exitCode !== 0) return { ok: false, error: check.stderr.toString().trim() || "Patch does not apply." };
  const applied = Bun.spawnSync(["git", "apply", "--binary", "--whitespace=nowarn", "-"], {
    cwd: repoPath,
    stdin: Buffer.from(patch),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (applied.exitCode !== 0) return { ok: false, error: applied.stderr.toString().trim() || "Patch application failed." };
  return { ok: true };
}

async function maybeOfferPatchApplication(options: {
  interactive: boolean;
  ask: TerminalPrompt;
  stdout: (message: string) => void;
  repoPath: string;
  patchPath: string;
  changedFiles: readonly string[];
}): Promise<void> {
  if (!options.interactive || options.changedFiles.length === 0) return;
  options.stdout(`\nPatch ready: ${options.patchPath}`);
  options.stdout(`Changed files: ${options.changedFiles.join(", ")}`);
  const answer = options.ask("Apply this patch to the source repo now? (y/N)", "N")?.trim().toLowerCase() ?? "";
  if (answer !== "y" && answer !== "yes") {
    options.stdout("Patch left unapplied. You can inspect patch.diff and apply it later.");
    return;
  }
  const patch = await readFile(options.patchPath, "utf8");
  const applied = await runGitApplyCheck(options.repoPath, patch);
  if (applied.ok) {
    options.stdout("Patch applied to the source repo.");
  } else {
    options.stdout(`Patch was not applied: ${applied.error}`);
  }
}

export async function runCli(
  argv: string[],
  dependencies: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    interactive?: boolean;
    promptForTask?: () => string | null;
    prompt?: TerminalPrompt;
    issueFetcher?: IssueFetcher;
    stdout?: (message: string) => void;
    stderr?: (message: string) => void;
  } = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? console.log;
  const stderr = dependencies.stderr ?? console.error;

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    stdout(HELP);
    return 0;
  }

  const [command, ...suppliedCommandArgs] = argv;
  if (command !== "run") {
    stderr(`Unknown command: ${command}\n\n${HELP}`);
    return 2;
  }

  if (suppliedCommandArgs.includes("--help") || suppliedCommandArgs.includes("-h")) {
    stdout(HELP);
    return 0;
  }

  try {
    const interactive = dependencies.interactive ?? Boolean(process.stdin.isTTY);
    const ask = dependencies.prompt ?? ((question, defaultValue) =>
      defaultValue === undefined ? prompt(question) : prompt(question, defaultValue));
    const commandArgs = interactive && suppliedCommandArgs.length === 0
      ? collectInteractiveRunArguments({
          ask,
          write: stdout,
          cwd: dependencies.cwd ?? process.cwd(),
          env: dependencies.env ?? process.env,
          select: createArrowKeySelector({ color: (dependencies.env ?? process.env).NO_COLOR === undefined }),
        })
      : suppliedCommandArgs;
    const configOptions: Parameters<typeof loadRunConfig>[0] = {
      argv: commandArgs,
      interactive,
      promptForTask: dependencies.promptForTask ?? (() => prompt("Task: ")),
      issueFetcher: dependencies.issueFetcher ?? fetchGitHubIssueTask,
    };
    if (dependencies.env !== undefined) configOptions.env = dependencies.env;
    if (dependencies.cwd !== undefined) configOptions.cwd = dependencies.cwd;

    const config = await loadRunConfig(configOptions);

    stdout(JSON.stringify(toPublicRunConfig(config), null, 2));
    const model = config.modelScriptPath === undefined
      ? config.provider === "deepseek"
        ? createDeepSeekModel({
            apiKey: config.apiKey!,
            model: config.model,
            ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }),
          })
        : config.provider === "qwen"
          ? createQwenModel({ apiKey: config.apiKey!, model: config.model })
          : createOpenRouterModel({ apiKey: config.apiKey!, model: config.model })
      : await loadFakeModelScript(config.modelScriptPath);
    const runOptions: Parameters<typeof runAutonomousTask>[0] = {
      repoPath: config.repoPath,
      outputPath: config.outputPath,
      task: config.task,
      maxSteps: config.budgets.maxSteps,
      maxMinutes: config.budgets.maxMinutes,
      maxModelCalls: config.budgets.maxModelCalls,
      maxRepairAttempts: config.budgets.maxRepairAttempts,
      verificationReserveSteps: config.budgets.verificationReserveSteps,
      maxStagnationInterventions: config.budgets.maxStagnationInterventions,
      maxContextChars: config.budgets.maxContextChars,
      repositoryMapEnabled: config.repositoryMapEnabled,
    };
    if (config.apiKey !== undefined) runOptions.apiKey = config.apiKey;

    // --- Plan Mode ---
    let planContext = "";
    if (config.planMode && interactive && config.apiKey !== undefined) {
      const select = createArrowKeySelector({ color: config.colorEnabled });

      stdout("\n⏳ Generating plan from issue analysis...\n");
      const baseUrl = config.provider === "deepseek" ? DEEPSEEK_BASE_URL
        : config.provider === "qwen" ? "https://dashscope.aliyuncs.com/compatible-mode/v1"
        : "https://openrouter.ai/api/v1";

      const planResult = await generatePlanRaw({
        apiKey: config.apiKey,
        baseUrl,
        model: config.model,
        task: config.task,
        repositoryContext: { repoPath: config.repoPath },
      });

      if (planResult.questions.length > 0) {
        stdout(renderPlanSummary(planResult, { color: config.colorEnabled }));

        const answers: PlanAnswer[] = [];
        const CUSTOM_VALUE = "__plan_custom_answer__";

        for (const question of planResult.questions) {
          const choices = planQuestionToSelectChoices(question);
          const selectedAnswer = select(
            question.question,
            choices,
            {
              defaultIndex: question.defaultIndex ?? 0,
              help: "Use ↑/↓ or j/k. Press Enter to select. Last option lets you type a custom answer.",
            },
          );

          let finalAnswer: string;
          let isCustom = false;

          if (selectedAnswer === CUSTOM_VALUE || selectedAnswer === null) {
            const customInput = ask("Your answer");
            finalAnswer = customInput?.trim() || choices[question.defaultIndex ?? 0]?.value || "Follow repo conventions";
            isCustom = finalAnswer !== choices[question.defaultIndex ?? 0]?.value;
          } else {
            finalAnswer = selectedAnswer;
          }

          answers.push({
            question: question.question,
            answer: finalAnswer,
            isCustom,
          });
        }

        const plan: AgentPlan = {
          summary: planResult.summary,
          questions: planResult.questions,
          answers,
        };

        stdout(renderPlanApproval(plan, { color: config.colorEnabled }));
        const planApproval = ask("Proceed with this plan? (Y/n)", "Y")?.trim().toLowerCase() ?? "";
        if (planApproval !== "y" && planApproval !== "yes" && planApproval !== "") {
          stdout("Plan rejected. Run cancelled.");
          return 0;
        }

        planContext = formatPlanContext(plan);
      } else {
        stdout("\n📋 No clarifying questions needed — proceeding with direct execution.\n");
      }
    }

    // Inject plan context into the task
    if (planContext !== "") {
      runOptions.task = `${runOptions.task}\n\n${planContext}`;
    }
    const result = await runAutonomousTask(runOptions, {
      model,
      onEvent: interactive
        ? createTuiEventRenderer(stdout, { color: config.colorEnabled })
        : createAgentEventRenderer(stdout, { color: config.colorEnabled }),
    });
    stdout(interactive ? renderRunSummary(result, { color: config.colorEnabled }) : JSON.stringify(result, null, 2));
    await maybeOfferPatchApplication({
      interactive,
      ask,
      stdout,
      repoPath: config.repoPath,
      patchPath: result.patchPath,
      changedFiles: result.changedFiles,
    });
    if (result.status === "verified") return 0;
    if (result.status === "partial") return 3;
    if (result.status === "blocked") return 4;
    if (result.status === "budget_exhausted") return 5;
    return 1;
  } catch (error) {
    if (error instanceof InteractiveRunCancelled) {
      stdout("Run cancelled.");
      return 0;
    }
    if (error instanceof ConfigurationError) {
      stderr(`Configuration error: ${error.message}`);
      return 2;
    }
    const detail = error instanceof Error ? error.message : String(error);
    stderr(`Unexpected error: ${detail}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
