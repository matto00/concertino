## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL
Issues:
- **AC #3 ("ref is a path that can actually be resolved from the dashboard's
  working directory, not a path relative to the agent's worktree") is
  violated on the evaluator/skeptic FAIL-fallback path, and this fallback was
  never decided in design.md.** `core/roles/evaluator.md:165-169` and
  `core/roles/skeptic.md:151-155` read: "If `persist-evidence.sh` prints
  `FAIL`, emit `verdict` with the original report path rather than dropping
  the event." That "original report path" is the raw `WORKTREE_PATH`-relative
  location — exactly the pointer `cleanup.sh --phase4` turns into a dangling
  reference. This directly contradicts design.md Decision 3's own
  unconditional language ("Every call site... builds `ref` from
  `persist-evidence.sh`'s `READY ref=<path>` output, **never** from the
  artifact's original... location. This is true for both the orchestrator's
  dedicated `evidence` events and the evaluator/skeptic's `verdict.ref`.") and
  reintroduces precisely the trap the ticket repeats three times ("an
  evidence ref that cannot be resolved after cleanup is worse than no
  evidence event at all"). The orchestrator's own FAIL handling (task 2.2,
  `core/roles/orchestrator.md` item 6) correctly applies that principle by
  skipping the evidence event entirely on a failed persist — the
  evaluator/skeptic fallback does not apply the same standard to `verdict.ref`,
  and this specific corner case is not addressed anywhere in design.md,
  tasks.md, or spec.md (grepped all three for "FAIL" — no verdict-emission
  scenario exists for this case). This is an unreviewed reinterpretation
  introduced during implementation, not a decision that went through the
  design-soundness gate.
  - Confirmed this is fixable cleanly without breaking "a verdict must always
    be emitted": `lib/ui/screens/drilldown.js:97` already renders
    `ev.ref || ''` for the `verdict` case, i.e. an absent `ref` degrades to an
    empty detail column, not a crash or blank line — the same honest
    degradation this design already relies on elsewhere. Omitting `ref=` from
    the `verdict` event when `persist-evidence.sh` fails (rather than falling
    back to the raw worktree-relative path) would satisfy AC #3 unconditionally
    while keeping the verdict itself always emitted.

Everything else in Phase 1 passes:
- All other ACs addressed explicitly (orchestrator emits `evidence` per
  planning artifact at the `workflow-state.md` write point;
  evaluator/skeptic route `verdict.ref` through `persist-evidence.sh`; the
  "decide and justify redundant evidence event" instruction is answered with
  a substantive, non-defaulted argument in design.md Decision 2, matching the
  skeptic's own design-gate CONFIRM).
- No AC silently reinterpreted elsewhere; scope matches `files-modified.md`
  exactly (verified via `git diff main...HEAD --stat`).
- Tasks 1.1-6.2 are all marked done and match the diff — verified by reading
  the actual diffs for each referenced file/line, not just trusting the
  checkboxes.
- No unnecessary changes outside ticket scope.
- No regressions: full `npm test` run independently (377 `node --test`
  assertions + 6 shell suites) — 0 failures, including the pre-existing
  `test/drilldown.test.js` evidence-panel fixtures.
- No API/schema changes required beyond the new `evidence-telemetry`
  capability's spec.md, which is present and accurate.
- Planning artifacts reflect the final implemented behavior for every
  decision **except** the FAIL-fallback gap above, which the implementation
  added without a corresponding design decision.

### Phase 2: Code Review — FAIL (same root cause as Phase 1)
Issues:
1. Same issue as Phase 1 above — `core/roles/evaluator.md:165-166` and
   `core/roles/skeptic.md:151-152` — an undesigned behavior that can, in a
   real failure case (e.g. `.concertino/runs/` unwritable in the main
   checkout), ship a `verdict.ref` that stops resolving the moment
   `cleanup.sh --phase4` runs.

Everything else in Phase 2 passes:
- `persist-evidence.sh` (`core/scripts/persist-evidence.sh`): clear, single
  purpose, matches the `READY key=value` / `FAIL <reason>` contract
  described in design.md; the `main_checkout()` duplication from
  `emit-event.sh` is a documented, deliberate convention (comment at
  `core/scripts/persist-evidence.sh:33-36`), not an unjustified DRY
  violation.
- No dead code, no TODO/FIXME, no magic values beyond the already-established
  `.concertino/runs/<TICKET>/evidence/` path convention.
- Error handling: `FAIL`/non-zero exit on missing/unreadable source and
  failed `mkdir`/`cp`, each with a distinct message; callers guard with
  `[ -n "$REF" ] && ... || true` per the existing telemetry-call-site
  pattern.
- Tests are meaningful: `test/scripts/persist-evidence.test.sh` independently
  re-run — covers copy-lands-in-main-checkout, ref-survives-worktree-removal
  (the actual load-bearing claim), missing-source failure, and idempotent
  re-run. I additionally ran an independent manual end-to-end smoke test
  (fresh scratch repo + worktree, `persist-evidence.sh` + `emit-event.sh
  evidence`, `git worktree remove --force`, then `cat` on the emitted `ref`)
  and it passed, confirming the durability claim against real git worktree
  removal, not just the packaged test.
- No untyped escape hatches (bash script, no type system to violate); no
  injection/XSS concerns beyond the pre-existing, unchanged convention of
  building `.concertino/runs/<TICKET_ID>/...` from an unsanitized
  `TICKET_ID` — identical exposure already exists in `emit-event.sh`
  (`RUN_DIR="${ROOT}/.concertino/runs/${TICKET}"`, no validation), so this is
  not a regression this diff introduces; noted as a non-blocking suggestion
  below.
- **Verified the stated claim that no `lib/ui/*.js` file changed and the
  reducer/drill-down already fully handle the `evidence` kind** (task 6.2)
  rather than assuming it: `git diff main...HEAD --stat` confirms zero
  `lib/` files touched; `lib/ui/reducer.js`'s `applyEvent` does a generic
  `run.events.push(ev)` with no per-kind `case` needed for an event to appear
  in the timeline; `lib/ui/screens/drilldown.js:98-99` (`describeEvent`'s
  `case 'evidence'`) and `:200-206` (`evidenceLines()`, filtering
  `ev.kind === 'evidence'`, falling back to `'no evidence recorded'`) already
  exist unmodified. The claim is accurate.
- Sync verified: `node bin/concertino sync` re-run inside the worktree
  reproduces byte-identical `.claude/agents/concertino-{orchestrator,
  evaluator,skeptic}.md` content already present (these are gitignored per
  `.gitignore:8`, so their absence from the git diff is correct, not a
  missed-commit gap) and `scripts/concertino/persist-evidence.sh` is
  byte-identical to `core/scripts/persist-evidence.sh`. `git status --short`
  after the re-sync shows no unexpected tracked-file drift.

### Phase 3: UI Review — N/A
No UI configured for this project; no `lib/ui/*.js` changes present, confirmed above.

### Overall: FAIL

### Change Requests
1. In `core/roles/evaluator.md` (~line 165) and `core/roles/skeptic.md`
   (~line 151), change the `persist-evidence.sh` `FAIL` fallback so the
   `verdict` event omits `ref` entirely (or otherwise never emits the raw
   `WORKTREE_PATH`-relative path) rather than substituting "the original
   report path." Keep the verdict event itself mandatory-and-always-emitted,
   but do not let it carry a `ref` that will dangle after
   `cleanup.sh --phase4`. Update design.md's decision (or add a short new
   one) documenting this corner case explicitly, and add a spec.md scenario
   for it under the `evidence-telemetry` capability so it isn't
   re-introduced later. `lib/ui/screens/drilldown.js:97`'s
   `ev.ref || ''` already degrades gracefully to an empty detail, so no UI
   change is needed to support this.

### Non-blocking Suggestions
- `persist-evidence.sh` builds `DEST_DIR` from an unsanitized `TICKET_ID`
  (`core/scripts/persist-evidence.sh` — the `DEST_DIR=".../runs/${TICKET_ID}/evidence"`
  line), matching `emit-event.sh`'s existing, equally unsanitized
  `RUN_DIR="${ROOT}/.concertino/runs/${TICKET}"`. Not a regression this diff
  introduces, but since this script now performs a real filesystem write
  (`cp`) rather than only appending to a log, it's a slightly higher-value
  target than `emit-event.sh` was for hardening `TICKET_ID` against a
  path-traversal-shaped value — worth a future ticket, not blocking here.
