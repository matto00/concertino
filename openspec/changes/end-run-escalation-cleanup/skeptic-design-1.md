## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Read all planning artifacts in full**: `ticket.md`, `proposal.md`, `design.md`,
   `tasks.md`, `specs/orchestrator-turn-discipline/spec.md`,
   `specs/post-completion-escalation-visibility/spec.md`, `workflow-state.md`.
   No `TODO`/`TBD`/`FIXME`/placeholder text anywhere in the change dir
   (`grep -rniE "TODO|TBD|FIXME|figure out|placeholder|xxx"` — no hits).

2. **"Genuinely complete" boundary doesn't reopen CON-15's hazard.** Read
   `core/roles/orchestrator.md` lines 429-457 (actual Phase 4 text): the three
   steps design.md's Decision 1 cites (`cleanup.sh --phase4`, ticket
   Done + closing comment, hygiene check) are exactly the three steps
   already there — no invented step. `specs/orchestrator-turn-discipline/
   spec.md`'s "genuinely complete" requirement has an explicit scenario
   ("The definition does not license stopping early in an earlier phase")
   directly guarding against the mirror-image hazard. Read the *existing*
   (pre-change) `openspec/specs/orchestrator-turn-discipline/spec.md` and the
   role's current Guardrails section (lines 618-639) to confirm the new
   requirements are purely additive with no textual overlap/contradiction —
   confirmed.

3. **Decision 3 (`lib/ui/reducer.js` fix) — read the actual file and traced
   the claims by hand:**
   - `deriveStatus` line 169 (`if (run.endStatus) return ...`) — confirmed
     it's checked first, exactly as design.md claims.
   - `escalationStale`'s current formula (lines 224-225: `!!run.escalation &&
     (run.endStatus != null || !!(run.window && !run.window.alive))`) — byte-
     for-byte matches design.md's quoted description of "today's" logic.
   - Traced **all 15** existing cases in `test/reducer.test.js` by hand
     against the proposed new `deriveStatus`/`escalationStale` (inserting one
     new branch ahead of the `endStatus` short-circuit, per task 3.2's "leave
     every other branch's precedence unchanged"). Every existing assertion
     (`run.status`, `run.escalationStale`) still holds under the new logic,
     including the three the design calls out explicitly (delivered+stale,
     no-window+stale, plain delivered).
   - Read `lib/ui/watch.js`'s `computeLiveEscalations` (line 252-257:
     `filter((r) => r.escalation && !r.escalationStale)`) and
     `lib/ui/screens/fleet.js`'s `bucketRuns` (line 294-299: keyed on
     `r.status === 'needs-you'`) and its Enter-key routing (line 1231:
     `if (run.escalation && !run.escalationStale)`) — both confirmed to match
     design.md's description of the two call sites that read the changed
     fields, and confirmed neither needs its own code change (only the two
     `reducer.js` fields feeding them do).
   - Read `lib/ui/reap.js`'s `selectReapable` (line 26:
     `run.endStatus != null && run.window && run.window.alive === false`) —
     confirmed unaffected by and independent of this design, matching the
     Non-Goals claim.

4. **Specs vs. design/tasks consistency**: ran `openspec validate
   end-run-escalation-cleanup --strict` — `Change 'end-run-escalation-cleanup'
   is valid`. Cross-read both spec deltas against design.md's three Decisions
   and tasks.md's five task groups — every requirement traces to a task and
   every task traces to a requirement or an Impact-section file. Scenarios in
   both spec files are concretely testable (either against the rendered role
   text by inspection, or against `reduce()`'s output directly).

5. **Task completeness / template-rendering question**: confirmed `.claude/
   agents/*.md` are git-ignored, sync-generated artifacts (`.gitignore`:
   `/.claude/agents/concertino-*.md`) and that the real rendering pipeline
   (`concertino sync` in `bin/concertino`) has no `{{block:}}`/`{{var:}}`
   tokens implicated by this change (pure prose addition to an existing
   Phase 4 section, no new template variables). Task 5.1 correctly requires
   either re-running `concertino sync` or explicitly confirming no
   block/var changes are needed and spot-checking the rendered orchestrator
   agent file — this is the right call for a self-hosted change and isn't
   skipped or hand-waved.

6. **CON-47 dependency**: design.md's Open Questions claims the `--await`
   timeout scope-note dependency has already landed. Confirmed via
   `git log --oneline --all | grep CON-47` → `daeaf0c CON-47 Escalation
   --await reliability: source .concertino.env + a trust off-ramp (#28)` is
   present in history. Not a blocking dependency.

### Verdict: CONFIRM

The design is sound: the "genuinely complete" boundary is precisely defined,
textually additive to the existing role file, and explicitly guarded (in both
prose and spec scenario) against relicensing CON-15's original early-exit
hazard. Decision 3's description of current `reducer.js` behavior is
byte-accurate, and I independently traced every existing reducer test against
the proposed new logic with no regressions. Specs are internally consistent
with design.md/tasks.md and their scenarios are concretely verifiable.
Tasks.md's breakdown is complete against the design, including the
easy-to-miss template-rendering step for this self-hosted change.

### Non-blocking notes

1. **Design.md's backward-compatibility claim is slightly overstated for one
   untested corner case.** The current `escalationStale` formula treats
   "escalation raised, no run.end yet, and no matching tmux window at all"
   as **not stale** (`!!(run.window && !run.window.alive)` is `false` when
   `run.window` is `null`), so `deriveStatus`'s existing (unchanged)
   `if (run.escalation) return 'needs-you'` branch already surfaces it as
   live today. The new formula (`!run.window || run.window.alive === false`)
   makes this same state **stale** — a real behavior change, not just "new
   branches that never fire for existing runs." This state is reachable in
   production (e.g., the tmux server/session is lost entirely — reboot, `tmux
   kill-server`, manual teardown — while an escalation is still open and
   `run.end` never fired), not merely theoretical. On reflection this is
   arguably a *correctness improvement* (if the window/process is truly gone,
   nobody is running `--await` to ever see an answer, so "stale" is the more
   honest signal, consistent with the file's own header comment about not
   sending a human to "answer a question nobody is waiting on"), but it is
   an undocumented, untested side effect of the formula rewrite rather than a
   deliberate, called-out decision. Suggest the executor either (a) add one
   more `test/reducer.test.js` case locking in this now-stale-instead-of-live
   behavior for "escalation + no run.end + no window data at all," or (b) add
   a sentence to design.md's Decision 3 acknowledging this is an incidental
   tightening, not merely an additive no-op for pre-existing runs. Not
   blocking — no scenario in either spec file asserts the old (arguably
   buggy) behavior, so nothing here contradicts the specs as written.

2. **Minor task redundancy**: tasks.md 4.5 ("run the full test suite") and
   5.2 ("run `node --test` across the touched test files") overlap; 4.5
   should probably say `npm test` explicitly (the project's actual gate,
   which also runs the `test/scripts/*.test.sh` suite, not just `node
   --test`) to avoid an implementer reading 4.5 as already-covered by 5.2's
   narrower command.

3. The archived CON-15 precedent (`2026-07-28-orchestrator-never-ends-turn/
   tasks.md`) included an explicit "re-read the role end-to-end as if seeing
   it for the first time" verification task; this change's tasks.md has no
   equivalent step. The spec scenarios cover the same intent ("a fresh model
   reads... can state exactly which three conditions"), so this is a stylistic
   gap rather than a coverage gap, but worth adding for parity with the
   precedent this ticket explicitly mirrors.
