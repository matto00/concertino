# Concertino — architecture & design rationale

## Core thesis

Most of what a human does babysitting an agent loop is **verification, not
judgment** — confirming an artifact exists and matches reality ("yes that test
failed," "yes the server's up," "yes the design is sound"). Checking evidence
against ground truth is mechanizable.

> For each Iron Law, replace *"human confirms Y"* with **an evidence artifact Y +
> a cold checker that verifies Y against reality.** The human survives only for the
> residue: real decisions and tiebreaks.

Three structural properties — none requiring a human — make the loop
self-correcting:

1. **Canonical procedures, re-read just-in-time.** Procedure lives in committed
   scripts and law docs the agents read at the moment of use — not recalled from
   drifting/compacted context. (Empirically the biggest lever: code quality jumps
   once agents are *forced* to read an explicit standard rather than infer it.)
2. **Evidence-gated transitions.** A wrong step fails *loudly* (a gate returns
   non-zero, a probe contradicts a hypothesis) instead of propagating silently.
3. **Fresh, cold readers.** A sub-reader checks an artifact with no shared context,
   so it can't inherit the originator's hallucination.

## The design, piece by piece

### 1. Canonical procedures as scripts, not orchestrator prose

Every "how-to" (worktree creation, port derivation, dev-server startup, cleanup)
lives in idempotent scripts under `scripts/concertino/`. The orchestrator *calls*
them — nothing left to hallucinate. Each prints a machine-checkable token
(`READY key=value` / `FAIL reason`). This is the biggest lever for procedural pain
and it *shrinks* the orchestrator prompt.

### 2. Phase postconditions as assertions

One shared `assert-phase.sh <phase>` checks the observable state required to *leave*
a phase (worktree exists, env present, health green, branch pushed). The
orchestrator can't transition until green — the autonomous version of a human
glancing and saying "yep."

### 3. Canonical law-docs (the standards pattern, generalized)

- **Iron Laws** (`core/laws/`): `systematic-debugging` (no fix without a
  probe-confirmed root cause) and `verification-before-completion` (no completion
  claim without fresh pasted evidence). Bound to the executor/evaluator/skeptic and
  re-read at the point of use.
- **Project canonical docs** (yours, bound via `concertino.config → canonicalDocs`):
  a code-quality standard and a design-language standard. Tag rules **[mechanical]**
  (greppable/lint-checkable → cheap, strict evaluator enforcement) vs **[judgment]**
  (the skeptic's domain). Push as much consistency as possible into deterministic
  gates; leave only true visual judgment to the cold reviewer.

### 4. The skeptic: a separate cold adversarial agent

The differentiator is **coldness + adversarial posture**, not model tier. A fresh
reviewer can't inherit the loop's blind spots or rubber-stamp impressions formed in
earlier cycles.

- **Evaluator** (warm, every cycle) = iteration partner. Runs gates, walks the
  *mechanical* checklist, files change requests. Its UI role is **objective**
  (console errors, broken states, ARIA, breakpoints). Subjective "does this look
  right" is deferred — not because its model is weak, but because a warm reviewer
  rubber-stamps its own earlier impressions.
- **Skeptic** (cold) = exit gate. **Evaluator PASS no longer means "deliver" — it
  means "ready for the skeptic gate."** CONFIRM → delivery; REFUTE → findings become
  bounded change requests back into the loop. One powerful gate at loop *exit*
  without making every cycle expensive. Also runs once after planning as a
  design-soundness gate (catching a bad design in planning ≫ cheaper than in cycle 3).

### 5. Escalation taxonomy + circuit breakers

Escalate to a human ONLY for: (a) a real design/scope/cost decision, (b) a
worker↔skeptic loop that can't converge in budget, (c) missing external input.
Everything else resolves in-loop. Every loop gets a **bounded counter + a defined
escalation** — never thrash forever, never silently give up. For a fleet, "fails
loudly into a known escalation state" is the property being bought.

### 6. Minimal orchestrator memory

The orchestrator holds *only* IDs, paths, and counters (`workflow-state.md`).
Re-derive every procedure from scripts/files at the point of use. Compaction can't
drift what isn't held as prose.

## Harness-agnostic layer

The role specs (`core/roles/`) are neutral templates. The `concertino` CLI renders
them — substituting your project config — into each harness's native layout:

- **Claude Code** (full fidelity): four sub-agents with frontmatter; the
  orchestrator spawns the others via the `Agent` tool and resumes them warm via
  `SendMessage`. Distributed as a plugin (`.claude-plugin/plugin.json`).
- **Codex CLI** (degraded): the orchestration protocol + laws + standards are
  concatenated into `AGENTS.md`; executor/evaluator are `.codex/agents/*.toml`.
  Codex has no programmatic multi-tier dispatch or warm-resume routing, so the loop
  runs **sequentially** — a single agent role-plays the phases, reading the same
  role specs and calling the same scripts. See `docs/harness-capabilities.md`.

The bash procedure scripts are the strongest portability anchor: both harnesses
just shell out to identical procedures.
