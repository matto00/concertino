# CON-128: concertino sync should report its binary/core provenance and offer a diff preview

## Description

> Re-scoped 2026-08-22. Filed as "a stale globally-installed concertino silently
> downgrades rendered agent files on sync." That root cause was investigated and
> refuted — see the correction comment in the Linear ticket. What remains here is
> the part of the ticket that is still valid and still worth building.

### What was refuted

- There is no stale global install. `/usr/lib/node_modules/concertino` is an
  `npm link` symlink to `/home/matt/Development/concertino` — verified by inode
  identity. Same file, not two copies.
- The symlink predates the incident (Jul 31 vs. an Aug 20 incident).
- `core/` has not changed across the incident window.
- A fresh render is not a downgrade — verified by direct render comparison.

The 2165-line deletion observed on 2026-08-20 remains unexplained. It is not
being dismissed, but version-stamping / downgrade-detection is machinery built
against a cause not in evidence, and is explicitly dropped from scope.

### What already shipped (do not redo)

`sync` faithfully regenerates from `core/`, so a fix applied to a rendered file
instead of its template is deleted on the next sync. That mechanism was split
out and delivered as CON-133 (merged `6699214`). Not this ticket's job.

### What remains in scope here

- **Report provenance before writing.** Print which binary and which `core/`
  root the sync is rendering from. `/usr/bin/concertino` vs. a dev checkout vs.
  a linked global should be visible at a glance, before any file is touched.
- **Offer a diff preview.** `sync` is a destructive whole-file regeneration
  with no preview and no confirmation. A `--dry-run`/diff mode should make the
  blast radius inspectable in advance. `--dry-run` already exists in some form
  (`npm run test:selftest` uses `sync --dry-run`) — establish what it currently
  does before building anything new; this may be mostly a matter of surfacing/
  documenting it plus adding a real diff against the target directory.

## Acceptance Criteria

- [ ] `concertino sync` prints the resolved binary path and `core/` root
      before writing any file.
- [ ] The provenance line distinguishes a linked global (symlink to a dev
      checkout) from a genuinely separate global install.
- [ ] A diff-preview mode shows what a sync would change against the target
      directory, without writing.
- [ ] Running the preview against a project whose rendered files carry local
      edits shows those edits as pending losses.

## Related

- CON-133 (merged) — the reproducible "sync clobbers local fixes" hazard this
  investigation surfaced.
- HEL-805, HEL-657 — the originating `GIT_DIR`/`core.bare` incident.

## Explicitly out of scope

- Version stamping, generation counters, downgrade detection.
- Explaining the unexplained 2165-line deletion.
- CON-131, CON-132, CON-121, CON-103, CON-127, CON-126.
