# CON-23: persist-evidence.sh collapses same-named artifacts into one destination, silently overwriting evidence

## Description

`persist-evidence.sh` names its destination from the source file's basename alone, into a flat per-ticket directory:

```sh
DEST_DIR="${ROOT}/.concertino/runs/${TICKET_ID}/evidence"
BASENAME="$(basename "$SOURCE_PATH")"
DEST_PATH="${DEST_DIR}/${BASENAME}"
```

Two artifacts from the same run whose paths differ only above the filename resolve to the same `DEST_PATH`, and the `cp -f` makes the second silently clobber the first. The script exits 0 and prints `READY ref=…` both times, so every caller emits an `evidence` event with a ref that looks good — while one of the two refs now points at the other artifact's content.

## How it was found

Hit live while delivering CON-14 (Procedure scripts build filesystem paths from an unsanitised ticket ID) — not theorised. That change carried two spec deltas, `specs/ticket-id-path-safety/spec.md` and `specs/evidence-telemetry/spec.md`. Both persisted as `evidence/spec.md`; the second overwrote the first. The orchestrator persists one artifact per planning document, so any change touching two spec deltas reproduces it, and the multi-delta shape is normal rather than exotic.

## Why it is worth closing

The script exists specifically so a ref survives `cleanup.sh --phase4` destroying the worktree — its whole purpose is that a human reading the event log later can still open the artifact. A dangling ref is at least legible as broken. This failure is worse: the ref resolves, the file opens, and the content belongs to a different artifact. Nothing in the event log distinguishes the two, and by the time anyone looks the worktree is gone, so the original is unrecoverable.

It also defeats the FAIL contract deliberately built into this script. The comment at the top argues that "an unresolvable ref is worse than no evidence event, so a caller must only emit one once this script has confirmed the copy exists" — but confirming the copy exists is not the same as confirming it is *this* source's copy, and the collision path never reports failure at all.

## Acceptance Criteria

* Two source paths that differ anywhere in the path persist to distinct destinations — no silent overwrite. Preserving enough of the source's relative path under `evidence/` is the obvious fix and keeps refs human-readable; a hashed or counter suffix would also work but reads worse in an event log.
* Re-persisting the *same* source path stays idempotent — it must keep overwriting its own previous copy, per the existing "Idempotent/re-runnable" contract, so a re-run does not accumulate copies.
* A collision that cannot be resolved safely reports `FAIL` and exits non-zero rather than overwriting, consistent with the script's existing contract.
* Tests cover the two-deltas-named-`spec.md` case end to end: both refs resolve, and each resolves to its own content.

## Notes

Pre-existing; not introduced by CON-14, which only added ticket-id validation ahead of this code. Flagged in that PR's Risks/follow-ups section and deliberately left unfixed there as out of scope.

Worth checking whether the same flat-namespace assumption exists anywhere else that derives a filename from a basename — the sweep in CON-14 looked at ticket-id-to-path call sites, not at destination naming.
