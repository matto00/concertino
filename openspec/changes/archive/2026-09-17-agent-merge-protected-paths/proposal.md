## Why

`agentMerge.enabled` is a single global boolean (`lib/config.js:203-206`): a
repository can let the auditor merge everything, or nothing. There is no way to
say "the auditor may merge ordinary work, but changes to *these* paths need a
human."

That gap matters most for the files whose whole purpose is to constrain the
agents. If an agent can merge a change to the constraint without a human seeing
it, the constraint is advisory. The concrete case that prompted this: a PR that
removes the escalation machinery entirely looks unremarkable in diff review, so
green CI plus satisfied acceptance criteria is enough for the auditor to merge
it, and the human never sees the argument for removing it.

The existing workaround — a consuming repo's local `check-protected-paths.sh`
bound to the auditor through `canonicalDocs` — is prose-bound enforcement: the
auditor is *told* to run it. That is the weakest form of gate this project has,
and one it already documents agents routing around.

## What Changes

- **New config field `agentMerge.protectedPaths`** (array of globs, default
  `[]`), schema-validated and additively defaulted alongside `enabled` and
  `mergeMethod`. Unset or empty means today's behavior, byte-for-byte.
- **A new deterministic pre-merge condition.** The run's diff against the review
  base is matched against the configured globs. A match means the auditor does
  not merge; it escalates for human merge, naming the matched paths.
- **Enforcement lives in the script layer, not role prose** — the same place as
  the other pre-merge conditions, so the auditor cannot satisfy it by assertion.
  The glob list is read from the **main checkout**, resolved via
  `git rev-parse --git-common-dir`, never from an auditor-supplied argument and
  never from a worktree-local file.
- **Config-reference documentation** for the new field, including the honest
  statement that this path is unexercised in this repository today.
- Not done here: retiring the consuming repo's local workaround (that repo is
  not in scope), and no change to `check-pr-mergeable.sh`.

### Why the glob list cannot travel as an argument or an env var

Two delivery mechanisms look obvious and are both wrong, which is why this is
called out at proposal level rather than buried in design:

- **As a script argument from role prose.** Role templates are `{{var:}}`
  substituted, so `{{var:agentMerge.protectedPaths}}` would render. But a list
  the auditor passes in is a list the auditor can pass in *empty* — precisely
  the "satisfied by assertion" failure acceptance criterion 4 forbids.
- **From a worktree-local `.concertino.env`.** Verified empirically on this
  run's own worktree: the 30 tracked `scripts/concertino/*.sh` are present, but
  `.concertino.env`, `speeds.json`, `concertino.config.json` and `AGENTS.md` are
  all absent (`.gitignore` lines 5, 10, 18; `worktree.linkModules`/`envFiles`
  are both `[]`). A guard reading its configuration from there resolves to an
  empty list **in the worktree where the auditor actually runs** — it would fail
  open in exactly the place it must hold.

Main-checkout resolution is the established precedent for this exact problem:
`check-merge-readiness.sh:208-222` already does it to read the event log, itself
copied from `emit-event.sh`'s `main_checkout()`.

## Capabilities

### New Capabilities

- `agent-merge-protected-paths`: a configured set of path globs that, when
  touched by the run's diff, forces the auditor to escalate for human merge
  instead of merging. Covers the config field's schema and defaulting, the
  deterministic check's outcome contract, where the glob list is read from, and
  the unchanged-when-unset guarantee.

Following the precedent of `verdict-sha-binding` (CON-166), which added a
fourth outcome to `check-merge-readiness.sh` as its own sibling capability
rather than amending `agent-merge`.

### Modified Capabilities

- `agent-merge`: its requirement "check-merge-readiness.sh deterministically
  evaluates the three machine-verifiable merge conditions" becomes four, and
  "The auditor merges only when all four conditions hold" is re-anchored to
  "every deterministic condition holds and the acceptance-criteria trace
  succeeds" — the old title's "four" counted CI + mergeability + gates + AC
  trace, so adding a fourth *deterministic* condition would have made a bare
  numeral ambiguous rather than merely stale.

  Because both requirement *titles* change, and a `MODIFIED` delta locates its
  target by matching the existing header text, each one needs a `RENAMED`
  entry (`FROM:`/`TO:`) alongside its `MODIFIED` block, whose header then
  carries the new title. Retitling inside `MODIFIED` alone would match no
  existing requirement and fail silently at archive time. Precedent:
  `openspec/changes/archive/2026-08-08-local-provider-standalone-escalation/specs/followup-triage/spec.md`
  does exactly this pairing.

## Impact

- `config/concertino.schema.json` — the `agentMerge` block (currently
  `additionalProperties: false` with two properties, so an unrecognized
  `protectedPaths` is rejected today).
- `lib/config.js` — the `agentMerge` defaults merge, and `collectConfigIssues`
  validation for a malformed value.
- `core/scripts/check-merge-readiness.sh` + its byte-identical rendered twin
  `scripts/concertino/check-merge-readiness.sh` (enforced by
  `test/scripts/rendered-scripts-drift.test.sh`).
- `core/roles/auditor.md` — the outcome's prose and verdict mapping.
- `docs/config-reference.md` — the `agentMerge` section and field table.
- Tests: `test/config.test.js`, `test/scripts/check-merge-readiness.test.sh`
  (whose `SCRIPT=` points at `core/scripts/`), and the render/drift suites.
- No runtime dependency added; no behavior change for any project that does not
  set the field.
