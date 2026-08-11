## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all three spec
  deltas (`specs/run-cost-telemetry/spec.md`, `specs/fleet-metrics-spend/spec.md`,
  `specs/drilldown-run-cost/spec.md`) in full.
- Both already-answered design-escalation questions are correctly reflected:
  v1 is Claude-Code-only (`design.md` Non-Goals; `run-cost-telemetry` spec
  scopes to Claude Code only), and the drill-down gets a per-run cost line in
  addition to METRICS (`drilldown-run-cost` capability + spec).
- All three ACs are covered by a task: AC1 (tasks 1.1-1.2, 3.1-3.3), AC2
  (tasks 4.1-4.3), AC3 (tasks 6.1-6.2).
- Verified several factual claims the design leans on against the actual
  codebase in this worktree:
  - `lib/ui/reducer.js:13` — `TIER2_KINDS = new Set(['run.start', 'gate.result'])`,
    `emptyRun()` at line 32 — matches the design's premise.
  - `lib/cli/emit.js`'s `copyAssets()` (lines 386-398) does copy every file
    under `core/scripts/` into `scripts/concertino/`, chmod +x only `.sh` —
    task 1.3's claim about picking up `pricing-table.json`/`report-cost.sh`
    with no code change is correct.
  - `mergeAgentMergeSettings()` (`lib/cli/emit.js:31-47`) is a real,
    read-modify-write, additive precedent for the proposed
    `mergeCostHookSettings()` — structurally sound to mirror.
  - `lib/ui/controllers/fleet.js:541-543` / `:677-680` confirm the
    claude-code-only inline-notice precedent design.md cites for the
    drill-down's degrade text.
  - `lib/ui/screens/fleet/metrics.js`'s `metricsFor()`/`metricsColumnLines()`
    and `lib/ui/screens/drilldown.js`'s `harnessText()`/`speedModelsText()`/
    `headerLines()` all exist as described, so tasks 4.x/5.x are pointed at
    real integration seams.
  - `lib/config.js` has both `agentMerge` validation (lines 178-303, 691-703)
    and `resolveModel`/`FALLBACK_MODEL` (lines 123-226) as claimed, so tasks
    1.1/2.1/2.3's precedents are real.
- Traced the actual process-spawn mechanics this design's core mechanism
  depends on, since nothing in this codebase has ever wired a Claude Code
  hook before (`grep -rn "SessionEnd\|SubagentStop" core/ openspec/specs`
  returns nothing) — this is genuinely new, unprecedented surface, so I did
  not take Decision 5's factual claims about hook behavior on faith:
  - `lib/ui/session.js`'s `spawn()` (`tmux new-window`/`respawn-window`,
    lines ~220-236) passes no `-c`/start-directory to tmux at all.
  - `lib/ui/prompt.js`'s default `launchCommand` is
    `claude "/concertino-deliver {{TICKET}}"` — no `cd` anywhere in the
    constructed command.
  - `core/roles/orchestrator.md` steps 2-6 (lines 150-200+): the orchestrator
    calls `setup-worktree.sh` to *create* the worktree and thereafter passes
    `WORKTREE_PATH` as an explicit argument to every subsequent script
    (`assert-phase.sh setup "$WORKTREE_PATH" ...`) rather than `cd`-ing into
    it once.
  - Together these three facts establish that the orchestrator's own
    top-level Claude Code process's `cwd` is the **main checkout**, not the
    ticket's worktree, for the whole life of that session.
  - `core/roles/orchestrator.md` lines 474-529: the orchestrator spawns
    executor/evaluator/skeptic/auditor by passing each of them the **same**
    `WORKTREE_PATH` it holds for the ticket — i.e. every sub-role sharing a
    delivery round has an identical `cwd`, if `cwd` even reflects the
    worktree for them at all (see Change Request 1 below).

### Verdict: REFUTE

The plan is well-organized and each individual task is well-scoped, but the
whole feature's data-plumbing mechanism (Decision 1 + Decision 5 in
`design.md`, and tasks 1.2/3.3) rests on two technical premises I could not
confirm against the actual codebase and have concrete reason to believe are
wrong. Both are load-bearing — if either is wrong, AC1 ("at least one harness
reliably reports cost/token usage") silently fails at runtime with no error,
which is exactly the "silent" failure mode this ticket exists to avoid.

### Change Requests

1. **`SessionEnd` may not fire once per role spawn — it may fire once per
   ticket delivery, or not at all for sub-roles.** `design.md` Decision 1
   asserts "every Claude Code session that runs as part of a ticket's
   delivery... gets its own `SessionEnd` hook firing... confirmed by how
   `Agent()` spawns work in this codebase," but no such confirmation is
   actually shown anywhere in the design, and nothing in this repo has ever
   used a Claude Code hook before (there is no existing precedent to point
   to). Concertino's executor/evaluator/skeptic/auditor are spawned via the
   orchestrator's own in-session `Agent` tool call — they are subagents of a
   single top-level Claude Code CLI process, not separate `claude` CLI
   invocations. Claude Code's hook taxonomy has a *distinct* hook,
   `SubagentStop`, specifically for when a Task/Agent-tool subagent
   completes; `SessionEnd` is documented to fire when the top-level session
   itself terminates. If that distinction holds here, wiring only
   `SessionEnd` would emit **at most one** `run.cost` event per ticket
   delivery (the orchestrator's own session ending) — capturing only the
   orchestrator's usage, not the sub-roles', which is close to the opposite
   of what Decision 1 argues for and what tasks 3.3/3.4 ("multi-event
   summation") are built to handle. **Required revision:** before committing
   to this architecture, verify empirically (e.g. a throwaway sync + a real
   sub-agent spawn + inspecting whether `SessionEnd` fires per subagent or
   only once) whether `SessionEnd` or `SubagentStop` (or both, for different
   roles) is the correct hook, and update Decision 1/Decision 5 and the
   `run-cost-telemetry` spec's "one event per Claude Code session" language
   accordingly. If sub-role completions only fire `SubagentStop` (which by
   Claude Code's own hook payload shape may not carry a `transcript_path` for
   the subagent specifically), that changes both the hook wired in
   `mergeCostHookSettings` and what `report-cost.sh` reads.

2. **`cwd` cannot disambiguate *role* even if it does disambiguate ticket,
   and may not even reliably disambiguate ticket.** Decision 5 states
   "`ticket`/`role` are derived from `cwd` the same way other worktree-scoped
   scripts already derive ticket id from the worktree path basename." Two
   problems:
   - The cited precedent (`assert-phase.sh`'s `GATE_TICKET` fallback,
     `${WORKTREE_PATH##*/}`) derives *ticket* from a worktree-path basename —
     it says nothing about deriving *role*, and there is no existing
     precedent anywhere in this codebase for inferring which of
     orchestrator/executor/evaluator/skeptic/auditor is running from `cwd`
     alone. Every existing `role=` field in an emitted event (e.g. the
     skeptic's own `verdict` call, `core/roles/skeptic.md` line 160:
     `role=skeptic`) is a literal hardcoded in that role's own prompt, not
     derived. `report-cost.sh` is a single shared script invoked identically
     regardless of which role's session is ending, with no equivalent
     hardcoded literal available to it.
   - Per Change Request 1's evidence, executor/evaluator/skeptic/auditor all
     share the *same* `WORKTREE_PATH` the orchestrator passed to each of
     them (`core/roles/orchestrator.md` spawn instructions) — so even setting
     role aside, `cwd` alone cannot distinguish *which* of those four
     sub-roles' session just ended; at best it could disambiguate the
     orchestrator (main checkout) from "some sub-role" (worktree), never
     which sub-role. **Required revision:** specify concretely how
     `report-cost.sh` is meant to determine `role`, given the hook payload's
     documented fields (`session_id`, `transcript_path`, `cwd`,
     `hook_event_name`, `reason` — no role) and no ambient env var
     equivalent to `CONCERTINO_ROLE` is set for a hook process spawned by
     Claude Code itself. If role truly can't be recovered, the design should
     say so explicitly and either drop `role` from the `run.cost` event or
     substitute a coarser field (e.g. `role: "unknown"`) — not leave it as an
     unaddressed "derived from cwd" hand-wave that tasks.md 1.2 and
     design.md Decision 5 both repeat as if solved.

3. **`emit-event.sh` cannot emit a fractional `cost_usd` as a JSON number.**
   `scripts/concertino/emit-event.sh`'s `json_value()` (lines 120-130)
   auto-unquotes a `k=v` value only when it matches
   `^-?(0|[1-9][0-9]*)$` (a bare JSON integer) or `true`/`false`; anything
   else — including any value with a decimal point — is JSON-string-quoted.
   A real Claude Code session's dollar cost is essentially always fractional
   (e.g. `0.0234`), so `cost_usd=0.0234` passed through the existing
   `emit-event.sh run.cost ...` call chain (as design.md Decision 5 and
   tasks.md 1.2 both specify verbatim) would be emitted as
   `"cost_usd":"0.0234"` — a **string**, not a number. `run-cost-telemetry`'s
   reducer requirement ("add that event's `cost_usd`... to a running
   `run.costUsd` total... never replace") and `fleet-metrics-spend`'s
   summation both assume numeric addition; summing a JS string field via `+`
   silently produces string concatenation or `NaN`, not a dollar total — the
   exact "silently presenting a total that looks complete but isn't" failure
   this ticket's AC2 explicitly calls out as unacceptable. **Required
   revision:** either (a) extend `emit-event.sh`'s `json_value()` regex to
   also auto-unquote a well-formed JSON decimal (and add that as an explicit
   task, since it's a shared script every other event kind also uses — a
   regex change there is not risk-free and deserves its own test), or (b)
   have `report-cost.sh` emit `cost_usd` pre-multiplied into an integer unit
   (e.g. micro-dollars) with the reducer/METRICS/drill-down all converting
   back for display, or (c) explicitly require the reducer's `run.cost` case
   to `Number(ev.cost_usd)` (or equivalent parse) before summing, tolerating
   the string encoding rather than fighting it — and state which of these
   the implementation must do. Right now none of design.md, the spec, or
   tasks.md acknowledges the gap at all.

### Non-blocking notes

- Decision 2's pricing-table format and Decision 3's `costTracking.enabled`
  default-off/additive-merge design are sound and well-precedented
  (`mergeAgentMergeSettings` is a good structural template).
- Decision 4's three-state honest-degradation taxonomy (no data / partial
  price coverage / full data) is clear and the spec's scenarios trace back to
  it cleanly — no notes there.
- Once Change Requests 1-2 are resolved, double-check whether the resolution
  changes anything about Non-Goals' "per role spawn is the finest granularity
  available for free" claim, since that claim is itself downstream of the
  same "own session via `Agent()`" premise being questioned in CR1.
