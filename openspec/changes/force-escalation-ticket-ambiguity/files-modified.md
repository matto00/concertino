- `core/laws/ticket-drafting-escalation.md` — new Iron Law: banned-hedge-phrase list + structural
  open-question check that forces a `ticket-ambiguity` escalation instead of silently resolving
  ticket-drafting ambiguity.
- `core/laws/README.md` — added the new law's row to the laws table (bound to: orchestrator, and
  documented as the convention future ticket-drafting flows, e.g. CON-21, are expected to apply);
  cycle-2 fix: also corrected the Acknowledgements section's blanket `inspired_by` claim now that
  one law (`ticket-drafting-escalation.md`) correctly omits it (evaluator non-blocking suggestion).
- `core/scripts/gather-escalation-context.sh` — added a sixth kind, `ticket-ambiguity`, to
  `VALID_KINDS` and its `case` block (fields: `signal`, `detail`, `draft_excerpt`); updated the
  header comment's kind enumeration.
- `core/scripts/README.md` — updated the `gather-escalation-context.sh` row/prose to reflect six
  kinds instead of five.
- `core/roles/orchestrator.md` — Phase 4 step 4: wired composing the one-shot follow-up-suggestion
  `question=` text to `ticket-drafting-escalation.md` (the role's first law reference, a single
  inline pointer, not a new repo-wide section); updated "How to raise one"'s "five kinds" language
  to "six kinds" to include `ticket-ambiguity`.
- `test/scripts/gather-escalation-context.test.sh` — added coverage for the new `ticket-ambiguity`
  kind's happy path and its missing-required-field failure path, mirroring the existing five
  kinds' test pattern.
- `scripts/concertino/gather-escalation-context.sh`, `scripts/concertino/README.md` — cycle-2 fix
  (evaluator change request 1): re-synced from the updated `core/scripts/` sources via
  `concertino sync` so the "installed copy" this repo's own orchestrator actually runs at runtime
  carries the new `ticket-ambiguity` kind. `node bin/concertino doctor` confirmed the drift before
  the fix and its absence after; `diff core/scripts/... scripts/concertino/...` is now empty for
  both files.
- `scripts/concertino/cleanup.sh` — incidental re-sync side effect of running `concertino sync`
  (comment-only correction, unrelated to CON-50's own change; this file's `core/` source was last
  touched by CON-33, not by this change) — running the sync the evaluator's fix explicitly asked
  for necessarily regenerates every file in `scripts/concertino/` from `core/scripts/`, not only
  the two named files, so this stale rendered copy was corrected as a side effect.
- `openspec/changes/force-escalation-ticket-ambiguity/workflow-state.md` — orchestrator/evaluator-
  managed run state (cycle counter, evaluator agent ID, cycle-1 verdict/report path); not edited
  by hand.
