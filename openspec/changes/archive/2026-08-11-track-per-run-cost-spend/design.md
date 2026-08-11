## Context

Concertino's event log (`.concertino/runs/<TICKET>/events.jsonl`, folded by
`lib/ui/reducer.js`) has no notion of `$` or token cost. Every run currently
costs real API spend with zero dashboard visibility into it. The ticket's own
research (recorded in this ticket's design escalation, answered by the human
before this change) established:

- **Claude Code**: no direct `$` field for an *interactive* session (the
  `--output-format json` `total_cost_usd` field only appears in
  non-interactive `-p` mode, which concertino's tmux-launched sessions don't
  use). Claude Code does support a `SessionEnd` hook, invoked with a JSON
  payload on stdin — `session_id`, `transcript_path`, `cwd`, `hook_event_name`,
  `reason`, and (round-1 skeptic REFUTE research, see Decision 1) `agent_type`/
  `agent_id` when the firing session is a Task-tool subagent rather than the
  root session — where `transcript_path` points to the session's JSONL
  transcript. **This paragraph states the original, doc-derived research
  claim as it stood before implementation began — Decision 1, below, found
  by empirical testing that the `SessionEnd`/subagent part of it is wrong
  (`SessionEnd` never carries `agent_type`; `SubagentStop` is the actual
  per-subagent signal). Read Decision 1 for the corrected, verified
  mechanism; this paragraph is left as the original research record, not
  updated in place.** Each assistant-role entry in that transcript carries a
  `message.usage` object: `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`, and
  `message.model`. Summing these across the transcript and converting via a
  pricing table gives a `$` figure — self-maintained, not authoritative, but
  the best available for an interactive session.
- **Codex**: session rollout JSONL (`~/.codex/sessions/**/*.jsonl`) carries
  `token_usage`/`total_token_usage` but no price at all — provider-agnostic,
  no pricing knowledge on Codex's side.
- **OpenCode**: `opencode stats`/`opencode export <sessionID>` expose
  OpenCode's own computed `$` cost natively — the strongest story of the
  three, but explicitly deferred (human's answer: v1 is Claude Code only).

Both open questions from the escalation are resolved inputs to this design,
not decisions made here:
1. **v1 scope = Claude Code only.** Codex/OpenCode support is future work.
2. **Drill-down gets a per-run cost line too** (not METRICS-only).

## Goals / Non-Goals

**Goals:**
- A new tier-2 `run.cost` event, emitted deterministically (script/hook, not
  agent-authored) once per Claude Code session that runs as part of a
  concertino role (orchestrator, executor, evaluator, skeptic, auditor).
- METRICS shows fleet-wide spend today/week, explicit about partial coverage.
- The drill-down shows a run's accumulated cost.
- Honest degradation everywhere a non-Claude-Code run, or a Claude-Code run
  that predates this feature, has no cost data — never a fabricated `$0.00`.

**Non-Goals:**
- Codex or OpenCode cost/token support (explicitly deferred per the human's
  answer — a future ticket, not silently attempted here).
- Authoritative billing reconciliation — the pricing table is self-maintained
  and can drift from Anthropic's actual invoiced rates; this is a *dashboard
  estimate*, stated as such, not a billing system.
- Per-phase (sub-session) cost breakdown beyond "per role spawn" — a
  `SessionEnd` hook fires once per Claude Code session; Concertino already
  gives each role (orchestrator/executor/evaluator/skeptic/auditor) its own
  session via `Agent`/cold spawn, so "per role spawn" is the finest granularity
  available for free, and it directly matches the ticket's "per-phase if the
  harness exposes incremental usage" language without extra plumbing.

## Decisions

### Decision 1: `run.cost` is per-session, accumulated by the reducer — not a single terminal value

**UPDATED — empirically verified against this repo's own runtime (tasks.md
7.1, executed as a required gate before this change could ship), correcting
the doc-derived claim this decision originally made.** The original text
(preserved in git history) claimed `SessionEnd` itself fires once per
Task-tool subagent session, with `agent_type`/`agent_id` present on that
firing. Real probes (nested `claude -p` invocations, `.claude/settings.json`
hooking both `SessionEnd` and `SubagentStop`, one with a built-in
`general-purpose` subagent and one with a real `.claude/agents/
concertino-executor.md`-defined custom agent — see this ticket's
`files-modified.md` for the exact commands/payloads captured) found instead:

- **`SessionEnd` fires exactly once per top-level `claude` process's session**
  (confirmed: one firing per `claude -p` invocation, regardless of how many
  subagents it spawned in between) — its payload **never** carries
  `agent_type`/`agent_id`, even when the session spawned subagents. This is
  the orchestrator's own session ending; `transcript_path` is its own
  transcript.
- **`SubagentStop` — not `SessionEnd` — is the per-subagent signal.** It
  fires once per Task-tool subagent **turn-completion**, carrying
  `agent_type` (the exact `subagent_type` the Task call used — confirmed
  literally `"concertino-executor"` for a real Concertino agent definition,
  not just the built-in `general-purpose` type), `agent_id`, and
  `agent_transcript_path` (the subagent's own transcript file, separate from
  the parent's).
- **Critically: a resumed subagent fires `SubagentStop` again for the SAME
  `agent_id`, against the SAME (appended, not replaced) `agent_transcript_path`
  file.** Probed directly: a `concertino-executor`-typed subagent resumed
  once via `SendMessage` fired `SubagentStop` twice, both times with the
  identical `agent_id`/`agent_transcript_path`, and the transcript file had
  grown (3 assistant turns logged by the second firing, 1-2 by the first).
  Concertino's own orchestrator protocol (`core/roles/orchestrator.md`'s
  "Cycles 2+ — resume" section) resumes the executor/evaluator across
  evaluation cycles routinely — this is not a rare edge case, it is the
  common multi-cycle path. A naive "re-sum the whole transcript file on every
  firing" implementation would double- (or triple-, quadruple-...) count
  every token already reported by an earlier firing for that same agent.

Two corrections follow, both implemented in `report-cost.sh` (Decision 5):
(a) **both `SessionEnd` and `SubagentStop` are wired as hooks**, not just
`SessionEnd` — `SessionEnd`'s `transcript_path` covers the orchestrator/root
role (no `agent_type` -> defaults to `orchestrator`, exactly as originally
designed); `SubagentStop`'s `agent_transcript_path` + `agent_type` covers
every other role. (b) **a persisted per-agent cursor** (Decision 5) makes
each firing sum only the transcript lines it hasn't already reported, so a
resumed subagent's second (third, ...) `SubagentStop` firing contributes only
its own incremental usage, not the whole file again.

`lib/ui/reducer.js`'s fold therefore **sums** every `run.cost` event's
`cost_usd`/token fields into `run.costUsd`/`run.tokens`, mirroring how
`run.gates` already accumulates across `gate.result` events (except summed,
not deduped-by-name — repeat `run.cost` events from distinct sessions, or
distinct resumes of the same session, are never the same increment reported
twice once the cursor above is in place, unlike a retried gate). The raw
per-event list is also kept on `run.events` (already true for every event
kind) so METRICS' today/week windowing can filter by each event's own `t`,
not just the run's aggregate.

**Alternative considered:** one `run.cost` event at the very end of the whole
ticket, summing everything in the orchestrator's own hook. Rejected: the
orchestrator's own `SessionEnd` fires when *its* session ends, which for a
long agentic run may be well before or long after sub-agent sessions finish
(sub-agents are resumed/re-spawned independently), so there is no single
point where "the whole run's cost" is knowable from one hook invocation. Per-
session emission + reducer-side summation is the only architecture where each
event only needs to know its own session's usage.

### Decision 2: the pricing table is a self-maintained, checked-in JSON file, not fetched live

`core/scripts/pricing-table.json` (synced verbatim to
`scripts/concertino/pricing-table.json` by the existing `copyAssets()` loop in
`lib/cli/emit.js`, which already copies every file — not just `*.sh` — out of
`core/scripts/`) maps a model id (e.g. `claude-sonnet-4-5-...`) to
`{ inputPerMTok, outputPerMTok, cacheReadPerMTok, cacheCreationPerMTok }` (all
in USD per million tokens, Anthropic's own published unit). `report-cost.sh`
looks up the transcript's `message.model` value; an unrecognized model id
degrades to "tokens known, `$` unknown" (never a guessed price) — see
Decision 4.

**Alternative considered:** fetch a pricing table from a hosted source at
hook-execution time. Rejected: a `SessionEnd` hook must complete fast and
without new failure modes on an already-terminating session; a network call
introduces latency and a new external dependency this ticket's own escalation
flagged as an explicit reason to escalate ("new external dependency"). A
checked-in file is instant, offline-safe, and its staleness is visible (see
Decision 4's degrade behavior) rather than silently wrong.

### Decision 3: wiring is `costTracking.enabled` (default `false`), additive to `.claude/settings.json` at sync time

A new top-level config key, `costTracking.enabled` (boolean, default
`false`), gates whether `concertino sync`'s `emitClaude()` calls a new
`mergeCostHookSettings(c, out, dry)` — structured exactly like the existing
`mergeAgentMergeSettings()` in `lib/cli/emit.js`: read-modify-write the whole
parsed `.claude/settings.json`, additively appending the SAME hook entry
(`{"matcher": "", "hooks": [{"type": "command", "command":
"scripts/concertino/report-cost.sh"}]}`) into **both** `settings.hooks.
SessionEnd` **and** `settings.hooks.SubagentStop` — Decision 1's empirical
finding is that `SessionEnd` alone only ever reports the orchestrator/root
role; every other role's cost is only observable via `SubagentStop` — without
disturbing any other pre-existing hook or settings key. Off by default
because the pricing table needs ongoing upkeep (Decision 2) a project owner
must opt into, not something silently switched on.

**Alternative considered:** always-on (no config flag), matching how
`run.start`/`gate.result` telemetry is unconditional. Rejected: those events
come from procedure scripts the workflow already runs unconditionally; a
`SessionEnd`/`SubagentStop` hook is new *runtime* surface added to every
Claude Code session project-wide (not just concertino-delivery sessions —
Claude Code has no concept of "only hook concertino's own sessions"), which
is a bigger blast radius to force on by default.

### Decision 4: degrade honestly — three distinct "no data" states, never collapsed into one

- **No `run.cost` event at all for a run** (non-Claude-Code harness, or
  `costTracking.enabled` was off, or the run predates this feature):
  `run.costUsd` stays `null`. METRICS excludes this run from both the
  numerator and the denominator's "reporting" count; the drill-down shows
  "cost not reported for `<harness>`" (mirroring the exact wording style of
  `lib/ui/controllers/fleet.js`'s `address-failure` claude-code-only notice).
- **`run.cost` events exist but at least one carries tokens with no matched
  price** (unrecognized `model` in the pricing table): `report-cost.sh` still
  emits the event with token fields populated and `cost_usd` explicitly
  absent (not `0`); the reducer's sum treats a missing `cost_usd` as
  contributing `0` to the dollar total but still counts the run as "partially
  reporting" — surfaced in METRICS coverage text, never silently rolled into
  a clean-looking total.
- **Every session reported cleanly**: full number, no caveat text.

METRICS' spend line is therefore always of the form `spend today: $X (N/M
runs reporting) · week: $Y (N/M)` — the coverage fraction is not optional
decoration, it is the acceptance criterion ("degrading honestly, not
silently") made concrete. When N == M (full coverage) the parenthetical may
be omitted (matches today's other METRICS lines, which don't show `n/a`
counts when there's nothing missing).

### Decision 5: `report-cost.sh` reads the hook JSON from stdin, sums the (incremental) transcript, calls `emit-event.sh` directly

**UPDATED per Decision 1's empirical findings.** `core/scripts/
report-cost.sh` (new, chmod +x via the existing `.sh` branch in
`copyAssets()`) is wired as **both** a `SessionEnd` and a `SubagentStop`
hook (Decision 3), and dispatches on the payload's own `hook_event_name`:

- `hook_event_name === 'SubagentStop'`: the transcript is
  `agent_transcript_path`; the cursor/dedup key (below) is `agent_id`.
- anything else (`SessionEnd`, the only other event this script is ever
  wired to): the transcript is `transcript_path`; the cursor key is
  `session_id`.

In both cases it streams the JSONL transcript (a `node -e` inline script,
matching `assert-phase.sh`'s own `utf8_safe_char_prefix()` precedent of
reaching for `node -e` for JSON-shaped work rather than `jq` chains), sums
`usage.input_tokens`/`output_tokens`/`cache_creation_input_tokens`/
`cache_read_input_tokens` across every **new** assistant entry (see the
cursor below), resolves the (single, session-wide — Claude Code doesn't
change model mid-session) `model` id against `pricing-table.json`, and calls
`emit-event.sh run.cost ticket=<derived> role=<derived> cost_usd=<or omitted>
input_tokens=... output_tokens=... cache_read_tokens=... cache_creation_tokens=...
model=<id>` — skipping the call entirely (silent no-op) when the increment
contains no new assistant usage (e.g. a resume that itself stopped again with
no new model turn in between).

**Incremental cursor, to avoid double-counting a resumed subagent's
transcript (Decision 1's confirmed finding):** before summing, `report-cost.sh`
reads a plain-text line-count cursor from `<main checkout>/.concertino/runs/
<ticket>/.cost-cursors/<cursor key>.count` (created on first use; `main
checkout` resolved via the same `main_checkout()` helper `emit-event.sh`
already defines, duplicated here rather than sourced per this script suite's
existing "stay standalone" convention). Only transcript lines **after** that
stored count are summed this firing; the cursor is then rewritten to the
transcript's new total line count (written even when the increment carried no
new usage, so an empty increment is never re-scanned next time either). This
directory lives beside `events.jsonl` (gitignored, ephemeral, per-run local
state) — never inside the worktree, which `cleanup.sh --phase4` can destroy.
A missing/corrupt cursor file degrades to "treat this firing as the first"
(cursor 0) rather than losing the event — a rare over-count on a broken
filesystem, never a silently dropped one.

**Ticket and role are NOT derived from `cwd`** (round-1 skeptic REFUTE Change
Requests 1-2, confirmed correct: the orchestrator's own top-level session's
`cwd` is the main checkout, not the ticket worktree — `lib/ui/session.js`'s
`spawn()` passes no `-c`/start-directory to `tmux new-window`, and
`core/roles/orchestrator.md` never `cd`s into `WORKTREE_PATH`, only passes it
as an explicit script argument — and every sub-role sharing a delivery round
receives that *same* `WORKTREE_PATH`, so even if `cwd` did reflect it, it
could never disambiguate *which* sub-role's session just ended). Instead:

- **Ticket**: `lib/ui/prompt.js`'s `submitTicket()` — the one spawn entry
  point every launch path (the `n` prompt, queue tick, force-start, restart,
  address-failure) already funnels through — is changed to unconditionally
  merge `{ CONCERTINO_TICKET: parsed.ticket }` into the `env` map passed to
  `session.spawn()`, alongside (never replacing) whatever provider-routing
  env `CON-65`'s `providerSpawnEnv` already contributes. This is the same
  `env`-prefix injection mechanism `CONCERTINO_PROVIDER` already uses
  (`lib/ui/session.js`'s `spawn(ticket, cmd, env)` — a real, precedented
  seam), just populated unconditionally instead of only under provider
  routing. Because `env NAME=value claude ...` sets `CONCERTINO_TICKET` in
  the root Claude Code process's own environment, and OS environment
  variables are inherited by every descendant process (ordinary POSIX
  semantics, not a Claude-Code-specific behavior) — including whatever
  process Claude Code itself spawns to run a hook command, for the root
  session or any subagent session — `report-cost.sh` reads
  `process.env.CONCERTINO_TICKET` (via `node -e` or a plain shell `${...}`
  read) directly, with no dependency on `cwd` at all. Empirically confirmed:
  the probe above set `CONCERTINO_TICKET` on the top-level `claude -p`
  invocation only, and both the `SessionEnd` firing (root) and the
  `SubagentStop` firing (the Task-tool subagent it spawned) ran in an
  environment that inherited it.
- **Role**: the `SubagentStop` payload's `agent_type` (confirmed present on
  every subagent firing, literally the `subagent_type` the Task call used).
  Concertino's own custom Claude Code agent definitions are named
  `concertino-<role>` (`lib/cli/emit.js`'s `emitClaude()`: `name:
  'concertino-' + role`), so a subagent-firing payload's `agent_type` is
  literally `concertino-executor`, `concertino-evaluator`, etc. —
  `report-cost.sh` strips the `concertino-` prefix to recover `role`
  directly. `SessionEnd`'s payload never carries `agent_type` (confirmed —
  Decision 1); `report-cost.sh` defaults `role` to `orchestrator` whenever
  `agent_type` is absent, which for a `SessionEnd` firing is unconditional.

### Decision 6: `cost_usd` is summed as a parsed number, tolerating `emit-event.sh`'s string encoding — `emit-event.sh` itself is unchanged

**Round-1 skeptic REFUTE Change Request 3, confirmed correct:**
`scripts/concertino/emit-event.sh`'s `json_value()` auto-unquotes a `k=v`
value into a bare JSON number only when it matches `^-?(0|[1-9][0-9]*)$` (an
integer) or `true`/`false` — a fractional dollar value like `cost_usd=0.0234`
does **not** match, so it is emitted as the JSON **string** `"0.0234"`, not
the JSON number `0.0234`. Every other event kind in this codebase either
never emits a fractional field or doesn't need to sum it, so this gap was
latent until now.

**Resolution: option (c) from the skeptic's own list** — tolerate the string
encoding at the reducer, rather than touching the shared `emit-event.sh`
regex (used by every event kind this project has ever emitted; a regex
change there is a correctness risk to everything, not just this feature, and
is explicitly out of scope for this ticket). `lib/ui/reducer.js`'s `run.cost`
fold parses `Number(ev.cost_usd)` before adding it to the running
`run.costUsd` total. When `ev.cost_usd` is absent (Decision 4's "unrecognized
model" state) or `Number(...)` produces `NaN` (a malformed/torn value), the
event contributes `0` to the dollar sum but is still treated as
"cost-data-bearing" for coverage purposes (its token fields are still valid
and summed) — the same "malformed degrades to absent, never throws" fold
discipline `reducer.js`'s existing `models`/`sub_questions` parsing already
follows. Token fields (`input_tokens` etc.) are always emitted as bare
integers by `report-cost.sh` (a session's token count is always a whole
number), so they hit `json_value()`'s existing integer branch and need no
equivalent parsing — only `cost_usd` needed this treatment.

## Risks / Trade-offs

- **[Risk] Self-maintained pricing table drifts from Anthropic's real
  pricing over time** → Mitigation: `docs/config-reference.md` documents this
  explicitly as an ongoing maintenance obligation of enabling
  `costTracking.enabled`; an unrecognized/stale model id degrades to
  "tokens known, `$` unknown" (Decision 4) rather than a wrong number.
- **[Risk] `SessionEnd`/`SubagentStop` hooks are new project-wide Claude Code
  surface, not scoped to concertino sessions only** → Mitigation: default
  `false` (Decision 3); `report-cost.sh` itself no-ops safely (exit 0, no
  event) when `CONCERTINO_TICKET` is unset in its environment (an ordinary,
  non-concertino Claude Code session in the same project never has it set),
  so a hook firing for an unrelated session is inert.
- **[Risk] `SessionEnd`/`SubagentStop` hooks failing/hanging could add
  latency or noise to every Claude Code session/subagent** → Mitigation:
  `report-cost.sh` has no network calls (Decision 2), reads local files
  (transcript + cursor), and is bounded by ordinary local I/O; failures are
  swallowed (best-effort telemetry, matching the existing "never let
  telemetry block delivery" discipline the orchestrator prompt already
  states for `emit-event.sh` calls generally).
- **[Risk, CONFIRMED and CORRECTED — tasks.md 7.1] `SessionEnd`'s originally-
  assumed per-subagent behavior was wrong.** Real probes (Decision 1) found
  `SessionEnd` fires once per top-level session only (never per subagent, and
  never carrying `agent_type`); `SubagentStop` is the actual per-subagent
  signal, and it fires again — against the same, appended transcript — on
  every resume of the same subagent. → Mitigation: `report-cost.sh` now hooks
  both events (Decision 3/5) and applies a persisted per-agent line cursor
  (Decision 5) so a resumed subagent's repeat firings never double-count. Had
  this correction not been made, AC1 ("at least one harness reliably reports
  cost/token usage") would still nominally hold (events would still emit) but
  the reported dollar figures would be systematically inflated on any
  multi-cycle ticket — a materially wrong number is worse than the
  under-attribution risk this note originally accepted, which is why this was
  fixed rather than left as a known gap.
- **[Risk] Unconditionally injecting `CONCERTINO_TICKET` at `submitTicket()`'s
  one spawn entry point changes the env of every future concertino-launched
  session, not just Claude Code ones** → Mitigation: this is additive (a new
  env var, never overwriting an existing one — `Object.assign` merges it
  first so caller-provided `env` values, e.g. `CON-65`'s
  `CONCERTINO_PROVIDER`, still win on any key collision, though none exists
  today) and harmless for Codex/OpenCode sessions, which simply never read it;
  only Claude Code's `report-cost.sh` (gated behind `costTracking.enabled`,
  Decision 3) ever consumes it.

## Migration Plan

Purely additive: new event kind, new optional config key (default off), new
scripts, new checked-in data file. No existing event, config key, or script
behavior changes. Adopting this repo's own dogfood usage (this project runs
concertino on itself) is a follow-up config change (`costTracking.enabled:
true` in this repo's own `concertino.config.json`), not part of this change's
required scope — the capability must exist and degrade honestly before
turning it on for real.
