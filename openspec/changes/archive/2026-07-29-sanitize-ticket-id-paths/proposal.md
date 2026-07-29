## Why

`persist-evidence.sh` builds `<main checkout>/.concertino/runs/<TICKET_ID>/evidence/` and
`emit-event.sh` builds `<main checkout>/.concertino/runs/<TICKET_ID>/events.jsonl` directly from
`TICKET_ID`, with no validation. A ticket id containing `..` walks out of the runs directory —
`../../../..` reaches anywhere the agent process can write. `assert-phase.sh`, `start-servers.sh`,
and `cleanup.sh` already guard every other place a ticket id reaches a shell command or a tmux
target with the same `looks_like_ticket` pattern; these two scripts are the last unguarded call
sites building a path from the same untrusted value, and the launch pad will soon be feeding
ticket ids into that path programmatically rather than from something a human typed.

## What Changes

- `core/scripts/emit-event.sh` validates `TICKET_ID` against `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$`
  (the exact pattern already carried by `assert-phase.sh`/`start-servers.sh`/`cleanup.sh`) before
  building `RUN_DIR`. A rejected ticket id emits nothing — no directory is created, no line is
  written — exactly the silent-drop degradation tier-2 telemetry already uses; the script still
  exits 0 in normal mode (an invalid ticket id must never fail the caller's run).
- `core/scripts/persist-evidence.sh` validates `TICKET_ID` the same way before building
  `DEST_DIR`. A rejected ticket id prints `FAIL <reason>` to stderr and exits non-zero — the
  existing failure contract — without creating any directory or touching the filesystem. Call
  sites already treat this script as `|| true` and omit `ref` on failure, so no caller changes.
- `test/scripts/ticket-pattern.test.sh` is extended to also extract and byte-compare the pattern
  copy now carried by `emit-event.sh` and `persist-evidence.sh`, so the shared-pattern guarantee
  covers all five shell copies (plus `lib/ui/ticket.js`'s `TICKET_RE`), not just three.
- New tests exercise a `../escape`-shaped ticket id against both scripts and assert nothing is
  written outside `.concertino/runs/`.
- Swept the remaining procedure scripts (`gather-escalation-context.sh`, `start-servers.sh`,
  `cleanup.sh`, `setup-worktree.sh`) for any other place a ticket id reaches a filesystem path
  unvalidated — none found; `setup-worktree.sh` only uses `TICKET_ID` to derive a numeric port
  offset and to tag an `emit-event.sh` call (already covered by this change), never to build a
  path directly.

## Capabilities

### New Capabilities
- `ticket-id-path-safety`: the shared `looks_like_ticket` guard, now also carried by
  `emit-event.sh` and `persist-evidence.sh`, and the degradation each takes on a rejected id
  (silent drop for telemetry, `FAIL`/non-zero for evidence persistence) — never a misplaced file.

### Modified Capabilities
- `evidence-telemetry`: `persist-evidence.sh`'s failure requirement gains ticket-shape validation
  as an additional, filesystem-untouched failure cause ahead of the existing "source
  missing/unreadable" and "copy cannot be written" causes.

## Impact

- `core/scripts/emit-event.sh`, `core/scripts/persist-evidence.sh` (and their rendered copies
  under `scripts/concertino/` via `concertino sync`).
- `test/scripts/ticket-pattern.test.sh` (extended), plus new assertions added to
  `test/scripts/emit-event.test.sh` and `test/scripts/persist-evidence.test.sh`.
- No caller changes: `orchestrator.md`/`evaluator.md`/`skeptic.md` prose and every existing call
  site already treat a missing `ref`/dropped event as an expected degradation path.
