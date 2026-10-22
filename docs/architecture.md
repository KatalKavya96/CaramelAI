# Harness architecture

## Runtime flow

```text
CLI input
  -> run initializer and isolated workspace
  -> controller
       -> model adapter
       -> repository and edit tools
       -> Docker command runner
       -> task state and event writer
       -> verification gate
  -> result.json + patch.diff + events.jsonl + check logs
  -> independent benchmark evaluation
```

The controller owns limits, validates every requested action, executes tools, records observations, and determines whether a model finish request satisfies the completion gate. The model proposes actions and code changes but cannot create verification evidence or set the final status directly.

## Component boundaries

### CLI and configuration

Parse explicit run inputs, validate environment configuration, select interactive or headless behavior, initialize the output directory, and render progress from structured events. Configuration precedence is command-line option, environment variable, then documented default. Secrets are accepted only through the environment and are redacted from logs.

### Model adapter

Expose one provider-neutral request boundary returning validated actions. The implementation includes a scripted fake adapter, an OpenRouter development transport using strict JSON Schema responses, and a direct DeepSeek OpenAI-compatible transport. The organizer adapter can replace those transports when its protocol is confirmed. The adapter owns API timeouts, bounded transient retries, and provider-reported usage. It does not execute tools.

### Controller and state

Maintain the original task, current plan, evidence-backed findings, hypotheses, inspected and changed files, failures, budgets, and completion state. The controller sends bounded context to the model, rejects invalid actions, and stops on success, an external block, a harness failure, or budget exhaustion.

### Repository tools

Provide bounded file listing, text search, ranged reads, atomic patch application, guarded whole-file text replacement, and diff inspection. All paths are resolved against the isolated working copy and checked for traversal and symlink escape. Replacement is limited to relative text-file paths inside the workspace, rejects unchanged content and oversized writes, and still exports as a normal Git patch. Tool results use typed success and failure variants and mark truncated output explicitly.

### Command runner

Execute target commands in a fresh unprivileged Linux container with time, output, and resource limits. Mount only the isolated working copy and dedicated log paths. Permit network access by default, with `--network none` to disable it. Keep git metadata outside the mount. Do not inject model credentials or mount the host Docker socket.

### Verification and evidence

Associate every check with its exact command, working directory, exit state, duration, full log, and a fingerprint of the tested code state. Any later code edit makes earlier code-dependent evidence stale. The completion gate, not the model, decides whether final evidence is sufficient for `verified`.

### Events and artifacts

Write append-only JSONL events as the source for terminal rendering and post-run inspection. Final artifacts live outside the target working copy so they cannot appear in the submitted patch. Artifact writing remains available after the model budget is exhausted.

### Benchmark evaluator

Start each task from a pinned clean state, apply the exported patch to a separate evaluation workspace, and run acceptance checks unavailable to the agent. Record all attempts, including timeouts and infrastructure failures. Development and held-out tasks stay distinct.

## Initial non-goals

- Multiple cooperating agents or model routing.
- Vector databases or repository-wide embedding indexes.
- Web or desktop IDE integration.
- Automatic commits, pushes, pull requests, or issue updates in target repositories.
- Claims of language support beyond the ecosystems exercised by the benchmark.

## Decision gates

1. Replace provisional organizer assumptions after reviewing the source documents.
2. Implement the official model adapter only after the provider contract is known.
3. Add one measured improvement at a time after the first benchmark baseline.
4. Keep experimental behavior behind configuration until it shows a benefit without unacceptable regressions.
