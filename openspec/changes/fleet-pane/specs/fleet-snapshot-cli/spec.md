## Purpose

Gives Concertino a read-only, tmux-independent snapshot of every run — folded by the same reducer the dashboard uses — so a Claude Code driver session (or the driver model itself) can see lane state without the watch TUI.

## ADDED Requirements

### Requirement: Fleet snapshot command
The CLI SHALL provide `concertino fleet [--json] [--all] [--out=DIR]` that reads `.concertino/runs/*/events.jsonl` under the resolved main checkout and prints every run folded by the dashboard reducer, with no tmux window data. The command SHALL NOT write any file or emit any event, except `.concertino/cache/fleet-tickets.json` when `--tickets` is given.

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
`concertino fleet --json --tickets=A,B` SHALL attach `ticket_meta` (state, assignee, priority, estimate, labels, description, url, newest 50 comments, `fetchedAt`) to any run with a cached entry, and `ticket_meta_error` to the requested runs only. Detail is fetched from Linear only (`ticketProvider.kind: linear`, `LINEAR_API_KEY`) and cached per ticket in `.concertino/cache/fleet-tickets.json` with a 20 s TTL (`CONCERTINO_FLEET_TICKET_TTL_MS` overrides). An invocation-wide Linear failure (HTTP 429, rejected key, timeout, network error, exhausted budget) SHALL stop further fetches; a per-ticket failure (such as not found) SHALL NOT. All fetches in one invocation SHALL share a 2.5 s time budget, and the cache SHALL be written after every fetch.

#### Scenario: Fresh cache served
- **WHEN** a requested ticket has a cache entry younger than the TTL
- **THEN** `ticket_meta` is served from the cache and Linear is not called

#### Scenario: Stale entry refetched
- **WHEN** a requested ticket's cache entry is older than the TTL
- **THEN** it is refetched from Linear and the cache entry is rewritten

#### Scenario: Invocation failure stops further fetches
- **WHEN** a Linear fetch fails with an invocation-wide error (for example HTTP 429) during an invocation
- **THEN** `ticket_meta_error` is set on every requested run and no further Linear fetches are made in that invocation

#### Scenario: Rate limit backs off
- **WHEN** a fetch fails with HTTP 429
- **THEN** the ticket's cache entry records `retryUntil` 60 s ahead and is not refetched until then

#### Scenario: Not found is cached negatively
- **WHEN** a requested ticket is not found in Linear
- **THEN** a failure entry is cached, that run reports the error with `ticket_meta: null`, the next requested ticket is still fetched, and the ticket is not refetched until the TTL expires

#### Scenario: Time budget
- **WHEN** the fetches in one invocation have used the 2.5 s budget
- **THEN** no further fetch starts, the remaining requested runs carry a budget `ticket_meta_error`, and the cache already holds the earlier results

#### Scenario: Non-linear provider
- **WHEN** the ticket provider is not linear
- **THEN** `ticket_meta` is null unless cached and `ticket_meta_error` is null, with no fetch

#### Scenario: Missing key
- **WHEN** the provider is linear and `LINEAR_API_KEY` is absent
- **THEN** `ticket_meta_error` says why and no fetch is made
