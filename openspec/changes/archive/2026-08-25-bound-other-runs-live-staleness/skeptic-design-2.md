## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-read all three revised artifacts and re-checked each round-1 change request against ground
truth (`core/scripts/cleanup.sh:405-434`, `test/scripts/cleanup.test.sh:500-570`,
`lib/ui/retention.js`).

- **CR1 (false retention claim) — resolved, and correctly.** `design.md`'s Context now carries an
  explicit "Correction from design-gate round 1" paragraph naming `lib/ui/retention.js`,
  `lib/cli/prune.js` and the `lib/ui/watch.js:218` auto-invoke, and states the real load-bearing
  reason (`retention.isEligible()` requires `hasRunEnd()`, so the stuck-marker case is exactly what
  retention deliberately never prunes). That matches `lib/ui/retention.js` as I read it in round 1.
  The inverted in-code comment is flagged in the same paragraph *and* given its own task (1.4) with
  an explicit "do not carry the inverted claim forward" instruction. I re-read
  `core/scripts/cleanup.sh:413-420` and confirmed the inverted text ("stays 'live' by this test
  until its run dir is pruned (lib/ui/retention.js prunes exactly those, by mtime)") is still
  present verbatim at those lines, so the task's quoted target is accurate and the line range is
  right.

- **CR2 (unparsable/missing `t`) — resolved.** `design.md` Decision 5 specifies fail-closed-to-LIVE
  with the reasoning (torn concurrent append is most likely under a genuinely live run), and also
  adopts the suggested backwards-scan-to-last-parseable-line rather than a blind `tail -1`.
  The spec's Requirement text carries the same rule normatively ("SHALL be treated as live ...
  never as not-live") and a fourth `#### Scenario: An unparsable last-event timestamp fails closed
  to live` was added. `tasks.md` 1.2 implements it and 2.2's fifth bullet covers it as a permanent
  regression case. All three artifacts now agree; no reading is left open.

- **CR3 (existing suite / fixture / worktree re-render) — resolved.** `tasks.md` section 2 now
  names `test/scripts/cleanup.test.sh` directly, and 2.1 parameterises `fake_event()`'s hardcoded
  timestamp defaulting to now. I re-confirmed the hazard is real and correctly located:
  `fake_event()` is defined at line 526 and the CON-66 section runs 502-570, with `TICK-88`
  `run.start`-only at 538 (the case that would flip) and the `run.end` pair at 555-556 (the case
  2.2's third bullet guards). 2.2 adds five permanent cases covering all three spec scenarios plus
  the CR2 case plus the env override; the throwaway fixtures are now RED evidence (2.3) rather than
  the whole regression story, with GREEN (2.4) and full `npm test` (2.5) separated. The hedge
  "if any exist" is gone. Task 1.5 now correctly scopes the re-render to *this worktree's*
  `scripts/concertino/cleanup.sh` (with the reason: the suite executes the rendered copy) and
  requires both files be committed together — no mutation of the main checkout.

- **No new problems introduced by the revision.** The added Decision 5, the new spec Scenario and
  the new tasks are internally consistent with each other and with Decisions 1/3/4; the ADDED
  Requirement's four scenarios now exhaustively partition the decision space (stale, recent,
  run.end-present, unparsable). No placeholders, TODOs or deferred decisions remain; Open Questions
  is empty and legitimately so.

### Verdict: CONFIRM

### Non-blocking notes

- `design.md`'s Non-Goals still quotes the ticket's "worth confirming... doesn't appear to run
  anywhere" about pruning without re-flagging that the Context correction supersedes the premise of
  that quote. The Non-Goal itself (don't build retention here) is still right, and Context now says
  the true state four paragraphs above — but a reader skimming only Non-Goals could re-absorb the
  round-1 error. A half-clause ("see the Context correction — it does run, it just can't prune
  run.end-less runs") would close that.
- Round-1's note on broadening `openspec/specs/cleanup-sync-guard/spec.md`'s `## Purpose` line was
  not taken up. Still non-blocking, still worth doing at archive time.
- Task 2.3's RED capture offers "temporarily reverting the staleness check" as an option; the
  throwaway-checkout option is cleaner and less likely to leave a half-reverted file behind.
  Executor's choice, not a blocker.
