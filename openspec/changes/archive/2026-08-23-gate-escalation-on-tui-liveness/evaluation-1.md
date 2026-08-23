## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket acceptance criteria addressed: single documented signal (`core/scripts/tui-attached.sh`,
  rendered to `scripts/concertino/tui-attached.sh`) gates the escalation raise path at the orchestrator's
  single call site (`core/roles/orchestrator.md`); no-TUI branch is blocking-wait-free and reaches chat
  immediately; TUI-attached branch is documented as unmodified; timeout-is-never-an-approval preserved on
  both branches; no-TUI branch documented inline in the topology section; ambiguity resolves to "no TUI"
  (verified live — see Phase 2); `concertino answer` remains the sole write path for chat-collected answers.
- No AC silently reinterpreted. The design correctly self-corrected two false claims from round 1
  (kill -0/EPERM semantics; "same write path" claim) per skeptic-design-1's REFUTE, and skeptic-design-2
  confirmed all five round-1 change requests closed against ground truth — I independently re-verified
  the closed items rather than trusting the skeptic reports (see Phase 2).
- Tasks 1.1-5.1 all marked done in `tasks.md`, and each matches what was actually implemented (script
  content, header comment, orchestrator.md's two edit sites, sync render, render-diff proxy).
- No scope creep: `git diff main...HEAD --name-only` touches only `core/roles/orchestrator.md`,
  `core/scripts/tui-attached.sh`, `scripts/concertino/tui-attached.sh`, and the openspec change dir.
  Confirmed no other `core/roles/*.md` file was touched (task 2.4's own check).
- No regressions: `emit-event.sh`, `concertino answer`/`lib/cli/answer.js`, and the TUI-attached branch's
  prose are byte-for-byte unmodified in the diff (only new conditional prose was inserted, nothing removed
  from the existing topology branches).
- No schema/API contract changes — N/A for this ticket.
- Planning artifacts (design.md, tasks.md, both spec deltas) accurately reflect the final implemented
  behavior; `files-modified.md` matches the actual diff.

### Phase 2: Code Review — FAIL

Ran `npm test` fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` gate at this speed): full suite passes,
exit 0, including `squash-branch.test.sh`, `check-gate-chain-change.sh`, `test-gate-in-isolation.sh`, and
all other `test/scripts/*.test.sh` + `node --test`. No regressions introduced by this change.

Read `CONTRIBUTING.md` (the canonical standard) before reviewing: `test/scripts/*.test.sh` are stated to
be "bash integration tests for the procedure scripts under `core/scripts/`, exercised through their actual
`sh`/`bash` entry points" and `npm test` — the whole gate — is an explicit, enumerated list of every one
of these files in `package.json`. Checked every `core/scripts/*.sh` against `test/scripts/*.test.sh`:
every script has a matching permanent test file except `setup-worktree.sh` (pre-existing gap, not
introduced by this change) and the new `tui-attached.sh`.

Independently re-verified the script's behavior by hand (not trusting the executor's own probe claims in
tasks 4.1-4.5, none of which are committed anywhere in the repo):

```
no lockfile            -> exit 1
dead pid                -> exit 1
pid 1 (EPERM, non-root)  -> exit 0  (matches watch-lock.js pidAlive's EPERM-is-alive)
torn/unparsable JSON     -> exit 1
own live pid             -> exit 0
```

All five match `specs/tui-liveness-detection/spec.md`'s scenarios exactly, and the script's `node -e`
snippet is a verbatim mirror of `lib/ui/watch-lock.js`'s `pidAlive()` (confirmed against
`lib/ui/watch-lock.js:44-52`). `core/scripts/tui-attached.sh` and `scripts/concertino/tui-attached.sh`
are byte-identical (`diff` empty), and running `node bin/concertino sync` against both
`config/examples/concertino.json` (claude-code only) and `config/examples/helio.json`
(claude-code + codex) confirms the rendered `concertino-orchestrator` role file references
`tui-attached.sh` an identical 2 times in both harnesses — no harness-specific leak.

**Issue (blocking): no permanent regression test for the new script — item (see below).**

1. **[CONTRIBUTING.md, `test/scripts/*.test.sh` convention] `core/scripts/tui-attached.sh` has no
   `test/scripts/tui-attached.test.sh`, and `npm test`'s `package.json` script list was not updated to
   include one.** Every sibling procedure script in `core/scripts/` (`emit-event.sh`, `assert-phase.sh`,
   `start-servers.sh`, `cleanup.sh`, etc. — 33 of 35 scripts) has a matching, permanently-committed
   `test/scripts/*.test.sh` wired into `npm test`, per `CONTRIBUTING.md`'s explicit statement that this is
   how procedure scripts get tested. Tasks 4.1-4.7 direct the executor to write "probes" for every scenario
   in `specs/tui-liveness-detection/spec.md` but explicitly scope them to "a throwaway dir under the
   scratchpad temp dir" — i.e., never committed, never part of the gate future changes run. That satisfies
   the letter of tasks.md but leaves the new, single-authority liveness check (which every future
   escalation-raise now depends on for correctness) with zero regression coverage: nothing in `npm test`
   would catch a future change to `tui-attached.sh` (or an accidental `watch-lock.js` pidfile-shape drift)
   silently flipping its "no TUI" default to the dangerous direction. This is exactly the kind of
   mechanically-checkable gap (`find core/scripts -name '*.sh'` vs `test/scripts/*.test.sh`, one exception
   at `setup-worktree.sh` predating this change) the canonical standard's own test-organization convention
   exists to prevent.
   **Fix:** add `test/scripts/tui-attached.test.sh` (mirroring `emit-event.test.sh`'s style/fixture
   conventions) covering the seven scenarios in `specs/tui-liveness-detection/spec.md` — live pid, missing
   lockfile, dead pid, torn/unparsable JSON, unexpected-failure/main-checkout-unresolvable, EPERM-owned pid
   (alive), heartbeat-staleness-ignored — and add it to `package.json`'s `test` script alongside the other
   `test/scripts/*.test.sh` invocations.

DRY / readability / modularity / type safety / security / error handling / no dead code / no
over-engineering: all otherwise PASS. The script is small, single-purpose, heavily commented with
provenance (`CON-126`), reuses `watch-lock.js`'s exact liveness semantics rather than reinventing one, and
`main_checkout()` correctly mirrors `emit-event.sh`'s existing resolution logic. The orchestrator.md prose
change is additive-only and does not touch the unmodified TUI-attached branch's existing text.

### Phase 3: UI Review — N/A

No changed files match `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or
`openspec/specs/**` (this is a Concertino-internal orchestration change, not a helio application change).

### Overall: FAIL

### Change Requests

1. Add `test/scripts/tui-attached.test.sh` (permanent, committed) covering every scenario in
   `openspec/changes/gate-escalation-on-tui-liveness/specs/tui-liveness-detection/spec.md`, and wire it
   into `package.json`'s `test` script, following this repo's existing `test/scripts/*.test.sh` convention
   (per `CONTRIBUTING.md`) that every `core/scripts/*.sh` procedure script gets a permanent regression test
   exercised through its real `bash` entry point. The scratchpad-only probes described in tasks 4.1-4.7 are
   not a substitute — they leave the new single-authority liveness check with zero coverage in the gate
   future changes actually run.

### Non-blocking Suggestions

- None beyond what skeptic-design-2 already flagged as non-blocking (stale pre-CR4 wording in
  `design.md` Risks and `tasks.md` 4.1's example mutation still describing the rejected `kill -0`
  mechanism) — cosmetic, does not affect implementation correctness.
