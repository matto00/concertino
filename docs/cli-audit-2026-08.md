# CLI audit — 2026-08

A sweep of `concertino`'s subcommand surface performed as part of CON-59
(bare `concertino` launches the dashboard; audit the rest of the CLI).
Scope bounded to the ticket's named areas: flag-naming/convention
consistency across `init`, `sync`, `update`, `validate`, `diff`, `doctor`,
`prune`, `upgrade`, `gates`, `completion`, `eject`, `migrate`; missing
per-subcommand `--help` support; and any other discoverability gaps beyond
the two the ticket already named (completion scripts, top-level help — both
fixed inline in this change, see below). Follows `docs/repo-audit-2026-08.md`'s
format: one section per finding, each ending in a **fixed inline** or
**follow-up** verdict with rationale.

## 1. Discoverability gaps named directly by the ticket (fixed inline)

Confirmed by diffing `bin/concertino`'s dispatch `if/else` chain (the
authoritative list of registered subcommands) against each of the three
independent listings:

- `lib/cli/completion.js`'s `CMDS`/`DESC` tables were missing `prune`,
  `eject`, `migrate`, and `answer` — every fish/zsh/bash completion script
  reads from the same two tables, so a user tab-completing any of those four
  subcommands got nothing.
- `lib/cli/help.js`'s top-level help text had no `concertino answer` entry.
- `README.md`'s `## CLI reference` section (a third, independent full
  listing kept in sync with `help.js` by convention only, not by any shared
  source) was missing `concertino prune` and `concertino answer`, and made
  no mention of the new bare-invocation default.

**Fixed inline** — all three are additions to an existing list/table,
mechanically verifiable against `bin/concertino`'s dispatch chain, and named
directly by the ticket's own acceptance criteria. See `lib/cli/completion.js`,
`lib/cli/help.js`, `README.md`.

## 2. `README.md`'s CLI reference is also missing `--core=PATH` on six entries

`lib/cli/help.js` (the CLI's own `--help`-equivalent output, generated from
the same dispatch chain) documents `--core=PATH` on `init`, `sync`,
`update`, `diff`, `doctor`, and `eject` — all six actually read `args.core`
(directly, or via a passthrough call to `cmdSync`/`resolveCore`).
`README.md`'s independent listing had none of those six `--core=PATH`
mentions, silently under-documenting a real, working flag on the repo's
most-visible surface — the same class of gap as finding 1, just for a flag
rather than a subcommand.

**Fixed inline** — doc-only, zero risk, mechanically verified against
`lib/cli/help.js`'s already-correct text (the source of truth for what each
command's `args` object actually reads). See `README.md`.

## 3. `--harness` has two incompatible value formats across commands

`sync` and `diff` both do `args.harness.split(',')` — `--harness` there
accepts a comma-separated list (`claude-code,codex,opencode`) and any
combination of them applies. `eject`'s `--harness` is compared with strict
equality against a single string (`harness === 'claude-code'`) — it accepts
exactly one of three literal values, and a comma-separated list would either
silently match nothing (falling through to eject's "unknown harness" error)
or be misread as a single malformed value. Both `lib/cli/help.js` and
`README.md` already document the difference correctly today (`sync`/`diff`
show `claude-code,codex,opencode`; `eject` shows
`claude-code|codex|opencode`), so no user is currently misled by the docs —
but the same flag name meaning two different things depending on which
subcommand it's attached to is a real cross-command consistency gap the
ticket asks this audit to name.

**Recommendation: follow-up ticket, not fixed inline.** Unifying the two
(e.g. making `eject --harness` also accept — and meaningfully act on — a
comma-separated list, or renaming one of the two flags) is a flag-semantics
change with its own blast radius (completion scripts, docs, any script
already passing `eject --harness=X`), which this change's design doc
explicitly rules out fixing in place (Non-Goal: "do not rename or restructure
any existing flag for cross-command consistency in this change").
**Ticket: CON-84.**

## 4. No subcommand supports a per-subcommand `--help`/`-h` flag

Confirmed via `grep -rn "args.help\|'-h'\|--help" lib/cli/*.js bin/concertino`
— zero matches. `concertino sync --help`, `concertino eject --help`, etc. all
currently either run the command with `--help` silently ignored (any command
that only reads specific flag names) or, worse, get misinterpreted (e.g.
`concertino update --help` would try to treat `--help` as a boolean flag and
still demand a `key=value` positional, printing a `usage:` error that never
mentions `--help` itself). Every subcommand's only source of documentation
is the shared top-level `concertino help`.

**Recommendation: follow-up ticket, not fixed inline.** This change's
design doc names this exact gap as an explicit Non-Goal — adding it
uniformly touches all thirteen `cmd*` functions' argument handling and is
exactly the kind of "individually-sizable gap" the ticket's own scope-check
clause says to file separately. **Ticket: CON-85.**

## 5. Shell-completion flag tables don't cover `watch`, `prune`, `eject`, `migrate`, `answer`

Beyond the `CMDS`/`DESC` top-level list (fixed in finding 1, which makes the
five subcommands complete at all), none of the three completion scripts'
per-command flag/value tables mention any of these five commands' own flags:

- **fish**: only `sync`/`update`, `diff`, `init`, `gates`, `completion` get
  a `__fish_seen_subcommand_from`-scoped flag completion block. `watch`
  (`--config`/`--out` only — already covered by the global `--out`/`--config`
  completes), `prune` (`--dry-run` — not offered), `eject` (`--role`,
  `--harness` — neither offered, and `--role` has no completable value list
  even if added), `migrate` (`--dry-run` — not offered), and `answer`
  (`--sub`, `--total` — not offered, and see finding 6 below for why they're
  a special case) get nothing beyond the bare subcommand name.
- **zsh**: `args_map` has the same five gaps — `watch|prune|eject|migrate`
  aren't in the `case $words[2]` pattern list at all, so zsh offers no flag
  completion for them (falls through to file completion or nothing).
- **bash**: the flag-name catch-all (`*) COMPREPLY=(--out --config --dry-run
  --harness --run --yes --example ...)`) already lists `--dry-run` generically
  (so `prune`/`migrate` incidentally get it), but never lists `--role` (eject)
  or `--sub`/`--total` (answer) anywhere.

**Recommendation: follow-up ticket, not fixed inline.** This is a real
discoverability gap, but per-command flag-value completions (especially
`eject --role=<...>`, which should ideally complete the five actual role
names) are a design decision with several reasonable shapes, not a
mechanical addition to an existing list — outside the "obviously safe,
mechanically verifiable" bar this change's design doc sets for inline
audit fixes (Decision 4). **Ticket: CON-86.**

## 6. `answer`'s `--sub`/`--total` flags use a different syntax convention — reviewed, no fix needed

Every other subcommand's flags follow `lib/cli/shared.js`'s global
`parseArgs` convention: `--key=value` only (a bare `--key` with no `=`
becomes boolean `true`, never consumes the next token). `concertino answer`
is the one exception — its `--sub <index> --total <n>` are value-bearing
flags that accept a space-separated value (`--sub 1`, not just `--sub=1`,
though it accepts both), parsed by a hand-rolled parser in
`lib/cli/answer.js` instead of the shared `parseArgs`.

Confirmed via `lib/cli/answer.js`'s own header comment (present since
CON-76) that this is a deliberate, already-reviewed exception: `answer` has
two positionals (`<ticket> <value>`) interleaved with its flags, and the
global `--key=value`-only convention can't represent a space-separated
`--sub 1` without losing the flag/value association — not a naming
oversight.

**Recommendation: none — no fix needed.** Noted here as a completed check
per the ticket's flag-naming-consistency ask, not a finding requiring
action.

## 7. `--config`/`--out` config-path resolution is duplicated verbatim across ten files

The one-liner `const cfgPath = args.config ? path.resolve(args.config) :
path.join(out, 'concertino.config.json')` (or the near-identical `out`
resolution above it) appears, hand-written, in `sync.js`, `diff.js`,
`eject.js`, `update.js`, `gates.js`, `doctor.js`, `watch.js`, `validate.js`,
`prune.js`, and `migrate.js` — ten of thirteen `cmd*` modules. Behavior is
identical everywhere (verified: every occurrence is byte-identical modulo
variable name), so this is not a user-facing inconsistency — no flag behaves
differently between commands because of it — but it is a maintenance hazard:
a future change to the resolution rule (e.g. an env-var fallback) would need
ten synchronized edits with no compiler/test enforcement that all ten were
updated.

**Recommendation: follow-up ticket, not fixed inline.** A shared
`resolveConfigPath(args, out)` helper in `lib/cli/shared.js` is a
straightforward extraction, but touching ten files is more than this
change's design doc's bar for a mechanically-safe inline fix, and is
unrelated to this ticket's bare-invocation/discoverability focus — a
cleaner, independently-reviewable change on its own. **Ticket: CON-87.**

## Summary

| # | Finding | Verdict |
| --- | --- | --- |
| 1 | `completion.js`/`help.js`/`README.md` missing `prune`, `eject`, `migrate`, `answer` | Fixed inline |
| 2 | `README.md` missing `--core=PATH` on 6 entries | Fixed inline |
| 3 | `--harness` comma-list (sync/diff) vs single-value (eject) | Follow-up: CON-84 |
| 4 | No per-subcommand `--help`/`-h` | Follow-up: CON-85 |
| 5 | Shell completions missing flag tables for `watch`/`prune`/`eject`/`migrate`/`answer` | Follow-up: CON-86 |
| 6 | `answer`'s space-separated `--sub`/`--total` syntax | No fix needed (reviewed, intentional) |
| 7 | `--config`/`--out` resolution duplicated across 10 files | Follow-up: CON-87 |

## Follow-up tickets

Filed:

- Finding 3 (`--harness` comma-list vs single-value) — **CON-84**
- Finding 4 (no per-subcommand `--help`/`-h`) — **CON-85**
- Finding 5 (shell completions missing flag tables for `watch`/`prune`/`eject`/`migrate`/`answer`) — **CON-86**
- Finding 7 (`--config`/`--out` resolution duplicated across 10 files) — **CON-87**
