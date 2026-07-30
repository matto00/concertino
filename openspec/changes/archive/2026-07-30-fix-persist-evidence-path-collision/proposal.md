## Why

`persist-evidence.sh` names each artifact's destination from the source path's basename alone,
into a single flat `evidence/` directory per ticket. Two artifacts from the same run whose paths
differ only above the filename (e.g. `specs/ticket-id-path-safety/spec.md` and
`specs/evidence-telemetry/spec.md`, both named `spec.md`) collide on the same destination, and
`cp -f` silently clobbers the first with the second. The script still prints `READY ref=…` and
exits 0 for both, so the caller has no way to know one of its two `evidence`/`verdict` refs now
resolves to the wrong artifact's content — and by the time anyone notices, `cleanup.sh --phase4`
has already destroyed the worktree that held the original. This was hit live delivering CON-14,
which carried exactly this two-spec-delta shape, and was deliberately left unfixed there as out
of scope.

## What Changes

- `persist-evidence.sh` derives each destination from enough of `SOURCE_PATH`'s relative-to-the-
  worktree structure to make same-basename artifacts land at distinct paths under `evidence/`,
  instead of the basename alone.
- Re-persisting the *same* source path (identical relative structure) continues to resolve to the
  same destination and overwrite it in place — the existing idempotency contract is preserved
  exactly.
- If the destination cannot be derived safely (e.g. the source path cannot be related to a
  worktree root at all), the script reports `FAIL <reason>` and exits non-zero rather than ever
  falling back to a basename-only path that could collide.
- No change to the script's CLI (`persist-evidence.sh <TICKET_ID> <SOURCE_PATH>`), its `READY
  ref=`/`FAIL` output contract, or any caller's invocation — this is purely a change to how
  `DEST_PATH` is derived internally.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `evidence-telemetry`: `persist-evidence.sh`'s destination-naming requirement changes from
  "basename under a flat `evidence/` directory" to "collision-safe path derived from enough of
  the source's relative structure to keep same-basename artifacts distinct, while staying
  idempotent for repeated calls with the same source."
- `drilldown-ticket-context`: ticket-text resolution's "persisted `ticket.md` at
  `.concertino/runs/<TICKET_ID>/evidence/ticket.md`" requirement changes to "a file named
  `ticket.md` located anywhere under `.concertino/runs/<TICKET_ID>/evidence/`" — the flat path was
  a downstream consumer's independent assumption about `persist-evidence.sh`'s destination shape,
  not a caller relaying a `ref=` value, and this change's new worktree-relative destination naming
  breaks that assumption for every real `ticket.md`. See design.md's Risks section.

## Impact

- `core/scripts/persist-evidence.sh` (canonical source; `scripts/concertino/persist-evidence.sh`
  is the synced copy and must be regenerated via `concertino sync`, not hand-edited).
- `test/scripts/persist-evidence.test.sh` — new test coverage for the two-deltas-named-`spec.md`
  collision case, plus regression coverage for the existing scenarios (destination naming details
  are asserted directly in a couple of existing checks and need updating to match).
- `core/scripts/emit-event.sh` (canonical source; `scripts/concertino/emit-event.sh` is the synced
  copy) — the one real caller affected by persist-evidence.sh's new FAIL-outside-any-git-worktree
  contract. `write_escalation_raised`'s oversized-context path staged its temp file via a bare
  `mktemp -d` (outside any git repo); it now stages it under the resolved main checkout instead, so
  it stays compliant. See design.md's Risks section for the full account.
- `lib/ui/ticket-text.js` — the one real consumer that independently reconstructed a
  `persist-evidence.sh` destination path rather than relaying a `ref=` value. `persistedPath()` now
  searches the run's `evidence/` directory for `ticket.md` instead of assuming the old flat path.
  See design.md's Risks section for why a search was chosen over reconstructing the new nested
  path shape.
- `test/ticket-text.test.js` — new regression test that invokes the real
  `core/scripts/persist-evidence.sh` on a real `ticket.md`-shaped nested source and confirms
  `resolve()` finds it.
- No other caller (`orchestrator.md`'s per-planning-artifact evidence emission, or the
  evaluator/skeptic's `verdict.ref`) or consumer changes — they already just relay whatever `READY
  ref=` prints, or (per a check of the diff for this exact pattern) don't independently
  reconstruct a destination path at all.
