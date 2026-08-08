## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Finding 1 (`stateTypesFromConfig` duplication) — confirmed accurate.**
   Read `lib/ui/tickets/local.js:245-251` — the comment ("this is linear.js's
   logic reused rather than reimplemented") sits directly above a verbatim
   reimplementation of the function body. Read `lib/ui/linear.js:420-426` —
   the two function bodies are byte-identical (`(config && config.dashboard
   && config.dashboard.launchPad) || {}`; same `backlog === false` filter).
   `linear.js`'s `module.exports` (line 577) already exports
   `stateTypesFromConfig`, and `local.js` already imports two sibling names
   (`deriveEpics`, `OPEN_STATE_TYPES`) from the same module at line 20 — so
   Decision 1's proposed one-line destructure extension is exactly the
   pattern already in use, not a new one. `lib/ui/watch.js:390` is the sole
   call site (`linear.stateTypesFromConfig(config)`, via the resolver, not
   `local.js` directly) — the design's claim that the fix is call-site-inert
   holds.

2. **Finding 2 (`STATES` duplication) — confirmed accurate.**
   `lib/ui/tickets/local.js:28`: `const STATES = ['backlog', 'unstarted',
   'started', 'completed', 'canceled'];`. `core/scripts/set-ticket-state.sh:37`:
   `STATES="backlog unstarted started completed canceled"`. Same five values,
   same order, two independent literals, no coupling test. Read
   `test/scripts/ticket-pattern.test.sh` in full — it is a real, working
   precedent for exactly the shape Decision 2 proposes (extract per-file,
   byte-compare, assert identity across copies, plus a self-verifying
   accept/reject exercise of the pattern itself) — a sound model to clone for
   `STATES`.

3. **Finding 3 (`<tickets-dir>` argument vs. Decision 3) — confirmed accurate.**
   Read the design doc
   (`docs/superpowers/specs/2026-08-07-local-ticket-provider-design.md`):
   Decision 3 literally says "The path is fixed, not configurable" (line 150);
   Decision 6 literally specifies `set-ticket-state.sh <TICKET_ID> <state>`
   (line 245) — two arguments. The shipped script's actual usage line (line 13)
   and its `[ "$#" -eq 3 ]` gate (line 41) confirm it takes three:
   `<tickets-dir> <TICKET_ID> <state>`. `lib/cli/render.js:143` confirms the
   one production call site always renders the literal string `tickets` as
   the first argument — the contradiction is real but currently inert, exactly
   as both the ticket and design.md claim.

4. **README gap — confirmed accurate.** `core/scripts/README.md`'s Scripts
   table (lines 47-57) lists nine scripts; `set-ticket-state.sh`,
   `check-merge-readiness.sh`, and `next-report-number.sh` are all absent.
   Read `core/scripts/check-merge-readiness.sh` and
   `core/scripts/next-report-number.sh`'s own usage comments — Decision 4's
   proposed `Args` column text (`<WORKTREE_PATH> <BRANCH> <TICKET_ID>` and
   `<change-dir> <kind>`) matches each script's actual signature exactly, not
   an invented approximation.

5. **Regression-test target confirmed to exist as claimed.** Read
   `test/scripts/local-provider-render.test.sh:42` —
   `has "names the write-back script" 'set-ticket-state.sh' "$ORCH"` is the
   exact anchor line design.md Decision 3 says the new assertion will be
   added after. Design.md's proposed new assertion text (pinning
   `set-ticket-state.sh tickets "$TICKET_ID"`) is consistent with how the
   existing `has`/`hasnt` helpers in that file already work (substring match
   against the rendered orchestrator file).

6. **AC-to-task traceability.** All four ACs in `ticket.md` map 1:1 onto
   tasks.md sections 1-4 (re-export, drift test, Decision-3 reconciliation,
   README rows), plus section 5 (new capability spec, already drafted and
   present) and section 6 (verification). No AC is left uncovered by any
   task, and no task does work beyond an AC — the proposal's explicit
   Non-Goals section (rewriting the ~30-case shell test suite to `cd` instead
   of taking a directory argument; moving `linear.js` into `providers/`; any
   behavioral change to the vocabulary or write-back mechanics) correctly
   fences off adjacent, larger changes the ticket does not ask for.

7. **No placeholders/hand-waving.** `grep`'d all planning artifacts for
   `TODO|TBD|figure out|placeholder|XXX` — no hits. Every decision names its
   concrete file, line range, and exact text to add (Decision 1's destructure
   line, Decision 2's extraction commands, Decision 3's exact "Exception"
   paragraph, Decision 4's exact table rows).

8. **Spec delta present and structurally sound.** `specs/local-provider-drift-guard/spec.md`
   exists with three ADDED Requirements, each with WHEN/THEN scenarios that
   map to the three code-level findings — no missing contract-update gap.

### Verdict: CONFIRM

The design is internally consistent, every factual claim about current
repository state (line numbers, file contents, call sites, existing test
precedent, other scripts' actual usage lines) checks out against the live
worktree, and the four ACs are each traceable to a specific, unambiguous,
non-hand-wavy task. Decision 3's "document, don't remove" resolution is a
reasoned trade-off with its risk explicitly named and mitigated (script's own
header comment gets the exception too, not just the design doc) rather than
silently swept aside.

### Non-blocking notes

- Decision 1 proposes dropping the misleading comment at `local.js:245-246`
  entirely rather than updating it to also name `stateTypesFromConfig`
  alongside `deriveEpics`/`OPEN_STATE_TYPES` in the file's top-of-file
  comment (lines 14-16, which currently only names those two). Not required
  by any AC, but the executor may want to fold `stateTypesFromConfig` into
  that top comment's list while touching the area, for a reader who never
  scrolls to the `require` line.
- The "~30 cases" figure design.md cites for
  `test/scripts/set-ticket-state.test.sh` is an approximation (I counted
  roughly 50 individual `check`/`ok` assertions, though scenario/case count
  depends on how one groups them) — immaterial to the decision, since the
  chosen resolution is "don't touch this file's shape" either way.
