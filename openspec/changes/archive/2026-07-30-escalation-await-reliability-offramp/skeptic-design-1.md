## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/escalation-resume/spec.md`, `specs/escalation-trust-offramp/spec.md`.
- **Structural validity of the deltas:** `openspec validate escalation-await-reliability-offramp --strict`
  → `Change 'escalation-await-reliability-offramp' is valid`. No structural
  objection; every finding below is substantive.
- **Current code the design edits:** `core/scripts/emit-event.sh` lines 45–53
  (flag parsing), 225–228 (non-await early exit), 234–322 (`write_escalation_raised`),
  355–360 (`on_kill` trap), 366–379 (pre-poll discard + unconditional `rm -f`),
  381–382 (`TIMEOUT_MIN`/`DEADLINE`), 384–406 (poll loop), 408–416 (post-loop timeout).
- **Prose being edited:** `core/roles/orchestrator.md` 468–528 ("How to raise one",
  incl. the `timeout: 600000` paragraph and the Exit 0 / Non-zero exit bullets).
- **Dashboard side that must produce the answer:** `lib/ui/reducer.js` 137–158,
  `lib/ui/watch.js` 139–141 and 475–477, `lib/ui/store.js` 211–227 (`writeAnswer`, `'wx'`).
- **Real escalation history** (`.concertino/runs/<T>/events.jsonl`, deltas computed
  with node):

  ```
  CON-30 escalation.raised   2026-07-30T00:34:58.651Z
  CON-30 escalation.timeout  2026-07-30T00:44:58.513Z  +599.9s
  CON-30 escalation.raised   2026-07-30T01:03:30.172Z
  CON-30 escalation.timeout  2026-07-30T01:13:30.021Z  +599.8s
  CON-35 escalation.raised   2026-07-29T09:41:14.224Z
  CON-35 escalation.timeout  2026-07-29T09:51:14.079Z  +599.9s
  CON-22 escalation.raised   2026-07-29T14:57:30.134Z
  CON-22 escalation.answered 2026-07-29T15:52:34.925Z  +3304.8s   (manual chat fallback)
  CON-22 escalation.timeout  2026-07-29T15:57:30.594Z  +3600.5s from raise
  ```

- **Live probe** (throwaway git repo in scratchpad, copy of
  `scripts/concertino/emit-event.sh` + a `.concertino.env` setting
  `CONCERTINO_ESCALATION_TIMEOUT_MIN=0`, run under `timeout 6`):

  ```
  exit=124 elapsed=6s
  {"t":...,"kind":"escalation.raised",...,"ticket":"T-1",...}
  {"t":...,"kind":"escalation.timeout",...,"ticket":"T-1",...}
  ```

  Two facts established: (a) the script **ignores** `.concertino.env` (a 0-minute
  configured timeout still polled until SIGTERM), and (b) a SIGTERM kill leaves
  `escalation.timeout` as the ticket's **most recent** event.
- **Env wiring:** `scripts/concertino/.concertino.env` contains
  `CONCERTINO_ESCALATION_TIMEOUT_MIN=8`; `grep -rn CONCERTINO_ESCALATION_TIMEOUT_MIN bin lib core test config`
  shows it is only ever *written* (`bin/concertino:557`) and read as a default
  (`core/scripts/emit-event.sh:381`) — nothing ever exports it. `emit-event.sh` has
  no `source .concertino.env`, unlike `assert-phase.sh:26`, `start-servers.sh:35`,
  `cleanup.sh:47`, `setup-worktree.sh:70`, `resolve-speed.sh:77`.

### Verdict: REFUTE

Part 2 (the trust off-ramp) is sound: `design.md` Decision 7 and
`specs/escalation-trust-offramp/spec.md` map 1:1 onto the ticket's four numbered
points, the placement is specified, and the scenarios are checkable. Part 1 is not
implementable as designed — its central mechanism (Decision 2) is contradicted by
the real post-kill log state, the dashboard cannot answer a resumed escalation at
all, and the root cause the ticket explicitly required be *measured first* is
measurable here and is something else entirely.

### Change Requests

1. **Decision 2's resume trigger never fires in the real world — after a killed
   `--await` the most recent event is `escalation.timeout`, not `escalation.raised`.**
   `design.md:36–39` makes "most recent is `escalation.raised`" the sole gate for
   resuming, and puts `escalation.timeout` in the "nothing open to resume → degrade
   to a fresh raise" bucket. But `on_kill` (`core/scripts/emit-event.sh:355–360`,
   preserved untouched by Decision 5) writes `escalation.timeout` on exactly the
   harness kill this feature exists to survive — confirmed by the probe above and by
   CON-30/CON-35's logs (timeout at +599.9s), and stated outright in the very prose
   being edited (`core/roles/orchestrator.md:522–524`: *"Non-zero exit: it timed out,
   or the wait was killed. Either way `--await` has already recorded
   `escalation.timeout`"*). Consequence: every retry the orchestrator's new loop
   issues degrades to a fresh raise — duplicate `escalation.raised`, clock reset to
   now, and the in-gap `answer.json` discarded by the pre-poll `rm`. All three
   headline goals (`design.md:12–14`) are unmet, and these become unsatisfiable as
   written: Decision 3's anchored deadline (never reached), Decision 5's
   don't-re-emit guard (dead code — a degraded resume writes its own fresh raise, so
   "most recent is already `escalation.timeout`" can never hold at the post-loop
   write), `tasks.md` 3.1 / 3.3 / 3.5 / 3.8, and the spec scenarios at
   `specs/escalation-resume/spec.md:13–15, 24–26, 35–37, 50–52`. Note also
   `design.md:59` asserts a post-deadline `--resume` "returns almost immediately,
   having written another `escalation.timeout` line" — only possible if the raise was
   still the most recent event, i.e. the design contradicts itself on this point.
   Resolve the meaning of a recorded `escalation.timeout` (harness kill vs. true
   deadline elapsed) explicitly — the current design needs it to mean both.

2. **A resumed escalation is unanswerable from the dashboard, so the resumed poll
   can never succeed.** `lib/ui/reducer.js:155–158` sets `run.escalation = null` on
   `escalation.timeout`; `lib/ui/watch.js:475–477` then bounces a human off the
   escalation screen, and `watch.js:139` drops the run from the cross-screen banner.
   So by the time a `--resume` runs, the question is no longer displayed anywhere and
   no `answer.json` will ever be written. A resume that deliberately does *not*
   re-raise (Decision 2, first case) therefore polls a file the UI cannot produce.
   The design must say how the escalation is re-surfaced to the dashboard — a new
   event kind the reducer understands, a re-raise that the log-dedup requirement then
   has to accommodate, or something else — and `proposal.md:24–29` / `design.md:22`
   must stop excluding `lib/ui/` from Impact if a reducer change is required. Add a
   requirement + scenario covering "a human can still answer a resumed escalation
   from the dashboard"; today neither spec delta asserts this anywhere, which is why
   the gap survived planning.

3. **Part 1's root cause is measurable in this repo, and the artifacts assert a
   false premise instead of measuring it.** The ticket
   (`ticket.md:13`) requires: *"This needs to be measured against real tool-call
   traces, not assumed."* `proposal.md:5` and `design.md:5` declare the measurement
   impossible and restate "killed at 450s, 510s, 990s — inconsistent with … the
   documented 600s call-timeout instruction" as fact. The event logs refute that: all
   three kills landed at **599.9s** (CON-30 twice, CON-35), i.e. `timeout: 600000`
   *was* being honored. The actual cause is a one-line defect: `.concertino.env` sets
   `CONCERTINO_ESCALATION_TIMEOUT_MIN=8`, but `emit-event.sh` never sources
   `.concertino.env` (all five sibling scripts do — see evidence above), so
   `TIMEOUT_MIN` is always the 60-minute fallback at `emit-event.sh:381` — six times
   the harness's 10-minute cap, which guarantees the harness always wins.
   Independently corroborated by CON-22, whose `escalation.timeout` fired at exactly
   +3600.5s from its raise (the 60-minute default running to completion). With the
   sourcing fixed, `--await`'s own deadline (480s) fires cleanly inside the 600s cap
   — precisely the outcome `config/concertino.schema.json:125` and
   `docs/dashboard.md:169–176` already promise and the role prose at
   `core/roles/orchestrator.md:511–513` already claims is happening. Revise the Why /
   Context / Open Questions to the measured facts, and re-derive scope from them:
   `design.md:21`'s Non-Goal ("Changing `CONCERTINO_ESCALATION_TIMEOUT_MIN`'s default
   or `dashboard.escalationTimeoutMinutes`") currently walls off the region
   containing the actual bug. State explicitly what residual failure `--resume` still
   buys once the deadline fits inside the call cap (session restart, compaction,
   SIGKILL) so the retry machinery is justified on its real merits rather than on a
   premise the logs contradict.

4. **Decision 4 removes a live protection the design doesn't account for: an empty
   or malformed `answer.json` deadlocks a resumed wait.** The pre-poll `rm -f`
   (`emit-event.sh:379`) is *unconditional*, outside the `if [ -e ]` discard block —
   and the poll loop only consumes a file whose parsed `answer` is non-empty
   (`emit-event.sh:392`), never removing it otherwise. Skip that `rm` on resume
   (`design.md:49–53`, `tasks.md` 2.2) and a leftover file with an empty/unparseable
   answer makes the resumed call poll to its deadline while
   `store.js:211–227`'s `'wx'` (O_EXCL) write rejects every new dashboard answer with
   `already answered` — the human is locked out for the rest of the window. Specify
   the rule precisely (e.g. keep a pre-existing `answer.json` only when it parses to
   a non-empty `answer`, otherwise `rm` exactly as today) and add a scenario for the
   malformed/empty case.

5. **Orphaned pollers and double consumption are unaddressed.** CON-22 proves an
   `--await` process can outlive its tool call by ~50 minutes (it wrote its own
   natural timeout at +3600.5s, five minutes *after* the orchestrator had already
   recorded `escalation.answered` manually). A `--resume` issued while the original
   is still polling gives two readers of one `answer.json`, which is never removed on
   the success path (`emit-event.sh:392–402`) — so both can write
   `escalation.answered`, and the orphan's later `escalation.timeout` clears a live
   escalation in the reducer. The design must state what happens when a previous
   poller may still be alive (detect and stand down, make consumption exclusive via a
   rename, or state why it's harmless) rather than assuming the prior call is dead.

6. **Decision 6's third loop-stop condition is unobservable to the orchestrator.**
   `design.md:59` states *"the call still exits 1 either way, so the orchestrator's
   retry loop sees the same signal"*, yet `design.md:65`, `tasks.md` 4.1, and
   `specs/escalation-resume/spec.md:55` all make "a `--resume` call exits non-zero
   having found the escalation already answered or timed out in the log" a distinct
   stop condition, with no mechanism given for how the orchestrator learns that (no
   distinguishing exit code, no stdout marker, no log-inspection command in the
   prose). Two implementers would reasonably build two different things, and the
   scenario is untestable. Specify one: a distinct exit status, a stdout token, or
   the exact log-check command the role prose runs.

7. **Documentation surfaces for the new flag are not covered by any task.** The
   `--resume` call shape needs to appear in `emit-event.sh`'s own usage header
   (`core/scripts/emit-event.sh:11–13`), the script table in
   `core/scripts/README.md:48`, and the escalation flow in
   `docs/dashboard.md:198–208`. `tasks.md` section 6 covers only `concertino sync` of
   the rendered copies, so these would silently drift.

### Non-blocking notes

- Part 2's spec delta (`specs/escalation-trust-offramp/spec.md`) is the strongest
  artifact here — each of the ticket's four points has a requirement and a
  reader-checkable scenario, including the anti-weakening clause for unsolicited
  claims. Keep it as-is through the Part 1 revision.
- Once CR1's semantics are settled, sanity-check the two additions for prose
  tension in the same section: the off-ramp tells the orchestrator that a recorded
  resolution is terminal, while the re-issue loop tells it to keep waiting after a
  recorded `escalation.timeout`. Both can be true (a timeout is not an answer —
  `core/roles/orchestrator.md:525–526` already says so), but a reader meets them
  three paragraphs apart and the distinction should be explicit.
- `design.md:84` flags the retry cap of 5 as an untuned guess. Fine as a constant,
  but with CR3's measurement in hand the cap can likely be derived (or dropped) —
  worth revisiting rather than shipping as an admitted guess.
