## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `skeptic-design-1.md`,
  and all five spec deltas (`escalation-bubble-up`, `escalation-answer-cli`,
  `escalation-trust-offramp`, `inline-orchestrator-mode`,
  `orchestrator-turn-discipline`) fresh, cold, without assuming round 1's
  findings were correctly fixed.
- Re-read `scripts/concertino/emit-event.sh` end to end (lines 280-540) against
  the current design text to check the round-1 fixes against the actual code
  the change will modify.

**Round-1 item 1 (stale-answer discard reused per-poll) — confirmed fixed.**
Design.md Decision 1a now states the discard-and-`rm` check "moves to the write
path, and never repeats during a single escalation's `--wait-only` polling" —
i.e. it is folded into `write_escalation_raised()` (Decision 1, tasks.md 1.1),
which only runs once, in `--raise-only`/`--await`'s own write step, never in
`--wait-only`. Tasks.md 1.3 states `--wait-only` "skips both the write *and*
the stale-answer discard check ... checking `answer.json`'s presence directly
(no discard/rm) at each attempt." The `escalation-bubble-up` spec adds an
explicit scenario ("`--wait-only` does not discard a dashboard answer written
between two calls") that is a direct regression test for exactly the bug round
1 found, and tasks.md 1.4 adds the matching test-list entry. This is sound and
consistent across design.md/tasks.md/spec.md.

**Round-1 item 2 (no per-call return mechanism for `--wait-only`) — confirmed
fixed.** Decision 1b gives `--wait-only` an explicit `max_wait_sec=<n>`
parameter and three distinct exit codes: 0 (resolved), 1 (the escalation's
*real* deadline — `raised_at` from `events.jsonl` + `CONCERTINO_ESCALATION_TIMEOUT_MIN`,
Decision 2 — reached, terminal), 2 (this call's own short budget elapsed,
escalation still open, caller retries). Tasks.md 1.3 restates this exactly,
and the `escalation-bubble-up` spec's "returns exit 2 when neither resolved
nor timed out" scenario and "real deadline survives being split across
multiple short calls" scenario both test the two-clock design (per-call budget
vs. real deadline) explicitly. This closes the ambiguity round 1 flagged —
Decision 3's chunked-polling loop is now buildable as specified.

### A new gap in the same category the round-1 fix didn't cover

Round 1's root cause finding was: "the stale-answer discard and the loop's
only two exit conditions were both designed for a single, one-shot blocking
call, not a series of short polls against one still-open escalation." The
discard block and the exit-condition set have now both been fixed. A third
piece of the same inherited poll loop was not addressed: **the `TERM`/`INT`
signal trap.**

`emit-event.sh:474-479` installs, unconditionally, right before the poll loop
begins:

```
on_kill() {
  FIELDS=""
  write_line escalation.timeout || true
  exit 1
}
trap on_kill TERM INT
```

This trap fires unconditionally on any TERM/INT the process receives while
polling — it does not check whether the escalation's real deadline has
actually been reached; receiving the signal *is* what causes `escalation.timeout`
(a **terminal** state) to be written. Today, with a single `--await` call, that
is exactly right: the only way to kill the process is the harness's own tool
timeout or the escalation truly having run out its allotted wait, so "killed"
and "should be recorded terminal" are the same event.

That equivalence breaks for `--wait-only`. Nowhere in design.md, tasks.md, or
the `escalation-bubble-up` spec is `--wait-only`'s trap behavior specified —
`grep -rn -i "trap\|SIGTERM\|SIGINT\|on_kill" design.md tasks.md specs/
proposal.md ticket.md` returns only references to `--await`'s trap being
"unchanged"/"byte-for-byte unchanged," never a statement of what `--wait-only`
itself should do on a signal. If an implementer builds `--wait-only`'s poll
loop the way the rest of Decision 1 explicitly invites ("share their
respective single implementations; only which sub-steps run at each call site
differs") and simply reuses the existing poll loop's trap installation
verbatim (dropping in the discard-check removal and the new exit-2 budget
check, but not touching the trap), then **any external kill of a `--wait-only`
call — a harness restart, a session eviction, the very "session eviction"
scenario the Risks section already names for the `SendMessage`-resume fallback
— writes a terminal `escalation.timeout` event even when the escalation's
real deadline (default up to 60 minutes) is nowhere close to being reached.**
Once that terminal event is on the log, the cold-respawn mitigation the Risks
section describes ("`PENDING_ESCALATION` being persisted there means the
re-spawned instance can immediately reconstruct and re-emit
`ESCALATION-PENDING`") re-emits a question against an escalation the system's
own event log now says already timed out — the exact failure this ticket
exists to prevent (a real, still-open human decision getting silently
discarded), just via a different code path than the one round 1 caught.

This is not a low-probability edge case given how Decision 3 itself describes
the wait: "the root polls in short (~30s) `--wait-only` calls **across its own
turns**... the root free to end its turn between them... Each call returns
exit code 2... the root simply calls `--wait-only` again on exit 2." The
design's own framing has the root spending essentially the *entire* wait
window inside back-to-back active `--wait-only` calls, with negligible time
genuinely "between" them — so a session restart or harness eviction landing at
essentially any point during the wait lands *inside* an active `--wait-only`
call, not in a safe gap.

**Required:** design.md needs an explicit decision (sibling to 1a/1b) stating
`--wait-only`'s signal-handling contract — most plausibly: `--wait-only`
installs no `on_kill`-style trap at all (a signal simply kills the process with
no event written, leaving the escalation exactly as open as it was before this
particular poll attempt, safe for the root's next turn/re-spawn to call
`--wait-only` again with no state corruption) — and the `escalation-bubble-up`
spec needs a requirement/scenario covering it (e.g. "a `--wait-only` call
killed mid-poll does not record `escalation.timeout` and leaves the escalation
open for a subsequent `--wait-only` call"), plus a corresponding tasks.md 1.4
test entry, mirroring how thoroughly Decision 1a/1b's fixes were specified and
tested.

### Verdict: REFUTE

### Change Requests

1. Specify `--wait-only`'s `TERM`/`INT` signal-handling contract in design.md
   (new decision alongside 1a/1b), add the corresponding requirement/scenario
   to `specs/escalation-bubble-up/spec.md`, and add a matching regression test
   to tasks.md 1.4's list — per the "A new gap" analysis above. The default
   expectation should be: a signal during a `--wait-only` call must never write
   a terminal `escalation.timeout` unless the escalation's real deadline
   (Decision 2) has actually been reached; it should instead leave the
   escalation exactly as open as before that call, so the root (fresh spawn or
   resumed turn) can safely call `--wait-only` again.

### Non-blocking notes

- Tasks.md 1.3's clause "(and, for multi-part, enough to detect `sub_questions`
  mode from the already-written `escalation.raised` event or an explicit
  `total=`)" leaves the implementer a choice between two mechanisms rather than
  picking one, unlike the rest of the document's otherwise very precise
  specification. Given `raised_at` is already specified as being re-derived
  from `events.jsonl` on every `--wait-only` call (Decision 2), reading
  `sub_questions`/`total` from that same already-logged `escalation.raised`
  event the same way would be the more consistent choice and is worth stating
  as the single mechanism rather than an "or."
- Everything else — the `concertino answer` CLI design (Decision 4), the
  root/bubble/relay protocol (Decisions 5-8), the turn-discipline carve-out
  wording, and the spec deltas for `escalation-trust-offramp` and
  `inline-orchestrator-mode` — remains internally consistent and unchanged in
  substance from round 1, where it was already found sound.
