## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Ticket requirements traced against artifacts** (`ticket.md` vs
   `proposal.md`/`design.md`/`tasks.md`/`specs/window-reaping/spec.md`, all
   read in full):
   - The trap ("do not reap on liveness alone") — addressed by Decision 1's
     selection predicate (`endStatus != null && window && !window.alive`),
     spec's "A run without a terminal event is never reaped" requirement, and
     `tasks.md` 4.2's explicit "dead+no-run.end is NOT selected... and, run
     through reducer.reduce, still resolves to `failed`" test — this is
     word-for-word the guarantee the ticket demands ("Any implementation
     needs a test asserting that a dead window with no `run.end` is never
     reaped, and still resolves to `failed`").
   - Scrollback preservation — `session.captureFull()` (task 1.1),
     `store.scrollbackPath()` (task 1.2), capture-then-kill ordering (task
     2.2, spec Requirement 3), tested at 4.3/4.4.
   - `__concertino__` / smoke-session exclusions — spec Requirement 4 covers
     both; design.md correctly argues both are structural, not new logic (see
     #2 below).
   - Second-decision writeup — Decision 3 directly answers the ticket's own
     conditional ("if [`run.end`] is genuinely the last thing emitted, (2) is
     safe and strictly better") by tracing Phase 4, with a specific,
     falsifiable finding.

2. **Codebase claims checked against the actual files**, not asserted:
   - `lib/ui/reducer.js` lines 151-152: `deriveStatus` reads exactly as
     quoted in the ticket and design.md (`if (run.endStatus) return ...; if
     (run.window && !run.window.alive) return 'failed';`).
   - `run.window` default is `null` (`emptyRun()`, reducer.js:46) and is only
     set (line 194) inside the loop over `windows` — i.e. only when
     `session.listWindows()` reports that ticket this poll. Confirms design's
     Decision 1/2 claims.
   - `endStatus` is set only in the `run.end` case of `applyEvent`
     (reducer.js:76-79) — confirms Decision 1's "non-null only once a
     `run.end` event has been parsed" claim.
   - `lib/ui/session.js`: `listWindows()` already does
     `.filter((w) => w.ticket !== PLACEHOLDER)` (line 88) — the `__concertino__`
     exclusion genuinely is structural, and is already tested
     (`test/session.test.js:20`: asserts zero `__concertino__` entries from
     `listWindows()`). `capture()` (no `-S`) vs the proposed `captureFull()`
     (`-S -`) is accurately characterized (Decision 4). `kill()` swallows all
     errors (line 133) — confirms Decision 2's idempotency/retry claim.
   - Smoke-session isolation: `test/scripts/watch-smoke.test.sh` spawns its
     own tmux sessions (`concertino-smoke-$$`, etc.), never `concertino`'s —
     confirms these windows structurally never appear in this session's
     `listWindows()` output, as design.md claims.
   - `lib/ui/retention.js`'s `hasRunEnd`/`isEligible`/`prune` match the
     "prior art" description in design.md's Context section exactly (same
     terminal-only-via-run.end safety predicate, whole-directory removal).
   - `.gitignore` line 4 confirms `.concertino/` is gitignored in full,
     supporting Decision 5's sensitivity argument.
   - `docs/dashboard.md` has a real `### Retention` section (line 192),
     confirming task 5.1's anchor point exists.

3. **Phase 4 trace verified directly**, the load-bearing claim behind
   Decision 3:
   - `core/scripts/cleanup.sh` line 201-202: emits
     `run.end status=delivered` as its last substantive action, immediately
     before printing `READY cleaned worktree=...` (line 204) — i.e. near the
     end of the script, as design.md states.
   - `core/roles/orchestrator.md` Phase 4 (lines 302-330): step 1 is
     `cleanup.sh` itself; step 2 ("Set the ticket to **Done** and post a
     closing comment") and step 3 (hygiene check) run **after** `cleanup.sh`
     returns, as separate orchestrator-driven steps in the same turn — i.e.
     the same still-running agent process, hence the same still-alive tmux
     window. This directly falsifies the ticket's speculative "if it is
     genuinely the last thing emitted" premise for policy (2), and
     design.md's conclusion (conservative-only, aggressive deferred) is the
     correct consequence of that finding, not a shortcut.

4. **Scope judgment (conservative-only vs. aggressive-with-grace-period):**
   The ticket's own phrasing ("Worth checking where `run.end` actually sits
   ... before choosing") frames this as an open investigation, not a mandate
   to build both policies. Decision 3 performs exactly that investigation and
   reaches a well-supported, falsifiable conclusion. The Non-Goals section's
   refusal to add a speculative config toggle ("no consumer" today) is a
   reasonable anti-scope-creep call, not an evasion — it names the concrete
   follow-up shape (`dashboard.reap.enabled` grace-period variant) rather
   than hand-waving it away. This is sound.

5. **Test list sufficiency (`tasks.md` §4):** 4.1 (captureFull), 4.2 (pure
   selection, including the mandatory "no run.end → never reaped, still
   failed" case run through the real reducer), 4.3 (capture-before-kill
   ordering + capture-failure-doesn't-block-kill against a fake session), 4.4
   (real-tmux end-to-end: window dies, reap, assert gone + scrollback on
   disk), 4.5 (wired into `draw()` once, after `reduce()`, against a spy
   session). This set directly proves the ticket's required guarantee via a
   real `reducer.reduce()` call (not a re-implemented assertion), and covers
   both the pure and impure halves of the module plus the poll-loop wiring.
   No missing coverage found for anything the ticket or spec requires.

No `TODO`/`TBD`/placeholder language found in any of the four planning
artifacts (`grep -rniE` search came up empty). No internal contradictions
between proposal/design/tasks/spec. No AC in `ticket.md` left uncovered by a
task.

### Verdict: CONFIRM

### Non-blocking notes

- A window a human kills manually via the drilldown's `kill-confirmed`
  action (`lib/ui/control.js`) will never emit `run.end` either, so under
  this design it is never auto-reaped and remains a stray until closed by
  hand again — correct per the ticket's own invariant, but worth one
  sentence in `docs/dashboard.md` (task 5.1) so an operator doesn't expect
  auto-reap to clear windows they killed themselves.
- The ticket's "~47 lines, bounded" scrollback-capture cost claim is
  premised on Claude Code's alt-screen-buffer behavior; if a non-Claude-Code
  harness (e.g. `codex`, referenced elsewhere in this codebase) does not use
  the alternate screen buffer, `capture-pane -S -` could be materially larger
  per reap. Not a blocker (the ticket itself asserts the boundedness premise,
  and Decision 5 already treats the write as best-effort/non-blocking), but
  worth a passing mention if it turns out to matter in practice.
