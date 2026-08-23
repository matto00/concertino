## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-read all artifacts fresh (`proposal.md`, `design.md`, `tasks.md`, both spec deltas) and re-derived
every ground-truth claim from source, not from the round-1 report or the executor's summary.

- **CR1 (authoring location) — closed.** `proposal.md` Impact, `design.md` Decision 1, `tasks.md` 1.1/1.3
  and both spec deltas now name `core/scripts/tui-attached.sh` as the authored file, with the
  `scripts/concertino/tui-attached.sh` render called out as a `concertino sync` product (task 3.1).
  `ls core/scripts` confirms this is where every sibling procedure script (`emit-event.sh`,
  `assert-phase.sh`, …) actually lives. Task 1.1 even carries the "NOT `scripts/concertino/`" warning inline.
- **CR2 (stale `answer.json` on a second no-TUI escalation) — closed, and the mechanism checks out.**
  `core/scripts/emit-event.sh`: `write_escalation_raised` → `discard_stale_answer` (writes
  `escalation.answer_discarded`, `rm -f "$ANSWER_FILE"`) → `if [ "$RAISE_ONLY" -eq 1 ]; then exit 0; fi`.
  So `--raise-only` is genuinely non-blocking *and* genuinely performs the discard — exactly the two
  properties Decision 2's no-TUI branch relies on. The spec's second scenario is now backed by real
  script behavior rather than an assumption.
- **CR3 (false "same write path" claim) — closed and correctly inverted.** `core/roles/orchestrator.md`
  l.1216-1224: the directly-raised `--await`-timeout fallback does record via a raw
  `scripts/concertino/emit-event.sh escalation.answered …` call; l.1298-1304 (the bubbled-root path) uses
  `concertino answer`. `specs/escalation-bubble-up/spec.md`'s third requirement now states this
  distinction explicitly ("distinct from, and not a reuse of…") and adds a scenario asserting the
  `--await`-timeout fallback stays unmodified. Design Decision 2 says the same and justifies the change.
- **CR4 (`kill -0` / EPERM) — closed.** Decision 1 step 3 now records the measured refutation
  (`bash -c 'kill -0 1'` exits 1) and mandates a `node -e process.kill(pid, 0)` snippet mirroring
  `lib/ui/watch-lock.js:44-52` `pidAlive()` (verified: `catch (e) { return e && e.code === 'EPERM'; }`),
  with stderr suppression. Task 1.1 carries the same instruction; the `tui-liveness-detection` spec's
  foreign-owned-pid scenario states the EPERM=alive rule.
- **CR5 (unbounded `--wait-only` poll on an unraised escalation) — closed.** `emit-event.sh`'s
  `--wait-only` block leaves `REAL_DEADLINE_MS` unset when `RAISED_AT` is empty and exits 2 forever.
  Because Decision 2's no-TUI branch now always calls `--raise-only` first, there is no longer any raise
  path that omits `escalation.raised`, so `RAISED_AT` always exists — the hang is closed at its root
  cause rather than special-cased. The spec's "dashboard attaching after a no-TUI raise" scenario says so.
- **No new problems found in the revisions.** Checked specifically: `--raise-only` does not block (exit 0
  immediately after the discard); `lib/cli/answer.js` `writeAnswer`/`writeSubAnswer` refusal semantics are
  untouched and still `O_EXCL` (`lib/ui/store.js:211-228`); the multi-part `--sub/--total` form still
  resolves through `recordAnswered` only on `complete` (`answer.js`), so CON-46's wizard survives the
  no-TUI branch; the Claude-Code-subagent `ESCALATION-PENDING` branch (`orchestrator.md` l.1131-1150) is
  explicitly declared unaffected by `TUI_ATTACHED`, which is correct — a subagent has no chat channel to
  resolve from, and Decision 2's bullet says the re-check happens at the root's resolution hop instead.

### Verdict: CONFIRM

All five round-1 change requests are closed against ground truth, and the fixes are structural
(always raise) rather than special-cased. The design is sound enough to implement.

### Non-blocking notes

- **Stale leftovers from the pre-CR4 draft.** `design.md` Risks still carries "[Risk] `kill -0` semantics
  differ across POSIX shells → Mitigation: `bash` is already a hard dependency", and `tasks.md` 4.1's
  example mutation is "flip the `kill -0` exit-code check" — both describe the mechanism the design no
  longer uses. Harmless (the real dependency, `node`, is equally hard), but reword so the implementer
  isn't nudged back toward the shell builtin.
- **`concertino answer`'s root resolution vs. `emit-event.sh`'s.** `lib/cli/answer.js` uses
  `path.resolve(flags.out || '.')` and `lib/ui/store.js`'s `runDir` joins straight off that root, while
  `emit-event.sh` normalises to the main checkout via `git rev-parse --git-common-dir`. If the
  orchestrator ever runs with cwd inside a worktree, the `--raise-only` discard and the `concertino answer`
  write would target different `answer.json` files and CR2's failure would quietly reappear. This is
  pre-existing (the bubbled-root path at `orchestrator.md:1301` already calls `concertino answer` with no
  `--out`) and design.md Decision 1 acknowledges the `--out` divergence, so it is not a blocker — but the
  no-TUI branch makes this the ordinary road, so passing an explicit `--out` (or one sentence in the
  orchestrator prose fixing cwd = main checkout) would be cheap insurance.
- `answer.json` written by the no-TUI branch is never read by anything in that branch (no poller). That's
  fine and is what makes the next raise's discard the only cleanup needed — worth one sentence in the
  orchestrator prose so a future reader doesn't mistake it for dead state to "fix".
