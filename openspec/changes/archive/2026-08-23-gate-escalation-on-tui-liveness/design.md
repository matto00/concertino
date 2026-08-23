## Context

`core/roles/orchestrator.md`'s "How to raise one" (escalation-bubble-up capability) unconditionally
calls `scripts/concertino/emit-event.sh escalation --await`/`--raise-only`, regardless of whether a
`concertino watch` dashboard is running against this repo. `lib/ui/watch-lock.js` already solves an
adjacent problem — a single-writer pidfile guard for the dashboard itself (CON-68) — using PID
liveness (`process.kill(pid, 0)`), not heartbeat freshness, as the authority: a heartbeat can go
stale while the holder is still legitimately alive (blocked inside `tmux attach`), so this module
deliberately treats staleness as informational only and PID liveness as ground truth. This is
exactly the "cannot go stale in the dangerous direction" property CON-126 asks for, already built
and already proven in production for a closely related question ("is a dashboard process alive
right now"). CON-127 (`7954d50`, merged) explicitly deferred this ticket and stated the composition
assumption this design must honour: the TUI/topology decision must live at exactly one call site in
`core/roles/orchestrator.md`, so every depth (orchestrator's own escalations, and sub-agent-raised
ones relayed by the orchestrator per `subagent-escalation-raise`) inherits the same gating for free.

## Goals / Non-Goals

**Goals:**
- One documented signal, "is a Concertino TUI attached to this run", reusing `watch-lock.js`'s
  existing PID-liveness pidfile rather than inventing a second liveness mechanism.
- Gate `core/roles/orchestrator.md`'s single raise call site on that signal — no other file in
  `core/roles/*.md` gains new logic (CON-127's composition assumption stays true).
- A no-TUI branch that reaches the human via chat with zero blocking wait and zero pointless script
  round-trip, while keeping `concertino answer` as the single authoritative write path.
- Preserve, byte-for-byte, every existing invariant of the TUI-attached path.
- Safe-by-default staleness handling: ambiguous or unreadable signal state resolves to "no TUI",
  never "TUI attached" (a false positive here reintroduces the 8-minute dead wait; a false negative
  merely costs one skipped dashboard flash-up on a run a human is actually watching — asymmetric
  cost, so the design must break the tie toward "no TUI").

**Non-Goals:**
- Changing `emit-event.sh`'s `--await`/`--raise-only`/`--wait-only` semantics, the `TERM`/`INT` trap,
  or `escalation.timeout` recording — all unmodified.
- Changing `concertino answer`/`writeAnswer`/`writeSubAnswer` — unmodified; still the single
  authoritative write path in both branches.
- A per-run (as opposed to per-repo) liveness signal. `watch-lock.js`'s pidfile is inherently
  per-repo (one dashboard, one repo, one lock) — a dashboard watching the repo is watching every run
  in it, including this one, so per-repo liveness is the correct granularity, not a compromise.
- Cross-harness parity work beyond what already exists (CON-135) — this changes only
  `core/roles/orchestrator.md`'s shared prose, which already renders identically to every harness;
  no harness-specific tool name is introduced.

## Decisions

### Decision 1 — The signal: `core/scripts/tui-attached.sh`, backed by `watch-lock.js`

**Authoring location (corrected per design-gate round-1 REFUTE, CR1):** `scripts/concertino/` is not
source — it is *generated*, verbatim, from `core/scripts/**` by `concertino sync` (`lib/cli/sync.js`,
`lib/cli/diff.js`, `lib/cli/doctor.js` all treat `core/scripts` as the tree they list/render). A file
authored only under `scripts/concertino/` never reaches any consumer repo's rendered output — it
would ship as a silently-broken reference (failing in the safe non-zero-exit direction, per Decision
1 below, but permanently dead everywhere `concertino sync` actually runs). The script is therefore
authored at `core/scripts/tui-attached.sh`, exactly like `emit-event.sh` and every other procedure
script it's modeled on, and reaches `scripts/concertino/tui-attached.sh` only via the ordinary
`concertino sync` render (task 3.1).

A new script, `core/scripts/tui-attached.sh`, is the single authority. It:
1. Resolves the main checkout the same way `emit-event.sh` already does (`git rev-parse
   --git-common-dir`, normalised) — the lockfile lives at `<main checkout>/.concertino/cache/watch.lock`,
   identical resolution to how `emit-event.sh` finds `.concertino/runs/`. **Stated assumption (non-
   blocking note, design-gate round 1):** `concertino watch` itself resolves this same path via
   `resolveOut(args)` (cwd/`--out`, `lib/cli/watch.js:43`), not via `git rev-parse --git-common-dir`.
   These coincide for the ordinary invocation (`concertino watch` run at the repo root) and diverge
   only under a non-default `--out=DIR` — the same pre-existing divergence `concertino answer`'s own
   `--out` default already carries. Not remediated here (out of this ticket's scope), but stated
   explicitly so a future reader isn't surprised by it.
2. Reads that JSON file (`{pid, startedAt, heartbeatAt}`), exactly as `watch-lock.js`'s `readLock`
   does. A missing or unparsable file is "no TUI" (exit 1) — mirrors `readLock`'s own "torn or absent
   is treated as absent" contract, so the two implementations can never disagree about the
   torn/missing case.
3. Checks PID liveness via a small `node -e` snippet that calls `process.kill(pid, 0)` and inspects
   the thrown error's `code`, **exactly mirroring `watch-lock.js`'s own `pidAlive()`** (EPERM → alive;
   anything else, including no throw, → the corresponding liveness result) — not bash's builtin
   `kill -0`. **Corrected per design-gate round-1 REFUTE (CR4):** the round-1 draft claimed bash's
   `kill -0` "folds EPERM into a zero exit, matching `pidAlive`'s own EPERM handling." Measured and
   false: `bash -c 'kill -0 1'` (uid 1000, pid 1 owned by root) exits **1** with `kill: (1) -
   Operation not permitted` on stderr — bash's builtin does *not* treat EPERM as success. Reusing
   `pidAlive`'s own semantics via Node (a hard dependency of every `scripts/concertino/*.sh` script
   already, per `now_ms()`'s existing fallback) means this check can never diverge from
   `watch-lock.js`'s own definition of "alive" — the two implementations agreeing is achieved by
   literally sharing the one-line semantics, not by an unverified claim about a different primitive.
   Node's stderr is suppressed (`2>/dev/null` around the invocation) so a foreign-owned live pid
   never sprays a permission-denied message into an agent's transcript.
4. On any unexpected failure (unreadable directory, `node` unavailable, `pid` field not a number) —
   exit 1 ("no TUI"), never exit 0. This is the explicit "ambiguity resolves toward no TUI" rule from
   Goals, enforced by making every non-confirmed-alive path fall through to the same exit-1 branch
   rather than enumerating "attached" as the default.

**Staleness, stated explicitly (Goals):** the pidfile's `pid` liveness is the only signal consulted;
`heartbeatAt` is never read by this script (mirrors `watch-lock.js`'s own "heartbeat is diagnostic
only, never a takeover criterion" design). The one residual risk this inherits unchanged from
`watch-lock.js` — a dead dashboard's pid gets recycled by an unrelated long-lived process before this
script runs — is the same accepted, documented risk `watch-lock.js` already carries (CON-68's "smallest
useful shape"); no new mitigation is invented here, since inventing one only for this consumer while
leaving `watch-lock.js` itself unchanged would let the two liveness checks silently diverge.

Alternative considered: a fresh per-run heartbeat file. Rejected — this is exactly the kind of
"staleness rots" signal Goals warns against (a dashboard blocked in `tmux attach` starves its own
heartbeat while still legitimately alive, so a heartbeat-based check would produce a **false
negative** under the exact condition `watch-lock.js`'s own design note calls out as the reason it
rejected heartbeat-based ownership) — a fresh, unproven implementation.

Alternative considered: an env var exported by `concertino watch`. Rejected — an env var is
inherited by every child process the dashboard's own tmux session spawns (the ticket's own warning:
"a marker file... or an env var inherited by a child process that outlives its parent... produce
the WRONG answer in the dangerous direction"); a delivery run's own orchestrator process is not a
child of `concertino watch` in the live topology (it runs inside its own Claude Code session,
usually itself launched from a `concertino watch`-spawned tmux pane, but that parent/child
relationship is exactly the kind of thing that gets severed by re-attaching, detaching, or a
crash-and-restart of one side without the other) — a live PID-liveness check of the *dashboard's own*
process, independent of any inheritance relationship, is the only signal that doesn't rot this way.

### Decision 2 — Gating the orchestrator's single call site

`core/roles/orchestrator.md`'s "How to raise one" gains one new step, run immediately after
"Present it in your own chat transcript immediately" (which stays unconditional — presenting to chat
costs nothing and must happen regardless) and before the existing topology branch:

```bash
if scripts/concertino/tui-attached.sh; then
  TUI_ATTACHED=1
else
  TUI_ATTACHED=0
fi
```

- **`TUI_ATTACHED=1`**: proceed exactly as today — root → `--await`, Claude-Code-subagent → `--raise-only`,
  unmodified in every respect (contracts, timeout trap, dual-channel, wizard).

  **Structural note (design-gate final round-2 REFUTE, CR1):** `TUI_ATTACHED` is checked
  *within* each topology branch, not as a shortcut that bypasses the root-vs-subagent split —
  the subagent branch always raises via `--raise-only` and always returns `ESCALATION-PENDING`
  regardless of `TUI_ATTACHED` (a subagent never blocks on resolution either way, and it has no
  human-visible transcript of its own to "wait in chat" against); only the **root** branch's
  behavior differs by `TUI_ATTACHED` (`--await` when attached, `--raise-only` + chat-resolve via
  `concertino answer` when not). This preserves CON-76's bubble-up contract for the subagent case
  unconditionally.
- **`TUI_ATTACHED=0`**: **corrected per design-gate round-1 REFUTE (CR2, CR3, CR5)** — still call
  `--raise-only` (never blocks — it writes `escalation.raised` and performs the existing one-time
  `discard_stale_answer` immediately, then returns exit 0 with no polling, per `emit-event.sh`'s own
  documented `--raise-only` contract), then resolve directly from the already-presented chat
  transcript by writing the human's answer through `concertino answer` (single-question) or
  `concertino answer ... --sub <i> --total <n>` (multi-part, per CON-46) — with **no `--await`/
  `--wait-only` call at all**. This is a real, and previously mis-described, change of write path for
  the *directly-raised* (non-bubbled) case: today's root `--await`-timeout fallback records with a raw
  `emit-event.sh escalation.answered ...` call (`core/roles/orchestrator.md`'s existing text), not
  `concertino answer` — the round-1 draft incorrectly claimed these were the same call. They are not;
  this design deliberately switches the no-TUI branch to `concertino answer` specifically because the
  ticket requires `concertino answer` be "the single authoritative write path for a chat-collected
  answer whenever a store exists to write to" (a store — `answer.json` — always exists as a
  possibility, so this is the correct call regardless of whether the round-1 draft mis-stated it as
  already-in-use). Still calling `--raise-only` first is exactly what closes design-gate round-1's
  discard-of-stale-answer and unbounded-poll findings (Decisions below): the escalation is genuinely
  raised (with a real `raised_at`), so a second no-TUI escalation in the same run discards the prior
  one's leftover `answer.json` exactly as the TUI-attached path already does, and a dashboard that
  attaches later finds a real, timestamped escalation to poll against rather than one that was never
  raised. "A timeout is never an approval" still holds: this branch never calls `--await`/`--wait-only`
  and never waits against a deadline — resolution happens only via an explicit, successful
  `concertino answer` write, so there is no elapsed-time condition anywhere in this branch that could
  be mistaken for an approval.

  **Pre-existing, not newly introduced (non-blocking note, design-gate round 1):**
  `concertino answer`'s `recordAnswered` hardcodes `role=orchestrator` on the `escalation.answered`
  event it writes (`lib/cli/answer.js`), regardless of which role actually raised the underlying
  question. This is unchanged behavior — the existing bubbled-root resolution path already has this
  same property today (it already resolves through `concertino answer`) — not a regression this
  design introduces; a sub-agent-originated no-TUI escalation's `escalation.raised` event (from the
  `--raise-only` call above) still correctly carries `role=<raiser>`, only the later `.answered` event
  loses that distinction, exactly as it already does on the existing bubbled path.
- The subagent (non-root, no dashboard to bubble state to before returning) branch's `ESCALATION-PENDING`
  contract is unaffected by `TUI_ATTACHED` — it already writes `PENDING_ESCALATION` to
  `workflow-state.md` and returns; whether the *root*, once it receives the bubbled escalation, finds
  `TUI_ATTACHED=0` or `=1` is re-checked at the root's own resolution point (Decision 3), not decided
  by the subagent that bubbled it — `TUI_ATTACHED` is re-read fresh at whichever hop is about to act on
  it, since a dashboard can attach or detach between the moment a subagent bubbles and the moment the
  root resolves.

Sub-agent-originated escalations (`ESCALATION` from executor/evaluator/skeptic, `ESCALATION-RAISE`
from auditor) are already required (`subagent-escalation-raise`, `escalation-bubble-up`) to be raised
through this exact same call site, tagged `role=<raiser>` — per CON-127's design.md Decision 4 and
Decision 6 ("no sub-agent ever calls `emit-event.sh` or reasons about TUI state"), so they inherit
`TUI_ATTACHED` gating automatically, with zero additional code. This is the literal payoff of
CON-127's single-call-site assumption.

### Decision 3 — The root's resolution loop, re-checked fresh at resolution time

`escalation-bubble-up`'s "root's resolution procedure" (used both when the root raises directly and
when it resolves a bubbled `ESCALATION-PENDING`) also re-checks `tui-attached.sh` at the point it
would otherwise start its `--wait-only` polling loop — because a dashboard can attach or detach
between raise time and resolution time, and the resolution-time state, not the raise-time state, is
what determines whether polling can do anything useful:
- `TUI_ATTACHED=1`: poll `--wait-only`, accept a racing chat reply, write through `concertino
  answer`. **This is now safe in every case, including a raise that happened under
  `TUI_ATTACHED=0`** (corrected per design-gate round-1 REFUTE, CR5): because Decision 2's no-TUI
  branch always calls `--raise-only` before resolving, `escalation.raised` (with a real `raised_at`)
  exists for this ticket regardless of which branch performed the raise, so `--wait-only`'s deadline
  arithmetic (`emit-event.sh`'s `RAISED_AT`/`REAL_DEADLINE_MS`) always has a genuine value to compute
  against — the round-1 draft's hang (a dashboard attaching after a raise that, in that draft, never
  wrote `escalation.raised` at all) cannot occur, because there is no longer any raise path that skips
  the write.
- `TUI_ATTACHED=0`: skip the `--wait-only` polling loop entirely (there is nothing on the dashboard
  side that could resolve it) — wait directly for the chat reply, then write it through `concertino
  answer`. `concertino answer`'s own refusal-on-already-answered behavior (`escalation-answer-cli`)
  still applies unchanged — first-write-wins is preserved by construction (same write path, same
  refusal semantics) in both branches, per the ticket's "do not weaken first-write-wins in the no-TUI
  branch" requirement.

### Decision 4 — Adapter safety

`tui-attached.sh` is invoked as an ordinary shell script, exactly like every other
`scripts/concertino/*.sh` call already in `core/roles/orchestrator.md` — no new harness-specific tool
name, no new `{{block:...}}` construct required beyond what already gates the surrounding
`SendMessage`/topology prose. Verified via CON-134's render-diff proxy (render all harnesses into
throwaway dirs under a temp directory, diff `SendMessage` and any new-string occurrence counts
baseline-vs-modified) before this change is considered done.

## Risks / Trade-offs

- [Risk] `watch-lock.js`'s accepted PID-recycling risk (a dead dashboard's pid reused by an unrelated
  long-lived process) is inherited unchanged by `tui-attached.sh` → Mitigation: explicitly documented
  here and in the script's own header comment as an inherited, accepted risk, not a new one introduced
  by this change; not remediated separately from `watch-lock.js` itself, to avoid the two checks
  silently diverging.
- [Risk] A future `concertino watch` invocation that doesn't go through `watch.js`'s existing
  `acquire()`/`heartbeat()`/`release()` lifecycle (e.g. a different entry point) would leave
  `tui-attached.sh` unable to detect it → Mitigation: `tui-attached.sh`'s header comment states the
  dependency explicitly; no known second entry point exists today.
- [Risk] `kill -0` semantics differ across POSIX shells → Mitigation: `bash` is already a hard
  dependency of every sibling script in `scripts/concertino/`; no new portability surface.

- [Risk] A second escalation raised in the same run, no TUI attached — would be unresolvable if the
  first escalation's `answer.json` were left behind → Mitigation: closed by Decision 2's `--raise-only`
  call, which performs the existing one-time `discard_stale_answer` exactly as the TUI-attached path
  already does; not a new mechanism, reuse of the existing one.

## Migration Plan

Additive only. `tui-attached.sh` is new; `core/roles/orchestrator.md` gains one new conditional
branch at one call site with no removal of existing behavior. Rollback = revert the commit.
