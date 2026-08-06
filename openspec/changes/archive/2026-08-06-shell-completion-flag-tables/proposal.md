## Why

The CON-59 CLI audit (`docs/cli-audit-2026-08.md`, finding 5) found that
`lib/cli/completion.js`'s per-command flag/value completion tables (fish,
zsh, bash) never mention `watch`, `prune`, `eject`, `migrate`, or `answer`.
Users tab-completing these five commands get the bare subcommand name and
nothing else, even though four of the five take real flags
(`prune --dry-run`, `eject --role/--harness`, `migrate --dry-run`,
`answer --sub/--total`) — inconsistent with the existing completion support
for `sync`/`diff`/`init`/`gates`.

## What Changes

- Add fish `__fish_seen_subcommand_from`-scoped flag completion blocks for
  `prune` (`--dry-run`), `eject` (`--role` completing the five role names,
  `--harness` completing `claude-code`/`codex`/`opencode`), `migrate`
  (`--dry-run`), and `answer` (`--sub`, `--total`). `watch` needs no new
  fish block — its only flags (`--config`/`--out`) are already completed
  globally in fish.
- Add zsh `args_map` entries for the same four commands (`prune`, `eject`,
  `migrate`, `answer`), following the existing `_arguments` pattern, **plus
  a new `watch` entry** (`--out`/`--config` only) — zsh has no
  subcommand-independent global completion mechanism, so unlike fish and
  bash, `watch` currently gets zero flag completion in zsh.
- Add bash flag-name completion for `--role` and `--sub`/`--total` to the
  catch-all list (`--dry-run` is already offered generically), a `--role`
  value-completion case (the five role names) mirroring the existing
  `--harness`/`--example` cases, and a `--sub|--total` value-position case
  producing no completions (mirroring the existing `--run` case).
- Add `test/completion.test.js` asserting the new per-command entries are
  present in each shell's generated output and the pre-existing entries for
  `sync`/`diff`/`init`/`gates`/`completion` remain unchanged.
- No changes to `sync`/`update`/`diff`/`init`/`gates`/`completion`'s
  existing completion behavior.

## Capabilities

### New Capabilities

- `cli-shell-completions`: the behavior of `concertino completion
  <fish|zsh|bash>` — which subcommands and flags each generated completion
  script offers, and which flags complete a fixed value list.

### Modified Capabilities

(none — no existing spec covers this file's behavior)

## Impact

- `lib/cli/completion.js` only. No other files, no runtime behavior changes
  outside completion-script generation (the scripts it prints are advisory
  shell config, not consumed by concertino itself).
