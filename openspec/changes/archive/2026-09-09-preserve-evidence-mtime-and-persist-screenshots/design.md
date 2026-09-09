## Context

See `proposal.md` - Why. `core/scripts/persist-evidence.sh` already exists and is the sanctioned
mechanism for giving a run's report artifacts a durable home outside the worktree
(`evidence-telemetry`). Verified at the base commit (`69e1c59`): the script's copy line is
`cp -f "$SOURCE_PATH" "$DEST_PATH"` (no `-p`), and the only established callers are the
orchestrator (planning artifacts, `premise-validation.md`), the evaluator/skeptic (their own
`verdict.ref` report), and the auditor (`auditor-report.md`) — never raw screenshots or
measurement dumps captured mid-review. This was confirmed against the real HEL-732 run directory:
its 12 rescued PNGs sit flat in `.concertino/runs/HEL-732/evidence/` (not under a git-relative
subpath), consistent with a hand-rolled `cp`/`mv` rather than a `persist-evidence.sh` call,
while the persisted `.md` reports do sit under the structured `openspec/changes/<name>/...`
subpath the script's relative-path-preserving destination naming produces.

## Goals / Non-Goals

**Goals:**
- Fix the mtime-rewrite in the one sanctioned persist path so every future caller inherits the
  fix for free.
- Give the evaluator and skeptic an explicit, in-line convention for persisting screenshot/
  measurement evidence as they capture it, closing the gap that made HEL-732's manual rescue
  necessary.
- Make the fragility of temporal/positional evidence, and the preference for self-authenticating
  evidence, a stated expectation in the roles most likely to produce or rely on it.

**Non-Goals:**
- Not building a new evidence-storage subsystem, database, or manifest format — the existing
  `.concertino/runs/<TICKET>/evidence/` convention and `persist-evidence.sh` mechanism are sound;
  this only fixes the copy flag and extends caller coverage.
- Not retroactively re-stamping HEL-732's already-corrupted PNGs — out of scope; the ticket is
  about preventing recurrence, not repairing historical evidence.
- Not building automatic detection of "this claim depends on mtime ordering" — the disclosure and
  gate-defect requirements are process/documentation obligations on the evaluator/skeptic, not a
  new mechanical check.
- CON-120 (stray ad-hoc screenshot leakage to repo root) is a related but distinct failure mode
  (accidental placement vs. deliberate placement that still doesn't survive) and is out of scope
  here.

## Decisions

**`cp -fp` instead of `cp -f` in `persist-evidence.sh`.** `-p` preserves mode, ownership (where
permitted), and timestamps; the only property this ticket cares about is mtime, but `-p`'s other
preserved attributes (mode) are harmless for evidence artifacts (never executed) and simpler than
hand-rolling a `touch -r` after a plain `cp -f`. Alternative considered: `cp -f` followed by
`touch -r "$SOURCE_PATH" "$DEST_PATH"` — rejected as two syscalls doing what one flag already
does, with no behavioral difference for this script's inputs (regular files, not symlinks/devices
where `-p`'s other semantics could matter). `--no-clobber`'s existing content-comparison branch is
unaffected: when it takes the no-op path (identical content, skip the copy), the destination's
mtime is deliberately left as whatever it already was — that's the correct behavior for an
already-persisted artifact, not something this change needs to touch.

**Extend evaluator/skeptic role docs with a named "persist artifact evidence" step, not a new
script.** `persist-evidence.sh` already accepts an arbitrary `SOURCE_PATH`; nothing about its
interface is report-shaped. The gap is purely that role docs never instructed calling it for
anything but the final report. Alternative considered: a wrapper script specifically for
screenshots — rejected as unnecessary indirection; the existing script's relative-path-preserving
destination naming already handles arbitrary files (including PNGs) with no special-casing
needed.

**Documentation-level fragility/gate-defect language, not a mechanical enforcement mechanism.**
Detecting "does this report's claim depend on mtime ordering" automatically would require parsing
report prose for temporal claims — out of proportion to the problem, and the roles that need this
discipline (evaluator, skeptic) are exactly the roles already trusted to self-report the disclosure
and gate-defect conditions the spec requires. Alternative considered: a lint-style scanner
flagging phrases like "older than"/"before"/"predates" in report `.md` files near a screenshot
citation — rejected as both fragile (easy to phrase around) and out of scope for what this ticket
needs to close.

## Risks / Trade-offs

- [`cp -fp`'s ownership-preservation semantics could fail under a restrictive umask/permission
  setup] → Low risk in practice: the script already runs as the same user reading and writing
  both sides of the copy (developer/CI worktree to the same user's main checkout); `-p`'s
  ownership preservation only matters cross-user, which doesn't apply here. If it ever did fail,
  `cp` already exits non-zero on a permission error, which the script's existing `FAIL` handling
  already covers — no new failure mode is introduced.
- [Role-doc-level "persist screenshot evidence as you capture it" guidance could still be skipped
  by a future evaluator/skeptic run under time pressure] → Mitigated only by the gate-defect
  requirement making the cost of skipping it visible (a recorded defect independent of verdict),
  not by a mechanical block — accepted trade-off, consistent with how the rest of this ticket's
  role-doc-level requirements are enforced elsewhere in this codebase (e.g. `verification-before-
  completion`).

## Migration Plan

No data migration. Ship as one delivery:
1. Fix `core/scripts/persist-evidence.sh`'s copy flag; mirror the fix into
   `scripts/concertino/persist-evidence.sh` via direct `cp` (CON-173 drift gate — never
   `concertino sync`).
2. Add the new/modified `evidence-telemetry` requirements to `openspec/specs/evidence-telemetry/
   spec.md` via this change's delta (handled by `openspec archive`).
3. Extend `core/roles/evaluator.md` and `core/roles/skeptic.md` with the persist-screenshot-
   evidence convention, the fragility note, and the gate-defect condition.
4. Add/extend a test exercising the mtime-preservation scenario against the pre-fix script to
   confirm it is red before the fix and green after (Iron Law: prove every new assertion goes red
   against the pre-fix tree).

Rollback: revert the single commit; `persist-evidence.sh` reverts to `cp -f`, role docs revert to
their prior text. No persisted state depends on the new behavior in a way that would break on
rollback — a destination file copied under `-p` semantics is still a valid, readable file under
`-f`-only expectations.
