## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/escalation-context/spec.md` in full.
- Traced every ticket AC to a design decision + task + spec scenario:
  - AC1 (context payload on `escalation.raised`) → design.md Decision 3,
    tasks 2.1-2.7, spec.md requirements 2-3.
  - AC2 (orchestrator gathers via script, no new decision point) → design.md
    Decision 5, tasks 4.1-4.3, spec.md requirement 5.
  - AC3 (screen renders above options, degrades honestly) → design.md
    Decision 4, tasks 3.1-3.3, spec.md requirement 6.
  - AC4 (4000-byte cap respected, visible truncation, consider file-beside-log
    per CON-10) → design.md Decision 3 (all 5 numbered sub-steps), tasks
    2.2-2.5, spec.md requirement 3 (4 scenarios).
  - AC5 (tests: with context / without / oversized) → tasks 5.1-5.4.
  - No AC is left uncovered; no task exists outside the ticket's stated scope.
- Verified `MAX_LINE=4000` and `write_line`'s existing byte-cap/fallback logic
  against `core/scripts/emit-event.sh:27,147-157` — matches design.md's
  description exactly (LC_ALL=C byte count, drop-to-`truncated:true` last
  resort that Decision 3 step 5 explicitly falls through to).
- Verified `persist-evidence.sh` (`core/scripts/persist-evidence.sh`) —
  destination `<main checkout>/.concertino/runs/<TICKET_ID>/evidence/`,
  basename-keyed, `READY ref=`/`FAIL` contract, omits ref on failure — matches
  design.md's reuse claim and CON-10/`evidence-telemetry` spec.md verbatim.
  `core/scripts/emit-event.sh` and `scripts/concertino/emit-event.sh` are
  byte-for-byte identical today (`diff` empty) — confirms the "mirrored
  byte-for-byte" convention the proposal invokes is real, not asserted.
- Verified `lib/ui/reducer.js`'s current `escalation.raised` case (lines
  119-129) and `lib/ui/screens/escalation.js`'s current render (lines 30-112)
  match design.md's description of "what exists today" exactly — the planned
  additive fields (`context`/`contextTruncated`/`contextRef`) and render
  insertion point (between question and options) are consistent with the real
  code, not a stale assumption.
- Verified `lib/ui/screens/drilldown.js:205`'s EVIDENCE-panel convention
  (`f.truncate('  ' + (ev.label || ev.ref || '(untitled)'), width)`) cited in
  design.md's Non-Goals section is quoted correctly.
- Verified `core/roles/orchestrator.md`'s "How to raise one" (lines 296-338)
  and "Always reaches the human" (lines 348-356) sections — found the
  generic, single `emit-event.sh escalation --await` template the design
  proposes inserting one step above, and found the escalation-trigger list
  actually has **4** bullets (Planning ESCALATION / Budget exhausted /
  BLOCKER / Contradiction), not 5 — see Non-blocking notes.
- Ran `openspec validate escalation-context-payload --strict` myself:
  `Change 'escalation-context-payload' is valid` (exit 0) — the change
  structure is mechanically sound.
- Ran `openspec validate --change "escalation-context-payload"` (the literal
  command tasks.md §6.1 tells the executor to run): it errors —
  `error: unknown option '--change' (Did you mean --changes?)`. Confirmed
  this is a pre-existing typo pattern elsewhere in the repo (one archived,
  already-shipped change's tasks.md has the identical `--change` mistake), so
  it is not novel to this change and did not block that change from shipping
  — flagged as a non-blocking nit rather than a design flaw.
- Confirmed no existing spec in `openspec/specs/` (`evidence-telemetry`,
  `gate-telemetry`, `phase-telemetry`, `orchestrator-turn-discipline`)
  currently governs `escalation.raised`'s payload — proposal.md's "no existing
  spec currently governs" claim (used to justify listing no Modified
  Capabilities) is accurate.

### Verdict: CONFIRM

The design is sound, internally consistent, and directly answers both traps
named in the ticket:
- **4000-byte cap:** Decision 3's build-then-measure, truncate-`context`-first,
  fall-through-to-existing-last-resort sequence is a correct and complete
  strategy against the real `write_line` implementation, and it explicitly
  protects `question`/`options` from ever being sacrificed to make room.
- **Path durability across `cleanup.sh --phase4`:** the design reuses
  `persist-evidence.sh`/`.concertino/runs/<TICKET>/evidence/` verbatim rather
  than inventing a second mechanism, per the ticket's explicit steer, and
  correctly threads the "omit the ref rather than emit a dangling one" failure
  discipline CON-10 established.

No placeholders, no deferred decisions that block implementation, no
uncovered acceptance criterion, and no scope drift beyond the five listed
impact areas.

### Non-blocking notes

1. design.md's Decision 5 rationale states the ticket's five context kinds
   "map onto the same five circuit-breaker/escalation triggers already in the
   role doc." Ground truth (`core/roles/orchestrator.md`'s "Always reaches
   the human", lines 348-356) has **4** bullets, not 5, and one bullet
   ("Planning ESCALATION: new external dependency, major architectural
   change, breaking API change, or scope significantly beyond the ticket")
   bundles two of the ticket's five kinds together with two scenarios
   (architectural change, scope drift) that map to none of
   `gather-escalation-context.sh`'s five kinds at all. This does not leave a
   real implementation gap — tasks.md §4.2 and spec.md's "gathering context
   is not applicable or fails → raise without `context=`" fallback already
   cover exactly this case — but the rationale text overstates the mapping's
   cleanliness and could mislead whoever edits the role doc into thinking
   every escalation trigger has a 1:1 kind. Worth a one-line correction before
   or during execution so the role-doc edit doesn't get written as if a kind
   always applies.
2. tasks.md §2.3's parenthetical — "(invoked as a sibling script, same
   pattern `emit-event.sh` already uses for `main_checkout()`'s duplicated
   logic)" — is self-contradictory: `main_checkout()` is **duplicated code**
   (no runtime call between the two scripts), not a sibling-script
   invocation. design.md's Decision 3 is unambiguous that `emit-event.sh`
   should call `persist-evidence.sh` as a command, so this doesn't block
   implementation, but the parenthetical should be fixed (or dropped) so an
   implementer doesn't copy the wrong precedent when resolving how
   `emit-event.sh` locates the sibling script path.
3. tasks.md §6.1's literal validation command (`openspec validate --change
   "escalation-context-payload"`) does not match the installed CLI's syntax
   (confirmed above). Should read `openspec validate
   escalation-context-payload --strict`, which I confirmed passes.
4. Neither design.md nor tasks.md mentions cleaning up the temp file that
   holds the full context before/after calling `persist-evidence.sh` on it —
   a minor leak into `/tmp` (or wherever it's created), not a correctness or
   durability issue since the durable copy is what matters.
