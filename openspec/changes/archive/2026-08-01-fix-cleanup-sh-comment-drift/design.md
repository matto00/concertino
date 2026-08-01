## Context

`core/scripts/*.sh` are canonical templates; `concertino sync` copies them
verbatim to `scripts/concertino/*.sh` (no templating variables inside these
`.sh` files themselves — only `.concertino.env` is templated via
`renderEnv()`). CON-32 fixed a stale comment directly in the rendered copy,
`scripts/concertino/cleanup.sh`, but not in `core/scripts/cleanup.sh`. Since
sync is a straight copy, the next sync (which `cleanup.sh --phase4` already
runs against `main` after every delivery, per CON-25's main-fast-forward
behavior) silently reverted the fix. At current HEAD, both files already
carry the identical stale comment — confirmed by diffing `core/scripts/*.sh`
against `scripts/concertino/*.sh`: no other file pair currently differs, so
this is not (yet) a wider active-drift problem, just this one already-reverted
fix.

## Goals / Non-Goals

**Goals:**
- Make the CON-32 comment correction durable: fix the canonical template so
  future syncs stop reverting it.
- Verify the fix survives an actual `concertino sync` run against this repo's
  own checkout.
- Do a one-time audit of `core/scripts/*.sh` vs `scripts/concertino/*.sh` for
  the same class of drift (already done during design research — no other
  pair currently differs — but re-verify once more right before archiving,
  since this is a fast-moving repo).

**Non-Goals:**
- No behavioral change to `cleanup.sh` — `BASE_REMOTE`/`BASE_BRANCH`
  resolution logic is already correct; only the comment is wrong.
- No change to the sync mechanism itself (e.g. adding a check that fails sync
  when template and rendered copy differ pre-existingly) — out of scope for
  this ticket; worth a separate follow-up if the audit turns up a pattern,
  but a single one-off fix doesn't justify new tooling.

## Decisions

**Decision 1: Fix `core/scripts/cleanup.sh` directly, then re-sync rather than
hand-editing the rendered copy again.** Editing only the rendered copy a
second time would reproduce exactly the bug this ticket exists to fix. The
template is the source of truth; the rendered copy must be a byproduct of
syncing it, not a parallel hand-maintained file.

**Decision 2: Use the exact corrected comment text CON-32 already proved
correct**, rather than rewording again — CON-32's own commit
(`d2f4859`, "CON-32 Make doctor's base-branch check read a configurable base
remote") already replaced the stale two-line comment with an accurate one in
the rendered copy. Reusing that exact text avoids re-litigating wording and
keeps the fix minimal and obviously correct:

```
# `concertino sync`'s renderEnv writes both CONCERTINO_BASE_BRANCH and
# CONCERTINO_BASE_REMOTE (see bin/concertino), the latter from
# project.baseRemote (defaulting to origin). Default both with
# ${VAR:-default} anyway, matching setup-worktree.sh's own fallback, so this
# is correct even against a stale .concertino.env rendered before this field
# existed, or one that predates a `concertino sync` re-run.
```

**Decision 3: Verify via a real `concertino sync` run, not just a visual
diff.** Acceptance criterion 2 ("re-running `concertino sync` ... no longer
reverts the comment") is only actually proven by running `concertino sync`
against this checkout and confirming `git diff` shows no change to
`scripts/concertino/cleanup.sh` after the template fix — matching visual
inspection of two files isn't equivalent to exercising the actual sync path
(`bin/concertino`'s render step) that caused the regression in the first
place.

## Risks / Trade-offs

- [Running `concertino sync` in the worktree could re-render *other* files
  unexpectedly if config differs from `main`] → Mitigation: run it, then
  `git diff --stat` to confirm only the intended comment lines changed
  (ideally nothing else, since the worktree's config should match `main`);
  if anything else changes, treat that as a decision point (revert unrelated
  changes for a properly-scoped diff), not something to include unreviewed
  in this ticket's commit.
