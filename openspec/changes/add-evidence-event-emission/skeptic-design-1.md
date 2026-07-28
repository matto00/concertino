## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **The dangling-ref trap (AC #3 / "The trap" section).**
   - Read `core/scripts/emit-event.sh`'s `main_checkout()` (git-common-dir
     resolution, normalised relative/absolute across git versions) and
     `core/scripts/cleanup.sh` (confirms `--phase4` does `git worktree remove
     --force` on `WORKTREE_PATH` while `.concertino/runs/<TICKET>/` in the main
     checkout is untouched). design.md's Context section states this
     accurately and matches the code.
   - design.md Decision 1 has `persist-evidence.sh` duplicate `emit-event.sh`'s
     `git rev-parse --git-common-dir` resolution (not source it — matches the
     existing "independent, no shared lib" convention across `core/scripts/*`,
     verified by reading `emit-event.sh`'s own comment on why `now_ms()` is
     copied rather than imported) and copy the artifact into
     `<main checkout>/.concertino/runs/<TICKET>/evidence/`, printing
     `READY ref=<absolute path>` — the same `READY key=value` contract
     `setup-worktree.sh` already uses (confirmed by reading
     `setup-worktree.sh`'s final `READY worktree=...` lines).
   - Decision 3 pins every call site (orchestrator, evaluator, skeptic) to
     build `ref` only from `persist-evidence.sh`'s output, never the
     worktree-relative original path. This directly resolves the trap: the
     `ref` a reader follows after `cleanup.sh --phase4` points at a file in
     the surviving main checkout, not the destroyed worktree.
   - The spec.md scenario "The returned ref survives the worktree being
     removed" and tasks.md 5.1/6.1 both require this to be tested (a fresh
     unit test that deletes the worktree and re-checks the ref, plus a manual
     end-to-end smoke test that actually runs `cleanup.sh --phase4`). This is
     the correct verification shape for the claim being made.

2. **The "no redundant `evidence` event for evaluator/skeptic" justification
   (AC #2).**
   - Read `lib/ui/screens/drilldown.js`: `describeEvent`'s `case 'verdict'`
     already renders `ev.ref` as the timeline line's detail (line 97), and
     `test/drilldown.test.js:367` (`"at 78 cols, a verdict's report reference
     is no longer truncated away"`) confirms this is exercised today — so
     design.md's claim that `verdict.ref` is already visible in the drill-down
     is accurate, not asserted.
   - design.md Decision 2 gives a substantive argument, not a default: (a)
     planning artifacts have no other event carrying a path today (verified —
     `core/roles/orchestrator.md`'s Phase 1 has no existing telemetry call for
     `proposal.md`/`design.md`/`tasks.md`), so a dedicated `evidence` event is
     the only way they surface; (b) evaluator/skeptic reports already have
     `verdict.ref`, so a second `evidence` event pointing at the identical
     file is pure duplication. It also names and rejects the literal-AC-text
     alternative (emit both), citing the ticket's own explicit steer against
     defaulting. This satisfies the ticket's explicit instruction to "decide,
     and justify" rather than default.
   - Read `lib/ui/reducer.js`: `TIER2_KINDS = {'run.start','gate.result'}`,
     `TIER3_KINDS` includes `'verdict'` but not `'evidence'` — confirms the
     design's Non-Goal ("no change to TIER2/TIER3 classification") is already
     true of the codebase as it stands; the decision doesn't require touching
     it.

3. **Plan coherence against the actual codebase (not just internal
   consistency).**
   - `core/scripts/README.md`'s existing script table (read in full) matches
     the shape tasks.md 1.4 asks to extend (one new row, same columns).
   - `package.json`'s `test` script is a `&&`-chained list of
     `test/scripts/*.test.sh` invocations (read in full) — tasks.md 5.2's
     instruction to append the new suite in the same pattern is concrete and
     directly actionable, not hand-waved.
   - `core/roles/orchestrator.md` line 121 ("Update `workflow-state.md`
     (PHASE: Execution, CYCLE: 1)") is the exact anchor tasks.md 2.1 names for
     inserting the per-artifact persist+emit instruction — verified by
     reading the actual file, not assumed from the task description.
   - `core/roles/evaluator.md` lines 153-157 and `core/roles/skeptic.md`
     lines 139-143 are the exact `emit-event.sh verdict ... ref=<report
     path>` call sites tasks.md 3.1/3.2 target — read in full, confirmed to
     be a single-line edit (swap the raw path for `persist-evidence.sh`'s
     `ref=` output) rather than a larger rewrite.
   - `.claude/agents/` in this worktree is currently gitignored and does not
     exist as a populated dir here (confirmed by `ls` — empty), while it does
     exist, populated, in the main checkout. `bin/concertino sync` defaults
     its output to the invocation `cwd` (confirmed by reading `bin/concertino`
     around `cmdSync`/`--out`), so tasks.md 4.1's "run `node bin/concertino
     sync` from the worktree root" is the correct, and only, way to populate
     this worktree's own rendered copies — not a hand-wave.
   - AC "Tests cover a run with evidence and a run without" is satisfied by
     the combination already in place: `test/drilldown.test.js` already has
     passing UI-level fixtures for both cases (`'no evidence: says so...'` and
     `'evidence events render as evidence lines when present'`, confirmed by
     reading the file), plus the new `persist-evidence.test.sh` (tasks.md 5.1)
     covering the emission-side mechanics the UI tests don't. Nothing in the
     plan claims a role doc (prose) will be literally unit-tested, which
     matches how every other role-doc-driven behavior in this codebase is
     verified (script-level unit tests + a manual smoke task).
   - No `TODO`/`TBD`/"figure out later" language anywhere in proposal.md,
     design.md, tasks.md, or the spec delta (grepped all four files).

### Verdict: CONFIRM

### Non-blocking notes
- tasks.md 3.3 asks for "a short comment/note in both role docs" recording the
  no-redundant-event rationale — worth the executor keeping this genuinely
  short (a line, not a re-paste of design.md's argument) so it doesn't bloat
  prose the orchestrator/evaluator/skeptic re-read on every cycle.
- The disk-growth risk (each evidence copy duplicates a markdown artifact
  under `.concertino/runs/<TICKET>/evidence/`, no retention policy) is
  correctly scoped out as matching `events.jsonl`'s existing no-retention
  precedent — flagging only so it isn't re-litigated at the final gate as a
  new concern.
