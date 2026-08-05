## Context

`bin/concertino` is a thin dispatcher (`bin/concertino:22-69`): it parses
argv, then an `if/else` chain routes to one `cmd*` function per subcommand
imported from `lib/cli/*.js`. Today `const cmd = args._[0] || 'help'`
(`bin/concertino:40`) means no subcommand routes to `help()`. `cmdWatch`
(`lib/cli/watch.js`) already resolves `--out`/`--config` and launches
`lib/ui/watch.js`'s TUI; it is the target behavior for the bare-invocation
case per the ticket's acceptance criteria.

The ticket also asks for an audit of the remaining subcommand surface
(`init`, `sync`, `update`, `validate`, `diff`, `doctor`, `prune`, `upgrade`,
`gates`, `completion`, `eject`, `migrate`) for flag-naming consistency,
missing `--help` text, and discoverability gaps, with an explicit
scope-check clause: individually-sizable gaps become follow-up tickets
rather than being folded into this change.

## Goals / Non-Goals

**Goals:**
- Bare `concertino` launches the dashboard via the exact same `cmdWatch(args)`
  call `concertino watch` already uses — no behavioral fork between the two
  entry points.
- `watch`, `help`, `--version` keep working exactly as before.
- Produce a written audit (`docs/cli-audit-2026-08.md`) covering every
  remaining subcommand, following the existing `docs/repo-audit-2026-08.md`
  precedent (finding → fixed-inline-or-follow-up, with rationale).
- Fix the two discoverability gaps the audit finds that are small, low-risk,
  and directly named by the ticket's own acceptance criteria (a subcommand
  missing from completion scripts or top-level help) — do not expand scope
  beyond that.

**Non-Goals:**
- Do not add per-subcommand `--help` flag support (e.g. `concertino sync
  --help`) in this change — no subcommand has it today, adding it uniformly
  touches all thirteen `cmd*` functions' argument handling, and is exactly
  the kind of "individually-sizable gap" the ticket's scope-check clause
  says to file separately rather than fold in here.
- Do not rename or restructure any existing flag for cross-command
  consistency in this change, even where the audit finds an inconsistency —
  same reasoning: a flag rename is a behavior change with its own blast
  radius (completion scripts, docs, muscle memory) and belongs in its own
  reviewed change.
- Do not change `lib/ui/watch.js`'s dashboard behavior itself — this change
  only changes how it is reached.

## Decisions

**1. Route through the existing `cmd` variable, not a separate branch.**
Change `const cmd = args._[0] || 'help'` to `const cmd = args._[0] ||
'watch'` in `bin/concertino`, rather than adding a new `if (!args._[0])`
branch ahead of the dispatch chain. This keeps `watch` as the single source
of truth for "no subcommand" behavior — anyone reading the dispatch table
sees one line change, and `concertino watch` and bare `concertino` are
provably the same code path (both set `cmd = 'watch'`) rather than two call
sites that could drift.
*Alternative considered*: special-case `!args._[0]` to call `cmdWatch`
directly before the dispatch chain. Rejected — it duplicates the `cmdWatch`
call site and makes `help`'s current default fallback (now unreachable
except via the explicit `help` command) easy to lose track of.

**2. `help`/`--version` remain checked before the `cmd` default kicks in.**
`args.version` is already checked before the dispatch chain
(`bin/concertino:41`) and continues to short-circuit before `cmd` is even
used. `concertino help` still requires being typed explicitly — there is no
change to when `help()` runs, only to what runs when neither `help` nor any
other subcommand was typed.

**3. `watch` becomes the primary form in documentation; keep it as a fully
documented, first-class alias, not deprecated.**
The ticket explicitly requires deciding this. Because scripts, muscle
memory, `docs/dashboard.md`, and `README.md`'s CLI reference already
reference `concertino watch` directly, and there's no cost to keeping two
spellings of the same dispatch target, `watch` stays fully documented (not
marked deprecated). `docs/dashboard.md`'s title and intro, and `README.md`'s
CLI reference, each gain a one-line note that bare `concertino` is
equivalent. Top-level help text (`lib/cli/help.js`) and `README.md` both
document the bare form first (as the primary/most-discoverable form) with
`watch` noted as the explicit alias immediately after.

**4. Audit fixes: fix mechanically-safe, ticket-named gaps inline; write up
everything else.**
`lib/cli/completion.js`'s `CMDS`/`DESC` tables, `lib/cli/help.js`'s
subcommand list, and `README.md`'s `## CLI reference` section (a third,
independent full subcommand listing kept in sync with `help.js` by
convention only, not by any shared source) are each missing entries for
commands that already exist (`prune`, `eject`, `migrate`, `answer` from
completion; `answer` from `help.js`; `prune` and `answer` from README, which
also still describes `concertino watch` with no mention of the new
bare-invocation default). All three are additions to an existing list or
table, mechanically verifiable (compare against `bin/concertino`'s dispatch
`if/else` chain, which is authoritative), and directly named by the
acceptance criteria's "commands that exist but aren't discoverable from
top-level help" example — so all three are fixed inline. Every other audit
finding (flag-naming inconsistency across commands, per-subcommand `--help`
support) is written up in `docs/cli-audit-2026-08.md` with a
fixed-inline-or-follow-up verdict per finding, following
`docs/repo-audit-2026-08.md`'s format; anything not fixed inline gets a
follow-up Linear ticket filed and referenced by ID.

## Risks / Trade-offs

- [Risk] A script or CI job somewhere pipes bare `concertino` (e.g.
  `concertino | grep ...`) expecting help text on stdout, and silently
  breaks when it gets an interactive TUI instead. → Mitigation: `cmdWatch`
  already requires tmux and a TTY-attached terminal; grep-ing the codebase's
  own scripts (`scripts/`, `package.json`, CI config) for a bare
  `concertino` invocation with no subcommand as part of task execution to
  confirm none exists before shipping. `concertino help` remains available
  and unchanged for any caller that wants the old text output.
- [Risk] Filing follow-up tickets for audit findings not fixed inline could
  under- or over-scope those tickets without another human pass. →
  Mitigation: each follow-up ticket references the specific
  `docs/cli-audit-2026-08.md` finding it covers, so scope is traceable back
  to the write-up rather than re-derived from memory.

## Migration Plan

No data migration. Deploy is just merging the branch — the behavior change
takes effect the next time a user runs `concertino` with the updated
`bin/concertino` on their `PATH`. No rollback complexity beyond reverting the
one-line dispatch default if needed.
