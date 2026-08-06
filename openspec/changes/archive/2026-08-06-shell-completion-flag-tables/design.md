## Context

`lib/cli/completion.js` generates fish/zsh/bash completion scripts from two
shared tables (`CMDS`, `DESC`) plus per-shell, per-command flag/value
completion entries. Five commands (`watch`, `prune`, `eject`, `migrate`,
`answer`) currently get no per-command flag entries in any of the three
shells (see `docs/cli-audit-2026-08.md` finding 5, and `ticket.md`). This is
a small, single-file, mechanical extension of an existing pattern — no
cross-cutting architecture, new dependency, or migration complexity, so this
design doc is intentionally brief.

## Goals / Non-Goals

**Goals:**
- Bring `prune`, `eject`, `migrate`, `answer` to parity with the existing
  `sync`/`diff`/`init`/`gates` flag-completion pattern, in all three shells.
- `eject --role=<...>` completes the five real role names.

**Non-Goals:**
- `watch` needs no new fish or bash entry — its flags (`--config`/`--out`)
  are genuinely global in those two shells (fish's `complete` lines carry no
  `-n` predicate; bash's `case "$prev"` switch is keyed only on the previous
  token, not the subcommand). **zsh is the exception**: its `args_map`/`case
  $words[2]` switch has no default branch, so `watch` currently gets *zero*
  flag completion in zsh — confirmed by running `node bin/concertino
  completion zsh` directly. zsh therefore needs a new `watch` entry (see
  Decisions below), even though fish/bash do not.
- No change to `CMDS`/`DESC` (already complete per CON-59) or to any
  existing command's completion behavior.
- No new flags on the underlying commands themselves — this only teaches the
  completion scripts about flags that already exist (confirmed by reading
  `lib/cli/prune.js`, `lib/cli/eject.js`, `lib/cli/migrate.js`,
  `lib/cli/answer.js`).

## Decisions

- **Role name list**: hard-code the five role names
  (`orchestrator executor evaluator skeptic auditor`) directly in
  `completion.js`, rather than importing them from wherever `eject.js`
  derives `meta.roles` — completion.js has no existing pattern of importing
  from other `lib/cli/*` modules for its value lists (e.g. `--harness`'s
  `claude-code codex opencode` and `--example`'s `helio generic
  opencode-ollama` are already hard-coded the same way), so this follows the
  file's existing convention rather than introducing a new one for this
  change alone.
- **`answer`'s `--sub`/`--total`**: completed as plain value-bearing flags
  (`-r` in fish, `:` value spec with no fixed list in zsh, `COMPREPLY=()` in
  bash) — matching how `gates --run` (a free-form value, no fixed list) is
  already completed, since neither takes a value from a closed set.
- **`watch`**: no new fish or bash block (already global there, per
  Non-Goals). zsh gets one new `args_map` entry —
  `'"--out=[project root]:dir:_files -/" "--config=[config path]:file:_files"'`
  — mirroring the existing `validate|doctor|upgrade` pattern, so `watch`
  reaches the same completion parity in zsh that it already has in fish and
  bash. This is a genuine addition, not a documented no-op.
- **bash `--sub`/`--total` value completion**: it is not enough to add
  `--sub`/`--total` to the flag-*name* catch-all — bash also needs an
  explicit `--sub|--total) COMPREPLY=() ;;` case in the `case "$prev"`
  switch (parallel to the existing `--run) COMPREPLY=() ;;` line), or typing
  `answer T V --sub <TAB>` falls through to the `*)` catch-all and suggests
  every flag *name* as a completion for `--sub`'s *value*, which contradicts
  the free-form/no-suggestion behavior this decision commits to.

## Risks / Trade-offs

- [Hard-coded role list drifts from `meta.roles` in `eject.js` if a role is
  ever added/removed] → Low risk (roles are a fixed architectural concept,
  not a growing list); existing `--harness`/`--example` value lists already
  carry the identical risk and have not caused a problem to date.
