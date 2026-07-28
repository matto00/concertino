## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `proposal.md`, `design.md`, `tasks.md`, `specs/gate-telemetry/spec.md`,
  and `ticket.md` in full.
- Read ground truth: `core/scripts/start-servers.sh`, `core/scripts/assert-phase.sh`,
  `core/scripts/emit-event.sh`, `openspec/specs/gate-telemetry/spec.md` (current,
  pre-change), `test/scripts/start-servers.test.sh`, `lib/ui/reducer.js`.
- Confirmed `scripts/concertino/start-servers.sh` is currently byte-identical to
  `core/scripts/start-servers.sh` (`diff` → no output), so the "re-render via sync"
  task is grounded and starts from a clean baseline.
- Confirmed `lib/ui/reducer.js`'s `gate.result` handler (lines 83-94) is generic —
  it reads `ev.status`/`ev.duration_ms`/`ev.first_error` off any `gate.result` event
  and pushes/replaces into `run.gates` by `name`. The proposal's claim ("No change
  to `lib/ui/reducer.js`") is accurate, and the fix does close the stated
  "denominator" gap since a new `run.gates` entry is exactly what's missing today.
- **Grep-verified the central factual claim in `design.md`/`tasks.md`**: `grep -rn
  "looks_like_ticket" core/scripts/` shows the function is defined and used **only**
  in `assert-phase.sh` (lines 109/114/119). `start-servers.sh`'s existing pass-path
  emission (line 66) does **not** call a function — it inlines the regex test:
  `[[ "$T" =~ ^[A-Za-z#][A-Za-z0-9._-]*[0-9]$ ]] && CONCERTINO_ROLE=script ...`.
  There is no `looks_like_ticket` in `start-servers.sh` today.
- Ran `openspec validate emit-gate-result-on-fail --strict` against the change dir
  → `Change 'emit-gate-result-on-fail' is valid` (structurally sound). Also
  confirmed `tasks.md`'s task 5.1 invokes the CLI with a flag that doesn't exist:
  `openspec validate --change ... --strict` → `error: unknown option '--change'
  (Did you mean --changes?)`. Correct form is `openspec validate
  emit-gate-result-on-fail --strict` (positional name, no `--change` flag).
- Traced every AC in `ticket.md` against the plan: gate/status/duration_ms/
  first_error fields (design.md Decisions), stdout/stderr/exit-1 unchanged
  (design.md Goals + spec delta's new "start-servers.sh failure output unchanged"
  scenario), `|| true` guard (design.md), `concertino sync` re-render (tasks.md 2.1,
  confirmed `npx concertino sync` is a real command per `package.json`'s
  `test:selftest` script), spec update (proposal + delta present), test coverage
  (tasks.md 4.1/4.2) — all five ACs have a corresponding task/decision.
- Checked the spec delta's requirement names against the current
  `openspec/specs/gate-telemetry/spec.md`: "gate.result events carry a duration"
  and "Failing gate.result events carry the first error line" both match existing
  requirement headers exactly, so the MODIFIED-requirement convention is followed
  correctly (full requirement text + all scenarios, not a diff fragment).

### Verdict: REFUTE

### Change Requests

1. **`looks_like_ticket` does not exist in `start-servers.sh` — the design's
   guard instruction is not grounded in the file it's editing.**
   `design.md` (Goals, "Keep the emission guarded... and ticket-gated
   (`looks_like_ticket`, matching the existing pass-path emission and
   `assert-phase.sh`'s pattern)") and `tasks.md` task 1.1 ("gate it with
   `looks_like_ticket`, matching the existing passing-path emission's pattern")
   both instruct the implementer to gate the new emit with `looks_like_ticket`,
   but `start-servers.sh`'s actual pass-path pattern (line 66) is an *inline*
   regex on a local `$T`, not a call to a function named `looks_like_ticket`
   (that function only exists in `assert-phase.sh`). If an implementer follows
   the instruction literally and writes `looks_like_ticket "$T" && ...` in
   `start-servers.sh` without first defining that function, the result under
   `set -euo pipefail` is: bash reports "command not found" (exit 127) on the
   condition, the `&&`/`|| true` chain swallows it, so the new `gate.result
   status=fail` event is **silently never emitted** (defeating the entire point
   of the ticket) — and the "command not found" line lands on stderr,
   **violating the AC that stderr is byte-for-byte unchanged**. Because the
   existing test convention checks stderr with `grep -c '<substring>'` rather
   than full-line equality, this regression could pass the new test case
   undetected. Fix: `design.md`/`tasks.md` must explicitly state one of two
   concrete options and pick one — (a) reuse the exact inline regex already at
   line 66 (`[[ "$T" =~ ^[A-Za-z#][A-Za-z0-9._-]*[0-9]$ ]]`) at the new call
   site too, no new function, or (b) explicitly add a `looks_like_ticket()`
   helper to `start-servers.sh` (mirroring `assert-phase.sh`) and refactor the
   existing pass-path call to use it as well, so the file has one guard pattern
   instead of two. Either is fine; the current text conflates both scripts'
   patterns and names a function that doesn't exist in the file being changed.

2. **Ticket-id derivation (`local T=...`) is computed *after* the failure
   branch, not before it — the design doesn't say it needs to move.**
   In `start-servers.sh`, `local T="${WORKTREE_PATH##*/}"` (line 65) sits
   *after* the `if/else` block that contains the `exit 1` (line 61). The
   pass-path emission on line 66-67 can use `$T` because it executes after that
   assignment; the new failure-path emission, placed "immediately before the
   existing `exit 1`" per `design.md`'s "Where in the function" decision, is
   inside the `if` block — `$T` is not yet in scope there. `design.md`/
   `tasks.md` need to explicitly call out moving the ticket-derivation
   (`local T=...`) to the top of `start_one()` (or duplicating that one-line
   assignment in the failure branch) so both emit call sites have `$T`
   available. This is a small fix, but it's currently an implicit gap the
   implementer has to discover on their own rather than a stated decision —
   worth one sentence in `design.md`'s "Where in the function" bullet.

3. **`tasks.md` task 5.1's verification command is wrong.** `openspec
   validate --change emit-gate-result-on-fail --strict` fails with `error:
   unknown option '--change' (Did you mean --changes?)` (confirmed by running
   it). The correct invocation is `openspec validate emit-gate-result-on-fail
   --strict` (positional item name). Low severity — an implementer hitting the
   CLI's own suggestion would self-correct in seconds — but since the artifact
   is meant to be an executable checklist, fix the command text.

4. **Minor: `proposal.md`'s "Modified Capabilities" section undersells the
   actual spec delta.** It only mentions broadening the `first_error`
   requirement's scope, but `specs/gate-telemetry/spec.md` in this change also
   modifies the "Existing stdout and telemetry-safety contracts are preserved"
   requirement, adding a new "start-servers.sh failure output unchanged"
   scenario (delta lines 68-73) — which is in fact the spec-level evidence for
   the "stdout/stderr and exit 1 unchanged" AC. Non-blocking, but the proposal
   should name both requirement changes so a reader doesn't have to diff the
   spec file to discover the second one.

### Non-blocking notes

- The `first_error` content decision (`"${label} did not become healthy at
  ${url} within ${timeout}s"`) is sound: it's derived from data already in
  scope, well under the 200-char bound `assert-phase.sh` uses, and doesn't
  need truncation logic — good call to explicitly note that asymmetry with
  `assert-phase.sh` rather than copy its truncation code unnecessarily.
- `duration_ms` reusing `start_ts` (already captured at the top of
  `start_one()`, line 52) is correct and requires no additional plumbing.
- The "coexist with BLOCKER, don't replace it" decision is well-reasoned and
  matches the ticket's suggested approach.
