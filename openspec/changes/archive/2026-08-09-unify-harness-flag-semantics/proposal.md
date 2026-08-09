## Why

`--harness` means two different things depending on which subcommand it is
attached to. `sync` and `diff` both parse it as a comma-separated list
(`args.harness.split(',')`) and act on every named harness in one invocation.
`eject` compares it with strict equality against a single literal
(`harness === 'claude-code'`), so a comma-separated value either falls
through to eject's generic "unknown harness" error or is silently
misinterpreted. Both `lib/cli/help.js` and `README.md` already document the
difference correctly today, so no user is currently misled by the docs — but
the same flag name behaving differently per subcommand is a real
cross-command consistency gap (found during the CON-59 CLI audit,
`docs/cli-audit-2026-08.md` finding 3, filed as this follow-up ticket).

## What Changes

- Add one shared `--harness` parsing/validation helper (`lib/cli/shared.js`)
  used by `sync`, `diff`, and `eject` alike: splits on commas, trims each
  entry, and validates every entry against the three known harness ids
  (`claude-code`, `codex`, `opencode`), exiting with a single clear error
  naming the invalid value(s) and the valid set. `sync`/`diff` gain this
  validation as a side effect — today an unrecognized harness name silently
  matches nothing and produces no output for it, with no error.
- `eject --harness` now accepts (and meaningfully acts on) a
  comma-separated list, exactly like `sync`/`diff`. `--harness` omitted still
  defaults to `claude-code` alone (unchanged from today), so the common
  `concertino eject --role=executor | less` invocation behaves identically
  to before.
- When `eject` is given more than one harness, it renders and prints each
  harness's output to stdout in sequence, each preceded by a one-line
  `# ---- harness: <name> ----` header so a piped/inspected multi-harness
  output is unambiguous. With exactly one harness (the default, and the only
  case supported before this change) the output is the raw rendered file
  with no header, byte-for-byte identical to today's single-harness output.
- If a listed harness doesn't support the requested `--role` (e.g. `codex`
  only supports `executor`/`evaluator`/`auditor`), `eject` skips that
  harness with the same "codex harness only has executor, evaluator, and
  auditor" stderr note it already prints today, and continues with the rest
  of the list; it only exits non-zero if every harness in the list is
  skipped or invalid.
- Update `lib/cli/help.js`'s and `README.md`'s `eject` usage text to show
  `--harness=claude-code[,codex,opencode]`, matching `sync`/`diff`'s existing
  phrasing, and to describe the new multi-harness output shape.

## Capabilities

### New Capabilities
- `cli-harness-flag`: defines the unified comma-separated-list parsing and
  validation contract for `--harness` shared by `sync`, `diff`, and `eject`,
  including `eject`'s multi-harness output shape and its unchanged
  single-harness default.

### Modified Capabilities
(none — no existing spec currently documents `--harness` parsing; this
introduces the first one.)

## Impact

- `lib/cli/shared.js` — new shared parsing/validation helper.
- `lib/cli/sync.js`, `lib/cli/diff.js` — switch to the shared helper (adds
  validation of unrecognized harness names; list-splitting behavior
  unchanged).
- `lib/cli/eject.js` — switch to the shared helper; accept and act on a
  comma-separated `--harness` list; add the multi-harness stdout header and
  per-harness role-support skip.
- `lib/cli/help.js`, `README.md` — `eject`'s usage/help text.
- No change to `completion.js`'s generated completion scripts — the existing
  fish/zsh/bash completions already offer the three harness tokens as
  selectable/free-text values for `eject --harness`, which remains valid
  under list semantics (a user can complete one token and append more by
  hand, same as they already can for `sync`/`diff`).
- No change to any script that already passes a single `eject
  --harness=<one-value>` (e.g. `core/scripts/setup-worktree.sh`'s harness
  detection, if any such call exists) — single-value input keeps behaving
  exactly as before.
