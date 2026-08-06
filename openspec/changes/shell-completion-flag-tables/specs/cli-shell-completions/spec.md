## ADDED Requirements

### Requirement: Per-command flag completion parity across shells
`concertino completion <fish|zsh|bash>` SHALL offer a per-command
flag/value completion entry for every concertino subcommand that takes its
own flags beyond the globally-completed `--out`/`--config`, in all three
supported shells (fish, zsh, bash) — not just a subset of commands.

#### Scenario: prune completion offers --dry-run
- **WHEN** a user runs `concertino completion fish` (or `zsh`, or `bash`)
  and inspects the generated script
- **THEN** the script offers `--dry-run` when completing flags for the
  `prune` subcommand

#### Scenario: migrate completion offers --dry-run
- **WHEN** a user runs `concertino completion fish` (or `zsh`, or `bash`)
  and inspects the generated script
- **THEN** the script offers `--dry-run` when completing flags for the
  `migrate` subcommand

#### Scenario: eject completion offers --role and --harness
- **WHEN** a user runs `concertino completion fish` (or `zsh`, or `bash`)
  and inspects the generated script
- **THEN** the script offers `--role` and `--harness` when completing flags
  for the `eject` subcommand

#### Scenario: answer completion offers --sub and --total
- **WHEN** a user runs `concertino completion fish` (or `zsh`, or `bash`)
  and inspects the generated script
- **THEN** the script offers `--sub` and `--total` when completing flags
  for the `answer` subcommand

#### Scenario: watch completes --out/--config in every shell
- **WHEN** a user runs `concertino completion fish`, `zsh`, or `bash` and
  inspects the generated script
- **THEN** the script offers `--out` and `--config` when completing flags
  for the `watch` subcommand in all three shells — in fish and bash via the
  existing global (subcommand-independent) completion, and in zsh via a
  dedicated `watch` entry in `args_map` (zsh has no equivalent global
  mechanism, so `watch` needs an explicit entry there even though fish and
  bash do not)

#### Scenario: answer's --sub/--total take no suggested value in bash
- **WHEN** a user runs `concertino completion bash`, sources it, and types
  `answer T V --sub <TAB>`
- **THEN** no flag names are suggested as a value for `--sub` (or
  `--total`) — the generated script's `case "$prev"` switch has a dedicated
  `--sub|--total` case producing no completions, matching the existing
  `--run` precedent, rather than falling through to the flag-name catch-all

### Requirement: eject --role completes the five role names
`eject --role=<...>` completion SHALL complete exactly the five concertino
agent role names: `orchestrator`, `executor`, `evaluator`, `skeptic`,
`auditor`, in every shell that offers value completion for `--role`.

#### Scenario: role value completion
- **WHEN** a user runs `concertino completion fish` (or `zsh`, or `bash`)
  and inspects the generated script's `--role` value completion
- **THEN** the offered values are exactly `orchestrator`, `executor`,
  `evaluator`, `skeptic`, `auditor`

### Requirement: existing completion behavior unchanged
Adding the new per-command entries SHALL NOT change the existing generated
completion output for `sync`, `update`, `diff`, `init`, `gates`,
`completion`, or the top-level subcommand/description list.

#### Scenario: existing commands' completions still present
- **WHEN** a user runs `concertino completion fish` (or `zsh`, or `bash`)
  and inspects the generated script
- **THEN** the existing `sync`/`update`/`diff`/`init`/`gates`/`completion`
  flag-completion entries and the top-level `CMDS`/`DESC`-derived
  subcommand list are present and unchanged
