## Why

A run whose branch's ticket suffix is lowercase (e.g. `bug/foo/con-79`, matching Linear's own
lowercase `gitBranchName` convention) is currently split across two run directories:
`setup-worktree.sh` correctly tags its events with the canonical (uppercase) `TICKET_ID` it was
given explicitly, while `assert-phase.sh` and `start-servers.sh` still infer the ticket id from
`${WORKTREE_PATH##*/}` and tag their own events with whatever case the branch happened to use.
The dashboard then renders one delivery as two fleet rows, each missing what the other has — the
real row shows "phase unknown" and the phantom row holds the gate history. This is the same defect
CON-64 already fixed in `cleanup.sh` by threading `TICKET_ID` in explicitly; that fix never
reached `assert-phase.sh` or `start-servers.sh`.

## What Changes

- `core/scripts/assert-phase.sh` and `core/scripts/start-servers.sh` accept the canonical ticket id
  as an explicit trailing argument, mirroring `cleanup.sh`'s CON-64 shape exactly: when passed, it
  is used verbatim for every `gate.result`/`gate.warning` event that script emits; when omitted,
  the existing `${WORKTREE_PATH##*/}` basename inference remains as a documented fallback (so
  call sites that predate this argument, or any future one, degrade the same safe way CON-64
  already established rather than breaking).
- `core/roles/orchestrator.md`, `core/roles/evaluator.md`, and `core/roles/skeptic.md` are updated
  to pass `$TICKET_ID` at every call site that invokes `assert-phase.sh` or `start-servers.sh`, and
  the rendered role/agent files are re-synced from these templates.
- `core/scripts/emit-event.sh` canonicalises a well-formed `ticket=` value to uppercase before it
  is used to build `RUN_DIR` or written into any event's `ticket` field — unconditionally, not only
  when an existing differently-cased run directory is detected — so no future case-only variance
  (whether from basename inference, a copy-pasted lowercase id, or any other source) can fork a
  run's identity again. This is a second, independent line of defense underneath the explicit-
  argument fix above: even a call site that still relies on inference now converges on the same
  directory as one that was told the ticket id explicitly.
- No migration of already-split run directories from before this fix — see Impact below.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `gate-telemetry`: `assert-phase.sh` and `start-servers.sh` gain an explicit, optional trailing
  `TICKET_ID` argument used for the `ticket` field of every event they emit, falling back to the
  existing worktree-basename inference only when it is omitted.
- `ticket-id-path-safety`: `emit-event.sh` additionally canonicalises a validated `ticket=` value
  to uppercase before it is used to build a path or written into an event, so a case-only variant
  of an existing ticket id can never address a different `RUN_DIR`.

## Impact

- Affected scripts: `core/scripts/assert-phase.sh`, `core/scripts/start-servers.sh`,
  `core/scripts/emit-event.sh`.
- Affected role templates: `core/roles/orchestrator.md`, `core/roles/evaluator.md`,
  `core/roles/skeptic.md` (call-site updates only — no procedural changes).
- Test coverage: extend `test/scripts/assert-phase.test.sh` and
  `test/scripts/start-servers.test.sh` with the CON-64-style explicit-ticket-id /
  non-ticket-shaped-basename regression cases, and extend `test/scripts/emit-event.test.sh` with
  the case-canonicalisation behavior.
- Existing already-split run directories (from before this fix) are not migrated: the defect is
  telemetry-only (per the ticket's own "Blast radius" — gates still enforced correctly, no run was
  ever compromised), the affected directories are historical and will age out under the dashboard's
  existing retention/reap policy, and writing a one-off migration script for a handful of already-
  cold directories is not worth the added surface. This is a deliberate decision, not an oversight.
