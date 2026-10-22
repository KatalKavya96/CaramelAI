# Harness execution contract

Status: aligned with the six-page problem statement supplied on 2026-09-26; evaluator transport and submission details remain provisional until their separate documents are available.

## Product goal

The harness receives a software-engineering task and a local Git repository, works in an isolated copy, and returns a patch with machine-readable evidence. It runs autonomously after invocation and must terminate within configured limits.

The product is a TypeScript application executed by Bun. It is initially tested against TypeScript/JavaScript and Python target repositories on Linux. Target-repository commands execute in disposable Docker containers with network access. The model client remains outside those containers, and API credentials are never forwarded into them.

## Proposed invocation

The stable headless interface will be:

```text
bun run src/cli.ts run \
  --repo <absolute-or-relative-repository-path> \
  (--issue <github-issue-url> | --task <text> | --task-file <path>) \
  [--output <artifact-directory>] \
  [--max-steps <positive-integer>] \
  [--max-minutes <positive-number>] \
  [--max-model-calls <positive-integer>]
```

During development, OpenRouter and the direct DeepSeek OpenAI-compatible API are live providers. Select them with `--provider openrouter|deepseek`; their credentials are held in `AI_API_KEY` and `DEEPSEEK_API_KEY` respectively. DeepSeek reasoning effort defaults to `medium` and can be set with `--reasoning-effort low|medium|high`. `--model-script <path>` supplies a validated JSON array of fake-model decisions and does not require a key. Neither development transport is assumed to be the official evaluation transport.

`make run` invokes the same entrypoint. When attached to an interactive terminal, a missing task may be prompted for. In a noninteractive process, missing required input is an error rather than a prompt. OpenRouter live runs are explicitly identified as development evaluation until the organizer transport is known.

The input repository is never modified during autonomous work. Each run creates an isolated working copy beneath its artifact directory. Model edits are limited to validated actions against that copy, including atomic Git patch application and guarded whole-file text replacement. A successful or partial run preserves that working copy for inspection. Interactive runs may offer to apply the final patch back to the source repository after the run finishes.

## Result contract

Every run that reaches local initialization writes:

- `result.json`: final status, termination reason, changed files, verification summary, timing, usage when reported by the provider, and artifact paths.
- `patch.diff`: changes relative to the recorded input state, including new and deleted files.
- `events.jsonl`: ordered structured execution events.
- `checks/`: complete command outputs referenced by verification records.

The process exits `0` only for `verified`. Other completed outcomes use a nonzero exit code defined by the CLI implementation and repeated in `result.json`.

Statuses:

- `verified`: required available checks passed against the exact final code state. This is evidence of verification, not proof that hidden evaluation tests will pass.
- `partial`: useful changes exist, but one or more requirements or checks remain unresolved.
- `blocked`: an external prerequisite prevents meaningful progress.
- `budget_exhausted`: a configured step, call, time, or token limit ended the run.
- `failed`: the harness itself could not complete the run.
- `cancelled`: the user stopped the run (Ctrl+C). The in-flight command container is removed and the report is still written. Exit code 130.

An independent benchmark runner decides whether a task is `solved`; the agent cannot assign that label to itself.

## Security and isolation boundary

Target commands run in a disposable Linux container with the working copy mounted read-write and an artifact log location controlled by the harness. Network access is permitted throughout the task based on the team's current decision. The harness must redact known credentials from events and logs and must not place model credentials in the container environment.

Docker reduces host exposure but is not presented as a complete security boundary. The implementation will use resource and time limits and avoid privileged containers, host Docker socket mounts, and broad host filesystem mounts.

## Current decisions

| Area | Decision |
|---|---|
| Harness implementation | TypeScript with Bun 1.3.x |
| Interaction | Autonomous headless CLI with readable progress |
| Target ecosystems tested first | TypeScript/JavaScript and Python |
| Execution platform | Linux with Docker |
| Target network | Available throughout task execution |
| Change delivery | Isolated working copy plus patch and evidence |
| Development model use | Deterministic fake adapter first; live quota pending |
| Team/time assumption | 24 hours, mainly one developer working with Codex |

## Confirmed problem-statement requirements

The supplied problem statement requires an autonomous coding-agent harness around the same standardized foundation model used by every team. It emphasizes repository navigation, tool use, context and state management, orchestration, failure recovery, verified code changes, and efficient resource use. It explicitly prioritizes correctness, evidence, and efficiency, while leaving the agent architecture to participants.

The problem statement does not identify the provider, model, endpoint, API schema, key format, evaluator invocation, resource limits, or submission contract. Claims derived only from the earlier conversation summary, including `AI_API_KEY` and Make target expectations, therefore remain provisional.

## Requirements still needing official confirmation

- Provider, exact model identifier, request protocol, supported structured-output features, and quota.
- Exact evaluator input mechanism and whether interactive input is permitted.
- Required artifact or repository mutation semantics.
- Required Makefile targets and process exit behavior.
- Time, token, disk, CPU, and memory limits.
- Docker availability and restrictions in the final judging environment.
- Whether target repositories may access the network and install dependencies.
- Submission deadline, repository visibility, deliverables, and judging rubric.

The model adapter, task input parser, execution backend, and result writer remain replaceable until these points are confirmed.
