## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `skeptic-design-1.md`,
  `skeptic-design-2.md`, and all five spec deltas (`escalation-bubble-up`,
  `escalation-answer-cli`, `escalation-trust-offramp`, `inline-orchestrator-mode`,
  `orchestrator-turn-discipline`) fresh, cold, without assuming either prior
  round's fixes were correctly applied.

**Round-2 fix (no kill-signal trap for `--wait-only`) — confirmed present and
consistent.** `design.md` Decision 1c (lines 47-51) states `--wait-only`
installs no `on_kill`-style trap; the Risks section (line 102) restates the
mitigation; `tasks.md` 1.3/1.4 both specify it (including a dedicated
regression-test entry: "a `--wait-only` process sent `TERM`/`INT` mid-poll
exits without writing `escalation.timeout`..."); and
`specs/escalation-bubble-up/spec.md` adds a full requirement ("A signal
killing a `--wait-only` call never records a terminal timeout on its own")
with three scenarios matching the decision exactly. I re-read
`scripts/concertino/emit-event.sh:460-479` and confirmed the real trap this
design must diverge from (`on_kill` at line 474, installed at line 479) is
accurately described. This item is closed.

**Round-2 non-blocking note (`sub_questions`/`total` dual mechanism) —
confirmed fixed.** Design.md Decision 1b now states detection is "read from
the same already-logged `escalation.raised` event in `events.jsonl` ...
never from a separately-supplied `total=` argument, so there is exactly one
mechanism, not a choice between two." `tasks.md` 1.3 restates this with the
same "never a separately-supplied `total=` argument" wording. Consistent.

**Round-1 items (stale-discard reuse, missing per-call return codes) —
re-checked, still sound**, unchanged in substance since round 2's
confirmation.

### A new gap: no code path ever records `escalation.answered` when the chat
channel wins the race

I traced the "chat answer resolves the wait" path all the way through the
actual code it will build on, not just the prose, and found a concrete,
reproducible correctness gap that is new to this round (rounds 1-2 were both
scoped to `--wait-only`'s poll-loop mechanics; this is about the CLI/root
resolution path).

**The invariant in the existing code:** `writeAnswer`/`writeSubAnswer`
(`lib/ui/store.js:211-296`) write `answer.json` only. They never append
`escalation.answered` to `events.jsonl` — the code comment at
`store.js:199-206` says so explicitly: *"`emit-event.sh --await`, blocked in
its poll loop, is the reader; it records `escalation.answered` itself once it
picks the file up, so this function does not also emit that event."* I
confirmed this in `emit-event.sh` itself: the only place `escalation.answered`
is ever written is inside the poll loop, after it observes `$ANSWER_FILE`
(lines 543-561, and the multi-part branch at 519-527) — i.e., **only the
process actively polling** ever records the terminal event. This is exactly
mirrored in the *existing* manual chat-fallback path already documented in
`core/roles/orchestrator.md` (lines 798-804): when the orchestrator gets an
answer from chat with no poller running, the role doc explicitly instructs it
to call `emit-event.sh escalation.answered ... || true` itself — "record it
yourself, since nothing else will" — precisely because it knows no other
writer exists.

**Why the new design breaks this for the chat-wins case:** Decision 4's
`concertino answer` CLI is explicitly scoped to delegate *only* to
`writeAnswer`/`writeSubAnswer` (`escalation-answer-cli/spec.md`: *"SHALL
contain no independent logic for constructing or locking `answer.json` —
all read-modify-write and atomicity behavior SHALL remain solely in
`lib/ui/store.js`'s existing exports"*) — so it never writes
`escalation.answered`. And the root's own resolution procedure explicitly
skips the one call that would otherwise pick it up:
`specs/escalation-bubble-up/spec.md`'s "A chat answer resolves the wait"
scenario states verbatim: *"the root writes that answer through `concertino
answer` and treats the escalation as resolved, **without waiting for a
further `--wait-only` call to confirm it**."* No other step anywhere in
design.md, tasks.md, or any spec delta ever records `escalation.answered` for
this path — I grepped all of them for `escalation.answered`/`reducer` and the
only remaining mentions are (a) `--wait-only`'s own exit-0 case, which by
construction never fires on this path since the design explicitly forgoes
that call, and (b) the *pre-existing* manual-fallback text in
`orchestrator.md`, which this new design doesn't route the chat-answer case
through.

**The observable consequence:** `lib/ui/reducer.js:151-188` sets
`run.escalation` on `escalation.raised` and clears it back to `null` **only**
on `escalation.answered` or `escalation.timeout` — no other event kind
touches it. `deriveStatus` (line 206-207) reports `needs-you` whenever
`run.escalation` is set and the run's window is alive. So: an escalation
resolved via a direct chat reply (the very channel this ticket adds as a
first-class peer path) leaves the dashboard showing `needs-you` — the exact
"a human must still act on this" signal — **indefinitely**, even though the
orchestrator has already been resumed with the answer and is actively
continuing the run. This is not a cosmetic gap: it is precisely the kind of
events.jsonl/dashboard-state mistrust this project has already been burned by
once (CON-71, this ticket's own grounding incident, and a pattern noted
independently in this project's history of escalation-answer visibility
bugs) — a stale `needs-you` on a run that has, in fact, moved on invites the
same wrong "was this really answered?" conclusion CON-71 caused, just
triggered by the opposite channel.

**This is also an internal contradiction, not just an omission.** `tasks.md`
7.2's own verification task describes the intended end-to-end trace as:
"resolve via a direct `concertino answer` call; confirm `--wait-only` (called
separately, simulating the root's poll) picks up the resolution and exits 0
with the answer" — i.e., tasks.md's own manual verification plan *assumes* a
confirming `--wait-only` call happens after `concertino answer`, which is
exactly the call `specs/escalation-bubble-up/spec.md`'s "A chat answer
resolves the wait" scenario explicitly says the root does **not** make. The
planning artifacts disagree with each other on whether that confirming call
occurs, and neither variant, as currently scoped, actually specifies who
writes `escalation.answered` in the chat-wins case in the real
root-resolution flow (task 7.2 is a manual test-trace description, not part
of the root's actual specified procedure in the `escalation-bubble-up` spec
or task 4.3).

**Required fix (either shape is acceptable, but the design must pick one and
state it explicitly):**
1. After a successful `concertino answer` write, the root makes exactly one
   more `--wait-only` call before proceeding to resume the orchestrator —
   this call will see `answer.json` already present and exit 0 immediately,
   which (per the existing, unmodified poll-loop code) is what actually
   writes `escalation.answered`. This reuses the existing "only the active
   poller records the terminal event" invariant with no changes to it, and
   directly resolves the tasks.md 7.2 vs. spec.md contradiction in favor of
   the confirming call. The "A chat answer resolves the wait" scenario's
   "without waiting for a further `--wait-only` call to confirm it" wording
   needs to be corrected to match, or explicitly scoped to mean "without
   waiting *before treating the answer as authoritative for resuming the
   orchestrator*" while still making the confirming call before/alongside
   that resume. **or**
2. `concertino answer` itself also writes `escalation.answered` to
   `events.jsonl` on a successful (non-refused) write — a deliberate,
   documented deviation from the current "only the reader writes it"
   invariant — with an explicit statement of why this doesn't risk a double
   write (e.g. because in this design, by the time `concertino answer`
   succeeds, no `--wait-only` call is concurrently in its own success path
   for the same escalation to also record it — this needs to be argued, not
   assumed, since the existing code comment treats "only the reader writes
   it" as load-bearing, and CON-46's multi-part `complete`-flag machinery
   this same file has already had to guard against exactly this kind of
   shape/ownership drift once before).

Either way, this needs its own decision in design.md (sibling to 1a/1b/1c),
a stated requirement/scenario in `escalation-bubble-up/spec.md` covering "a
chat-resolved escalation's `run.escalation` state is cleared on the
dashboard," and a task in tasks.md's section 4 (root resolution procedure)
or section 1 (if the CLI itself needs to change) reflecting whichever shape
is chosen.

### Verdict: REFUTE

### Change Requests

1. Close the `escalation.answered`-on-chat-resolution gap described above:
   add an explicit design.md decision stating who writes `escalation.answered`
   when the chat channel wins the race (recommended: the root makes one
   confirming `--wait-only` call after a successful `concertino answer` write,
   before/while resuming the orchestrator), reconcile the "A chat answer
   resolves the wait" scenario in `specs/escalation-bubble-up/spec.md` with
   `tasks.md` 7.2 (which currently assumes the confirming call happens),
   add the corresponding scenario stating `run.escalation` correctly clears
   on the dashboard for a chat-resolved escalation, and add a matching task
   under section 4 (or section 1, if `concertino answer` itself is the chosen
   mechanism) so this isn't left to the implementer to notice.

### Non-blocking notes

- Everything else — the `--wait-only`/`--await`/`--raise-only` split
  (Decisions 1/1a/1b/1c/2/3), the recursive bubble/relay protocol (Decisions
  5-8), the `concertino answer` CLI's delegation to `store.js` (Decision 4,
  confirmed against the real `writeAnswer`/`writeSubAnswer` exports), and the
  `escalation-trust-offramp`/`inline-orchestrator-mode`/
  `orchestrator-turn-discipline` spec deltas — is internally consistent, well
  grounded in the actual code being modified, and closes both prior rounds'
  findings correctly. This round's finding is narrow and additive to an
  otherwise sound design.
