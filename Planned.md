# Caramél — Planned Enhancements

## Purpose

Use this file as the implementation roadmap for improving the Caramél AI Coding Harness.

Implement the plan **segment by segment**, not all at once. For every segment:

1. Inspect the existing architecture before changing anything.
2. Reuse existing abstractions where possible.
3. Keep the implementation modular, strongly typed, and testable.
4. Avoid duplicating functionality that already exists.
5. Add or update tests for every meaningful behavior change.
6. Run typecheck and relevant tests after each segment.
7. Preserve current working behavior unless the change intentionally improves it.
8. Keep compatibility with `make setup`, `make run`, and `make test`.
9. Prefer small composable modules over large controller/UI files.
10. Inspect the final diff before marking work complete.

---

# Global Engineering Requirement — Improve Code Structure and Design

While implementing every segment, continuously improve the internal architecture.

## Structure goals

Refactor toward clear boundaries such as:

```text
src/
├── agent/
│   ├── controller.ts
│   ├── phases.ts
│   ├── state.ts
│   ├── policies.ts
│   └── types.ts
├── context/
│   ├── builder.ts
│   ├── stale-context.ts
│   └── types.ts
├── planning/
│   ├── hypotheses.ts
│   ├── planner.ts
│   └── types.ts
├── recovery/
│   ├── classify.ts
│   ├── strategies.ts
│   └── types.ts
├── verification/
│   ├── evidence.ts
│   ├── gates.ts
│   ├── impact.ts
│   ├── reviewer.ts
│   └── types.ts
├── reporting/
│   ├── report.ts
│   ├── events.ts
│   ├── replay.ts
│   └── artifacts.ts
├── tui/
│   ├── theme.ts
│   ├── dashboard.ts
│   ├── timeline.ts
│   ├── selectors.ts
│   └── views.ts
└── ...
```

This exact structure is optional, but the codebase should move toward:

- small files with focused responsibility,
- no giant monolithic controller,
- minimal circular dependencies,
- reusable rendering helpers,
- provider-specific logic isolated from generic model logic,
- UI separated from agent execution,
- persistence separated from runtime state,
- verification/reporting separated from terminal rendering,
- centralized enums/constants for phases, actions, statuses, and termination reasons,
- explicit interfaces instead of loose objects,
- pure/testable functions where practical.

## Code quality expectations

- Prefer explicit types over `any`.
- Reduce deeply nested conditionals through strategies/policies where useful.
- Centralize configuration defaults and validation.
- Keep functions short and single-purpose.
- Preserve useful error messages.
- Keep behavior deterministic where possible.
- Maintain credential, shell, and workspace security boundaries.
- Every new subsystem should have tests.
- Refactor opportunistically when touching poorly structured code, but avoid unrelated rewrites.

---

# MANDATORY CORE EXECUTION MODEL — Iterative Coding Feedback Loop

This is a **required architectural change**, not an optional enhancement.

The current architecture must not behave as:

```text
issue
→ make one plan
→ edit code
→ finish
```

Caramél must operate as a closed-loop engineering system:

```text
UNDERSTAND
   ↓
PLAN
   ↓
INSPECT
   ↓
IMPLEMENT
   ↓
VERIFY
   ↓
INTERPRET RESULT
   ↓
┌───────────────────────────────┐
│ verification failed?          │
│                               │
│ YES → diagnose → re-plan      │
│        → edit → verify again  │
│                               │
│ NO  → review diff/task        │
└───────────────────────────────┘
   ↓
FINAL VERIFICATION
   ↓
FINISH
```

The system must assume that the **first implementation attempt may be wrong**.

A code edit is never considered complete merely because:

- the model believes it is correct,
- the patch applied successfully,
- the code compiles,
- one command succeeded,
- the intended change looks reasonable.

The harness must gather evidence from the repository after changes and use that evidence to decide what to do next.

## Mandatory controller loop

The central controller should conceptually operate like:

```text
while not terminal:
    understand current task state
    choose next action
    execute action
    observe real result
    update evidence/memory/state

    if source changed:
        invalidate stale verification
        determine relevant checks
        run verification

    if verification failed:
        classify failure
        inspect failure evidence
        update/reject hypothesis
        re-plan narrowly
        repair
        verify again

    if verification passed:
        review final diff against task
        detect missing requirements/regressions
        run final required checks

    finish only when completion gates are satisfied
```

Do not implement this as an uncontrolled infinite retry loop. It must remain bounded by:

- step budget,
- model-call budget,
- repair-attempt budget,
- time budget,
- stagnation policy,
- verification reserve.

## Mandatory edit → test → diagnose → repair cycle

Any meaningful source-code change should trigger a verification cycle.

Preferred sequence:

```text
EDIT
↓
inspect diff
↓
select cheapest meaningful verification
↓
run targeted check/test
↓
interpret result
```

If successful:

```text
targeted verification
↓
broader verification where appropriate
↓
final diff/task review
```

If unsuccessful:

```text
failure output
↓
classify failure
↓
inspect relevant source/test
↓
update hypothesis
↓
repair
↓
rerun failed check
```

The agent must **not blindly apply another patch** without first using the failure as new evidence.

## Verification ladder

Use a cost-aware verification ladder rather than always running the most expensive command first:

```text
1. syntax/type/build check for touched area
2. directly related test(s)
3. related test module/package
4. project lint/typecheck/build as relevant
5. broader/full test suite where practical
6. final diff review
```

The exact ladder should adapt to the repository.

Examples:

### TypeScript
```text
targeted unit test
→ package test
→ typecheck
→ lint if configured
→ broader suite
```

### Python
```text
specific pytest node
→ test file/module
→ related package tests
→ broader pytest suite
```

### Go
```text
go test ./relevant/package
→ go test ./...
```

### Rust
```text
cargo test relevant_test
→ cargo test
→ cargo check/clippy if appropriate
```

Do not hardcode language behavior in the controller if it belongs in repository/verification adapters.

## Failed verification becomes new context

When a verification command fails, record structured evidence:

```text
command
exit code
failure category
failing test/build target
relevant file/line references
concise stderr/stdout summary
whether failure existed before the edit
current code fingerprint
attempt number
```

Feed only the relevant failure evidence back into the next reasoning step.

Avoid repeatedly injecting huge raw logs into context.

## Re-plan after evidence changes

The initial execution plan is provisional.

The system must support:

```text
initial plan
↓
new repository evidence
↓
plan update
↓
implementation
↓
failed verification
↓
plan revision
```

The plan should contain states such as:

```text
pending
in_progress
verified
blocked
superseded
```

A failed assumption should invalidate dependent plan items where appropriate.

## Repair attempts must be evidence-driven

Each repair should answer:

```text
What failed?
Why do we think it failed?
What evidence supports that explanation?
What is the smallest change likely to fix it?
How will we verify that specific repair?
```

Avoid:

```text
test failed
→ ask model to "try again"
```

Prefer:

```text
test failed with assertion X
→ locate assertion/call path
→ compare expected vs actual behavior
→ revise hypothesis
→ make minimal repair
→ rerun exact failing test
```

## Final verification is mandatory

Before a successful finish:

1. inspect final diff,
2. ensure verification evidence matches the current code fingerprint,
3. rerun any check made stale by later edits,
4. confirm the original issue requirements are covered,
5. confirm no known failed check is being ignored,
6. record exactly what was and was not verified.

Successful completion must be evidence-based.


---

# SEGMENT 1 — User Interface and Input Experience

Goal: make Caramél easy to understand, configure, and operate without weakening headless/evaluator execution.

## 1.1 Dashboard navigation

Create a proper interactive dashboard:

```text
New Task
Continue
Recent Runs
Settings
Benchmarks
Tools
Help
```

Requirements:

- arrow-key navigation,
- Enter to select,
- number shortcuts,
- Esc / Ctrl+C safe cancellation,
- consistent Caramél yellow/gold theme,
- low-flicker redraw,
- non-TTY/headless fallback.

## 1.2 Better New Task flow

Use a compact setup screen containing:

```text
Repository
Task source
Provider
Model

Limits
- max steps
- max model calls
- max repair attempts
- max minutes
- max context

Repository map
Docker execution
Output directory
```

Allow review before start.

## 1.3 Multiple task input modes

Support:

- pasted task,
- GitHub issue URL,
- task file,
- benchmark task,
- optionally recent task.

Keep normalization centralized.

## 1.4 Recent repositories

Expose recently used/detected repositories:

```text
~/Desktop/project-a
~/Desktop/project-b
~/Documents/api
Choose another...
```

Persist only non-sensitive path history.

## 1.5 Real Continue flow

Show recent runs with:

- run ID,
- task title,
- status,
- repository,
- timestamp.

Actions:

- resume if genuinely resumable,
- rerun verification,
- open report,
- inspect patch,
- replay run.

Do not fake resume support.

## 1.6 Settings screen

Basic:

- provider,
- model,
- repository.

Advanced:

- max steps,
- max model calls,
- repair attempts,
- context limit,
- verification reserve,
- repository map,
- Docker,
- debug mode.

## 1.7 Live phase indicator

Show:

```text
EXPLORE → PLAN → IMPLEMENT → VERIFY → RECOVER → REVIEW → FINISH
```

Highlight current phase from real controller state.

## 1.8 Live budgets

Show:

```text
Step          11 / 32
Model calls    6 / 18
Repairs        1 / 4
Context       21k / 32k
Elapsed       03:14 / 20:00
```

## 1.9 Optional local/demo controls

Optional only:

```text
p  pause
r  resume
d  diff
e  evidence
q  stop safely
```

Do not let these affect autonomous evaluator mode.

## 1.10 Compact live timeline

Prefer:

```text
01  SEARCH      refresh token                  8 matches
02  READ        src/auth/token.ts              1–184
03  PLAN        expiry validation missing
04  EDIT        src/auth/token.ts              +8 -2
05  TEST        auth suite                     17/17 pass
06  REVIEW      final diff                     clean
```

---

# SEGMENT 2 — Core Optimization and Score Increase

Goal: improve correctness, hidden-task solve rate, verification quality, and efficiency.

This is the highest-priority segment.


## 2.0 Mandatory autonomous engineering loop

Implement the feedback-loop architecture described in **MANDATORY CORE EXECUTION MODEL** before advanced optimization work.

Required properties:

- the plan can change after new evidence,
- edits invalidate stale verification,
- changed code triggers appropriate checks,
- failing checks trigger diagnosis before another edit,
- repairs are bounded,
- successful tests do not automatically mean the task is complete,
- final diff/task review is separate from test execution,
- completion requires fresh evidence.

The controller should own orchestration; individual tools should remain small and deterministic.

### Recommended state model

Track at least:

```text
task
phase
current plan
active hypothesis
completed actions
changed files
code fingerprint
verification fingerprint
verification results
known failures
repair attempt count
stagnation state
remaining budgets
final-review state
```

This state should be serializable enough to support reports, replay, and future resume behavior.

### Recommended high-level transitions

```text
EXPLORE
  ↓ enough evidence
PLAN
  ↓ actionable plan
IMPLEMENT
  ↓ code changed
VERIFY
  ├─ pass → REVIEW
  └─ fail → RECOVER

RECOVER
  ├─ repair possible → IMPLEMENT
  ├─ more evidence needed → EXPLORE
  └─ limits reached → STOP

REVIEW
  ├─ issue found → IMPLEMENT / RECOVER
  └─ clean → FINAL_VERIFY

FINAL_VERIFY
  ├─ pass → FINISH
  └─ fail → RECOVER
```

Avoid allowing arbitrary direct transitions to `FINISH`.


## 2.1 Better repository localization

Combine:

- task keywords,
- filename/path relevance,
- exact symbol matches,
- imports,
- references,
- test-to-source relationships,
- directory proximity.

Example weighting:

```text
exact symbol match       +10
path/name match           +6
import relationship       +5
test references symbol    +5
content keyword match     +2
```

Keep ranking bounded and benchmarkable.

## 2.2 Lightweight dependency/call graph

Support practical relationships such as:

- TS/JS imports,
- Python imports,
- test-to-source links,
- cheap symbol references.

Use graph neighbors to improve localization.

Avoid over-engineering a full compiler pipeline unless justified.

## 2.3 Explicit phase/state machine

Represent real phases:

```text
EXPLORE
PLAN
IMPLEMENT
VERIFY
RECOVER
REVIEW
FINISH
```

Use phase-aware action policies.

Example:

### EXPLORE
- list
- search
- read

### IMPLEMENT
- read
- checkpoint
- patch
- replace

### VERIFY
- run commands
- inspect diff
- collect evidence

## 2.4 Hypothesis ledger

Create first-class hypothesis state:

```json
{
  "id": "H2",
  "statement": "middleware bypasses token expiry validation",
  "status": "active",
  "evidenceFor": [],
  "evidenceAgainst": []
}
```

Statuses:

```text
active
confirmed
rejected
superseded
```

Prevent repeated failed approaches.

## 2.5 Failure-specific recovery

### Patch failure
- reread exact region,
- inspect current text,
- generate fresh patch.

### Compiler/type error
- extract file/line,
- inspect edited symbol,
- repair narrowly.

### Test assertion failure
- inspect failing test,
- inspect target implementation,
- update/reject hypothesis.

### Timeout
- narrow scope,
- use targeted tests,
- avoid immediate repetition.

### Setup/dependency failure
- inspect manifests/runtime,
- keep separate from code-repair budget where appropriate.

## 2.6 Test-impact selection

Infer likely relevant tests using:

- changed files,
- naming conventions,
- imports,
- symbol references,
- directory proximity.

Flow:

```text
edit
↓
targeted tests
↓
broader related tests
↓
full suite when appropriate
```

Track verification depth.

## 2.7 Automatic regression-test generation

For bug fixes:

1. check whether an existing test reproduces the issue,
2. if not, create a minimal meaningful regression test,
3. ideally demonstrate failure before fix,
4. apply fix,
5. verify pass,
6. run broader checks.

Avoid meaningless generated tests.

## 2.8 Adaptive context builder

Build context by phase.

### EXPLORE / PLAN
- task,
- repository map,
- important structure,
- findings,
- hypotheses.

### IMPLEMENT
- task,
- active hypothesis,
- target file,
- related code,
- related tests,
- relevant prior failures.

### RECOVER
- failed action,
- exact failure,
- attempted hypothesis,
- source/test context,
- rejected approaches.

### REVIEW
- original task,
- final diff,
- verification evidence,
- unresolved warnings.

Keep context bounded.

## 2.9 Stale-context invalidation

When a file changes:

- invalidate old read cache entries,
- mark prior exact observations stale,
- do not present stale source text as current,
- reread before exact-text-dependent edits.

## 2.10 Diff-aware final reviewer

After verification, review only:

```text
original task
+
final diff
+
verification evidence
```

Check for:

- incomplete requirements,
- unrelated modifications,
- missed edge cases,
- accidental API changes,
- regressions,
- debug code,
- formatting churn.

If review finds a real issue:

```text
REVIEW → IMPLEMENT/RECOVER
```

## 2.11 Verification gates

For normal code-changing tasks, completion should generally require:

```text
changed files exist
AND diff inspected
AND meaningful verification exists
AND evidence fingerprint == current code fingerprint
AND no current failed verification
```

Support legitimate no-code-change tasks separately.

Never treat model claims as verification.

## 2.12 Baseline failure awareness

Capture baseline health when feasible.

Example:

```text
Before: 3 failing tests
After:  2 failing tests
```

Differentiate:

```text
VERIFIED
PARTIALLY_VERIFIED
PRE_EXISTING_FAILURES_REMAIN
UNABLE_TO_VERIFY
```

## 2.13 Budget-aware controller

Example policy:

### >60%
Normal exploration.

### 30–60%
Reduce broad exploration.

### 10–30%
Focus on active hypothesis, edits, targeted verification.

### Verification reserve
Disallow unnecessary exploration.

## 2.14 Stronger stagnation detection

Detect semantic cycles such as:

```text
read A
read B
test
read A
read B
test
```

On intervention:

- record why strategy failed,
- summarize current evidence,
- require a substantially different hypothesis.

## 2.15 Benchmark-driven tuning

Compare:

```text
baseline
repo map
repo map + memory
repo map + adaptive context
repo map + recovery
full harness
```

Track:

- solve rate,
- verified solve rate,
- false-finish rate,
- model calls,
- tokens,
- runtime,
- files read,
- repair success.

## 2.16 Efficiency metric

Add:

```text
Verified Solves per 10k Tokens
```

Also track:

- tokens per solved task,
- model calls per solved task,
- median runtime,
- repair loops per task.

---

# SEGMENT 3 — Output Accessibility, Debugging and Observability

Goal: make runs understandable, reproducible, inspectable, and easy to debug.

## 3.1 Engineering evidence report

Produce a final report like:

```text
CARAMÉL RUN REPORT

Task
────────────────────────
Fix expired refresh-token handling.

Root Cause
────────────────────────
Middleware bypassed token-expiry validation.

Changes
────────────────────────
src/auth/token.ts       +7 -2
tests/auth.test.ts      +9

Verification
────────────────────────
✓ targeted tests       18/18
✓ full suite           124/124
✓ diff reviewed
✓ regression test added

Recovery
────────────────────────
Attempts               2
Rejected hypotheses    1
Checkpoint restores    1

Efficiency
────────────────────────
Model calls            7
Tokens                 18,420
Commands               8
Files read             11
Cache hits             5
Elapsed                47 sec

Final
────────────────────────
VERIFIED
```

Only report real recorded values.

## 3.2 Machine-readable output

Generate:

```text
report.md
report.json
patch.diff
events.jsonl
```

## 3.3 Structured event log

Persist meaningful events:

```json
{"step":1,"type":"search"}
{"step":2,"type":"read"}
{"step":3,"type":"hypothesis"}
{"step":4,"type":"patch"}
{"step":5,"type":"verification"}
```

Include timestamps and IDs.

Never persist secrets.

## 3.4 Replay mode

Implement:

```bash
caramel replay <run-id>
```

Replay recorded execution without model calls.

## 3.5 Timeline visualization

Example:

```text
✓ 01 EXPLORE      repository map
✓ 02 SEARCH       parseUser
✓ 03 READ         user.ts
✓ 04 PLAN         validation hypothesis
✓ 05 CHECKPOINT   before-edit
✓ 06 EDIT         user.ts
✗ 07 TEST         1 failed
✓ 08 RECOVER      null handling issue
✓ 09 EDIT         user.ts
✓ 10 TEST         32 passed
● 11 REVIEW
```

## 3.6 Better failure explanations

Example:

```text
TEST FAILURE

Command
pytest tests/auth.py

Failure
test_expired_refresh_token

Expected
401

Received
500

Relevant code
src/auth/middleware.py:81–106
```

Preserve raw logs separately.

## 3.7 Evidence explorer

Allow viewing:

```text
Evidence
Diff
Logs
Report
Timeline
Hypotheses
```

Viewing artifacts should not trigger new model calls.

## 3.8 Patch preview

Use readable diff rendering.

Suggested colors:

- addition: green,
- deletion: red,
- context: muted,
- headings: yellow/gold.

## 3.9 Stale-verification warning

If code changes after successful verification:

```text
⚠ Previous verification is stale

Verified fingerprint:
abc123

Current fingerprint:
def456
```

Require new evidence.

## 3.10 Structured termination reasons

Use explicit statuses/enums such as:

```text
VERIFIED
PARTIALLY_VERIFIED
STOPPED_STEP_BUDGET
STOPPED_MODEL_BUDGET
STOPPED_TIME_BUDGET
STOPPED_REPAIR_LIMIT
STOPPED_STAGNATION
FAILED_SETUP
FAILED_EXECUTION
UNABLE_TO_VERIFY
CANCELLED
```

Keep machine-readable codes separate from display labels.

## 3.11 Debug mode

Add optional debug mode.

Show:

```text
structured model actions
phase transitions
context size
cache keys
workspace fingerprints
failure classifications
runner commands
model latency
provider usage
verification gate decisions
```

Never display secrets.

## 3.12 Self-contained run artifacts

Recommended:

```text
runs/
└── <run-id>/
    ├── task.md
    ├── config.json
    ├── events.jsonl
    ├── hypotheses.json
    ├── verification.json
    ├── patch.diff
    ├── report.md
    ├── report.json
    └── logs/
```

Extend the current output structure instead of duplicating it.

---

# SEGMENT 4 — Benchmarking and Evaluation Quality

Goal: prove which features actually improve performance.

## 4.1 Expand benchmark difficulty

Add tasks covering:

- simple localization,
- multi-file bug,
- misleading issue wording,
- hidden edge case,
- cross-file call flow,
- config/dependency issue,
- pre-existing unrelated failures,
- stale patch conflict,
- task requiring regression test,
- public API preservation,
- refactor without behavior change.

## 4.2 Ablation testing

Support comparisons with major features toggled:

```text
repository map on/off
adaptive context on/off
memory on/off
recovery on/off
final review on/off
targeted tests on/off
```

Generate comparison reports.

## 4.3 Benchmark metrics

Track:

```text
solve rate
verified solve rate
false-finish rate
partial solve rate
average model calls
average tokens
average runtime
average files read
average commands
repair success rate
stagnation rate
verification completeness
```

## 4.4 Held-out evaluator cleanliness

Never expose:

```text
solution.patch
evaluator-only tests
reference outputs
hidden benchmark metadata
```

to the agent workspace/context.

Preserve strict separation between fixture, agent workspace, evaluator, and solution/reference data.

---

# SEGMENT 5 — Reliability and Security Hardening

Goal: preserve safe and evaluator-friendly execution.

## 5.1 Command policies

Continue strengthening:

- workspace-bound paths,
- no traversal outside repository,
- bounded execution time,
- bounded output,
- command purpose classification,
- safe working-directory validation.

## 5.2 Secret protection

Never expose:

```text
AI_API_KEY
DEEPSEEK_API_KEY
QWEN_API_KEY
OPENROUTER_API_KEY
other credential-looking values
```

Protect:

- logs,
- reports,
- debug output,
- model prompts,
- subprocess environments.

## 5.3 Patch-quality safeguards

Detect and flag:

- very large unrelated diffs,
- accidental generated files,
- deleted tests,
- debug print statements,
- TODO/FIXME introduced by patch,
- broad formatting-only churn,
- unexpected dependency changes.

Flag rather than blindly reject where context matters.

## 5.4 Preserve source repository

Continue using isolated workspaces.

Do not modify the user's original checkout directly unless explicitly supported and documented.

---

---

# MANDATORY AGENT BEHAVIOR RULES

These rules should be treated as harness invariants. They reflect strong practices used by mature autonomous coding systems.

## Rule 1 — Read repository instructions first

Before planning substantial changes, inspect repository guidance when present:

```text
README
CONTRIBUTING
AGENTS.md
CLAUDE.md
project-specific instruction files
package/build manifests
CI configuration
test configuration
```

Repository-local instructions override generic assumptions unless unsafe or incompatible with the evaluation contract.

Do not read the entire repository blindly; inspect likely instruction files first.

## Rule 2 — Understand before editing

Before the first patch, the agent should normally identify:

```text
relevant implementation file(s)
relevant tests
likely call path/data flow
existing conventions
verification command(s)
```

Exceptions are allowed for trivial tasks, but blind editing should not be the default.

## Rule 3 — Make the smallest sufficient change

Prefer minimal, localized changes that solve the issue.

Avoid:

- unrelated refactors,
- broad formatting churn,
- unnecessary dependency additions,
- renaming unrelated symbols,
- rewriting files when a small patch is enough.

If a wider refactor is actually required, record why.

## Rule 4 — Preserve existing behavior unless the task requires change

Treat existing APIs, tests, public types, configuration contracts, and CLI behavior as constraints.

Do not silently change public behavior to make a test pass.

## Rule 5 — Never weaken tests to hide a defect

Do not:

```text
delete failing tests
skip tests
relax assertions without task justification
disable lint/typecheck
remove error handling
catch and ignore failures
```

Changing a test is acceptable only when the task genuinely requires a behavior/specification update, and the reason must be explicit.

## Rule 6 — Tests are evidence, not the goal

Passing tests does not automatically prove task completion.

After tests pass, also check:

- original issue requirements,
- final diff,
- edge cases implied by the task,
- accidental unrelated changes,
- public contract changes.

## Rule 7 — Never claim commands were run when they were not

The report must distinguish:

```text
RUN_AND_PASSED
RUN_AND_FAILED
NOT_RUN
UNAVAILABLE
SKIPPED_WITH_REASON
```

No fabricated verification.

## Rule 8 — Do not repeat failed actions without new information

If the same action/patch/command failed, repeating it requires a reason such as:

- code changed,
- environment changed,
- command parameters changed,
- new evidence changes the expectation.

Otherwise trigger recovery/stagnation handling.

## Rule 9 — Use errors as observations

Compiler messages, failing assertions, stack traces, and tool errors are evidence.

Parse and retain the useful part rather than treating failure as an opaque event.

## Rule 10 — Re-read before patching stale exact text

If:

- a file changed,
- a patch failed because context did not match,
- another action may have modified the file,

reread the relevant region before constructing a new exact patch.

## Rule 11 — Inspect the final diff

Before success, inspect:

```text
changed files
added/deleted lines
unexpected files
generated artifacts
dependency changes
test changes
debug statements
```

A green test suite with a bad diff is not a successful run.

## Rule 12 — Preserve a clean workspace

Track the initial workspace state.

Distinguish:

- user/pre-existing modifications,
- harness-generated modifications,
- agent modifications.

Never accidentally overwrite unrelated pre-existing work.

## Rule 13 — Git operations must be safe

Do not perform destructive operations such as:

```text
git reset --hard
git clean -fd
force checkout over user changes
history rewriting
force push
```

unless explicitly authorized by the execution environment and required.

Prefer isolated workspaces/checkpoints.

## Rule 14 — Do not commit or push unless explicitly required

The default deliverable is the patch/result, not repository history mutation.

## Rule 15 — Commands must be purposeful

Before running a shell command, it should serve one of:

```text
inspect
build
test
lint
format
verify
diagnose
```

Avoid exploratory shell spam.

Use direct repository tools for file reads/search when they are safer or cheaper.

## Rule 16 — Bound expensive output

Large command outputs should be truncated/summarized while preserving:

- exit status,
- failing test names,
- error locations,
- important diagnostics.

Allow targeted follow-up reads of full logs if needed.

## Rule 17 — Prefer deterministic tools over model inference

If a fact can be obtained reliably using:

```text
search
AST/symbol index
test runner
compiler
git diff
package metadata
```

prefer that evidence over guessing.

## Rule 18 — Keep planning concise and executable

Plans should be implementation-oriented, for example:

```text
1. inspect auth validation and existing tests
2. add regression test for expired token
3. patch validation path
4. rerun targeted auth test
5. run broader auth suite
6. inspect final diff
```

Avoid long speculative plans that consume context without guiding actions.

## Rule 19 — Update plan state continuously

Do not create a plan once and forget it.

Mark steps:

```text
pending
in_progress
done
blocked
superseded
```

Update after important discoveries and failures.

## Rule 20 — Separate exploration from implementation

Exploration should reduce uncertainty.

Once enough evidence exists, stop broad searching and implement.

Conversely, if repair attempts fail because understanding is poor, return to exploration rather than piling on edits.

## Rule 21 — Maintain a verification reserve

Never spend the entire budget on exploration/implementation.

Reserve enough capacity to:

- inspect the final diff,
- run meaningful verification,
- repair at least one late failure when possible.

## Rule 22 — Check repository-defined quality commands

Discover existing scripts before inventing commands.

Examples:

```text
package.json scripts
Makefile
pyproject.toml
tox.ini
Cargo.toml
go.mod
CI workflows
```

Prefer project-native commands.

## Rule 23 — Respect formatter/linter conventions

If formatting is required, use the repository formatter rather than manual global formatting.

Run formatting only on relevant files where possible.

## Rule 24 — Handle pre-existing failures honestly

If a check was already failing before the change:

- record it as baseline,
- determine whether the task touches it,
- avoid claiming the repository is fully green,
- verify the agent did not introduce additional failures.

## Rule 25 — Distinguish environment failure from code failure

Examples:

```text
dependency unavailable
network unavailable
missing compiler
permission issue
container failure
```

must not automatically be interpreted as defects in the patch.

## Rule 26 — Detect no-progress cycles

Track repeated combinations of:

```text
same files
same hypothesis
same command
same failure
```

Escalate to:

```text
new hypothesis
broader inspection
checkpoint restore
bounded stop
```

instead of wasting budget.

## Rule 27 — Checkpoint before risky changes

Create recoverable checkpoints before:

- multi-file refactors,
- dependency changes,
- large replacements,
- high-risk recovery attempts.

Restore only when evidence shows the branch is worse or invalid.

## Rule 28 — Keep context relevant

Do not continuously append all prior logs/messages.

Retain:

```text
task contract
current plan
confirmed findings
active/rejected hypotheses
current relevant code
latest failures
verification evidence
```

Compact/archive stale narrative history.

## Rule 29 — Treat model output as a proposal

Structured model actions must be:

- schema validated,
- policy checked,
- path validated,
- budget checked,
- executed by deterministic tools.

Never let free-form model text directly mutate the workspace.

## Rule 30 — Validate paths and workspace boundaries

All reads/writes/commands must stay within allowed workspace boundaries unless the harness explicitly exposes another safe resource.

Reject traversal and unsafe absolute-path operations.

## Rule 31 — No secret leakage

Never send or print unnecessary credentials, `.env` contents, SSH keys, tokens, or secret-looking values.

Redact secrets from:

```text
logs
model context
reports
debug output
command output
```

## Rule 32 — Do not use hidden evaluator information

Benchmark/reference solutions, hidden tests, answer patches, or evaluator metadata must never enter agent context.

## Rule 33 — Prefer targeted reads

Read the smallest useful range/file set first.

Expand only when needed.

This improves context quality and reduces token waste.

## Rule 34 — Use repository structure to guide search

Search should progress approximately:

```text
task terms
→ likely files/symbols
→ definitions/references
→ related tests
→ dependencies/callers
```

Avoid random file browsing.

## Rule 35 — Verify behavior after every meaningful repair

A repair is not complete until the check that motivated it is rerun.

If repair A was made because `test_x` failed, rerun `test_x` before moving to unrelated validation.

## Rule 36 — Broaden verification after local success

A targeted test passing means:

```text
specific failure appears fixed
```

not necessarily:

```text
repository is correct
```

Run broader checks when budget/environment permit.

## Rule 37 — Late edits invalidate earlier success

Any source/config/test modification after successful verification makes affected verification stale.

The final report must never cite stale evidence as current proof.

## Rule 38 — Review changed tests carefully

If tests were modified, final review should explicitly ask:

```text
Did the task require this test change?
Did assertions become weaker?
Was coverage removed?
Does the new test actually reproduce the issue?
```

## Rule 39 — Dependency changes require extra scrutiny

Before adding/updating a dependency:

- confirm existing dependency cannot solve the need,
- check project conventions,
- minimize version churn,
- rerun appropriate install/build/test checks,
- surface the dependency change in the final report.

## Rule 40 — Finish with a truthful result, including partial outcomes

When full completion is impossible, prefer an honest structured outcome:

```text
PARTIALLY_VERIFIED
BLOCKED_BY_ENVIRONMENT
BUDGET_EXHAUSTED
PRE_EXISTING_FAILURES
UNABLE_TO_REPRODUCE
```

over an unsupported success claim.


# Recommended Implementation Order

## Priority 0 — Keep the project green

Before and after each segment:

```bash
bun run typecheck
bun test
```

Do not stack large unverified changes.

## Priority 1 — Highest score impact

1. **Mandatory iterative execution feedback loop**
2. Explicit phase/state machine
3. Automatic edit → verify → diagnose → repair cycle
4. Adaptive context builder
5. Hypothesis ledger
6. Failure-specific recovery
7. Test-impact selection
8. Diff-aware final reviewer
9. Verification gates
10. Baseline failure awareness

## Priority 2 — Output/debugging maturity

1. Structured event log
2. Better final evidence report
3. Run artifact structure
4. Timeline
5. Failure explanations
6. Replay mode
7. Evidence explorer
8. Debug mode

## Priority 3 — UI/input polish

1. Dashboard navigation
2. Better task setup
3. Recent repositories
4. Recent runs
5. Continue flow
6. Live phase indicator
7. Live budgets
8. Compact timeline

## Priority 4 — Benchmark proof

1. Benchmark expansion
2. Ablation mode
3. Metrics report/dashboard
4. Verified-solves-per-token metric

---

# Instructions to the Coding Agent

When given one segment from this file:

1. Implement **only that segment** unless a small prerequisite is essential.
2. Inspect the relevant existing code first.
3. Briefly identify the architectural change before editing.
4. Reuse existing mechanisms rather than creating parallel duplicate systems.
5. Improve code structure while touching the relevant area.
6. Prefer focused modules and explicit types.
7. Add/update tests during implementation.
8. Use checkpoints before risky refactors.
9. Run targeted tests after each meaningful change.
10. Run typecheck and the broader relevant suite before completion.
11. Inspect the final diff.
12. Do not mark work complete because code merely compiles.
13. Clearly state any remaining limitation.
14. Never invent verification results or benchmark metrics.
15. Preserve headless evaluator behavior.
16. Maintain Makefile compatibility.
17. Keep credentials out of code, logs, prompts, reports, and debug output.
18. Leave the codebase cleaner, more modular, and easier to extend than before.
19. Never use a one-shot `plan → edit → finish` execution path for code-changing tasks.
20. After meaningful edits, run relevant verification and feed failures back into reasoning.
21. Re-plan when repository evidence contradicts the current plan.
22. Rerun the exact failing check after each repair before moving on.
23. Do not finish while verification is stale relative to the current code fingerprint.
24. Treat final review and final verification as explicit completion gates.

---

# Definition of Done per Segment

A segment is complete only when:

```text
✓ architecture remains clean/modular
✓ requested behavior is implemented
✓ relevant tests exist
✓ typecheck passes
✓ targeted tests pass
✓ existing behavior is not unintentionally broken
✓ final diff has been inspected
✓ config/docs are updated where necessary
✓ no secrets are exposed
✓ no fabricated evidence is reported
```
