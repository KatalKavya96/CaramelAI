# Dinner

Dinner is an autonomous coding harness for software-engineering tasks, built in reviewable commits for the AI Harness Hackathon 2026.

The current checkpoint provides an autonomous vertical slice with bounded memory, repair checkpoints, final-state evidence, stagnation controls, independent benchmarks, Docker commands, and patch export. The organizer-specific API transport remains pending; the CLI says this explicitly rather than guessing its protocol.

Input repositories are never edited directly. The workspace manager snapshots tracked changes, deletions, staged content, and non-ignored untracked files into a separate Git worktree. Checkpoints and final patches are calculated against that exact snapshot, so supplied changes are part of the baseline rather than mistaken for agent edits.

## What Dinner does

Dinner accepts a Git repository and engineering task, snapshots the repository into an isolated workspace, lets a validated model action loop inspect and edit it, runs bounded checks, and exports evidence. Completion belongs to the controller: a model cannot mark itself verified without a changed final state, passing evidence for that exact state, and final diff review.

The harness includes bounded repository tools, Docker command execution, atomic patching, guarded whole-file text replacement, checkpoints and recovery, compact task memory, stagnation detection, a verification reserve, independent hidden-test evaluation, and optional issue-guided repository mapping.

## Requirements

- Bun 1.3.x
- GNU Make
- Linux and Docker for target-repository command execution

## Setup

```bash
make setup
```

Create local environment configuration for OpenRouter development runs:

```bash
cp .env.example .env
```

Do not commit `.env` or API credentials.

## CLI

Show the command contract:

```bash
make run ARGS="--help"
```

Set `AI_API_KEY` to an OpenRouter key and optionally choose a model:

```bash
export AI_API_KEY="your-openrouter-key"
export OPENROUTER_MODEL="openai/gpt-5.2"
```

OpenRouter is the live development provider until the organizer publishes its official transport. Override the model per run with `--model <openrouter-model-id>`. The CLI accepts one task source: `--issue`, `--task`, or `--task-file`. If none is supplied, it prompts only when connected to an interactive terminal; headless execution exits with an error.

Direct DeepSeek runs use the OpenAI-compatible API without routing through OpenRouter:

```bash
export DEEPSEEK_API_KEY="your-deepseek-key"
export MODEL_PROVIDER="deepseek"
export DEEPSEEK_MODEL="deepseek-flash"
export DEEPSEEK_REASONING_EFFORT="medium"
make run
```

DeepSeek requests enable thinking with medium reasoning effort by default and use a 120-second request timeout. Select `deepseek` in the guided wizard, or pass `--provider deepseek --model deepseek-flash --reasoning-effort high` in a headless run when a task needs more reasoning.

For a guided run, invoke the command without arguments in a terminal:

```bash
make run
```

The wizard asks for the repository, GitHub issue URL/task/`@task-file`, model, repository map, budgets, and output directory, then shows the full configuration before starting. During execution, numbered terminal events show every model action and every redacted tool result, including captured command output previews. Complete command logs remain in the run's `checks/` directory. When an interactive run produces changes, Dinner asks whether to apply the generated patch back to the source repository.

For issue-driven runs:

```bash
make run ARGS="--repo /path/to/repo --issue https://github.com/owner/repo/issues/123 --provider deepseek --repository-map enabled"
```

The shorter Caramel issue command uses the optimized DeepSeek defaults:

```bash
make caramel REPO=/path/to/repo ISSUE=https://github.com/owner/repo/issues/123
```

The default run uses a short focused planning phase, begins implementation after two to four repository inspections, and keeps the fetched GitHub issue title and description as the binding acceptance contract through verification.

The balanced default ceiling is 120 steps, 80 model calls, and 60 minutes, with separate room for repair, verification, stagnation recovery, and compact context. Override it only when a task needs a different profile:

```bash
make caramel REPO=/path/to/repo ISSUE=https://github.com/owner/repo/issues/123 REASONING=high MAX_STEPS=40 MAX_MODEL_CALLS=25 MAX_MINUTES=30
```

Direct invocation exposes optional budgets:

```bash
AI_API_KEY="$AI_API_KEY" bun run src/cli.ts run \
  --repo . \
  --issue https://github.com/owner/repo/issues/123 \
  --output /tmp/dinner-manual \
  --max-steps 120 \
  --max-minutes 60 \
  --max-model-calls 80 \
  --max-repair-attempts 12 \
  --verification-reserve-steps 10 \
  --max-stagnation-interventions 6 \
  --max-context-chars 64000
```

Additional controls include `--max-repair-attempts`, `--verification-reserve-steps`, `--max-stagnation-interventions`, `--max-context-chars`, `--repository-map enabled`, `--reasoning-effort medium`, and `--color disabled`. Run `make run ARGS="--help"` for the authoritative list.

The experimental `--repository-map enabled` option adds bounded, ranked source-file and symbol candidates to the initial model context. It remains disabled by default: development-fixture localization improved from 0/6 metadata-only candidates to 6/6 relevant files in the top three, but this surrogate comparison does not establish a solve-rate or token improvement. The comparison and limitations are recorded in `benchmarks/reports/localization-comparison-2026-09-26.json`.

Render the current evaluation scorecard in the terminal:

```bash
make scorecard
```

The scorecard keeps autonomous solve metrics separate from evaluator calibration and localization accuracy. Unobserved real-model metrics appear as `N/A` rather than as zero.

If `--output` is omitted, Dinner creates a unique run beneath the operating system's temporary directory. Output must be outside the target repository.

### Deterministic fake-model runs

A fake-model script is a JSON array containing one validated decision per model turn:

```json
[
  { "intent": "inspect", "action": { "type": "list_files", "path": "." } },
  { "intent": "finish", "action": { "type": "finish", "summary": "Inspection complete." } }
]
```

Run it without an API key:

```bash
make run ARGS="--repo /path/to/target-repo --task 'Inspect the repository' --model-script /path/to/script.json --output /tmp/dinner-run"
```

The example finishes as `partial` because it neither changes code nor executes a successful verification command. A model cannot obtain `verified` merely by claiming success.

## Run artifacts

Every initialized run keeps its artifacts outside the target repository:

- `result.json`: machine-readable status, metrics, evidence, recovery, memory, and usage.
- `patch.diff`: binary-capable Git patch against the exact supplied input snapshot.
- `events.jsonl`: append-only structured progress events.
- `report.md`: reviewer-facing evidence, missing/stale checks, failures, and artifact paths.
- `checks/`: complete stdout and stderr logs for commands.

`verified` means the available final-state checks passed; independent hidden evaluation may still reject the patch. Other honest outcomes are `partial`, `blocked`, `budget_exhausted`, and `failed`.

## Development checks

```bash
make test
make check
```

Build and test the command-execution container when Docker is running:

```bash
make runner-image
make test-docker
```

Each target command receives one unprivileged, read-only-root container with CPU, memory, process, time, preview, and log limits. Only the target workspace is mounted read-write. The container has network access, but model credentials are never injected. Docker reduces host exposure; it is not claimed as a complete security boundary.

Rehearse the committed tree from a fresh archive:

```bash
make rehearse-clean
```

## Demo, evaluation, and limitations

Run the verified and honest-partial demonstrations using [docs/demo.md](docs/demo.md). Current results and precise claim limits are in [docs/evaluation.md](docs/evaluation.md). The organizer-model adapter remains the principal unresolved implementation dependency; autonomous solve-rate and cost metrics are unavailable until that contract is supplied.

Architecture and provisional evaluator assumptions are documented in [docs/architecture.md](docs/architecture.md) and [docs/contract.md](docs/contract.md). Before delivery, follow [docs/submission.md](docs/submission.md).
