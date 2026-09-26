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


## 1.0 Mandatory TUI interaction correctness

The current TUI is intended to be interactive, but arrow-key navigation is not reliable enough. This must be treated as a **functional bug**, not as visual polish.

Do not keep an interactive-looking interface whose controls do not consistently work.

The TUI must be made genuinely usable before further visual decoration.

### Required behavior

All selectable screens must support predictable keyboard navigation:

```text
↑ / ↓        move vertically
← / →        move horizontally where the layout requires it
Enter        activate selected item
Esc          go back / cancel safely
Ctrl+C       exit safely and restore terminal state
1–9          optional direct shortcuts where displayed
Tab          optional next-item navigation where appropriate
Shift+Tab    optional previous-item navigation
```

Displayed keyboard hints must match the controls that actually work.

### Navigation model

Do not implement each screen with independent ad-hoc key parsing.

Create a reusable TUI input/navigation layer responsible for:

```text
key decoding
selection state
focus movement
screen redraw
activation
back/cancel handling
terminal cleanup
TTY capability detection
```

Suggested separation:

```text
src/tui/
├── input.ts
├── navigation.ts
├── selectors.ts
├── screen.ts
├── theme.ts
└── views/
```

The exact structure may differ, but input handling must not remain duplicated across screens.

### Arrow-key decoding

Terminal arrow keys arrive as escape sequences and may be received in different chunk boundaries depending on runtime/terminal behavior.

The implementation must not assume that every keypress always arrives as one perfectly formed string.

Use a robust decoder/state machine for sequences such as:

```text
ESC [ A    Up
ESC [ B    Down
ESC [ C    Right
ESC [ D    Left
```

Support the runtime/terminal combinations used by the project, especially macOS Terminal/iTerm-style environments and the prescribed evaluator environment.

Avoid fragile checks that only compare a single `readSync()` result to an exact sequence without handling partial/combined input.

### Selection rules

Selection behavior must be deterministic.

For a one-dimensional list:

```text
↑ = previous
↓ = next
```

For a horizontal menu:

```text
← = previous
→ = next
```

For grids:

- represent items using row/column coordinates,
- move to the nearest valid item in the requested direction,
- define whether edges clamp or wrap,
- use the same rule consistently.

Do not map all four arrow keys to "next" or "previous" simply to make them appear functional.

### Focus and selected state

Every interactive screen must have exactly one clear selected/focused element unless the screen intentionally has none.

The selected state must be visually obvious using the Caramél yellow/gold theme.

Rendering and selection state should be separate:

```text
state
→ render(state)
```

Do not infer state from terminal output.

### Input loop architecture

Use one bounded event loop per active interactive screen.

Conceptually:

```text
initialize terminal
render screen

while active:
    key = read/decode key
    action = map key to navigation command
    nextState = reduce(currentState, action)

    if state changed:
        redraw

    if activate:
        return selected action

    if cancel:
        return cancelled

finally:
    restore terminal state
```

The reducer/navigation logic should be testable without a real terminal.

### Terminal cleanup is mandatory

Every exit path—including:

- Enter/selection,
- Esc,
- Ctrl+C,
- thrown error,
- cancelled prompt,
- screen transition,

must restore:

```text
raw mode
cursor visibility
alternate screen state if used
terminal formatting/reset codes
```

Use `try/finally`.

The harness must never leave the user's shell with a hidden cursor or raw input enabled.

### Screen redraw

Avoid repeatedly printing complete screens below each other.

Use controlled redraw behavior.

If using an alternate screen buffer:

- enter it once,
- redraw in place,
- leave it reliably.

If not using an alternate screen:

- clear/reposition predictably,
- avoid excessive flicker.

Do not mix multiple incompatible screen-management approaches.

### Interactive vs headless mode

TUI behavior must never break automated evaluation.

When stdin/stdout are not TTYs:

```text
interactive keyboard loop must not start
```

Use deterministic non-interactive behavior or the existing CLI argument flow.

Core agent execution must remain independent from the TUI.

### Mouse support is optional

Do not spend priority time on mouse support until keyboard navigation is correct.

Arrow keys + Enter + Esc are mandatory.

### No decorative fake controls

If an item is shown as selectable, it must either:

- work, or
- be visibly disabled with a reason.

Examples such as:

```text
Continue
Recent Runs
Benchmarks
Settings
Tools
Help
```

must not be rendered as active buttons if the corresponding behavior does not exist.

### TUI tests are mandatory

Add unit tests for pure navigation behavior.

At minimum test:

```text
initial selected index
Up
Down
Left
Right
edge behavior
wrap/clamp policy
Enter activation
Esc cancellation
number shortcut selection
invalid key ignored
```

Add tests for key decoding:

```text
complete escape sequence
partial escape sequence
multiple keys in one input chunk
Ctrl+C
Enter
```

Add integration-level tests using mocked input/output streams where practical.

### Navigation regression tests

Every time a navigation bug is fixed, add a regression test.

The current arrow-key issue must receive a regression test so it cannot silently return.

### TUI usability completion gate

Do not mark Segment 1 complete until all of the following are true:

```text
✓ Up/Down work on vertical lists
✓ Left/Right work on horizontal menus
✓ Enter activates the visible selection
✓ Esc safely backs out
✓ Ctrl+C restores terminal state
✓ selection is visually obvious
✓ displayed shortcuts actually work
✓ terminal state is restored after errors
✓ non-TTY execution does not hang
✓ navigation unit tests pass
✓ interactive regression tests pass
```

### Priority

This fix belongs at the top of Segment 1:

```text
1. Repair reusable keyboard input/navigation engine
2. Add navigation regression tests
3. Make existing dashboard actually usable
4. Only then continue visual TUI polish
```

Visual similarity to the mockup is secondary to reliable interaction.


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

## Priority 3 — UI/input reliability and polish

1. **Fix reusable keyboard input/navigation engine**
2. **Add arrow-key and terminal-state regression tests**
3. Make current dashboard genuinely interactive
4. Dashboard navigation
5. Better task setup
6. Recent repositories
7. Recent runs
8. Continue flow
9. Live phase indicator
10. Live budgets
11. Compact timeline

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
25. Never ship decorative TUI controls that do not actually work.
26. Keep keyboard decoding/navigation logic reusable and separate from screen rendering.
27. Add regression tests for every fixed keyboard-navigation bug.
28. Always restore terminal raw mode, cursor state, and screen state through `try/finally`.
29. Keep interactive TUI behavior completely optional for headless/evaluator execution.

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

---

# SEGMENT 6 — Tool Registry and Skill Registry Architecture

Goal: give Caramél a professional capability layer comparable in structure and discipline to modern coding agents, while keeping behavior deterministic, auditable, secure, and compatible with the existing controller.

The system must make a strong distinction between:

```text
TOOLS   = deterministic actions against the environment
SKILLS  = reusable engineering workflows that orchestrate tools
MODEL   = reasoning and decision-making
CONTROLLER = policy, state, budgets, orchestration
MEMORY  = durable task evidence/state
VERIFICATION = ground truth about whether work actually succeeded
TUI     = interaction and observability
```

This separation is mandatory.

Do not implement "skills" as uncontrolled mini-agents with separate hidden state.

Do not expose raw filesystem, raw shell, or raw environment access when a safer bounded tool can exist.

---

# 6.1 Tool Registry — Design Requirements

Create a typed registry for all executable capabilities.

Suggested shape:

```ts
export interface AgentTool<I, O> {
  name: string;
  description: string;
  category: ToolCategory;
  risk: ToolRisk;
  allowedPhases: AgentPhase[];
  inputSchema: unknown;

  execute(
    input: I,
    context: ToolContext,
  ): Promise<ToolResult<O>>;
}
```

Suggested common result:

```ts
export interface ToolResult<T> {
  ok: boolean;
  data?: T;
  error?: ToolError;

  evidence?: {
    files?: string[];
    command?: string;
    exitCode?: number;
    durationMs?: number;
    fingerprint?: string;
  };

  truncated?: boolean;
  warnings?: string[];
}
```

Every tool should:

- validate input before execution,
- be bounded,
- return structured results,
- produce evidence suitable for reports,
- avoid leaking secrets,
- be phase-aware,
- be risk-classified,
- be testable independently of the model,
- never infer success from free-form text,
- never mutate outside the allowed workspace unless explicitly designed to,
- keep output size controlled.

Suggested risk classes:

```text
READ_ONLY
WORKSPACE_WRITE
EXECUTION
STATE_MUTATION
DESTRUCTIVE
```

Suggested capability categories:

```text
REPOSITORY
SEARCH
CODE_EDIT
EXECUTION
VERIFICATION
WORKSPACE
RECOVERY
REPORTING
```

---

# 6.2 Core Tool Catalog — Detailed Descriptions

## TOOL: `list_files`

### Purpose

Provide a bounded, structured view of repository files and directories.

### Real-world developer need

Developers often begin unfamiliar work by understanding structure:

```text
src/
tests/
packages/
apps/
lib/
scripts/
config/
```

The agent should not recursively dump the entire repository into context.

### Inputs

Possible inputs:

```ts
{
  path?: string;
  depth?: number;
  includeHidden?: boolean;
  extensions?: string[];
  limit?: number;
}
```

### Behavior

- normalize and validate path,
- stay within workspace,
- ignore excluded directories by default,
- bound depth and result count,
- distinguish files/directories,
- optionally include size/type metadata,
- avoid returning binary content.

### Typical use cases

```text
understand project layout
find likely package boundaries
locate tests
find config files
inspect a newly discovered directory
```

### Output should include

```text
relative path
entry type
possibly size
possibly extension
truncation indicator
```

### Safety

Must reject:

```text
../ traversal
unsafe absolute paths
host filesystem paths
secret filesystem locations
```

### Why it matters

A strong coding agent should inspect structure efficiently instead of wasting tokens reading arbitrary files.

---

## TOOL: `search`

### Purpose

Search repository text, filenames, symbols, error messages, configuration keys, and tests.

### Real-world developer need

Developers routinely search for:

```text
function names
error strings
API routes
config options
types/interfaces
test names
environment variables
call sites
```

### Inputs

```ts
{
  query: string;
  path?: string;
  mode?: "text" | "filename" | "symbol";
  caseSensitive?: boolean;
  extensions?: string[];
  limit?: number;
}
```

### Behavior

- bounded search,
- prioritize useful results,
- include line numbers,
- return short matching context,
- allow path/ext filtering,
- optionally rank results.

### Typical use cases

```text
find implementation for issue wording
locate error string from failing test
find all usages of an option
discover related tests
find config references
```

### Output

```text
file
line
match
small surrounding context
score/relevance if ranked
```

### Safety / efficiency

- do not search huge ignored folders,
- do not expose `.env` contents,
- cap matches,
- summarize when many results exist.

---

## TOOL: `read_file`

### Purpose

Read bounded source ranges safely.

### Real-world developer need

Agents need precise context around:

```text
functions
classes
tests
config sections
error locations
```

Reading full large files by default wastes context.

### Inputs

```ts
{
  path: string;
  startLine?: number;
  endLine?: number;
  maxChars?: number;
}
```

### Behavior

- validate file path,
- reject binary files,
- bound output,
- include line numbers,
- indicate truncation,
- support exact snippets.

### Important rule

If the file changed after a previous read, stale cached content must not be treated as current.

### Typical use cases

```text
inspect implementation
inspect failing test
read surrounding compiler error
verify exact text before patch
inspect configuration
```

---

## TOOL: `read_symbol`

### Purpose

Read the most relevant code region for a named function, class, method, variable, interface, type, test, or module symbol.

### Real-world developer need

Developers think in symbols, not just line ranges.

Example:

```text
"Show me validateToken()"
"Find UserService.create()"
"Open the Config interface"
```

### Behavior

- locate symbol definition,
- return the symbol body and nearby context,
- optionally include signature/doc comments,
- optionally include parent class/module.

### Fallback

If symbol indexing is unavailable:

```text
symbol search
→ text search
→ bounded file read
```

### Benefits

Reduces search/read round trips and improves localization quality.

---

## TOOL: `find_references`

### Purpose

Find where a symbol, module, route, function, class, or configuration value is used.

### Real-world developer need

Before changing code, developers often need to know:

```text
who calls this?
what imports this?
which tests exercise this?
is this public API?
```

### Inputs

```ts
{
  symbol: string;
  path?: string;
  includeDefinitions?: boolean;
  limit?: number;
}
```

### Behavior

Use the best available mechanism:

```text
AST/index if available
language service if cheap
fallback textual reference search
```

### Output

```text
references
definitions
importers
callers where available
related tests
```

### Why it matters

This helps prevent accidental API regressions and incomplete multi-file fixes.

---

## TOOL: `repository_map`

### Purpose

Produce a compact ranked map of likely relevant files for the current task.

### Real-world developer need

Large repositories cannot be explored uniformly.

The agent needs a fast first-pass shortlist.

### Inputs

```ts
{
  task: string;
  maxFiles?: number;
}
```

### Signals

Use combinations of:

```text
filename/path match
task-term content match
symbol match
imports
test links
directory proximity
historical relevance if available
```

### Output

```text
ranked files
reason for rank
matched symbols/terms
likely related tests
```

### Important

This is not truth.

The map guides exploration but must not override actual repository evidence.

---

## TOOL: `inspect_diff`

### Purpose

Return the current workspace changes in a structured, bounded form.

### Real-world developer need

Developers continuously inspect diffs to catch:

```text
unexpected edits
formatting churn
test weakening
debug statements
dependency changes
unrelated files
```

### Inputs

```ts
{
  paths?: string[];
  staged?: boolean;
  contextLines?: number;
}
```

### Output

```text
changed files
added/deleted line counts
diff text
binary/untracked indicators
summary
```

### Additional analysis

Optionally flag:

```text
large unrelated diff
test deletions
new TODO/FIXME
debug print/logging
dependency manifest changes
```

### Mandatory use

Final success requires final diff inspection.

---

## TOOL: `apply_patch`

### Purpose

Apply a bounded patch to existing files.

### Real-world developer need

Precise patching is safer than rewriting entire files.

### Inputs

```ts
{
  patch: string;
}
```

### Behavior

- apply only inside workspace,
- detect stale context,
- fail cleanly on mismatch,
- return changed files,
- update workspace fingerprint,
- invalidate stale verification and read cache.

### Failure behavior

On mismatch:

```text
do not repeatedly retry same patch
reread relevant region
construct fresh patch
```

### Safety

Reject patches touching:

```text
outside workspace
forbidden secret files
evaluator/reference solution data
```

---

## TOOL: `replace_text`

### Purpose

Perform a precise text replacement when patch generation is unnecessary.

### Real-world developer need

Useful for:

```text
renaming a local constant
small config edits
single known substitution
```

### Inputs

```ts
{
  path: string;
  oldText: string;
  newText: string;
  expectedOccurrences?: number;
}
```

### Behavior

- verify expected match count,
- fail instead of guessing when ambiguous,
- update fingerprints/cache,
- report exact change.

### Safety

Must never silently replace unexpected multiple matches.

---

## TOOL: `replace_file`

### Purpose

Replace full file contents when that is clearly the appropriate operation.

### Real-world developer need

Suitable for:

```text
small generated config
new compact files
major rewrite where diff patch is impractical
```

### Use sparingly

A mature agent should prefer minimal edits.

### Safeguards

- size limit,
- workspace boundary,
- preserve line endings where practical,
- warn when replacing a large existing file,
- checkpoint before risky rewrites.

---

## TOOL: `run_command`

### Purpose

Run a bounded command inside the controlled workspace/runner.

### Real-world developer need

Required for:

```text
build
test
typecheck
lint
format
package scripts
diagnostic commands
```

### Inputs

```ts
{
  command: string;
  cwd?: string;
  timeoutMs?: number;
  purpose: "inspect" | "build" | "test" | "lint" | "format" | "diagnose";
}
```

### Mandatory protections

- cwd must be allowed,
- timeout,
- output cap,
- environment filtering,
- blocked dangerous commands/patterns,
- no credential dumping,
- no unrestricted host filesystem access.

### Output

```text
exit code
stdout summary
stderr summary
duration
truncated flag
```

### Important

A shell command's exit code is evidence.

The model's interpretation is not.

---

## TOOL: `run_tests`

### Purpose

Provide a test-focused wrapper above generic command execution.

### Real-world developer need

Testing is important enough to deserve structured semantics.

### Inputs

```ts
{
  targets?: string[];
  scope?: "targeted" | "related" | "full";
  timeoutMs?: number;
}
```

### Behavior

- select repository-native test command,
- run requested targets,
- parse test counts where possible,
- capture failed test names,
- store evidence fingerprint,
- classify outcome.

### Output

```ts
{
  status: "passed" | "failed" | "unavailable";
  passed?: number;
  failed?: number;
  skipped?: number;
  failingTests?: string[];
  command: string;
  fingerprint: string;
}
```

### Why separate from `run_command`

This enables:

```text
verification gates
structured reports
test-impact logic
failure-driven repair
```

---

## TOOL: `discover_checks`

### Purpose

Discover repository-defined verification commands.

### Real-world developer need

Different projects use different workflows.

Examples:

```text
package.json scripts
Makefile targets
pyproject
tox
Cargo
Go
Gradle
Maven
CI workflows
```

### Output

Possible categories:

```text
test
typecheck
lint
build
format
integration
```

### Rule

Prefer repository-native checks over invented commands.

### Example

Instead of assuming:

```text
npm test
```

discover that the project actually expects:

```text
bun test
bun run typecheck
make contract
```

---

## TOOL: `workspace_status`

### Purpose

Describe current workspace state.

### Real-world developer need

The agent must know:

```text
what changed?
what was pre-existing?
what is untracked?
did a dependency file change?
```

### Output

```text
modified files
added files
deleted files
untracked files
baseline modifications
agent modifications
fingerprint
```

### Why important

Prevents accidental overwriting of unrelated developer work.

---

## TOOL: `create_checkpoint`

### Purpose

Create a recoverable workspace snapshot before risky changes.

### Real-world developer need

Useful before:

```text
multi-file refactors
dependency changes
large rewrites
uncertain repairs
```

### Output

```text
checkpoint ID
fingerprint
changed files
timestamp
```

### Important

Checkpoints are recovery mechanisms, not commits unless intentionally implemented that way.

---

## TOOL: `restore_checkpoint`

### Purpose

Restore a known workspace state after a bad branch of work.

### Real-world developer need

Autonomous agents must recover from failed approaches without accumulating damage.

### Rules

- restore only agent-owned workspace changes,
- do not erase unrelated user changes,
- record restoration as an event,
- invalidate stale verification,
- explain why restore occurred.

---

## TOOL: `get_failure_summary`

### Purpose

Convert raw build/test/tool failure output into structured diagnostic evidence.

### Real-world developer need

Raw logs are noisy.

The model needs:

```text
what failed
where
why it may matter
which test/symbol/file is implicated
```

### Inputs

```ts
{
  commandResultId: string;
}
```

### Output

```text
failure category
primary error
file/line locations
failing tests
stack frame highlights
compiler diagnostics
concise relevant log excerpt
```

### Important

This tool should summarize deterministic output.

It should not invent root cause.

Root-cause reasoning belongs to a debugging skill/model step.

---

## TOOL: `finish`

### Purpose

Request task completion.

### Important

This is not a normal unrestricted tool.

It must be guarded by controller verification policy.

### Controller should reject finish when:

```text
verification is stale
known failures remain
required diff review not done
task requirements not addressed
minimum completion evidence missing
```

### Output

```text
accepted
or
rejected with missing completion gates
```

---

# 6.3 Optional/Advanced Tools

These can be added after the core tools are stable.

## `symbol_index`

Build/query symbol index for large repositories.

## `dependency_graph`

Expose import/package relationships.

## `test_impact`

Return tests likely affected by changed files/symbols.

## `read_log`

Read a bounded stored command log without rerunning commands.

## `artifact_write`

Write report/debug artifacts into the run directory.

## `replay_events`

Load recorded run events for TUI replay mode.

Do not add optional tools merely for UI display.

---

# 6.4 Skill Registry — Design Requirements

Skills are reusable engineering strategies.

A skill should:

- have a clear input/output contract,
- operate through approved tools,
- use current controller state,
- remain bounded,
- update evidence/hypotheses/plan state where relevant,
- avoid maintaining secret independent memory,
- not bypass policy,
- not execute arbitrary raw actions outside the tool layer.

Suggested interface:

```ts
export interface Skill<I, O> {
  name: string;
  description: string;

  canRun(context: SkillContext): boolean;

  run(
    input: I,
    context: SkillContext,
  ): Promise<O>;
}
```

Suggested context:

```ts
export interface SkillContext {
  tools: AgentTools;
  memory: TaskMemory;
  state: AgentState;
  config: AgentConfig;
  evidence: EvidenceStore;
}
```

Skills may use the model for reasoning, but all environmental effects must go through tools.

---

# 6.5 Core Skill Catalog — Detailed Descriptions

## SKILL: `repo_understanding`

### Purpose

Rapidly understand an unfamiliar repository before editing.

### Real-world developer situation

A developer receives:

```text
"Fix upload retries"
```

but knows nothing about:

```text
language
package layout
test framework
architecture
repository conventions
```

The skill should establish enough context to work safely.

### Inputs

```text
task
repository root
known repository map if available
```

### Workflow

```text
1. inspect repo instructions
2. inspect manifests/build files
3. inspect top-level structure
4. identify likely application/package boundaries
5. identify testing conventions
6. identify relevant implementation areas
7. identify likely related tests
8. summarize only actionable findings
```

### Tools

```text
list_files
search
read_file
repository_map
discover_checks
```

### Output

```ts
{
  architectureSummary: string[];
  relevantFiles: string[];
  likelyTests: string[];
  repoInstructions: string[];
  verificationCommands: string[];
  risks: string[];
}
```

### Completion criteria

Stop exploring when enough evidence exists to produce an actionable plan.

Do not attempt to "understand the whole repository."

---

## SKILL: `issue_localization`

### Purpose

Determine where an issue most likely originates.

### Real-world developer situation

Issue wording often describes symptoms rather than implementation:

```text
"User gets logged out after refresh"
```

The bug may be in:

```text
token parsing
middleware
cache
API client
cookie handling
```

### Workflow

```text
extract task concepts
→ search symbols/error strings
→ inspect likely implementation
→ find references/importers
→ inspect related tests
→ rank candidate locations
```

### Tools

```text
repository_map
search
read_symbol
read_file
find_references
```

### Output

```text
primary candidate
secondary candidates
supporting evidence
related tests
unknowns
```

### Important

Do not output fake numeric confidence.

Use evidence-backed ranking.

---

## SKILL: `plan_change`

### Purpose

Turn repository understanding into a short executable implementation plan.

### Real-world developer need

Good plans reduce unnecessary edits and context switching.

### Plan style

Prefer:

```text
1. reproduce/inspect failing behavior
2. inspect validation path
3. add/update regression test
4. patch implementation
5. rerun targeted test
6. run broader verification
7. inspect diff
```

Avoid long essays.

### Plan state

Every item must support:

```text
pending
in_progress
verified
blocked
superseded
```

### Important

Plans are provisional and must change when evidence changes.

---

## SKILL: `implement_change`

### Purpose

Make the smallest safe implementation change consistent with repository conventions.

### Workflow

```text
confirm active plan item
→ confirm relevant file is current/not stale
→ checkpoint if risky
→ inspect exact region
→ apply minimal edit
→ inspect diff
→ update changed-file/fingerprint state
```

### Tools

```text
read_file
read_symbol
apply_patch
replace_text
replace_file
create_checkpoint
inspect_diff
```

### Developer expectations

The skill should:

- preserve local naming/style,
- avoid unrelated cleanup,
- avoid unnecessary dependencies,
- avoid rewriting whole files,
- not modify tests solely to silence failures,
- surface public API changes explicitly.

---

## SKILL: `debug_failure`

### Purpose

Diagnose failed builds/tests/runtime checks using evidence.

### Real-world developer situation

After a patch:

```text
test_expired_token
Expected 401
Received 500
```

A weak agent simply retries.

A strong debugging skill:

```text
reads failing test
reads implicated source
compares expected/actual path
updates hypothesis
proposes minimal repair
```

### Inputs

```text
failed verification
current diff
active hypothesis
recent edits
related files
```

### Tools

```text
get_failure_summary
read_file
read_symbol
find_references
search
inspect_diff
```

### Output

```text
failure classification
likely cause
supporting evidence
rejected assumptions
recommended next repair
specific verification to rerun
```

### Important

This skill diagnoses.

It should not silently edit before understanding the failure.

---

## SKILL: `recovery`

### Purpose

Choose a different engineering strategy when the current path fails.

### Situations

```text
patch mismatch
type error
test assertion
timeout
setup failure
stagnation
bad model response
repeated unsuccessful repair
```

### Strategy examples

#### Patch mismatch

```text
reread region
discard stale patch
build new patch against current text
```

#### Compiler error

```text
parse diagnostic
inspect exact file/line
repair local symbol
rerun typecheck
```

#### Assertion failure

```text
inspect test expectation
inspect implementation path
update hypothesis
repair minimal behavior
rerun failing test
```

#### Stagnation

```text
summarize failed strategy
mark hypothesis rejected
restore checkpoint if useful
return to targeted exploration
```

### Output

```text
chosen strategy
why current strategy failed
state/hypothesis changes
next action
```

---

## SKILL: `verification`

### Purpose

Determine whether the implementation actually works.

### Real-world developer need

Verification should mirror how strong developers work:

```text
cheap relevant check first
→ broader confidence
→ final review
```

### Workflow

```text
discover checks
→ select affected tests
→ run targeted tests
→ interpret results
→ run broader checks as appropriate
→ record evidence fingerprint
```

### Tools

```text
discover_checks
run_tests
run_command
workspace_status
inspect_diff
```

### Output

```text
verification level
checks run
results
failing tests
stale/not stale
evidence fingerprint
recommended next step
```

### Verification levels

Suggested:

```text
NONE
TARGETED
RELATED
PROJECT_LEVEL
FULL
```

Do not equate a targeted pass with full verification.

---

## SKILL: `regression_test`

### Purpose

Ensure the reported bug has durable automated coverage.

### Real-world developer need

A bug fix without a regression test can silently return later.

### Workflow

```text
search existing tests
→ determine whether issue is reproduced
→ inspect testing conventions
→ add minimal test if needed
→ run test before fix when practical
→ verify it fails for the expected reason
→ implement fix
→ verify pass
```

### Tools

```text
search
read_file
read_symbol
apply_patch
run_tests
inspect_diff
```

### Important rules

Do not:

- add tests that merely execute code without asserting behavior,
- weaken existing tests,
- generate huge redundant test files,
- claim red-green evidence if the test was never actually run before the fix.

---

## SKILL: `final_review`

### Purpose

Perform an independent final engineering review after verification.

### Inputs should be intentionally limited

```text
original task
final diff
verification evidence
remaining warnings
```

### Review questions

```text
Does the diff fully satisfy the issue?
Are there unrelated changes?
Was public behavior unintentionally changed?
Are tests meaningful?
Were tests weakened?
Are there debug statements?
Was a dependency changed unnecessarily?
Are obvious edge cases missed?
Is verification fresh?
```

### Tools

```text
inspect_diff
workspace_status
verification evidence store
```

### Output

```text
approved
or
issues requiring another implementation/recovery cycle
```

### Important

This skill should not automatically approve simply because tests are green.

---

## SKILL: `context_management`

### Purpose

Build the smallest useful model context for the current phase.

### Real-world developer need

Long-running coding agents fail when irrelevant history crowds out relevant source/error evidence.

### Context by phase

#### EXPLORE

```text
task
repo map
repo instructions
important findings
```

#### PLAN

```text
task
confirmed repository evidence
candidate files/tests
current hypotheses
```

#### IMPLEMENT

```text
task requirement
active plan item
active hypothesis
target source
related test
relevant conventions
```

#### VERIFY

```text
current diff summary
changed files
known checks
```

#### RECOVER

```text
exact latest failure
relevant source/test
failed hypothesis/attempt
```

#### REVIEW

```text
task
final diff
verification evidence
```

### Rules

- cap context,
- prefer fresh evidence,
- drop stale raw logs,
- keep rejected hypotheses summarized,
- never include secrets,
- avoid sending whole repository files unnecessarily.

---

## SKILL: `test_impact_analysis`

### Purpose

Predict the cheapest meaningful tests to run after a change.

### Inputs

```text
changed files
changed symbols
dependency graph
test relationships
```

### Workflow

```text
changed symbol
→ direct test references
→ importing modules
→ nearby test files
→ package/module suite
```

### Output

```text
ranked test targets
reason for each
estimated scope
fallback broader check
```

### Why valuable

Reduces:

```text
runtime
token usage
repair latency
```

while preserving strong verification.

---

## SKILL: `baseline_health`

### Purpose

Understand repository health before attributing failures to the agent.

### Workflow

When practical:

```text
discover checks
→ run bounded baseline
→ store existing failures
```

After edits:

```text
compare new results against baseline
```

### Output

```text
pre-existing failures
new failures
resolved failures
unchanged failures
```

### Why valuable

Prevents false conclusions such as:

```text
"my patch broke the repo"
```

when failures already existed.

---

## SKILL: `finalize_result`

### Purpose

Assemble the truthful final outcome after controller gates pass.

### Inputs

```text
task
final diff
verification evidence
hypotheses
recovery history
efficiency metrics
termination reason
```

### Output should distinguish

```text
VERIFIED
PARTIALLY_VERIFIED
UNABLE_TO_VERIFY
BLOCKED_BY_ENVIRONMENT
BUDGET_EXHAUSTED
FAILED
```

### Important

This skill formats/organizes the result.

It does not override completion policy.

---

# 6.6 Tool and Skill Compatibility Rules

To remain compatible with mature coding-agent architecture patterns, Caramél should follow these principles.

## Stable names

Tool names should be stable machine-facing identifiers:

```text
read_file
search
run_tests
inspect_diff
```

Do not rename them based on UI branding.

The TUI may display friendly labels separately.

## JSON-schema-friendly inputs

Every model-callable tool should have:

- explicit required fields,
- bounded strings/numbers,
- enums where possible,
- no ambiguous union shapes unless necessary.

## Versionability

Prepare registry metadata for future evolution:

```ts
{
  name: "run_tests",
  version: 1
}
```

No need to expose version to model initially, but keep registry design evolvable.

## Capability discovery

The controller/TUI should derive visible capabilities from the registry:

```ts
toolRegistry.list()
skillRegistry.list()
```

Do not hardcode fake tool names into the TUI.

## Phase permissions

Example:

```text
EXPLORE
  read-only repository tools

IMPLEMENT
  repository read + write + checkpoint

VERIFY
  execution + verification + diff

REVIEW
  read-only diff/evidence tools
```

## Policy remains above registry

A registered tool is not automatically callable.

Controller policy must still check:

```text
current phase
risk category
budget
workspace constraints
task context
```

## Skills are composable

Example:

```text
repo_understanding
→ issue_localization
→ plan_change
→ implement_change
→ verification
→ debug_failure
→ recovery
→ final_review
```

But the controller may skip unnecessary skills on trivial tasks.

## Skills must not become rigid pipelines

Real repositories differ.

Skills provide reusable strategies, not fixed scripts.

---

# 6.7 Real-World Agent Workflow Example

Task:

```text
Fix expired refresh tokens returning 500 instead of 401.
```

### Phase 1 — Understand

Skill:

```text
repo_understanding
```

Tools:

```text
list_files
repository_map
discover_checks
search
```

Findings:

```text
auth middleware
token decoder
auth tests
```

### Phase 2 — Localize

Skill:

```text
issue_localization
```

Tools:

```text
search
read_symbol
find_references
read_file
```

Hypothesis:

```text
middleware decodes refresh token before expiry validation
```

### Phase 3 — Plan

Skill:

```text
plan_change
```

Plan:

```text
1. inspect existing expired-token tests
2. add regression coverage if absent
3. fix validation order
4. run targeted test
5. run auth suite
6. inspect diff
```

### Phase 4 — Implement

Skill:

```text
implement_change
```

Tools:

```text
create_checkpoint
read_file
apply_patch
inspect_diff
```

### Phase 5 — Verify

Skill:

```text
verification
```

Tools:

```text
run_tests
```

Result:

```text
targeted test failed:
expected 401
received 403
```

### Phase 6 — Diagnose

Skill:

```text
debug_failure
```

Tools:

```text
get_failure_summary
read_file
read_symbol
```

New evidence:

```text
exception mapping converts expiry error to generic forbidden response
```

Original hypothesis becomes incomplete.

### Phase 7 — Repair

Skill:

```text
recovery
→ implement_change
```

Tools:

```text
apply_patch
inspect_diff
```

### Phase 8 — Re-verify

Skill:

```text
verification
```

Results:

```text
targeted test PASS
auth suite PASS
typecheck PASS
```

### Phase 9 — Review

Skill:

```text
final_review
```

Checks:

```text
task satisfied
no unrelated changes
test meaningful
verification fresh
```

### Phase 10 — Finalize

Skill:

```text
finalize_result
```

Result:

```text
VERIFIED
```

This is the target Caramél operating model.

---

# 6.8 TUI Representation

The TUI should display only capabilities that actually exist in the registries.

Example:

```text
AVAILABLE TOOLS

› list files
› search
› read
› symbols
› references
› edit
› diff
› execute
› tests
› checkpoints
```

Example:

```text
AVAILABLE SKILLS

› repository understanding
› issue localization
› planning
› implementation
› debugging
› recovery
› verification
› regression testing
› context management
› final review
```

Do not display:

```text
deploy
browser
database
web search
```

unless Caramél genuinely implements them.

The registry is the source of truth for UI capability display.

---

# 6.9 Initial Implementation Order for Tools and Skills

Implement in this order.

## Foundation

1. typed tool registry
2. typed skill registry
3. shared `ToolResult`
4. risk/category metadata
5. phase permission policy
6. registry-driven TUI capability list

## Core deterministic tools

1. `list_files`
2. `search`
3. `read_file`
4. `read_symbol`
5. `find_references`
6. `inspect_diff`
7. `apply_patch`
8. `run_command`
9. `run_tests`
10. `discover_checks`
11. `workspace_status`
12. `create_checkpoint`
13. `restore_checkpoint`
14. `get_failure_summary`
15. policy-gated `finish`

Reuse existing implementations where already present rather than rebuilding them.

## Core skills

1. `repo_understanding`
2. `issue_localization`
3. `plan_change`
4. `implement_change`
5. `verification`
6. `debug_failure`
7. `recovery`
8. `context_management`
9. `test_impact_analysis`
10. `regression_test`
11. `baseline_health`
12. `final_review`
13. `finalize_result`

---

# 6.10 Tool/Skill Definition of Done

A new tool is complete only when:

```text
✓ input schema exists
✓ output type exists
✓ errors are structured
✓ path/security boundaries enforced
✓ output is bounded
✓ phase permissions defined
✓ risk category defined
✓ unit tests exist
✓ event/report integration exists
✓ no secrets leak
```

A new skill is complete only when:

```text
✓ input/output contract exists
✓ required tools are explicit
✓ it respects controller state
✓ it does not bypass policy
✓ it updates plan/evidence state correctly
✓ it handles failure paths
✓ tests cover main behavior
✓ it remains useful in headless mode
✓ it does not maintain hidden independent state
```

