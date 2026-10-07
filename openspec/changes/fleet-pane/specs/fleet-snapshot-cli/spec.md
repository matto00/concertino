## Purpose

Gives Concertino a read-only, tmux-independent snapshot of every run — folded by the same reducer the dashboard uses — so a Claude Code driver session (or the driver model itself) can see lane state without the watch TUI.

## ADDED Requirements

### Requirement: Fleet snapshot command
The CLI SHALL provide `concertino fleet [--json] [--all] [--out=DIR]` that reads `.concertino/runs/*/events.jsonl` under the resolved main checkout and prints every run folded by the dashboard reducer, with no tmux window data. The command SHALL NOT write any file or emit any event.

#### Scenario: JSON snapshot
- **WHEN** `concertino fleet --json` runs in a repo with active runs
- **THEN** stdout is one JSON object `{ generatedAt, root, runs[] }` where each run is the reducer's run model without `events`, plus `ticket_doc { title, excerpt }`, `pendingAnswer`, `timeline` (last 20 events, fields `t, kind, phase, cycle, agent, role, verdict, gate, status, url, label`) and `currentAgent`

#### Scenario: Done runs hidden by default
- **WHEN** a run has a terminal `run.end` with status `delivered`
- **THEN** it is absent from the output unless `--all` is given

#### Scenario: Worktree cwd
- **WHEN** the command runs from `.concertino/worktrees/<type>/<change>/<T>`
- **THEN** `root` is the main checkout and its runs are listed

#### Scenario: No runs
- **WHEN** `.concertino/runs` does not exist
- **THEN** the command exits 0 with `runs: []` (`--json`) or a dim "no active runs" line

### Requirement: Linear detail for requested tickets
`concertino fleet --json --tickets=A,B` SHALL attach `ticket_meta` (state, assignee, priority, estimate, labels, description, url, newest 50 comments, `fetchedAt`) and `ticket_meta_error` to the requested runs only. Detail is fetched from Linear only (`ticketProvider.kind: linear`, `LINEAR_API_KEY`) and cached per ticket in `.concertino/cache/fleet-tickets.json` with a 20 s TTL (`CONCERTINO_FLEET_TICKET_TTL_MS` overrides). The first Linear failure in an invocation SHALL stop further fetches.

#### Scenario: Fresh cache served
- **WHEN** a requested ticket has a cache entry younger than the TTL
- **THEN** `ticket_meta` is served from the cache and Linear is not called

#### Scenario: Stale entry refetched
- **WHEN** a requested ticket's cache entry is older than the TTL
- **THEN** it is refetched from Linear and the cache entry is rewritten

#### Scenario: First failure stops further fetches
- **WHEN** a Linear fetch fails during an invocation
- **THEN** `ticket_meta_error` is set for that ticket and no further Linear fetches are made in that invocation

#### Scenario: Non-linear provider
- **WHEN** the ticket provider is not linear or `LINEAR_API_KEY` is absent
- **THEN** `ticket_meta` is null and `ticket_meta_error` says why
