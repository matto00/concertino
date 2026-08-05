## Why

The fleet dashboard (`concertino watch`) is the primary, most-used surface of
this tool, but a bare `concertino` invocation currently falls through to
`help()` (`bin/concertino:40`, `const cmd = args._[0] || 'help'`) instead of
launching it. Every other subcommand was added ad hoc over time with no pass
checking flag-naming consistency or top-level discoverability across the
full command set — this change fixes the primary entry-point gap and audits
the rest so any further-sizable gaps are captured as explicit follow-ups
rather than silently left.

## What Changes

- `concertino` with no subcommand now launches the fleet dashboard (the same
  `cmdWatch()` path as `concertino watch`, including its `--out`/`--config`
  resolution), instead of `help()`.
- `concertino watch` keeps working unchanged and remains the documented,
  explicit form (existing scripts/docs/muscle memory referencing it keep
  working); the top-level help text is updated to state that bare
  `concertino` is an alias for it.
- `concertino help` and `concertino --version` are unaffected — both still
  require being typed explicitly.
- Audit fix: `lib/cli/completion.js`'s `CMDS`/`DESC` tables (used by all
  three shell completion scripts) are missing `prune`, `eject`, `migrate`,
  and `answer` — a direct instance of the ticket's "commands that exist but
  aren't discoverable" gap. Add all four so completion covers every
  registered subcommand in `bin/concertino`.
- Audit fix: the top-level help text (`lib/cli/help.js`) documents every
  subcommand except `answer`. Add a `concertino answer` entry.
- Audit fix: `README.md`'s `## CLI reference` section is a third,
  independent full subcommand listing (kept roughly in sync with
  `lib/cli/help.js` by convention, not by any shared source) that is also
  missing `prune` and `answer`, and still documents `concertino watch` as
  the way to launch the dashboard with no mention of the new bare-invocation
  default. Add the missing entries and the bare-invocation note here too —
  the same discoverability gap, on the repo's most visible surface.
- Audit write-up: a new `docs/cli-audit-2026-08.md` records the full
  subcommand-by-subcommand review (flag-naming conventions, per-subcommand
  `--help` support, other discoverability gaps) called for by the ticket,
  following the precedent of `docs/repo-audit-2026-08.md`. Findings judged
  large enough to need their own design/review cycle are filed as separate
  follow-up Linear tickets and only referenced here, not implemented in this
  change (matching this ticket's own scope-check clause).

## Capabilities

### New Capabilities

- `cli-default-command`: bare `concertino` (no subcommand) launches the fleet
  dashboard via the same code path as `concertino watch`; `watch` remains a
  fully-supported explicit alias; `help`/`--version` are unaffected. Also
  covers the completion-script and top-level-help discoverability fixes
  found by this change's audit (every registered subcommand appears in both).

### Modified Capabilities

(none — no existing spec's requirements change)

## Impact

- `bin/concertino` (dispatch: `cmd = args._[0] || 'help'` becomes
  `args._[0] || 'watch'`, with `help`/`--version` unaffected).
- `lib/cli/help.js` (documents the new bare-invocation behavior + the
  missing `answer` entry).
- `lib/cli/completion.js` (fish/zsh/bash completions gain the four missing
  commands).
- `README.md` (`## CLI reference` gains a bare-invocation entry, `prune`,
  and `answer`, and notes bare `concertino` as the primary way to launch the
  dashboard).
- `docs/` (new `docs/cli-audit-2026-08.md`; possible one-line mention in
  `docs/quickstart.md` if it currently tells readers to run `concertino
  watch` explicitly).
- No backend/runtime behavior changes beyond the CLI entry point — no
  breaking changes (bare `concertino` previously printed help and exited 0;
  it now launches an interactive TUI, which is the acceptance criterion
  itself, not a break of any documented contract).
