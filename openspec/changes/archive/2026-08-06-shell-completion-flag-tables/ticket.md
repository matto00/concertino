# CON-86: Shell completions missing flag tables for watch/prune/eject/migrate/answer

## Description

Found during the CON-59 CLI audit (`docs/cli-audit-2026-08.md`, finding 5).

Beyond the top-level `CMDS`/`DESC` list (now complete as of CON-59), none of
the three completion scripts' per-command flag/value tables
(`lib/cli/completion.js`) mention any of these five commands' own flags:

* **fish**: only `sync`/`update`, `diff`, `init`, `gates`, `completion` get a
  `__fish_seen_subcommand_from`-scoped flag completion block. `watch`
  (`--config`/`--out` only, already covered globally), `prune` (`--dry-run` —
  not offered), `eject` (`--role`, `--harness` — neither offered, and
  `--role` has no completable value list even if added), `migrate`
  (`--dry-run` — not offered), and `answer` (`--sub`, `--total` — not
  offered) get nothing beyond the bare subcommand name.
* **zsh**: `args_map`'s `case $words[2]` pattern list has the same five gaps
  — no flag completion offered for them.
* **bash**: the flag-name catch-all lists `--dry-run` generically (so
  `prune`/`migrate` incidentally get it) but never lists `--role` (eject) or
  `--sub`/`--total` (answer) anywhere.

## Suggested approach

Add per-command flag/value completion entries for all five, following the
existing pattern for `sync`/`diff`/`init`/`gates`. `eject --role=<...>`
ideally completes the five actual role names (orchestrator/executor/
evaluator/skeptic/auditor) — a design decision with a few reasonable shapes,
which is why this wasn't fixed inline in CON-59.

Referenced from `docs/cli-audit-2026-08.md` finding 5.

## Acceptance Criteria

- fish completion: `prune`, `eject`, `migrate`, `answer` each get a
  `__fish_seen_subcommand_from`-scoped flag completion block matching the
  existing pattern used for `sync`/`diff`/`init`/`gates`. `watch`'s
  `--out`/`--config` are already covered globally in fish (no `-n`
  predicate), so no new fish block is needed for it.
  - `prune` offers `--dry-run`.
  - `eject` offers `--role` (completing the five role names:
    orchestrator/executor/evaluator/skeptic/auditor) and `--harness`.
  - `migrate` offers `--dry-run`.
  - `answer` offers `--sub` and `--total`.
- zsh completion: `args_map`'s `case $words[2]` pattern list gains entries
  for `prune`, `eject`, `migrate`, `answer` (same flags/values as fish)
  **and for `watch`** — zsh, unlike fish and bash, has no
  subcommand-independent global completion mechanism, so `watch` currently
  gets zero flag completion in zsh; it needs its own `args_map` entry
  offering `--out`/`--config` (mirroring the existing
  `validate|doctor|upgrade` entry) to reach parity with the other two
  shells.
- bash completion: flag-name completion offers `--role` (eject) and
  `--sub`/`--total` (answer) in addition to the already-present `--dry-run`,
  plus a `case "$prev"` entry so `--sub`/`--total` take no suggested value
  (matching the existing `--run` precedent) rather than falling through to
  the flag-name catch-all.
- Automated regression coverage (`test/completion.test.js`, auto-discovered
  by `node --test`) asserts the new per-command entries are present in each
  shell's generated output and that the pre-existing
  `sync`/`diff`/`init`/`gates`/`completion` entries remain unchanged.
- Existing completions for `sync`/`update`/`diff`/`init`/`gates`/`completion`
  remain unchanged in behavior.
