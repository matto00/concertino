## Why

`cleanup.sh`'s Phase-4 fast-forward step, when a human answers `retry` to a
fast-forward escalation and the retry still doesn't leave local `main`
current, always prints "note: local main remains behind origin/main after
retry". That wording is accurate when the retry's fetch succeeded and the
comparison genuinely found local behind (still dirty, still diverged, or an
unexpected merge/update-ref failure). It is misleading when the retry's own
`git fetch` itself failed (offline, remote unreachable, auth expired) —
in that case the script never learned the relationship between local and
remote at all, yet reports a confident "remains behind" as if it had. A
reader trusting that message goes looking at their working tree for a
divergence that was never actually observed, instead of at their network
connection.

## What Changes

- After a retried fast-forward attempt that doesn't land on `updated` or
  `current`, `cleanup.sh` distinguishes two cases before choosing its stderr
  wording:
  - The retry's fetch itself did not succeed (`FF_STATUS=fetch-failed`, or
    `no-local-base` — the retry never got far enough to compare local vs.
    remote) → report that the base state could not be determined, and why
    (the fetch/lookup did not succeed), instead of claiming "remains behind".
  - The retry's fetch succeeded and the comparison completed, finding the
    tree still dirty, the base still diverged, or a `failed` outcome from an
    actual merge/update-ref attempt → keep today's "remains behind ...
    resolve manually" wording unchanged.
- No change to exit status, to which outcomes trigger the retry/skip
  escalation, or to the skip-and-continue behavior — cleanup always finishes
  and always prints its `READY cleaned worktree=...` line.
- New `test/scripts/cleanup.test.sh` case(s) covering the fetch-failed retry
  wording, alongside the existing still-diverged/dirty retry coverage.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `main-fast-forward`: the "second consecutive failure does not escalate a
  third time" requirement's logged note now distinguishes a retry whose own
  fetch/lookup did not succeed (report that the base state could not be
  determined, and why) from a retry that completed its comparison and found
  the tree still dirty, the base still diverged, or a real merge/update-ref
  failure (report remains behind, as today) — no change to exit/skip
  behavior.

## Impact

- `core/scripts/cleanup.sh` (canonical source) and its synced copy
  `scripts/concertino/cleanup.sh`.
- `test/scripts/cleanup.test.sh`.
- No API, schema, or exit-status changes; stderr wording only, and only in
  the retry-exhaustion sub-case where the retry's own fetch failed.
