## Why

Harness selection is project-wide today: `concertino.config.json`'s `harnesses`
array drives a static `CONCERTINO_HARNESS` default, and `setup-worktree.sh`
resolves the actual run-time value from process env signals when that default
is ambiguous. There is no way to say "run ticket X on Codex, ticket Y on
Claude Code" within one project — every delivery run resolves to whichever
single harness the project happens to be configured/detected for. As teams
adopt more than one harness, individual tickets increasingly have a harness
that suits them best (e.g. a ticket that needs Codex's larger context budget),
and today's only lever is changing project-wide config for every run.

## What Changes

- Ticket metadata gains an optional harness override, expressed as a Linear
  label of the form `harness:<value>` (e.g. `harness:codex`), read by the
  orchestrator alongside the ticket's other fields during Setup — no new
  Linear tooling required, since `mcp__linear__get_issue` already returns
  `labels`.
- When a ticket declares a **supported** harness (`claude-code` or `codex`),
  the orchestrator passes it through to `setup-worktree.sh` as a new optional
  4th positional argument (`HARNESS_OVERRIDE`), and it takes precedence over
  both the project's static `CONCERTINO_HARNESS` default and the existing
  runtime env-based detection (`CLAUDECODE` / `CODEX_SANDBOX*`).
- When a ticket does not declare a harness, resolution is byte-for-byte
  unchanged from today: runtime detection, then the static default, then
  `unknown`.
- When a ticket declares a harness with **no implemented adapter** (e.g.
  `local-llm`), the orchestrator treats this as a hard stop immediately after
  fetching the ticket — **before** deriving a branch name or calling
  `setup-worktree.sh`, i.e. before any worktree is created. `setup-worktree.sh`
  itself also validates a `HARNESS_OVERRIDE` it is given directly (defense in
  depth for any future caller that bypasses the orchestrator), failing with
  `FAIL` before any git/worktree operation.
- `concertino sync` writes a new `CONCERTINO_IMPLEMENTED_HARNESSES`
  space-separated value into `.concertino.env`, sourced from `lib/config.js`'s
  existing `VALID_HARNESSES` list — the one place bash scripts can validate an
  override against without duplicating the list.
- `concertino validate` gains an optional `--ticket <ID>` flag: live-fetches
  that one ticket via the configured `ticketProvider` and reports/validates
  any declared harness override in the existing Integrations section,
  alongside the static/runtime resolution it already reports there.
- `docs/config-reference.md` and `docs/harness-capabilities.md` are updated to
  document the override label, its precedence, `--ticket`, and the current
  list of implemented harnesses.

**Non-goals** (see design.md for full rationale):
- The dashboard launch pad's batch launch-plan screen (`lib/ui/screens/launchplan.js`)
  keeps its existing single harness-per-batch picker (`h` to cycle), unchanged.
  Per-ticket harness display/override inside that batch UI is a separate,
  follow-on concern.
- Implementing a `local-llm` (or any other new) harness adapter — tracked
  separately, per the ticket's own scoping.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `harness-identity`: adds a ticket-declared override as the highest-priority
  step in the existing resolution order, and adds `concertino validate --ticket`
  as a way to surface/validate that override ahead of a run.

## Impact

- `core/scripts/setup-worktree.sh` — new optional 4th positional arg, adjusted
  resolution order, defense-in-depth validation, extended READY contract.
- `core/roles/orchestrator.md` — Setup step 1/3 updated to read the label and
  pass it through, and to hard-stop on an unsupported value.
- `bin/concertino` — `sync` writes `CONCERTINO_IMPLEMENTED_HARNESSES`;
  `validate` gains `--ticket`.
- `lib/config.js` — reused as the single source of truth for
  `VALID_HARNESSES` (no change to its value, just a new consumer).
- `docs/config-reference.md`, `docs/harness-capabilities.md` — documentation.
- `openspec/specs/harness-identity/spec.md` — modified capability (delta in
  this change's `specs/harness-identity/spec.md`).
