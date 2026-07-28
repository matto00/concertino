# Concertino TUI — fleet dashboard, control plane, launch pad

**Status:** design approved, not yet implemented
**Date:** 2026-07-27

A terminal UI shipped with Concertino for watching and steering a fleet of
orchestrator runs at a high level, plus the harness-agnostic telemetry substrate
that feeds it.

---

## Why

Concertino can already run a fleet of orchestrators unattended — every loop is
bounded and every bound has a defined escalation. What it can't do is *show you
the fleet*. Today the only views are a wall of raw agent chatter in whatever
terminal you started `claude` in, and `workflow-state.md`, which is a snapshot
written for the agent's benefit rather than a history written for yours.

The gap is not information — the workflow already produces every fact worth
displaying. The gap is that those facts are trapped in prose, in transcripts, and
in files that get destroyed at cleanup.

## Non-goals

Deliberately out of scope for v1:

- A web UI.
- Multi-repo fleets. Events are **keyed** `(project, ticket)` from day one so this
  is a later grouping change and not a schema change, but discovery is cwd-only.
- Historical analytics or aggregate stats across runs.
- Editing plans, specs, or any artifact from the TUI.
- Custom rendering of agent output. Attach is `tmux attach` — full stop. We never
  parse or re-render a harness's own TUI.
- Native Windows. tmux means Linux, macOS, and WSL.

---

## Constraints that shaped this

1. **Harness-agnostic for real.** Claude Code, Codex CLI, and local models behind
   any harness that can run bash. Per `docs/harness-capabilities.md`, the procedure
   scripts and Iron Laws are the only things byte-for-byte identical across
   harnesses — so the telemetry seam has to be the scripts.
2. **Zero npm dependencies.** `package.json` has none today and keeps none.
3. **Subscription-billed harnesses only.** No API-key path is assumed. This is why
   batch concurrency is a bounded, visible, editable number rather than an
   unbounded fan-out — advertised Pro/Max limits assume ordinary individual usage,
   and an unbounded parallel batch is the one feature that could push a user out of
   that. Default `maxConcurrent: 2`.
4. **Runs outlive the UI.** An overnight batch must survive the TUI crashing, the
   ssh session dropping, and the laptop lid closing.

---

## Architecture

Five units, each independently testable.

| Unit | Location | Depends on |
| --- | --- | --- |
| `emit-event.sh` | `core/scripts/` | bash + coreutils |
| Session backend | `lib/ui/session.js` | tmux |
| Run store (reducer) | `lib/ui/reducer.js` | nothing — pure |
| TUI renderer | `lib/ui/render.js`, `lib/ui/screens/*.js` | run store |
| Linear client | `lib/ui/linear.js` | `LINEAR_API_KEY`, feature-flagged |

The reducer is the keystone:

```
(events[], workflowState, tmuxState) → Run[]
```

Pure, synchronous, no I/O. Everything hard to test sits on one side of it;
everything worth testing sits inside it.

`bin/concertino` is already 1411 lines. The UI goes in `lib/ui/*` modules required
from it, not inline. `package.json → files` gains `lib/`.

---

## Telemetry: three tiers of reliability

The design's central idea. Three sources of differing trustworthiness, and a UI
that **degrades down them rather than failing**.

### Tier 1 — process state (free, cannot be wrong)

The TUI owns the tmux windows, so alive / dead / exit-code / output-idle-time cost
nothing and need no cooperation from the agent or the harness. This is what
produces "HEL-334 has produced no output for 11 minutes" — frequently the single
most useful fact on screen.

Idle detection is a **hash of `capture-pane` output over time**, never a parse of
it. Format-independent, so it works identically for Claude Code, Codex, or a local
model.

### Tier 2 — script events (deterministic)

The procedure scripts already run at every structural moment and already have a
`READY k=v` / `PASS` / `FAIL` contract. They call `emit-event.sh` directly, so
setup, ports, server health, gate results and cleanup become non-negotiable
telemetry that no model can forget.

### Tier 3 — semantic events (prose compliance)

Phase transitions, verdicts, cycle counters, escalations. Only the agent knows
these. This adds **no new compliance surface**: `core/roles/orchestrator.md`
already requires rewriting `workflow-state.md` at exactly these moments, so it is
one additional line at points the role must already touch.

### Degradation ladder

| Available | Rendered |
| --- | --- |
| All three tiers | Full timeline, gate panel, phase pipeline |
| Tiers 1 + 2 | `running · phase unknown · gates 3/4` — ports and gates real |
| Tier 1 only | `running · no telemetry · idle 11m` |

Absent data is never rendered as healthy data. An uninstrumented run looks
*conspicuously uninstrumented*. This is the property that makes it safe to look
away from an unattended fleet.

---

## State layout

Events live in the **main checkout**, not the worktree:

```
.concertino/
  worktrees/HEL-334/          ← existing; destroyed by cleanup.sh --phase4
  runs/HEL-334/
    events.jsonl              ← survives cleanup; the run's history
    answer.json               ← control plane writes here
```

`workflow-state.md` lives at `WORKTREE_PATH/<change-dir>/` and `cleanup.sh
--phase4` destroys the worktree. Putting the event log there would erase every
run's history at the exact moment it succeeded.

Agents run *inside* the worktree, so `emit-event.sh` resolves the main checkout via
`git rev-parse --git-common-dir` — shared between a worktree and its main checkout —
then walks up to the repo root.

`workflow-state.md` is unchanged and keeps its current job: crash recovery for the
**agent**. The event log is for the **human**. Different consumers, different
lifetimes, no merging of concerns. The reducer reads both.

---

## Event schema

One JSON object per line, append-only. Always present: `t` (epoch ms), `kind`,
`project`, `ticket`, `role`.

`role` is one of `orchestrator`, `executor`, `evaluator`, `skeptic`, `script`
(tier-2 events emitted by the procedure scripts themselves), or `human` (control-plane
events written by the TUI).

| Kind | Emitted by | Fields |
| --- | --- | --- |
| `run.start` | `setup-worktree.sh` | `harness`, `model`, `branch`, `worktree`, `dev_port`, `backend_port` |
| `run.end` | orchestrator | `status` = `delivered` \| `killed` \| `failed` \| `escalated` |
| `phase.enter` | orchestrator | `phase`, `cycle` |
| `agent.spawn` | orchestrator | `role` |
| `agent.resume` | orchestrator | `role`, `cycle` |
| `agent.return` | orchestrator | `role`, `verdict` |
| `gate.result` | scripts, executor, evaluator | `gate`, `status`, `duration_ms`, `first_error` |
| `verdict` | evaluator, skeptic | `verdict` = `PASS`\|`FAIL`\|`BLOCKER`\|`CONFIRM`\|`REFUTE`, `ref` |
| `evidence` | any | `ref`, `label` |
| `escalation.raised` | any | `question`, `options[]` |
| `escalation.answered` | TUI | `answer` |
| `escalation.timeout` | `emit-event.sh` | — |
| `note` | any | `msg` |

The vocabulary is a transcription of the signal table at `core/roles/orchestrator.md`
("Signal Types") and the circuit-breaker table in the same file. Nothing new is
invented; prose signals are serialised.

### Two hard constraints

**Lines are capped at 4000 bytes**, with `msg` and `first_error` truncated to fit.
Under `O_APPEND` a write below `PIPE_BUF` is atomic, so an orchestrator and a
sub-agent appending concurrently cannot interleave. Each run owns its own file, so
parallel runs never contend at all.

**`--await` never blocks forever.** On `dashboard.escalationTimeoutMinutes` it emits
`escalation.timeout`, exits non-zero, and the agent falls back to its existing
behaviour of printing the escalation to chat. The TUI accelerates escalations; it
must never become a new way for a run to hang.

---

## `emit-event.sh`

A new canonical script, distributed and synced exactly like the existing four.
Takes `k=v` pairs and builds the JSON itself, so no caller ever hand-quotes JSON.

```bash
# fire and forget
emit-event.sh phase.enter ticket=HEL-334 phase=Evaluation cycle=2

# blocking — returns the human's decision on stdout
emit-event.sh escalation --await \
    ticket=HEL-338 \
    question="Add zod@3.23 as a runtime dependency of shared contracts?" \
    options=approve,deny
```

`--await` writes `escalation.raised`, then polls `answer.json` until it appears or
the timeout fires. From the agent's side, raising an escalation is a single bash
call that returns the answer — no polling loop for the model to forget, and no
keystroke injection into a PTY.

---

## Session backend

A five-method interface over tmux so the TUI never shells out directly:

```
spawn(ticket, cmd) · list() · capture(ticket) · attach(ticket) · kill(ticket)
```

One tmux session (`dashboard.tmuxSession`, default `concertino`), one window per run,
window named for the ticket.

`concertino watch` **adopts an existing session on startup** rather than clobbering
it. Restarting the TUI, or ssh-ing in from another machine, re-attaches to the live
fleet instead of starting a second one.

---

## Screens

### Fleet view — attention-sorted

Escalations and blockers pin to the top and cannot scroll away.

```
┌ concertino · helio ──────────────────────────────── 4 runs · 1 needs you ─┐
│                                                                          │
│  NEEDS YOU                                                               │
│  ▸ HEL-338  spec-delta-validation                            ESCALATION  │
│      new external dependency: zod@3 — approve?     [a]pprove   [d]eny    │
│                                                                          │
│  RUNNING                                                                 │
│    HEL-331  auth-token-refresh                                           │
│      ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪░░░░░░░░  Execution   cycle 2/5   gates 3/4    8m  │
│    HEL-334  panel-resize-handles                                         │
│      ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪░░  Evaluation  cycle 1/5   gates 4/4   23m  │
│                                                                          │
│  DONE                                                                    │
│    HEL-341  csv-connector-retry           PR #218 open            1h04m  │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ ↵ attach   n new run   k kill   r restart   / filter   q quit            │
└──────────────────────────────────────────────────────────────────────────┘
```

### Drill-down — timeline and panels, with a role gutter

The agent-name column is colour-coded per role, so handoffs and the skeptic's
isolated cold spikes read at a glance without spending 64 columns on swimlanes.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ HEL-334  panel-resize-handles                        Evaluation · c2/5   │
│ feature/panel-resize-handles/HEL-334                 claude · opus-5     │
│ .concertino/worktrees/HEL-334   :5334 :8334          started 15:00 · 23m │
├──────────────────────────────────────────────────────────────────────────┤
│ Setup ✓─ Planning ✓─ Execution ✓─ Evaluation ●─ Delivery ○─ Cleanup ○    │
├─────────────────────────────────────────┬────────────────────────────────┤
│ TIMELINE                                │ GATES · evaluator c2           │
│ 15:02  skeptic    design gate  CONFIRM  │  ✓ typecheck            4.1s   │
│ 15:04  executor   spawned               │  ✓ lint                 2.8s   │
│ 15:09  executor   gates        4/4      │  ✓ test                1m12s   │
│ 15:09  executor   commit       a3f9e1   │  ✗ build                8.4s   │
│ 15:11  evaluator  spec review  2 CRs    │    └ TS2345 Panel.tsx:88       │
│ 15:11  evaluator  verdict      FAIL     │                                │
│ 15:14  executor   resumed      cycle 2  │ EVIDENCE                       │
│ 15:22  evaluator  re-eval      running… │  eval-report-c1.md             │
│                                         │  proposal.md · design.md       │
│                                         │  diff  +182 −41 · 9 files      │
├─────────────────────────────────────────┴────────────────────────────────┤
│ ↵ attach   l logs   e evidence   k kill   r restart   esc back           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Escalation

```
┌──────────────────────────────────────────────────────────────────────────┐
│ HEL-338  spec-delta-validation                       Planning · BLOCKED  │
├──────────────────────────────────────────────────────────────────────────┤
│  ▲ ESCALATION  new external dependency          raised 15:31 · 4m ago    │
│                                                                          │
│  Validation of spec deltas needs a schema library. Proposal adds         │
│  zod@3.23 as a runtime dependency of the shared contracts package.       │
│                                                                          │
│  raised by orchestrator   ·   source proposal.md:41                      │
│                                                                          │
│    [a] approve — continue with zod@3.23                                  │
│    [d] deny — replan without a new dependency                            │
│    [t] type a reply…                                                     │
│                                                                          │
│  ↳ writes .concertino/runs/HEL-338/answer.json — agent is polling        │
├──────────────────────────────────────────────────────────────────────────┤
│ a approve   d deny   t reply   ↵ attach   esc back                       │
└──────────────────────────────────────────────────────────────────────────┘
```

### Launch pad — epics left, tickets right

The right pane carries an **inline status column** so a ticket already *In
Progress* in Linear, or already backed by a live run, is visible at selection time
rather than only on the confirm screen.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ NEW RUN · helio                                          34 open tickets │
├──────────────────────────────┬───────────────────────────────────────────┤
│ EPICS                        │ Pipeline v2                               │
│ ▸ Pipeline v2         8 open │ [x] HEL-338  spec-delta-validation   Todo │
│   Panel system        5 open │ [x] HEL-341  csv-connector-retry     Todo │
│   Auth hardening      3 open │ [ ] HEL-347  sql-source-introspect   Todo │
│   Connector SDK      12 open │ [x] HEL-349  pipeline-shape-presets  Todo │
│                              │ [ ] HEL-352  scaffold-step-registry  ▲run │
│   ─ unassigned ─      6 open │                                           │
│                              │ 3 selected · parallel ×2                  │
├──────────────────────────────┴───────────────────────────────────────────┤
│ space select   a all   s sequential   p parallel   ↵ launch   esc back   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Launch plan — the confirm gate

```
┌──────────────────────────────────────────────────────────────────────────┐
│ LAUNCH PLAN                                          HEL-338 +2          │
├──────────────────────────────────────────────────────────────────────────┤
│  3 tickets  ·  parallel  ·  max 2 concurrent                             │
│  harness  claude          base  main @ 3b2023c                           │
│                                                                          │
│   1  HEL-338  spec-delta-validation     :5338 :8338   start now          │
│   2  HEL-341  csv-connector-retry       :5341 :8341   start now          │
│   3  HEL-349  pipeline-shape-presets    :5349 :8349   queued             │
│                                                                          │
│  each runs:  claude  "/concertino-deliver HEL-XXX"                       │
│  worktrees:  .concertino/worktrees/HEL-XXX                               │
│                                                                          │
│  ▲ 2 runs already active — fleet would be 4 concurrent                   │
├──────────────────────────────────────────────────────────────────────────┤
│ ↵ confirm & launch     c concurrency     h harness     esc cancel        │
└──────────────────────────────────────────────────────────────────────────┘
```

Three things this screen does deliberately:

- **Ports are shown pre-flight.** They are derived from the ticket number by
  `setup-worktree.sh`, so the plan can display them before anything runs, and a
  collision is visible rather than discovered.
- **Concurrency is a bounded number, on screen, editable.** "Parallel" never means
  unbounded fan-out.
- **The already-active warning counts the whole fleet**, not just this batch,
  because that is what actually lands on the machine and the rate limit.

---

## Control plane

Split by reliability, and the split is the safety property:

- **Process actions** (`attach`, `kill`, `restart`) go straight to tmux. Reliable,
  no agent cooperation, and they work on a run with zero telemetry.
- **Semantic actions** (approve, deny, reply) write `answer.json` with `O_EXCL`.
  First writer wins; a second TUI is told "already answered" rather than silently
  racing. The agent, blocked in `emit-event.sh escalation --await`, returns the
  moment the file lands.

No keystroke synthesis into a PTY, and no dependence on detecting when a harness is
at an input prompt. The mechanism is identical on Codex and on a local-model
harness.

---

## Launch pad and queue

Gated on **all three** of `dashboard.launchPad.enabled`, `ticketProvider.kind ===
"linear"`, and a `LINEAR_API_KEY` environment variable, so the feature cannot
half-activate.

Read-only against Linear. Concertino never writes ticket state from the TUI — the
orchestrator already owns that transition.

Launching runs `tmux new-window` with the harness's configured launch template
(`claude "/concertino-deliver HEL-334"`, or the Codex equivalent). The queue runner
holds `dashboard.maxConcurrent` and starts the next ticket when a run emits `run.end` or
its window dies. **Sequential is `maxConcurrent: 1`** — the degenerate case of the
same path, not a second code path.

---

## Config additions

Added to `concertino.config.json` and `config/concertino.schema.json`:

```json
"dashboard": {
  "tmuxSession": "concertino",
  "maxConcurrent": 2,
  "escalationTimeoutMinutes": 60,
  "launchPad": { "enabled": false }
}
```

**Not `ui`** — that key is already taken. `ui` describes whether the *project under
test* has a user interface and how the evaluator reviews it (`ui.enabled`,
`ui.tool`, `ui.triggers`, `ui.breakpoints`), consumed at `bin/concertino:186` and
defined at `config/concertino.schema.json:106`. Reusing it would collide with the
evaluator's UI-review phase.

---

## Failure modes

| Failure | Behaviour |
| --- | --- |
| tmux absent | `doctor` flags it; `watch` exits with an install hint, never half-starts |
| Malformed JSONL line | Skipped and counted; footer shows `▲ 2 malformed events`. Never crashes the TUI |
| Window died, no `run.end` | Run renders `failed · window exited`, not `running` |
| Agent crashed holding an escalation | `--await` times out, emits `escalation.timeout`, row shows it timed out |
| Two TUIs answer at once | `O_EXCL` — one wins, the other is told |
| Linear API down or token invalid | Launch pad shows the error; fleet view entirely unaffected |
| Terminal narrower than 80 cols | Progress-bar column drops first; nothing reflows into unreadability |
| tmux session exists from a prior TUI | Adopted, not clobbered |

---

## Testing

The reducer being pure is what makes this cheap. Node's built-in `node --test` —
still zero dependencies.

- **Reducer** — fixture `events.jsonl` in, expected `Run[]` out. The bulk of the
  value: every degradation tier, out-of-order events, missing `run.end`, budget
  exhaustion, malformed lines.
- **`emit-event.sh`** — shell tests for JSON shape, 4000-byte truncation, concurrent
  append with no interleaving, and `--await` in both the answered and timed-out
  cases.
- **Session backend** — integration against a real tmux driving `sleep 300`.
- **Renderer** — `render(runs, {cols, rows}) → string` snapshot tests at 80×24 and
  120×40.

No test requires a real Claude session, a Linear token, or network access.

---

## Implementation surface

| File | Change |
| --- | --- |
| `core/scripts/emit-event.sh` | new |
| `core/scripts/README.md` | document the new script and its contract |
| `core/scripts/{setup-worktree,start-servers,assert-phase,cleanup}.sh` | emit tier-2 events |
| `core/roles/{orchestrator,executor,evaluator,skeptic}.md` | emit tier-3 events where each already writes `workflow-state.md` |
| `lib/ui/*` | new — session, reducer, render, screens, linear |
| `bin/concertino` | new `watch` subcommand; `doctor` gains a tmux check; `sync` copies `emit-event.sh` |
| `config/concertino.schema.json` | `dashboard` block |
| `package.json` | `files` gains `lib/`; `test` runs `node --test` |
| `docs/` | a `dashboard.md` page |

---

## Build order

Three shippable slices, each useful on its own:

1. **Telemetry + read-only fleet view.** `emit-event.sh`, tier-2 emission from the
   scripts, tier-3 emission from the roles, the reducer, the session backend, and
   the fleet screen with attach. At the end of this slice you can watch a fleet;
   you just can't steer it from the TUI.
2. **Control plane + drill-down.** `--await`, `answer.json`, the escalation screen,
   the D1 drill-down, and kill/restart.
3. **Launch pad.** Linear client, epic/ticket browser, launch plan, queue runner.

Slice 1 must land before slice 2 — the control plane has nothing to act on without
the event log. Slice 3 depends only on the session backend from slice 1 and can be
built in parallel with slice 2.

## Implementation note



`emit-event.sh` must be callable from inside a worktree and resolve the main
checkout. `git rev-parse --git-common-dir` is the mechanism, but its output is
relative in some git versions and absolute in others. The implementation must
normalise it and cover both in tests.
