## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/orchestrator-turn-discipline/spec.md` in full.
- Read the current (unmodified) `core/roles/orchestrator.md` — confirmed its
  "Harness resume model" section (lines 13-16) is nothing but the
  `{{block:harnessResume}}` placeholder with no surrounding turn-boundary
  prose today, and its Phase 1/2/3 spawn/resume instructions (lines
  110-119, 151-168, 182-194) state no wait-inline rule or fallback — matches
  the ticket's description of the gap.
- Read `bin/concertino`'s `block()` function (`case 'harnessResume':`,
  around line 354): confirmed the `claude-code` string returned there — not
  prose in `core/roles/orchestrator.md` — is what actually fills the
  `{{block:harnessResume}}` placeholder for both harnesses via `renderBody`
  (verified `emitClaude`/`emitCodex` both call
  `renderBody(readRoleFile(role, out), c, <harness>)` on the *same* neutral
  `core/roles/orchestrator.md` source, so any prose added directly to that
  file — not inside the block placeholder — appears in both the rendered
  Claude Code agent file and Codex's `AGENTS.md`). This is exactly the trap
  named in my brief (fixing only the neutral template while missing
  `bin/concertino`'s `block()` function); the plan's Decision 1 in
  `design.md` explicitly names and avoids it, and the proposal's Impact
  section lists `bin/concertino`'s block-render function as a required file,
  with `tasks.md` §2 as its own task group.
- Read `adapters/codex/header.md` and `adapters/codex/prompt.md`: confirmed
  today's text instructs a fully sequential single-thread flow with no
  spawn/suspend boundary at all ("switch into that role... where this spec
  says spawn or resume") — matches the design's claim that the default Codex
  path can't reproduce CON-10's failure mode.
- Read `docs/harness-capabilities.md`: confirmed it documents
  `.codex/agents/*.toml` / `spawn_agents_on_csv` as an optional, non-default
  worker-dispatch path available on richer Codex environments — matches the
  design's Decision 4 claim about where the equivalent Codex risk actually
  lives, and confirmed `adapters/codex/agent.toml.tmpl` exists as the
  template that generates those per-role `.toml` files (a plausible target
  for task 3.3's caution).
- Grepped for `TODO`/`TBD`/"figure out later"/placeholder language across
  `proposal.md`, `design.md`, `tasks.md`, `specs/.../spec.md`: the only hits
  are literal references to the `{{block:harnessResume}}` template
  placeholder mechanism, not deferred decisions.
- Cross-checked each ticket AC against the spec deltas: all five ACs (state
  the rule + never-return-control; explain the asymmetry, not just assert
  it; state an explicit poll-or-escalate fallback; check the Codex path;
  record the constraint in `docs/harness-capabilities.md`) each have a
  corresponding `### Requirement` + scenario in
  `specs/orchestrator-turn-discipline/spec.md`, and each requirement maps to
  a concrete task group in `tasks.md` (§1-§4) plus a verification task (§5).

### Verdict: CONFIRM

The plan correctly diagnoses that the neutral `core/roles/orchestrator.md`
template alone is inert for Claude Code — the actual rendered text comes
from `bin/concertino`'s `harnessResume` case in `block()` — and explicitly
schedules a fix to that function (Decision 1, tasks §2), not just the
markdown template. It correctly separates "explain once" (harness-resume
section, both the template's surrounding prose and the per-harness block
text) from "repeat briefly at each spawn/resume point" (Phase 1 skeptic
gate, cycle-1 spawns, cycle-2+ resumes, final skeptic gate — tasks §1.2-1.5),
which is the right structure for surviving both paraphrase and compaction.
It states a concrete fallback (poll for the sub-agent's expected artefact,
or escalate) rather than leaving the no-inline-wait case undefined. The
Codex check is scoped honestly: it correctly identifies that the *default*
sequential flow has no turn boundary to fix, and correctly locates the one
place an equivalent risk exists (the optional `spawn_agents_on_csv` /
`.codex/agents/*.toml` path), documenting rather than restructuring, which
matches what the codebase's existing `docs/harness-capabilities.md` already
frames that path as (optional, not the recommended flow). No internal
contradictions, no unresolved placeholders, no AC left uncovered, no scope
drift beyond the four named files.

### Non-blocking notes

- `tasks.md` §1.1 phrases the work as "extend the neutral prose around the
  Harness resume model section," but today there is no surrounding prose at
  all — just the heading and the bare `{{block:harnessResume}}` placeholder
  (`core/roles/orchestrator.md:13-16`). Not a blocking ambiguity —
  `design.md`'s Decision 1 spells out what to add and why — but the
  executor should read that decision rather than infer "extend" to mean
  editing pre-existing prose that doesn't exist yet.
- Task 3.3's target for the Codex worker-dispatch caution ("`adapters/codex/
  header.md` (or the toml template's generated comment, whichever a Codex
  reader actually sees)") is left as an either/or. Worth landing on both if
  cheap: `adapters/codex/agent.toml.tmpl:1-4` is the one file a reader
  actually sees when inspecting a generated `.toml` in isolation, while
  `header.md` is what's read as part of `AGENTS.md`'s narrative — a reader
  who only encounters one artifact benefits from the caution being in both.
