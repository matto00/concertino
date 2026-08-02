# harness-identity Specification

## Purpose
Defines how `CONCERTINO_HARNESS` is computed at `concertino sync` time and
resolved at run time, so telemetry records the harness that actually ran a
workflow instead of the literal string `unknown`.
## Requirements
### Requirement: `concertino sync` renders a `CONCERTINO_HARNESS` static default
`concertino sync` SHALL write a `CONCERTINO_HARNESS` key into
`scripts/concertino/.concertino.env` alongside the other `CONCERTINO_*` values. When
the project config's `harnesses` array has exactly one entry, the value SHALL be
that harness. When `harnesses` has more than one entry, the value SHALL be empty —
sync SHALL NOT write the full configured list or an arbitrary single pick as a
stand-in for a value it cannot determine at render time.

#### Scenario: Single harness configured
- **WHEN** `concertino sync` runs for a project whose config has
  `"harnesses": ["claude-code"]`
- **THEN** the rendered `.concertino.env` contains `CONCERTINO_HARNESS='claude-code'`

#### Scenario: Multiple harnesses configured
- **WHEN** `concertino sync` runs for a project whose config has
  `"harnesses": ["claude-code", "codex"]`
- **THEN** the rendered `.concertino.env` contains `CONCERTINO_HARNESS=''`

### Requirement: `setup-worktree.sh` resolves the running harness at runtime
`setup-worktree.sh` SHALL determine the harness for the `run.start` telemetry
event's `harness=` field (the identity/telemetry value, hereafter `HARNESS`)
using this resolution order: (0) an optional `HARNESS_OVERRIDE` passed as the
script's 4th positional argument, when non-empty and present in the
implemented-harness set (see the "Per-ticket harness override" requirement
below); (1) if no override was passed, a runtime signal read directly from
the process environment — `CLAUDECODE` set non-empty indicates `claude-code`;
`CODEX_SANDBOX` or `CODEX_SANDBOX_NETWORK_DISABLED` set non-empty indicates
`codex`; (2) if neither an override nor a runtime signal is present, the
static `CONCERTINO_HARNESS` value sourced from `.concertino.env`; (3) if none
of the above resolves a value, the literal string `unknown`. When no
`HARNESS_OVERRIDE` is passed, the script SHALL NOT report a `HARNESS` value
that contradicts a detected runtime signal — this constraint does not apply
when a valid `HARNESS_OVERRIDE` is passed, which is honored for `HARNESS` even
if it contradicts a detected runtime signal (see the override requirement
below for why). The script SHALL also print `READY harness=<value>` and
`READY harness_source=ticket-override|runtime-detected|static-default|unknown`
identifying which step of this order produced the resolved `HARNESS` value.

The harness value the script passes to `resolve-speed.sh` for per-role
model-tier resolution (hereafter `MODEL_TIER_HARNESS`) is a SEPARATE value
that SHALL NEVER be influenced by `HARNESS_OVERRIDE`: it SHALL always resolve
via steps (1)-(3) above only (runtime signal, then static default, then
`unknown`) — the exact chain this script used before ticket overrides
existed. This is intentional: model ids resolved via `MODEL_TIER_HARNESS`
are fed directly into the live `Agent(...)` tool call actually spawning
sub-agents in this process, so they SHALL always reflect the harness that is
actually executing, never a ticket's stated (but not currently running)
preference.

#### Scenario: Run started under Claude Code
- **WHEN** `setup-worktree.sh` runs with no `HARNESS_OVERRIDE` argument, in a
  process where `CLAUDECODE` is set (regardless of the project's configured
  `harnesses` or the static `CONCERTINO_HARNESS` default)
- **THEN** the `run.start` event records `harness=claude-code`, and the script
  prints `READY harness=claude-code` and `READY harness_source=runtime-detected`

#### Scenario: Run started under Codex
- **WHEN** `setup-worktree.sh` runs with no `HARNESS_OVERRIDE` argument, in a
  process where `CODEX_SANDBOX` (or `CODEX_SANDBOX_NETWORK_DISABLED`) is set
- **THEN** the `run.start` event records `harness=codex`, and the script
  prints `READY harness=codex` and `READY harness_source=runtime-detected`

#### Scenario: Both runtime signals set simultaneously
- **WHEN** `setup-worktree.sh` runs with no `HARNESS_OVERRIDE` argument, in a
  process where both `CLAUDECODE` and `CODEX_SANDBOX` are set
- **THEN** the `run.start` event records `harness=claude-code` — `CLAUDECODE`
  is checked first and wins, since a Codex sandbox process would not
  independently set `CLAUDECODE`

#### Scenario: No runtime signal, single-harness project
- **WHEN** `setup-worktree.sh` runs with no `HARNESS_OVERRIDE` argument,
  neither `CLAUDECODE` nor `CODEX_SANDBOX` set, and the project's
  `.concertino.env` has a non-empty static `CONCERTINO_HARNESS`
- **THEN** the `run.start` event records that static value, and the script
  prints `READY harness_source=static-default`

#### Scenario: No runtime signal, no static default
- **WHEN** `setup-worktree.sh` runs with no `HARNESS_OVERRIDE` argument,
  neither `CLAUDECODE` nor `CODEX_SANDBOX` set, and `CONCERTINO_HARNESS` is
  unset or empty
- **THEN** the `run.start` event records `harness=unknown`, and the script
  prints `READY harness_source=unknown`

#### Scenario: Valid ticket-declared override outranks runtime detection for identity
- **WHEN** `setup-worktree.sh` runs with `HARNESS_OVERRIDE=codex` passed as
  its 4th argument, in a process where `CLAUDECODE` is set (a contradicting
  runtime signal) and the project's static `CONCERTINO_HARNESS` is
  `claude-code`
- **THEN** the `run.start` event records `harness=codex`, and the script
  prints `READY harness=codex` and `READY harness_source=ticket-override` —
  the override wins over both the contradicting runtime signal and the
  static default for the `HARNESS` (identity/telemetry) value

#### Scenario: A contradicting override never changes per-role model-tier resolution
- **WHEN** `setup-worktree.sh` runs with `HARNESS_OVERRIDE=codex` passed as
  its 4th argument, in a process where `CLAUDECODE` is set (a contradicting
  runtime signal)
- **THEN** the value passed to `resolve-speed.sh` for `MODEL_TIER_HARNESS` is
  `claude-code` (the detected runtime signal), NOT `codex` — every resolved
  per-role model id in `READY models=` stays valid for the Claude Code
  `Agent(...)` calls this process actually makes, regardless of what the
  ticket's `HARNESS_OVERRIDE` declares

### Requirement: `concertino validate` surfaces harness-telemetry resolution
`concertino validate` SHALL print an informational line in the "Integrations"
section describing how `CONCERTINO_HARNESS` will resolve for the project's
configured `harnesses` (a static value for a single configured harness, or
runtime-detection for more than one). This SHALL never be reported as a
validation error — an empty static default for a multi-harness project is a
correct, expected state, not a misconfiguration.

`concertino validate` SHALL additionally accept an optional `--ticket <ID>`
flag. When passed, it SHALL fetch the named ticket via the project's
configured `ticketProvider` and check it for a harness-override label
matching `harness:<value>`. When no such label is present, it SHALL print an
informational line noting the ticket has no override and will resolve via the
existing runtime/static chain. When a matching label is present and its value
is in the implemented-harness set, it SHALL print an informational line
naming the ticket and the override value, and that it will take precedence
over the project default and runtime detection for that ticket's run. When a
matching label is present and its value is NOT in the implemented-harness
set, `concertino validate` SHALL report this as a validation error (non-zero
exit), naming both the ticket and the unsupported value. Omitting `--ticket`
SHALL leave `concertino validate`'s behavior unchanged from today.

#### Scenario: Validate reports static resolution
- **WHEN** `concertino validate` runs against a config with
  `"harnesses": ["claude-code"]`
- **THEN** the Integrations section reports the static harness value that will be
  written to `CONCERTINO_HARNESS`, and validation does not fail because of it

#### Scenario: Validate reports runtime-detection resolution
- **WHEN** `concertino validate` runs against a config with
  `"harnesses": ["claude-code", "codex"]`
- **THEN** the Integrations section reports that `CONCERTINO_HARNESS` resolves at
  runtime rather than statically, and validation does not fail because of it

#### Scenario: Validate --ticket reports no override present
- **WHEN** `concertino validate --ticket CON-1` runs against a ticket with no
  `harness:<value>` label
- **THEN** the Integrations section reports that ticket CON-1 has no harness
  override and resolves via the existing runtime/static chain, and validation
  does not fail because of it

#### Scenario: Validate --ticket reports a valid override
- **WHEN** `concertino validate --ticket CON-1` runs against a ticket labeled
  `harness:codex`
- **THEN** the Integrations section reports that ticket CON-1 will run under
  `codex`, taking precedence over the project default and runtime detection,
  and validation does not fail because of it

#### Scenario: Validate --ticket reports an unsupported override as an error
- **WHEN** `concertino validate --ticket CON-1` runs against a ticket labeled
  `harness:local-llm`
- **THEN** validate reports a validation error naming ticket CON-1 and the
  unsupported value `local-llm`, and exits non-zero

### Requirement: Ticket-declared harness override resolves and fails loudly, before worktree setup
The orchestrator SHALL honor an optional per-ticket harness declaration: a
ticket MAY carry a single Linear label matching `^harness:(.+)$` naming which
implemented harness (`claude-code` or `codex`) SHALL execute its delivery
run. When the orchestrator fetches a ticket during Setup, it SHALL check for
this label alongside the ticket's other fields. When present
and its value is in the implemented-harness set, the orchestrator SHALL pass
that value through to `setup-worktree.sh` as the `HARNESS_OVERRIDE` argument,
and it SHALL take precedence over the project's `harnesses` config default and
over runtime env-based detection for that run's identity/telemetry `HARNESS`
value — this precedence does NOT extend to per-role model-tier resolution
(`MODEL_TIER_HARNESS`), which always reflects the actually-detected runtime
harness regardless of any override (see the "resolves the running harness at
runtime" requirement above for why). When present and its value is
NOT in the implemented-harness set (e.g. `local-llm`, which names a harness
with no adapter implemented anywhere in the codebase), the orchestrator SHALL
treat this as a hard stop: it SHALL surface the ticket and the unsupported
value to the human immediately, and it SHALL NOT proceed to derive a branch
name or invoke `setup-worktree.sh` — no worktree is created. When a ticket
carries more than one label matching `^harness:(.+)$`, the orchestrator SHALL
treat this the same as an unsupported value (ambiguous override), never
silently picking one. `setup-worktree.sh` SHALL independently validate any
`HARNESS_OVERRIDE` argument it is given against the same implemented-harness
set and SHALL print `FAIL` and exit non-zero before any git/worktree
operation when the value is not implemented — this holds regardless of
caller, so any future dispatcher that invokes `setup-worktree.sh` directly
gets the same fail-loud guarantee the orchestrator's own Setup-step check
provides.

#### Scenario: Ticket with no harness label — unchanged behavior
- **WHEN** the orchestrator fetches a ticket with no label matching
  `^harness:(.+)$`
- **THEN** it calls `setup-worktree.sh` with no `HARNESS_OVERRIDE` argument,
  and harness resolution proceeds exactly as it does today (runtime
  detection, then static default, then `unknown`)

#### Scenario: Ticket declares a supported harness
- **WHEN** the orchestrator fetches a ticket labeled `harness:codex`
- **THEN** it calls `setup-worktree.sh` with `HARNESS_OVERRIDE=codex`, and the
  run resolves to `codex` regardless of the project's `harnesses` config or
  any runtime env signal

#### Scenario: Ticket declares an unsupported harness
- **WHEN** the orchestrator fetches a ticket labeled `harness:local-llm`
- **THEN** it stops immediately after the fetch, surfaces to the human that
  ticket's identifier and the unsupported value `local-llm`, and does not
  derive a branch name or call `setup-worktree.sh` — no worktree is created

#### Scenario: Ticket declares more than one harness label
- **WHEN** the orchestrator fetches a ticket labeled both `harness:codex` and
  `harness:claude-code`
- **THEN** it treats this as an unsupported/ambiguous override and stops
  immediately, exactly as for a single unsupported value, rather than picking
  either label

#### Scenario: setup-worktree.sh invoked directly with an unsupported override
- **WHEN** `setup-worktree.sh` is invoked directly (bypassing the
  orchestrator) with `HARNESS_OVERRIDE=local-llm`
- **THEN** it prints `FAIL` naming the unsupported harness and exits non-zero
  before creating or touching any worktree

