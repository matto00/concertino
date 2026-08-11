## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read round-1's report (`skeptic-design-1.md`) in full, then re-read the
  current `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, all three
  spec deltas, and `workflow-state.md` in full — not assuming any round-1
  state still holds.

**CR1 (SessionEnd-per-subagent premise).**
- `design.md` Decision 1 no longer asserts the premise as fact "confirmed by
  how `Agent()` spawns work" (round 1's objection). It now cites a specific
  research pass and states the finding precisely: `SessionEnd` fires once
  per session, a Task-tool subagent's completion is its own separate
  session, subagent-firing payloads carry `agent_type`/`agent_id`, the root
  session's does not.
- `workflow-state.md:41-44` independently corroborates this was a real
  research step ("Researched Claude Code hooks behavior via claude-code-guide
  agent"), not fabricated to satisfy the gate.
- Critically, the design explicitly labels this "**documentation-derived,
  not yet empirically observed in this repo's own runtime**" (`design.md:76-80`)
  and the Risks section repeats the caveat (`design.md:264-275`). `tasks.md`
  section 7 is retitled "REQUIRED" and 7.1 is a concrete, non-optional
  end-to-end check (drive a real run, inspect actual `SessionEnd` payloads,
  confirm firing-per-subagent and `agent_type` presence, and explicitly says
  "this task does not pass on documentation alone"). This is exactly the
  doc-derived-but-gated treatment round 1 asked for, not a re-assertion.
- I could not independently verify Claude Code's hook semantics from inside
  this sandbox (no network access), but the epistemic posture — cite the
  research, keep the failure mode bounded (mis-attributed `role`, not a
  dropped event, per the Decision-1 risk mitigation), and force empirical
  confirmation before the change is "done" — is the right way to carry an
  unverifiable-at-design-time premise. **Addressed.**

**CR2 (cwd cannot derive ticket/role).**
- Re-verified round 1's underlying finding still holds: `lib/ui/session.js`'s
  `spawn()` (lines 181-233) passes no `-c` to tmux; `submitTicket()` is the
  only call site of `session.spawn()` in the codebase (confirmed:
  `grep -rn "session.spawn(\|\.spawn(" lib/ui/controllers/*.js lib/ui/*.js`
  returns only `lib/ui/prompt.js:157`).
- Verified `submitTicket()` genuinely is the single spawn entry point:
  `grep -rn "submitTicket(" lib/` shows every call site —
  `lib/ui/control.js:54`, `lib/ui/controllers/drilldown.js:258`,
  `lib/ui/launcher.js:108,116`, `lib/ui/controllers/fleet.js:553,683` — funnels
  through the one `submitTicket()` in `lib/ui/prompt.js:133`, which is the
  only function that calls `session.spawn()`. Design.md/spec's claim that
  every launch path funnels through this one function is literally true of
  the current code, not an approximation.
- Read `lib/ui/prompt.js:128-158` (the `env` param, currently optional/
  threaded through verbatim) and `lib/ui/session.js:170-191` (the `env NAME='value' ...`
  prefix mechanism, gated on `env && Object.keys(env).length`). Task 2.4's
  plan (unconditionally merge `{ CONCERTINO_TICKET }` first, caller env
  second/wins-on-collision) is concretely specified against this real code,
  not hand-waved, and is a small, well-scoped diff.
- `specs/run-cost-telemetry/spec.md`'s "ticket and role are identified
  without relying on cwd" requirement (lines 44-67) and the `submitTicket()`
  requirement (lines 91-111) both have Given/When/Then scenarios, not just
  prose. `tasks.md` 2.4/2.5 are concrete. **Addressed.**
- Independent sanity-check on the env-inheritance claim asked for in the
  task: sub-roles (executor/evaluator/skeptic/auditor — I am one of these,
  spawned exactly this way, right now) run as Task-tool subagents *of the
  same OS process* as the orchestrator's root Claude Code session, not as
  separate `env ... claude ...` invocations of their own (confirmed by
  round-1's own tracing of `orchestrator.md`'s spawn instructions, which I
  re-read and still holds — the orchestrator passes `WORKTREE_PATH` as an
  argument to sub-role Agent-tool spawns, never re-invoking `claude` via
  tmux). That means `CONCERTINO_TICKET`, once present in the root process's
  `process.env` (set once at the original `env CONCERTINO_TICKET=... claude
  "/concertino-deliver ..."` spawn), is trivially visible to whatever
  hook-invoking mechanism Claude Code uses internally for a subagent's
  `SessionEnd` — it's the *same process's* environment, not something that
  has to cross a fork/exec boundary a second time. This makes the
  "OS env vars are inherited by descendant processes" claim lower-risk than
  it might first appear (it doesn't even depend on subagents being separate
  child processes) — a reasonable, low-risk assumption to build on, correctly
  contrasted against CR1's genuinely novel, Claude-Code-implementation-specific
  claim (per-session hook firing granularity), which is the one actually
  gated behind task 7's required verification. No further revision needed
  here, though task 7.1's real run will incidentally validate this too (if
  `CONCERTINO_TICKET` didn't propagate, no `run.cost` events would appear at
  all, which would be an obvious, visible symptom of that required check).

**CR3 (fractional `cost_usd` through `emit-event.sh`).**
- Re-read `scripts/concertino/emit-event.sh`'s `json_value()`
  (lines 120-130): regex `^-?(0|[1-9][0-9]*)$` unchanged from round 1 — a
  fractional value is still string-quoted. Confirmed the design's premise
  still holds and, per Decision 6, the file is deliberately *not* touched.
- `design.md` Decision 6 states the chosen option (c) explicitly and
  reasons why (shared script, out of scope for a regex change).
  `lib/ui/reducer.js` doesn't yet implement `run.cost` (expected — this is
  pre-implementation), but `specs/run-cost-telemetry/spec.md`'s "cost_usd is
  parsed as a number before summation" requirement (lines 113-131) has a
  concrete Given/When/Then scenario for the exact `"0.0234"` string case,
  and `tasks.md` 3.3/3.4 both name `Number(ev.cost_usd)`, `NaN`-degrades-to-0,
  and a dedicated string-encoded-fraction test case. **Addressed.**
- Checked `fleet-metrics-spend`/`drilldown-run-cost` specs both consume the
  already-summed `run.costUsd` (never re-parse `cost_usd` themselves), so
  the fix is applied in exactly one place, consistently.

### Additional checks
- `openspec validate --changes track-per-run-cost-spend` → clean (`Totals: 1
  passed, 0 failed`), matching `workflow-state.md`'s claim.
- Confirmed `mergeAgentMergeSettings`/`checkAgentMergePermission` precedents
  cited for tasks 2.2/2.3 are real functions in `lib/cli/emit.js`/`lib/config.js`.
- Confirmed `test/prompt.test.js`, `test/reducer.test.js`, `test/fleet.test.js`,
  `test/drilldown.test.js`, `test/emit.test.js` all exist as named in tasks.md.

### Verdict: CONFIRM

All three round-1 change requests are concretely, specifically addressed —
not gestured at. Each revision is backed by either a cited research pass
(explicitly hedged and gated behind a now-required empirical task) or a
verified-against-real-code mechanism (the `submitTicket()` single-entry-point
env injection, the reducer-side `Number()` parse). The plan's remaining
epistemic risk (Claude Code's actual hook-firing granularity) is honestly
named as unverified and is gated behind a required, non-optional
end-to-end task before the change can be considered done — the correct
posture for a premise that cannot be checked from a design review alone.

### Non-blocking notes
- `design.md`'s Decision 1 section header, "**Verified against Claude Code's
  documented hooks reference**," reads slightly stronger than the body's own
  "documentation-derived, not empirically observed" hedge a paragraph later.
  Consider softening the header (e.g. "Researched against...") so a future
  reader skimming only headers doesn't walk away more confident than the
  design itself claims to be. Cosmetic only — the body text and the Risks
  section are already precise.
- Task 7.1 is framed around confirming hook-firing counts/`agent_type`
  presence; consider explicitly folding in "confirm the resulting `run.cost`
  events carry the correct `ticket`/`role` fields" as an assertion of that
  same task, since that's the piece that actually closes the loop on AC1 —
  though as noted above this will very likely be observed as a side effect
  of driving a real run anyway.
