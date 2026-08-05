## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all five spec deltas
  (`escalation-bubble-up`, `escalation-answer-cli`, `escalation-trust-offramp`,
  `inline-orchestrator-mode`, `orchestrator-turn-discipline`) in full.
- Read `scripts/concertino/emit-event.sh` end to end (the file this change most
  directly modifies) to check the design's claims about current behavior against
  the actual code, and to check whether the proposed `--wait-only` mode is
  actually buildable as described.
- Read `lib/ui/store.js`'s `writeAnswer`/`writeSubAnswer` (lines 199-314) to confirm
  the design's claims about `O_EXCL`/rename-based first-write-wins semantics and
  the `(root, ticket, answer)` / `(root, ticket, index, value, total)` signatures —
  **accurate**, `escalation-answer-cli`'s design is sound on this point.
- Confirmed `write_escalation_raised()` (emit-event.sh:301-419) already exists as a
  standalone function called once, unconditionally, before the poll loop — task
  1.1's "refactor into a standalone function" is close to a no-op against the
  current code (minor inaccuracy, not a blocker).
- Confirmed `test/scripts/escalation-loop.test.sh` exists (task 1.4's "extend"
  reference is accurate, not inventing a new file path unexpectedly).
- Traced the exact poll-loop code that `--wait-only` is specified to reuse
  "unchanged" (emit-event.sh:483-491, the block right after `write_escalation_raised()`
  and right before the `while` loop):

  ```
  ANSWER_FILE="${RUN_DIR}/answer.json"
  if [ -e "$ANSWER_FILE" ]; then
    # A previous --await was killed after a human answered but before this
    # script consumed it ... That answer may belong to a different, earlier
    # escalation — acting on it here would apply a stale approval ...
    FIELDS=""
    write_line escalation.answer_discarded || true
  fi
  rm -f "$ANSWER_FILE" 2>/dev/null || true
  ```

  The comment makes the invariant this code relies on explicit: any
  `answer.json` present at this point is safe to assume stale **only because it
  runs in the same script invocation, immediately after that same invocation's
  own `write_escalation_raised()` call** — i.e. the escalation this call is
  about to poll for was *just* raised this instant, so nothing could have
  legitimately answered it yet.

### Verdict: REFUTE

### Change Requests

1. **`--wait-only`'s reuse of the unmodified poll loop will discard genuine
   dashboard answers under exactly the chunked-polling architecture Decision 3
   proposes.** Design.md Decision 1 and tasks.md 1.3 both specify `--wait-only`
   as: skip the write, then "run the exact same poll-to-resolution logic
   `--await` already has" / "the existing poll-to-resolution loop unchanged."
   That inherited loop's first action is the discard-and-`rm` block quoted
   above — safe today only because it always immediately follows the *same
   call's* own raise. Under Decision 3, the root is specified to call
   `--wait-only` **repeatedly, as separate process invocations, every ~30s**,
   against the *same still-open* escalation. Every one of those calls after the
   first will re-run this discard block at its own start. If a legitimate
   dashboard answer lands in the gap between two `--wait-only` calls (exactly
   the scenario the `escalation-bubble-up` spec's "A dashboard answer resolves
   the wait" scenario claims to handle), the *next* `--wait-only` invocation
   will treat it as "stale, belongs to a different earlier escalation," emit
   `escalation.answer_discarded`, delete it, and keep polling — silently
   throwing away the human's real answer rather than resolving on it. This
   directly threatens the ticket's stated AC ("An answer given at the
   dashboard ... resolve[s] through `answer.json`") under the very mechanism
   the design proposes. **Required:** design.md/tasks.md must specify how
   `--wait-only` distinguishes "an answer written to this same still-open
   escalation, in the gap between two of my own polls" from "genuine leftover
   state from a prior, unrelated escalation" (e.g., only discard/`rm` when the
   file's mtime precedes the escalation's own `raised_at`, or don't run the
   discard step at all in `--wait-only` mode and instead consume-if-present at
   loop entry).

2. **No mechanism is specified for a `--wait-only` call to return after ~30s
   "still unresolved" without marking the escalation as timed out.** Decision 2
   anchors the deadline to `raised_at + CONCERTINO_ESCALATION_TIMEOUT_MIN` (the
   *full* escalation timeout, default tens of minutes), read fresh each call —
   correct as far as it goes. But Decision 3's entire premise is that the root
   makes *several separate, short* `--wait-only` calls and is free to end its
   turn between them, specifically to sidestep the unverified harness
   message-queuing risk. The loop being reused (emit-event.sh's `while` +
   `sleep 1` to `DEADLINE`) has exactly two exits: resolve, or reach the full
   `DEADLINE` and write `escalation.timeout` (a **terminal** state) and exit 1.
   There is no third "not yet resolved, not yet actually timed out, but this
   short call's own budget is up — return cleanly so the root can call again"
   exit path in the current code, and neither `design.md` nor the
   `escalation-bubble-up` spec introduces one (the spec's own `--wait-only`
   requirement text says it "poll[s] an already-raised escalation ... to
   resolution using the same deadline/trap/multi-part logic `--await` already
   has" — i.e., blocks to resolution or the full timeout, not for ~30s).
   As specified, calling `--wait-only` "in short (~30s) calls" would either (a)
   block for up to the full remaining timeout on every call anyway (defeating
   the entire reason Decision 3 gives for chunking), or (b) require an
   implementer to invent an undocumented new parameter/flag on the spot to get
   a short per-call budget distinct from the real deadline — precisely the
   kind of implementation-blocking ambiguity a design gate exists to catch.
   **Required:** design.md must add a decision specifying the actual per-call
   short-poll mechanism (e.g., a new `max_wait_sec=` argument to `--wait-only`,
   separate from the real deadline, that causes a clean non-timeout exit when
   the call's own short budget — not the escalation's real deadline — is
   reached), and the `escalation-bubble-up` spec's `--wait-only` requirement
   and its "Deadline survives being split across multiple short calls"
   scenario need to reflect that third exit path explicitly (currently they
   only describe deadline correctness, not the per-call return mechanism).

Both issues trace back to the same root cause: Decision 1's claim that all
three modes "share one poll/resolve implementation; only which sub-steps run
differs" is not true for the sub-steps that matter most to Decision 3's own
risk mitigation — the stale-answer discard and the loop's only two exit
conditions were both designed for a single, one-shot blocking call, not a
series of short polls against one still-open escalation. This is fixable (the
overall shape — three modes, shared write function, deadline anchored to
`raised_at`, single-authority resolution via `writeAnswer`/`writeSubAnswer` —
is sound), but it needs an explicit decision and spec update before
implementation, not something an executor should improvise mid-task.

### Non-blocking notes

- Task 1.1 ("refactor `write_escalation_raised()` into a standalone function")
  is effectively already true of the current code; harmless as written, just
  slightly overstates the amount of refactoring needed.
- Everything else — the `concertino answer` CLI design (Decision 4), the
  root/bubble/relay protocol (Decisions 5-8), the turn-discipline carve-out
  wording, and the spec deltas for `escalation-trust-offramp` and
  `inline-orchestrator-mode` — is internally consistent, traces correctly
  against the actual code (`store.js` signatures, `bin/concertino`'s dispatch
  pattern, existing role-file structure), and has no placeholders or
  unresolved TBDs. Once the two change requests above are addressed, this
  design looks implementable as stated.
