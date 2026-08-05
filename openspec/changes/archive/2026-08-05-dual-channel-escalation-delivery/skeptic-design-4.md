## Skeptic Report — design gate (round 4, human-authorized extension)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `skeptic-design-1.md`,
  `skeptic-design-2.md`, `skeptic-design-3.md`, `workflow-state.md`, and all five
  spec deltas (`escalation-bubble-up`, `escalation-answer-cli`,
  `escalation-trust-offramp`, `inline-orchestrator-mode`,
  `orchestrator-turn-discipline`) fresh, cold, without assuming any prior
  round's fixes were correctly applied.
- Re-read `scripts/concertino/emit-event.sh` in full (all 575 lines), including
  the exact poll-loop code (lines 481-564) that `--wait-only`/the Decision 4a
  confirming call are specified to reuse unmodified.
- Read `lib/ui/store.js:199-296` (`writeAnswer`/`writeSubAnswer`) to ground any
  claim about what a `concertino answer --sub/--total` write actually returns.

**Rounds 1-3's fixes — re-verified present and internally consistent, not just
asserted.**
- Round 1 (stale-discard reuse / no per-call return code): `design.md`
  Decisions 1/1a/1b, `tasks.md` 1.3, and `specs/escalation-bubble-up/spec.md`'s
  "`--wait-only` returns exit 2..." and "does not discard a dashboard answer
  written between two calls" scenarios all match, and match the real
  `write_escalation_raised()`/discard-block code at `emit-event.sh:301-419` and
  `:486-498`. Closed.
- Round 2 (unconditional `TERM`/`INT` trap): `design.md` Decision 1c, `tasks.md`
  1.3/1.4, and `specs/escalation-bubble-up/spec.md`'s "signal killing a
  `--wait-only` call never records a terminal timeout" requirement all agree,
  and correctly diverge from the real `on_kill` trap at `emit-event.sh:474-479`.
  Closed.
- Round 3 (no writer of `escalation.answered` when chat wins): `design.md`
  Decision 4a, `tasks.md` 4.3/7.2, and `specs/escalation-bubble-up/spec.md`'s
  "The root presents immediately and resolves via both channels" requirement
  plus its "A chat answer resolves the wait and is confirmed by one immediate
  `--wait-only` call" and "A chat-resolved escalation clears `run.escalation`
  on the dashboard" scenarios are now mutually consistent (the tasks.md 7.2 vs.
  spec.md contradiction round 3 found is gone — both now describe the
  confirming call). This is the mechanism the human asked me to look hard at.

### A new gap in Decision 4a itself: the confirming call is not guaranteed to
resolve for a multi-part (CON-46 wizard) chat sub-answer, and nothing says
what the root does when it doesn't

I traced Decision 4a's confirming-call claim against the actual multi-part
branch of the poll loop it reuses, not just the prose.

**Decision 4a's literal claim (`design.md:69`):** "the root SHALL make exactly
one more `--wait-only max_wait_sec=<small>` call for the same ticket before
resuming the orchestrator: **that call finds `answer.json` already present,
resolves immediately** (no real waiting — the file is already there)."
`specs/escalation-bubble-up/spec.md`'s corresponding scenario (line 92-95)
repeats this unconditionally: "...then immediately makes one more `--wait-only`
call which finds `answer.json` already present **and resolves exit 0** without
any real wait."

**Why that claim is false for a multi-part chat sub-answer.** This design's
own `escalation-answer-cli` capability explicitly supports answering *one*
step of a multi-part escalation via chat: `concertino answer <ticket> <value>
--sub <index> --total <n>` calls `writeSubAnswer` (`escalation-answer-cli/spec.md`
lines 4/10-12, `tasks.md` 2.1/2.4), and the proposal's own Non-Goal section
states this is deliberate — "chat is not a strictly weaker channel" for
multi-part escalations (`design.md:24`). `writeSubAnswer`
(`lib/ui/store.js:255-282`) only sets `complete: true` when *every* slot is
non-null (`complete = subAnswers.length === total && subAnswers.every((a) =>
a != null)`) — a single sub-answer to one of several questions returns `{ok:
true, complete: false}`. The (unmodified, per Decision 1/1b) multi-part branch
of the poll loop `--wait-only` reuses (`emit-event.sh:504-542`) resolves
(writes `escalation.answered`, exits 0) **only** when `a.complete === true`; a
parseable `answer.json` with `complete: false` is "treated identically to the
file not existing yet: keep polling" (this exact framing is even quoted
verbatim in `emit-event.sh`'s own comment at line 505-509, and restated in
`design.md:45`).

So: for a multi-part escalation, if the human answers **one but not the last**
sub-question via a direct chat reply, `concertino answer ... --sub --total`
succeeds, but Decision 4a's confirming `--wait-only` call will **not** find a
`complete: true` payload — it will poll for its own `max_wait_sec` budget and
return **exit 2** ("still open"), not exit 0. This directly contradicts
Decision 4a's and the spec scenario's unconditional "resolves immediately
exit 0" claim, and — more importantly — **nothing in `design.md`, `tasks.md`,
or any spec delta says what the root does when this specific confirming call
returns exit 2 instead of exit 0.** Decision 4a and `tasks.md` 4.3 both phrase
the confirming call as a single deterministic step immediately followed by
"proceed to resume the orchestrator," with no conditional branch on its exit
code — unlike Decision 3's *general* loop, which is explicitly gated on exit
code ("looping again on exit code 2, stopping on exit 0 or exit 1").

**The observable consequence, either way an implementer resolves the
ambiguity:**
- If they follow Decision 4a literally as an unconditional "confirm, then
  resume" pipeline, the root resumes the bubbled orchestrator with a
  **partial, incomplete** multi-part answer — a direct regression of the
  CON-46 wizard contract, which this ticket's own AC list says must not be
  regressed ("the multi-part wizard path (CON-46)... are not regressed"). The
  orchestrator would be resumed believing the escalation is answered when
  `total - 1` sub-questions are still unanswered.
- If they instead notice the mismatch and improvise a fix (e.g., "on exit 2
  from the confirming call, go back to the main polling loop"), that is
  exactly the kind of implementation-blocking ambiguity a design gate exists
  to catch rather than leave to be invented mid-task — nothing tells them this
  is even a legitimate outcome of "a successful `concertino answer` write," so
  they cannot tell whether exit 2 here is a bug in their own implementation or
  expected behavior.

This is a genuinely new defect in exactly the piece of control flow the human
asked me to scrutinize (Decision 4a) — round 3 introduced the confirming call
to fix the single-question chat-wins case, but its wording (and the spec
scenario built from it) implicitly assumes every successful `concertino
answer` write is terminal, which round 1-3's own established fact base
(`--wait-only`'s multi-part branch, already documented in Decision 1b/design.md:45)
directly contradicts.

**Required fix:**
1. Add an explicit clause to Decision 4a (or a sibling sub-decision, e.g. 4b)
   stating: the confirming `--wait-only` call is only guaranteed to resolve
   exit 0 immediately when the chat-given answer is either (a) a single-question
   escalation's answer, or (b) the sub-answer that completes the last remaining
   slot of a multi-part escalation. For any other multi-part sub-answer
   (`writeSubAnswer`'s `complete: false`), the confirming call correctly
   returns exit 2 — this is expected, not an error — and the root MUST NOT
   proceed to resume the orchestrator in that case; instead it falls back into
   its normal Decision 3 polling loop (continuing to wait on the remaining
   sub-questions, answerable via either channel) exactly as if no confirming
   call had been made. The root only resumes the orchestrator once some
   `--wait-only` call — confirming or ordinary — actually returns exit 0.
2. Update `specs/escalation-bubble-up/spec.md`'s "A chat answer resolves the
   wait and is confirmed by one immediate `--wait-only` call" scenario to scope
   its "resolves exit 0 without any real wait" claim to the single-question/
   final-sub-answer case, and add a new scenario ("A partial multi-part chat
   sub-answer does not resolve the wait") covering the `complete: false` case
   and stating the root continues normal polling rather than resuming the
   orchestrator.
3. Update `tasks.md` 4.3 to state the confirming call's outcome is
   conditional (exit 0 → proceed to resume; exit 2 → resume normal polling,
   do not resume the orchestrator), and extend 7.2's verification trace with a
   multi-part branch: write a non-final `concertino answer --sub --total`,
   confirm the confirming call returns exit 2 and no `escalation.answered` is
   recorded, confirm the root's procedure does not resume the orchestrator at
   that point, then complete the remaining sub-answer(s) and confirm resolution
   proceeds normally afterward.

### Verdict: REFUTE

### Change Requests

1. Close the multi-part/partial-chat-sub-answer gap in Decision 4a's
   confirming-call mechanism described above: add the conditional-outcome
   clause to `design.md` (sibling to 4a), correct
   `specs/escalation-bubble-up/spec.md`'s "confirmed by one immediate
   `--wait-only` call" scenario to scope its unconditional "resolves exit 0"
   claim and add the missing "partial multi-part sub-answer" scenario, and
   update `tasks.md` 4.3/7.2 to reflect the conditional continuation — per the
   "Required fix" above.

### Non-blocking notes

- Everything else — the `--wait-only`/`--await`/`--raise-only` split
  (Decisions 1/1a/1b/1c/2/3), the recursive bubble/relay protocol (Decisions
  5-8), the `concertino answer` CLI's delegation to `store.js` (Decision 4),
  and the `escalation-trust-offramp`/`inline-orchestrator-mode`/
  `orchestrator-turn-discipline` spec deltas — remains internally consistent,
  correctly grounded in the real code, and closes all three prior rounds'
  findings with no regressions introduced by those fixes. This round's finding
  is narrow and additive, specifically inside the new Decision 4a machinery
  the human asked me to focus on.
