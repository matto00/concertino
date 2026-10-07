## 1. CLI and docs (PR 1)

- [x] 1. `buildSnapshot` — fold runs into the JSON contract
- [x] 2. `cmdFleet` — CLI wrapper, dispatch, help
- [x] 3. OpenSpec change + docs for the CLI (closes PR 1)

## 2. The Claude Code mod (PR 2)

- [x] 4. Mod scaffold, type contract, `snapshot.ts`
- [x] 5. `lanes.ts` — correlation, liveness, ordering, summary
- [x] 6. `render.tsx` — the lane list
- [x] 7. `render.tsx` — the detail view
- [x] 8. The poll — `refresh`, status line, toast, `/fleet`, `session.start`
- [x] 9. Wire plugin validate/test into `npm test`; type-check
- [x] 10. Manual verification and PR 2

## 3. v1.1 — Linear ticket detail

- [x] 1. `fetchTicketDetail` — one Linear issue in the launch-pad shape
- [x] 2. Per-ticket detail cache for `concertino fleet`
- [x] 3. `concertino fleet --tickets` attaches cached Linear detail
- [x] 4. Pane requests detail for shown lanes; toast only shown lanes
- [x] 5. Pane detail: metadata, description, latest comments
- [x] 6. Docs, OpenSpec deltas, full suite
