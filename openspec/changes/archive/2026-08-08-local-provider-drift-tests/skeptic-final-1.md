## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **`stateTypesFromConfig` is a genuine re-export, not a reimplementation.**
   `lib/ui/tickets/local.js:20` now destructures `stateTypesFromConfig` from
   `require('../linear')` alongside `deriveEpics`/`OPEN_STATE_TYPES`; the
   old duplicated function body (previously ~lines 245-251) and its
   misleading comment are gone (`git diff 6160ba3..0090406 -- lib/ui/tickets/local.js`
   shows only a −8/+1 net removal, no new function defined). `local.js`'s
   `module.exports` (line 300) still exports the name unchanged.
   `lib/ui/linear.js:420` is the sole remaining *definition*
   (`grep -n stateTypesFromConfig` across `lib/ui/*.js lib/ui/tickets/*.js`
   shows exactly one `function stateTypesFromConfig` declaration). The one
   call site (`lib/ui/watch.js:390`) calls `linear.stateTypesFromConfig`
   directly and is unaffected either way.

2. **The `STATES` drift test genuinely couples the two copies — proven by mutation, not just read.**
   Ran `test/scripts/ticket-state-vocabulary.test.sh` standalone: 6/6 pass.
   Then deliberately mutated `lib/ui/tickets/local.js`'s `STATES` array to
   drop `'canceled'` and re-ran the same test: it failed on exactly the two
   assertions that should fail ("STATES have drifted" and "do not match the
   expected order"), 4 passed / 2 failed, exit 1. Restored the file
   (`git diff` on `local.js` confirmed clean afterward). This is a real,
   reproduced demonstration that the test would catch actual drift, not
   just self-verifying fixtures asserting today's state.
   `core/scripts/set-ticket-state.sh:46` carries `STATES="backlog unstarted
   started completed canceled"`, matching `lib/ui/tickets/local.js:28`'s
   array exactly. The suite is wired into `package.json`'s `test` script
   (confirmed in the diff, next to `ticket-pattern.test.sh`).

3. **Decision 3's documented exception is present, consistent, and the pinning regression test is real.**
   `docs/superpowers/specs/2026-08-07-local-ticket-provider-design.md` gains
   the exact "Exception:" paragraph design.md's Decision 3 specifies,
   inserted directly after "The path is fixed, not configurable." — matches
   verbatim. `core/scripts/set-ticket-state.sh`'s header comment (lines
   14-21) gains the matching pointer. `lib/cli/render.js:143` — the one
   production call site — renders the literal
   `set-ticket-state.sh tickets "$TICKET_ID"`, matching what the design doc
   claims. `test/scripts/local-provider-render.test.sh` gains a new `has`
   assertion pinning exactly that literal string; ran it standalone (11/11
   pass, including the new assertion by name: "pins the write-back call to
   the literal tickets-dir argument").

4. **README table update is accurate.** `core/scripts/README.md`'s Scripts
   table gains three rows (`set-ticket-state.sh`, `check-merge-readiness.sh`,
   `next-report-number.sh`). Cross-checked each row's `Args` column against
   the named script's own usage/header comment:
   `check-merge-readiness.sh` (`<WORKTREE_PATH> <BRANCH> <TICKET_ID>`),
   `next-report-number.sh` (`<change-dir> <kind>`), and
   `set-ticket-state.sh` (`<tickets-dir> <TICKET_ID> <state>`) — all match
   the scripts' actual usage comments exactly, no invented approximation.

5. **Acceptance criteria traced end-to-end** against `ticket.md`'s four ACs —
   all four map to concrete, verified diff content (points 1-4 above). No AC
   left unaddressed; no scope drift (`git diff main...HEAD --stat` for the
   commit's own files touches only what `files-modified.md` and the design
   doc describe, plus this change's own openspec artifacts).

6. **Gates re-run fresh, not trusted from the evaluator's report.**
   `openspec validate --changes local-provider-drift-tests --strict` →
   `✓ change/local-provider-drift-tests`, 1 passed, 0 failed.
   Full `npm test` (ran to completion under `timeout 280`, ~2 min once
   Playwright's package cache was warm — matches the evaluator's noted
   one-time environmental hang, not attributable to this change): final
   tally `# tests 1681`, `# pass 1681`, `# fail 0`, and every bash suite in
   the `test` script's chain individually reports `N passed, 0 failed`
   (spot-checked `ticket-state-vocabulary.test.sh` 6/6,
   `local-provider-render.test.sh` 11/11, `set-ticket-state.test.sh` 54/54).
   Grepped the full log for `FAIL`/`not ok` outside "0 failed" lines — every
   hit is a test-name string (e.g. "FAIL printed to stderr"), not an actual
   failure.

7. **No UI review applicable** — this ticket's change is entirely
   library/script/doc-level (drift tests, a re-export, doc reconciliation);
   no UI is configured for this project per the task brief, and this diff
   touches no rendered screen.

### Verdict: CONFIRM

Every AC traces to real, independently-verified code and passes a fresh
re-run of the gates, including a mutation test proving the new drift test
would actually catch regression rather than just describing itself as doing
so. Decision 3's exception is documented in both required locations and
pinned by a real, passing regression test matching the one true production
call site. The evaluator's PASS report's factual claims (line numbers, test
counts, call sites) all check out against ground truth.

### Non-blocking notes

- Same as the design-gate skeptic and the evaluator both already noted:
  `lib/ui/tickets/local.js:14-16`'s top-of-file comment still lists only
  `deriveEpics`/`OPEN_STATE_TYPES` as "reused from" `linear.js`, not the
  newly-added `stateTypesFromConfig`. Cosmetic, not required by any AC.
