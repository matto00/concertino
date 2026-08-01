## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Ground truth re-established.** Read `ticket.md`, `proposal.md`,
   `design.md`, `tasks.md`, both spec deltas
   (`specs/orchestrator-turn-discipline/spec.md`,
   `specs/post-completion-escalation-visibility/spec.md`), the pre-existing
   `openspec/specs/orchestrator-turn-discipline/spec.md` (CON-15's spec, to
   check for contradiction), `files-modified.md`, `evaluation-1.md`, and
   `skeptic-design-1.md` (treated all as claims, not facts). Ran
   `git diff main...HEAD --stat` — full change is 15 files; `git diff
   main...HEAD --stat -- ':!openspec'` confirms exactly the five
   ticket-named files (`core/roles/orchestrator.md`,
   `docs/harness-capabilities.md`, `lib/ui/reducer.js`,
   `test/reducer.test.js`, `test/fleet.test.js`) — no scope creep. Read every
   line of the actual diffs for all five files myself (not the evaluator's
   description of them).

2. **AC (a) — orchestrator ends its turn once Phase 4 is genuinely complete,
   precisely bounded against CON-15's hazard.** `core/roles/orchestrator.md`
   (diff, lines 459-496) adds a "Genuinely complete" paragraph naming all
   three conditions (cleanup.sh run + `run.end` side effect, ticket
   Done + closing comment, hygiene check reported), explicitly states
   `run.end` alone is insufficient, and explicitly scopes the rule to Phase 4
   only ("not license to consider yourself 'done' ... at the end of
   Planning, Execution, Evaluation, or Delivery"). Step 5 is the actual
   end-of-turn instruction ("no further tool calls, no further open-ended
   questions, no continued conversation inviting a reply"). Guardrails
   section (line 679) cross-references it. `docs/harness-capabilities.md`
   records the same fact independently, alongside the existing CON-15
   subsection, with the double-invisibility rationale (dashboard already
   renders DONE; window-reaping's live-window rule protects the very session
   stuck in the bug). This traces 1:1 to `orchestrator-turn-discipline`'s
   spec delta and does not textually overlap or contradict the pre-existing
   spec file.

3. **AC (b) — post-cleanup suggestions go through escalation, not bare
   chat.** Step 4 of the new Phase 4 text requires `emit-event.sh escalation
   --await` (generic `question=`/`options=`, no kind — confirmed this
   fallback is real and already documented at `core/roles/orchestrator.md`
   line 507's "How to raise one" section, which I read directly), states
   it's one-shot and doesn't interact with `DEBUG_ATTEMPTS` or any other
   breaker, and is skipped if there's nothing to raise. Matches
   `post-completion-escalation-visibility`'s... no — matches
   `orchestrator-turn-discipline`'s second added requirement and its
   scenarios exactly.

4. **Gates re-run myself, not trusted from the evaluator's report:**
   - `npm test` — exit 0. Read the full output; grepped for `not ok` (0
     hits) and confirmed the only "fail" substrings are test *names*
     (e.g. "a failed run...", "fetch-failed retry"), with every suite's
     summary line reading "N passed, 0 failed".
   - `node --test test/reducer.test.js test/fleet.test.js` directly — 201
     passed, 0 failed, including the three new `reducer.test.js` cases and
     the new `fleet.test.js` end-to-end bucketing case, all visibly `✔`.
   - `openspec validate end-run-escalation-cleanup --strict` — "Change
     'end-run-escalation-cleanup' is valid".

5. **Independently re-derived the reducer.js fix, not just trusted passing
   tests.** Read the actual diff:
   ```
   escalationStale = !!run.escalation && (!run.window || !run.window.alive)
   deriveStatus: first branch `if (run.escalation && run.window && run.window.alive) return 'needs-you'`, checked before the `run.endStatus` short-circuit
   ```
   Traced this by hand against every relevant permutation:
   - escalation + run.end + window alive → old: stale (endStatus forced it);
     new: not stale, `needs-you` — **the fix**, matches design.md Decision 3
     and the new spec's first two scenarios.
   - escalation + run.end + window dead → stale under both old and new
     formulas (unchanged) — `deriveStatus`'s new first branch doesn't fire
     (window not alive), so the `endStatus` branch still returns
     `done`/`failed` exactly as before.
   - escalation + run.end + no window data at all → stale under both old
     (`endStatus != null`) and new (`!run.window`) formulas — unchanged,
     matches the new regression-guard test and spec scenario.
   - escalation, no run.end, window alive (ordinary in-flight escalation) →
     not stale under both formulas — unchanged.
   - escalation answered (event clears `run.escalation`) → both fields
     revert correctly since `applyEvent` nulls `run.escalation` on
     `escalation.answered`/`escalation.timeout`, independent of this change.
   This matches design.md's Decision 3 precisely, not merely "tests pass by
   coincidence" — the logic itself is right.

6. **One genuine gap surfaced by the design-gate skeptic that was not
   closed, checked to see if it matters.** `skeptic-design-1.md`'s
   non-blocking note #1 flagged that the corner case "escalation raised, no
   `run.end` yet, and no window data at all" flips from not-stale (old
   formula) to stale (new formula) — a real, untested behavior change,
   reachable in production (tmux server lost entirely while an escalation is
   open). I confirmed neither remedy the design skeptic suggested (a new
   `test/reducer.test.js` case, or a design.md sentence) was added — grepped
   `design.md` for "no window data at all" / "incidental tightening" /
   "reboot" and found no addition, and `test/reducer.test.js` has no case
   with `escalation.raised` + no `run.end` + empty `windows` array. However:
   this was explicitly marked *non-blocking* at the design gate (with the
   reasoning that it's arguably a correctness improvement, and doesn't
   contradict either spec file's scenarios), and I confirmed no requirement
   in `openspec/specs/cross-screen-escalation/spec.md` (the only pre-existing
   spec referencing `escalationStale`) depends on the old behavior for that
   corner case. It remains an open, harmless loose end from the design
   review that the executor didn't follow up on — worth naming, not worth
   blocking on.

7. **Scope / archive readiness.** `grep -rniE "TODO|TBD|FIXME|placeholder"`
   across the change dir and all five touched files: no genuine hits (one
   false positive is a fleet test's literal string `"{{TICKET}} placeholder"`
   used as test fixture text, and two are the evaluator/skeptic reports
   describing the *absence* of TODOs). `files-modified.md`'s claim that
   `.claude/agents/concertino-*.md` are gitignored and therefore correctly
   absent from the commit is verified directly: `.gitignore` lines 8-9 are
   exactly `/.claude/agents/concertino-*.md` and
   `/.claude/commands/concertino-*.md`, and the rendered
   `.claude/agents/concertino-orchestrator.md` on disk (untracked per `git
   status`) does contain the new "Genuinely complete" text at line 520.
   `workflow-state.md`'s uncommitted diff is normal orchestrator bookkeeping
   (PHASE/EVALUATOR fields), not in-scope code.

### Verdict: CONFIRM

Both ticket ACs trace to real, correctly-scoped diff content; the reducer.js
fix is independently re-derived (not just test-passing) and matches
design.md's Decision 3 exactly; all gates (full `npm test`, targeted
`node --test`, `openspec validate --strict`) were re-run fresh and pass; the
diff is exactly the five files the ticket calls for, with no scope creep;
the change is free of placeholders and ready to archive.

### Non-blocking notes
- The design-gate skeptic's non-blocking suggestion (add a
  `test/reducer.test.js` case, or a design.md sentence, for the "escalation +
  no run.end + no window data at all" corner case that silently flips from
  not-stale to stale under the new formula) was not acted on. Still
  non-blocking — no spec scenario depends on the old behavior, and the
  design skeptic's own assessment that this is likely a correctness
  improvement holds up — but worth folding in on a future touch of this
  function so the behavior change is deliberate and locked in, not just an
  accidental byproduct of a precedence rewrite.
- `evaluation-1.md`'s cosmetic note (the "Genuinely complete" paragraph
  interrupts the Phase 4 numbered list between step 3 and step 4) is real —
  confirmed by reading `core/roles/orchestrator.md:456-496` — but functionally
  harmless for an LLM consumer and not required by any configured standard.
