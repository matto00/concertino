## Why

`setup-worktree.sh` emits `harness=${CONCERTINO_HARNESS:-unknown}` on the `run.start`
telemetry event, but `CONCERTINO_HARNESS` is set nowhere — `concertino sync` never
writes it into `.concertino.env`, even though `concertino sync` already knows which
harnesses a project renders for (`config.harnesses`). Every run therefore records
`harness=unknown`, which the drill-down screen planned for slice 2 will display
verbatim. This makes the dashboard's harness field permanently useless and needs
fixing before that screen ships.

## What Changes

- `concertino sync` renders a new `CONCERTINO_HARNESS` line into
  `scripts/concertino/.concertino.env`. When the project configures exactly one
  harness, that harness is the value — it can never be wrong. When a project
  configures more than one harness (e.g. both `claude-code` and `codex`), sync
  cannot know at render time which one any given run will use, so it leaves the
  static value empty rather than writing a guess (a "full configured list" or an
  arbitrary pick would both be dishonest).
- `setup-worktree.sh` (the single script both harnesses share, per
  `docs/harness-capabilities.md`) gains a **runtime detection** step that reads
  real, harness-set process environment variables — `CLAUDECODE` (Claude Code sets
  `CLAUDECODE=1` for every Bash-tool subprocess) and `CODEX_SANDBOX` (the Codex CLI
  sandbox sets this for every command it runs) — and prefers that detected value
  over the static `.concertino.env` default. This is what actually makes a run
  started under Claude Code record `claude-code` and one under Codex record
  `codex`, including for a project configuring both. If neither runtime signal nor
  the static default resolves a value, the event still honestly records `unknown`
  rather than guessing.
- `bin/concertino validate` gains an informational line in the "Integrations"
  section surfacing how `CONCERTINO_HARNESS` will resolve for the project's
  configured harnesses (static single value, vs. runtime-detected because
  multiple harnesses are configured) — no new required config field, no new
  failure mode.
- `docs/config-reference.md` documents the new `.concertino.env` key and the
  detection/fallback order.
- `core/scripts/README.md` (and its synced copy `scripts/concertino/README.md`)
  gain `CONCERTINO_HARNESS` in the `.concertino.env` key list.

## Capabilities

### New Capabilities
- `harness-identity`: how `CONCERTINO_HARNESS` is computed at sync time (from
  configured harnesses) and resolved at run time (runtime env-var detection
  overriding the static default, with an honest `unknown` fallback), and how it
  reaches the `run.start` telemetry event.

### Modified Capabilities
- (none — no existing spec currently governs `.concertino.env` rendering or
  `run.start` telemetry content)

## Impact

- `bin/concertino` (`renderEnv`, `cmdValidate`)
- `core/scripts/setup-worktree.sh` (source of truth) and its synced copy
  `scripts/concertino/setup-worktree.sh` (this project dogfoods its own tool)
- `core/scripts/README.md` / `scripts/concertino/README.md`
- `config/concertino.schema.json` (documentation comment near `harnesses`)
- `docs/config-reference.md`
- No breaking changes; `CONCERTINO_HARNESS` is a new, additive `.concertino.env`
  key and existing consumers of `run.start` already treat `harness=unknown` as a
  valid (if uninformative) value.
