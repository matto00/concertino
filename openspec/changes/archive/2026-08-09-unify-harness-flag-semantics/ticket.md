# CON-84: Unify `--harness` flag semantics: comma-list (sync/diff) vs single-value (eject)

## Description

Found during the CON-59 CLI audit (`docs/cli-audit-2026-08.md`, finding 3).

`sync` and `diff` both do `args.harness.split(',')` — `--harness` there accepts a comma-separated list (`claude-code,codex,opencode`) and any combination applies. `eject`'s `--harness` is compared with strict equality against a single string (`harness === 'claude-code'`) — it accepts exactly one of three literal values; a comma-separated list would either silently match nothing (falling through to eject's "unknown harness" error) or be misread as a single malformed value.

Both `lib/cli/help.js` and `README.md` already document the difference correctly today (`sync`/`diff` show `claude-code,codex,opencode`; `eject` shows `claude-code|codex|opencode`), so no user is currently misled by the docs — but the same flag name meaning two different things depending on which subcommand it's attached to is a real cross-command consistency gap.

## Suggested approach

Unify the two — e.g. make `eject --harness` also accept (and meaningfully act on) a comma-separated list, or rename one of the two flags. This is a flag-semantics change with its own blast radius (completion scripts, docs, any script already passing `eject --harness=X`), so it needs its own design/review pass rather than being folded into another change.

Referenced from `docs/cli-audit-2026-08.md` finding 3.
