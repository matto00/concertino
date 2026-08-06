## Why

`agentMerge.enabled: true` in `concertino.config.json` is not sufficient
authorization for the auditor to actually merge a PR under Claude Code's
auto-mode permission classifier: the classifier has no visibility into the
project's config file, so it denies the auditor spawn (and would deny `gh pr
merge` too) as an unauthorized, self-granted action — even though a human
genuinely opted in by writing `agentMerge.enabled: true`. Today this means
every agent-merge run under Claude Code's auto mode silently degrades to a
manual "please merge yourself" pause, discovered only after PR creation, with
a `SECURITY WARNING` that reads as though the workflow tried to do something
illegitimate. CON-73 hit this concretely on 2026-08-05.

## What Changes

- `concertino sync` (Claude Code emitter) additively merges the permission
  grant `agentMerge.enabled: true` requires into the project's
  `.claude/settings.json` (`permissions.allow`), so the human's config opt-in
  is expressed in the one place the classifier actually reads, closing the
  gap without the classifier needing any awareness of `concertino.config.json`.
  Merge is non-destructive: existing `permissions.allow`/`deny`/`ask` entries
  and any other settings keys are preserved untouched; only the two rules
  agent-merge needs are added if absent.
- `concertino doctor` and `concertino validate` warn when `agentMerge.enabled`
  is `true` for a project with `claude-code` in `harnesses`, but
  `.claude/settings.json` has no matching allow rule — naming exactly which
  rule is missing and how to add it (or that `concertino sync` will add it).
  This is a drift/safety-net check, not the primary mechanism — the settings
  file is normally kept current by `sync` itself.
- The orchestrator's agent-merge path (Phase 3, `AGENT_MERGE = true`) checks
  for the permission grant **before** spawning the auditor, not after being
  denied. If the grant is present (the common case post-sync), it proceeds to
  spawn exactly as before — no change to the happy path or its cost. If the
  grant is absent, it raises one escalation up front, asking the human to
  either run `concertino sync` (or grant permission manually) and retry, or
  fall back to today's `AGENT_MERGE = false` manual-merge flow — never
  attempts the spawn blind, and never works around a denial itself.
- Docs (`docs/config-reference.md` or equivalent) state plainly that
  `agentMerge.enabled` alone does not authorize a merge under Claude Code's
  auto mode, and that the second half of the opt-in is the harness-level
  permission grant `concertino sync` now maintains in `.claude/settings.json`.
- The `AGENT_MERGE = false` fallback is unchanged: never work around a
  denial, always hand the decision back to the human.

## Capabilities

### New Capabilities
(none — this modifies the existing `agent-merge` capability's authorization
story; it does not introduce a new one)

### Modified Capabilities
- `agent-merge`: adds the harness-level permission grant `concertino sync`
  maintains, the `doctor`/`validate` drift check for it, and the
  orchestrator's pre-spawn permission check that replaces "spawn, then react
  to a denial" with "check, then spawn or ask" — all in service of the
  existing "Agent-merge is a config default with a per-run override" and "A
  disabled agent-merge run is unchanged from today's human-confirmation flow"
  requirements, neither of which changes behaviorally.

## Impact

- `lib/cli/emit.js` (`emitClaude`): additive merge into
  `.claude/settings.json`.
- `lib/config.js` (`collectConfigIssues`): new "Agent-merge" section.
- `core/roles/orchestrator.md`: Phase 3 delivery, `AGENT_MERGE = true` branch.
- `scripts/concertino/`: a new small deterministic check script the
  orchestrator (and doctor) both call, so the required-rules list has one
  source of truth instead of being duplicated in prose and in JS.
- Docs: a short new subsection stating the two-part opt-in explicitly.
- No change to the auditor role itself, to `check-merge-readiness.sh`, or to
  the `AGENT_MERGE = false` path.
