# CON-2: Dashboard always reports the harness as "unknown"

## Description

`setup-worktree.sh` emits `harness=${CONCERTINO_HARNESS:-unknown}` on the `run.start` event, and `CONCERTINO_HARNESS` is set nowhere in the repository. Every run therefore records its harness as the literal string `unknown`, and the drill-down screen planned for slice 2 will display that.

`concertino sync` already knows which harnesses a project renders for — it is the value driving the whole adapter layer — so the information exists and simply is not plumbed through.

## Acceptance criteria

* `concertino sync` writes `CONCERTINO_HARNESS` into `scripts/concertino/.concertino.env` alongside the other `CONCERTINO_*` values.
* The value reflects the harness actually in use rather than the full configured list, so a project rendering both Claude Code and Codex records the one that ran.
* A run started under Claude Code records `harness=claude-code`; one started under Codex records `harness=codex`.
* `bin/concertino validate` accepts the new key, and `docs/config-reference.md` documents it.

## Notes

Getting "which harness is running right now" from inside a shell script may not be cleanly determinable — if so, say what you found and propose the closest honest alternative rather than guessing a value. A field that is confidently wrong is worse than one that stays `unknown`, which is the same principle the dashboard's degradation ladder is built on.

## Metadata

- Ticket URL: https://linear.app/helioapp/issue/CON-2/dashboard-always-reports-the-harness-as-unknown
- Priority: Medium
- Team: Concertino
