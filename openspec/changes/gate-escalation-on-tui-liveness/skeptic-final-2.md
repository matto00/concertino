## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### What I verified (with evidence)

- **Diff/commits**: `git log --oneline main..HEAD` → `9f79b02`, `a7e5215`, `a2f3467`.
  `git diff main...HEAD --stat` → 16 files; the only non-openspec production files are
  `core/roles/orchestrator.md`, `core/scripts/tui-attached.sh`,
  `scripts/concertino/tui-attached.sh`, `test/scripts/tui-attached.test.sh`, `package.json`.
  No frontend/UI surface in this change → design-standard/screenshot review not applicable,
  servers not started.
- **Round-1 finding is genuinely fixed**: read `core/roles/orchestrator.md` in full around
  the triage section (lines 690–760). Step 4 now reads "Raise the escalation through 'How to
  raise one' below, in full — the same TUI-liveness check, topology branch, per-call timeout,
  and off-ramp rules, not a second, hand-rolled call", and contains no `emit-event.sh`
  invocation.
- **Call-site census (grepped myself)**: `grep -n "emit-event.sh escalation" core/roles/orchestrator.md`
  → lines 722 (prose forbidding a bespoke call), 948 (`cleanup.sh`'s own internal `--await`,
  pre-existing, not the orchestrator's raise), 1176 (`--await`, root branch), 1188
  (`--raise-only`, subagent branch), 1218 (`--await` in the multi-part *wire-shape* example),
  1269 (`escalation.answered` timeout fallback), 1349 (`--wait-only` resolution poll).
  1176/1188/1218 all sit inside the single "How to raise one" procedure, downstream of the
  `TUI_ATTACHED` check at 1117–1131. So: exactly one gated raise site in the file. Good.
- **Script**: read `core/scripts/tui-attached.sh` in full; `diff` against
  `scripts/concertino/tui-attached.sh` → identical. Liveness is pid signal-0 via `node`
  (EPERM ⇒ alive, matching `lib/ui/watch-lock.js`'s `pidAlive()`); heartbeat never consulted;
  every ambiguity path `exit 1`. Matches `specs/tui-liveness-detection/spec.md` scenario for
  scenario.
- **Gates re-run by me**: `bash test/scripts/tui-attached.test.sh` → 10 passed, 0 failed
  (incl. the 9.1 mutation check). Full `npm test` → exit 0, no failing suites.
- **Resolution-loop requirement**: `core/roles/orchestrator.md` step 1a (line 1328) does the
  fresh re-check, satisfying `escalation-bubble-up`'s second requirement *for that file*.

### Verdict: REFUTE

Two defects, both in the ticket's own stated common case (a plain Claude Code
`/concertino-deliver` run with no TUI attached), both reproduced by reading the shipped text
rather than a diff.

### Change Requests

1. **`core/roles/orchestrator.md` lines 1128–1155 — the `TUI_ATTACHED=0` branch silently
   drops CON-76 bubble-up for a subagent orchestrator, leaving the default topology with no
   path to the human at all.**
   The branch says: "still call `--raise-only` ... **regardless of whether you are the root or
   a subagent** ... Then make **no `--await`/`--wait-only` call at all** — you already presented
   the question to chat above, so simply wait there for the human's reply." It is followed by
   "**If `TUI_ATTACHED=1` (TUI attached):** proceed exactly as below" — which tells a cold agent
   that the topology section (lines 1157–1210, including the subagent branch's mandatory
   `PENDING_ESCALATION` persist + `ESCALATION-PENDING` return) applies only when
   `TUI_ATTACHED=1`. A `concertino-orchestrator` running as a Claude Code subagent with no TUI
   therefore ends up instructed to "wait in chat" in a transcript this very document states does
   not reach the human ("It costs nothing when you don't own that channel either; the topology
   branch below is what additionally reaches the human in that case", lines ~1104–1107). That
   is a hang, and it is strictly worse than the 8-minute timeout the ticket set out to remove.
   It also contradicts this change's own `design.md` Decision 2, third bullet: "The subagent ...
   branch's `ESCALATION-PENDING` contract is **unaffected by `TUI_ATTACHED`** — it already writes
   `PENDING_ESCALATION` to `workflow-state.md` and returns". Ticket AC "With no TUI attached,
   raising an escalation ... reaches the human in chat immediately" and "an agent can tell which
   branch it is on without guessing" are both untraceable as written.
   Fix: make the `TUI_ATTACHED=0` branch explicitly topology-aware — as the root (or `--inline`/
   sequential-harness), wait in chat and record via `concertino answer`; as a Claude Code
   subagent, after `--raise-only`, still persist `PENDING_ESCALATION` and return
   `ESCALATION-PENDING` exactly as the subagent branch requires, with the no-TUI decision then
   re-made fresh by the root at resolution time (step 1a already supports this). The
   `escalation-bubble-up` spec's "No TUI attached" scenario ("waits for the human's reply
   directly in chat") needs the same topology qualification, since as written it asserts the
   unreachable-transcript behaviour for the subagent case too.

2. **`adapters/claude-code/command.md` lines 71–82 — the root resolution loop for the default
   topology polls `--wait-only` with no TUI-liveness re-check.**
   `specs/escalation-bubble-up/spec.md` adds "The root's resolution loop re-checks TUI liveness
   before polling ... When not attached, the root SHALL skip the `--wait-only` polling loop
   entirely". `core/roles/orchestrator.md` implements this at step 1a, but `command.md` — which
   is the file the *actual root* (the top-level `/concertino-deliver` session) follows when an
   `ESCALATION-PENDING` bubbles up in the default non-`--inline` topology — spells out its own
   numbered steps 1–5 and omits the check: step 2 says "Poll for a dashboard answer with
   repeated short `--wait-only` calls ... looping on exit 2, stopping on exit 0 ... or exit 1
   (the escalation's real deadline reached)". `grep -n "tui-attached\|TUI" adapters/claude-code/command.md`
   returns nothing. With no dashboard attached, that loop can only end at the escalation's real
   deadline — the exact dead-wait this ticket exists to eliminate, on the exact path the ticket
   describes as observed live on CON-131.
   Fix: add the fresh `scripts/concertino/tui-attached.sh` check to `command.md` step 2 (skip
   the polling loop entirely when it exits non-zero, wait in chat and go straight to step 3's
   `concertino answer`), or replace the inlined steps with a pointer to
   `core/roles/orchestrator.md`'s procedure so it cannot drift again.

### Non-blocking notes

- The multi-part example at line 1218 hardcodes `--await`, and its follow-up parenthetical only
  says "Replace `--await` with `--raise-only` for the subagent branch above" — it does not
  mention the no-TUI branch. The `TUI_ATTACHED=0` text ("no `--await`/`--wait-only` call at
  all") is binding and unambiguous, so this is not a defect, but adding "or the no-TUI branch"
  to that parenthetical would remove a copy-paste temptation.
- `tui-attached.sh` resolves the lock dir via `git rev-parse --git-common-dir` while
  `concertino watch` uses `resolveOut(args)`; they diverge only under a non-default `--out=DIR`.
  The script's header documents this as accepted and out of scope — agreed, and the failure
  direction is the safe one (reads as not-attached).
