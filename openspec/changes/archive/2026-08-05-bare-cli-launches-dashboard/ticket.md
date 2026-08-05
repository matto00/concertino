# CON-59: Bare `concertino` launches the dashboard; audit and expand the CLI surface

## Description

Today, running `concertino` with no subcommand defaults to `help` (`bin/concertino:1830-1853`, `const cmd = args._[0] || 'help'`), and the dashboard is only reachable via the explicit `concertino watch` subcommand (`cmdWatch()`, `bin/concertino:1130-1139`). Since the fleet dashboard is the primary/most-used surface of this tool, make the bare `concertino` invocation launch it directly, and use the opportunity to audit the rest of the CLI for consistency and gaps.

Current subcommand list (from `bin/concertino:1835-1848` and its help text): `init`, `sync`, `update`, `validate`, `diff`, `doctor`, `watch`, `prune`, `upgrade`, `gates`, `completion`, `eject`, `migrate`, plus `help`/`--version`.

## Acceptance Criteria

* `concertino` with no arguments launches the same dashboard as `concertino watch` today (reusing `cmdWatch()`'s logic, including its `--out`/`--config` flag resolution).
* `concertino watch` keeps working as an explicit alias (don't break existing muscle memory / scripts / docs that reference it) — decide and document whether `watch` becomes a documented alias or the primary form going forward.
* Audit the remaining subcommand list (`init`, `sync`, `update`, `validate`, `diff`, `doctor`, `prune`, `upgrade`, `gates`, `completion`, `eject`, `migrate`) for: consistent flag naming/conventions across commands, missing `--help` text per-subcommand, and any obvious gaps (e.g. commands that exist but aren't discoverable from top-level `help`, or missing commands implied by existing ones).
* `concertino --version` and `concertino help` continue to work unchanged.
* Any new or renamed commands/flags found necessary during the audit are documented in the top-level help text (`bin/concertino:1740-1827`) and, if user-facing behavior changes, in `docs/` as well.
* Scope check: if the audit surfaces enough individually-sizable gaps, file them as separate follow-up tickets rather than expanding this one indefinitely — this ticket's hard requirement is just the bare-`concertino` → dashboard default plus a written-up audit of the rest.
