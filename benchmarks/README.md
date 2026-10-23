# Benchmark suite

Each task contains four pinned inputs:

- `fixture/`: the repository shown to the agent.
- `evaluator/`: acceptance tests kept outside that repository and mounted read-only.
- `solution.patch`: a known-good calibration patch.
- `manifest.json`: issue text, budgets, commands, and SHA-256 hashes for all three inputs.

Manifests label tasks as `development` or `held_out`. Moving a held-out task into tuning requires changing that label and recording the reclassification; held-out solution patches are calibration artifacts and must not be used while tuning agent behavior.

The evaluator copies the fixture into a fresh Git repository, checks and applies the submitted patch atomically, then runs task and regression checks. Its `benchmark-result.json` records `solved`, `unsolved`, `timeout`, `invalid_submission`, or `infrastructure_error` independently of the agent's own verification claims.

Build the runner image, then evaluate a patch:

```sh
make runner-image
make benchmark ARGS='--task benchmarks/tasks/ts-add --patch benchmarks/tasks/ts-add/solution.patch --output /tmp/dinner-eval'
```

The output directory must be outside the task directory. Use a new output directory for each durable attempt; the CLI replaces an existing output directory so stale files cannot affect a score.

## Tasks

| Task | Split | What it measures |
|------|-------|------------------|
| `ts-add`, `ts-clamp`, `ts-prefix`, `py-median`, `py-port`, `py-slug` | development | One-function bugs. A floor: every model should solve these. |
| `ts-unique`, `py-chunks` | held_out | Same size, kept out of tuning. |
| `ts-receipt-rounding` | development | The symptom shows in the CLI output; the bug is a float-to-cents helper two files away. Discount rounding must stay as documented. |
| `py-regression-test` | development | Write a test, not a fix. Solved only if the suite fails when the old bug is put back. |
| `ts-rename-export` | development | Rename a public function everywhere and keep a `@deprecated` alias for existing users. |
| `ts-readme-example` | development | The docs are wrong, not the code (the CHANGELOG says so). README examples are executed. |
| `py-env-override` | held_out | A real-looking bug report with a traceback and a wrong guess. Only typing every env setting fixes it. |
| `py-not-a-bug` | held_out | Half of the report is documented behaviour. Changing it fails, even though the reporter asked. |
| `ts-timezone-date` | held_out | "Flaky" test that is a real date bug west of UTC. Pinning `TZ=UTC` hides it and fails. |

Hidden checks drive each project the way a user would: running its CLI, copying its README
examples, or sending reminders from machines in six time zones.
