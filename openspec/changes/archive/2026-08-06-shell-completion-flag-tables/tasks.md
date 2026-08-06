## 1. Fish completion

- [x] 1.1 Add `__fish_seen_subcommand_from prune` block offering `--dry-run`
- [x] 1.2 Add `__fish_seen_subcommand_from eject` blocks offering `--role`
      (values: orchestrator, executor, evaluator, skeptic, auditor) and
      `--harness` (values: claude-code, codex, opencode)
- [x] 1.3 Add `__fish_seen_subcommand_from migrate` block offering `--dry-run`
- [x] 1.4 Add `__fish_seen_subcommand_from answer` block offering `--sub`
      and `--total`

## 2. Zsh completion

- [x] 2.1 Add `prune` entry to `args_map` offering `--dry-run`
- [x] 2.2 Add `eject` entry to `args_map` offering `--role` (with the five
      role-name value list) and `--harness` (existing harness value list)
- [x] 2.3 Add `migrate` entry to `args_map` offering `--dry-run`
- [x] 2.4 Add `answer` entry to `args_map` offering `--sub` and `--total`
- [x] 2.5 Add a `watch` entry to `args_map` offering `--out`/`--config`
      only, mirroring the existing `validate|doctor|upgrade` pattern — zsh
      (unlike fish/bash) has no subcommand-independent global completion,
      so `watch` currently gets zero flag completion in zsh without this

## 3. Bash completion

- [x] 3.1 Add `--role` and `--sub`/`--total` to the flag-name catch-all list
- [x] 3.2 Add a `--role` value-completion case offering the five role names
- [x] 3.3 Add a `--sub|--total) COMPREPLY=() ;;` case to the `case "$prev"`
      switch (parallel to the existing `--run` case) so typing
      `answer T V --sub <TAB>` suggests nothing, rather than falling
      through to the flag-name catch-all and suggesting flag names as a
      value for `--sub`
- [x] 3.4 Confirm `--dry-run` is already covered for `prune`/`migrate` (no
      change needed — already generic)

## 4. Verification

- [x] 4.1 Add `test/completion.test.js` (auto-discovered by `node --test`)
      asserting, for each shell, that the generated output (a) contains the
      new `prune`/`eject`/`migrate`/`answer`/`watch`(zsh-only) flag entries
      and the five exact role names, and (b) still contains the
      pre-existing `sync`/`diff`/`init`/`gates`/`completion` entries
      verbatim (or the specific substrings that matter)
- [x] 4.2 Manually run `concertino completion fish|zsh|bash` and diff
      against the previous output to confirm only the intended additions
      changed (existing sync/diff/init/gates/completion entries untouched)
- [x] 4.3 Run the full test suite and any existing lint/gate scripts
- [x] 4.4 Update `docs/cli-audit-2026-08.md` finding 5 to reflect resolution,
      if the doc tracks per-finding status
