## Context

`core/roles/orchestrator.md` Phase 3 Delivery step 1 (line ~775) today reads
only: "**Squash all branch commits** into one with subject `<prefix>
<description>` and trailer `<commitTrailer>`" — it specifies no mechanism at
all. There is no `core/agents/` directory (that was a naming error in the
first draft of this design; the real path is `core/roles/orchestrator.md`,
which renders to `.claude/agents/concertino-orchestrator.md`). Because the
prose names no git command, the executing orchestrator improvised
`git reset --soft origin/main` — which reads `origin/main` at squash time,
not at branch time. When a sibling run's merge lands on the base in between,
that improvised reset silently stages a revert of the sibling's work. CI
passes on the resulting tree because it's self-consistent. Nothing in
today's flow inspects the staged set before committing.

*(Design-gate round 1 REFUTE, corroborated by evidence in
`skeptic-design-1.md`: no `core/agents/` directory exists, and
`core/roles/orchestrator.md:775` contains no git command — grepped
project-wide for `reset --soft`, zero hits outside test fixtures. This
section is corrected accordingly.)*

Canonical procedure scripts (`setup-worktree.sh`, `cleanup.sh`,
`assert-phase.sh`) already live in `core/scripts/`, rendered per-project via
`concertino sync`. This is the same category of fix: pull a git procedure out
of orchestrator prose into a real, testable script.

## Goals / Non-Goals

**Goals:**
- Reset always targets the true merge-base, never the base ref's live tip.
- Staged files after reset are compared against the union of a caller-supplied
  change-dir allowlist and the parsed `files-modified.md` declaration; any
  file outside that union stops the script (non-zero exit) before any commit.
- The staged file count + full list is always printed, unconditionally,
  before committing — not only when the guard trips.
- Provable in a throwaway repo: red (revert reproduced) with the guard
  removed, green (no revert, or a loud stop) with it present.

**Non-Goals:**
- CON-128 (stale-global root cause) — no version-stamping.
- CON-131 (cleanup.sh silent no-op on git failure).
- CON-132, CON-121.
- HEL-764 (cleanup.sh fast-forward false-positives) — same family, separate
  ticket; do not touch `cleanup.sh`'s fast-forward logic.
- Rewriting `files-modified.md`'s own maintenance — this change only reads
  it; the executor already maintains it per cycle.

## Decisions

**D1 — Reset target: `git merge-base HEAD <base-ref>`, not `<base-ref>`
directly.** This is the direct fix for the root cause: the merge-base is the
last commit the branch and the base share, so resetting there and re-applying
the branch's own diff can never touch commits the base gained afterward.
Alternative considered: rebase onto the new base tip before squashing — this
would work but changes the branch's parentage/history shape mid-run and adds
conflict-resolution surface the executor already isn't scoped for; merge-base
reset achieves the same safety with a strictly smaller, mechanical diff.

**D2 — Guard staged files against `files-modified.md` UNION a fixed
workflow-artifact allowlist, hard-stop on overrun.**

*Corrected after design-gate round 1 REFUTE.* The original D2 assumed
`files-modified.md` alone was a complete, fresh declaration of the staged
set. Evidence in `skeptic-design-1.md` disproves that: `core/roles/
executor.md:72-82` writes `files-modified.md` at step 4, then step 7 commits
**everything** in the worktree — including the whole change directory
(`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/**`,
`.openspec.yaml`, `workflow-state.md`, prior `evaluation-*.md`,
`skeptic-*.md`) which is never itself named in `files-modified.md`. Real
history (`151bad1b`, `8359d181`, `e56cccf2`, `a194152c`) also shows the file
has no enforced schema: from a clean bullet list to free-form prose whose
backticks are mostly shell commands/regexes, not paths, and one case
(`a194152c`) that summarizes 190 relocated files as a bare count rather than
enumerating them. A guard comparing only against `files-modified.md` would
therefore trip on essentially every ordinary run — an always-tripping guard
is one operators learn to route around, which is worse than no guard.

The corrected guard's allowed set is the union of two things:

1. **The workflow-artifact allowlist, derived from a caller-supplied change-dir
   argument — never hardcoded in the script.** *Corrected after design-gate
   round 2*: `core/scripts/**` is copied verbatim by `lib/cli/emit.js:426-428`
   (no `renderBody`/variable substitution — unlike role prose, which
   `lib/cli/render.js:202` substitutes `<change-dir>` into from
   `c.specProvider.changeDir`), and `specProvider.changeDir` is itself
   configurable (`config/concertino.schema.json:42` defaults to
   `openspec/changes/<CHANGE_NAME>`, but `lib/cli/init.js:135` emits
   `spec/changes/<CHANGE_NAME>` for `specProvider.kind: 'none'`). A literal
   `openspec/changes/<CHANGE_NAME>/**` glob baked into the script would
   false-positive on every ordinary run in a non-openspec-configured project
   — the exact always-tripping-guard failure mode this design exists to
   remove, reintroduced one layer down. The script therefore takes the change
   directory as an explicit `<CHANGE_DIR>` argument (mirroring
   `next-report-number.sh`'s caller-passes-the-path convention), and the
   orchestrator-prose call site (D4/tasks 2.1) supplies it via the
   `<change-dir>` token that `lib/cli/render.js:202` already substitutes.
   The allowlist is then `<CHANGE_DIR>/**` (covers `ticket.md`, `proposal.md`,
   `design.md`, `tasks.md`, `.openspec.yaml`, `specs/**`, `workflow-state.md`,
   every `evaluation-*.md` and `skeptic-*.md`, and `files-modified.md`
   itself) — exactly the set of paths the delivery flow itself is known to
   create as a side effect of Planning/Execution/Evaluation, legitimate every
   run and not something the executor should have to declare, regardless of
   which `specProvider.kind` the project is configured with.
2. **The parsed contents of `files-modified.md`** — the executor's own
   declared source-code touch set, parsed per D2a below.

Any staged path outside that union trips the guard (non-zero exit, no
commit). This keeps the check's power (catching an out-of-band revert of
someone else's *source* files) while removing the false-positive-on-every-run
defect: the allowlist absorbs the workflow's own known-legitimate paths, so
`files-modified.md` only has to account for what the executor actually wrote
in `src`/`backend`/`frontend`/etc.

**D2a — Parsing `files-modified.md`.** Given the file's inconsistent real-world
shape, the script extracts **only** backtick-quoted spans that begin a
markdown list item at the start of a line (regex, applied per line:
`^\s*[-*]\s*` followed by a backtick-quoted path — i.e. `` - `path/to/file` ``
optionally followed by ` — rationale` prose). Backticks appearing elsewhere in
the line (inline in prose, inside a shell command, part of a regex) are not
paths and are ignored. If this extraction yields zero paths while the staged
set (outside the D2 allowlist) is non-empty, the file is treated as
**unparseable-with-content-outstanding**: this is distinct from "missing"
(D2b) and the script fails loudly by default, printing the raw
`files-modified.md` content and every staged path outside the allowlist, and
requires the same explicit `--allow-empty-declaration` opt-in to proceed
(intentionally the same flag as the missing-file case — both are "no usable
declaration to check against").

**D2b — Missing file, and the "declared as a summary" case.** A missing
`files-modified.md` is treated as an empty declared set (as before);
`--allow-empty-declaration` opt-in required, else fail loudly. For a
`files-modified.md` that *is* parseable but declares its coverage as a count
rather than an enumeration (the `a194152c` case — "190 files moved"), this
design deliberately does **not** attempt to special-case count-only prose:
the D2a extraction rule finds zero enumerated paths, so it falls into the
unparseable-with-content-outstanding path above (loud stop, `--allow-
empty-declaration` opt-in) exactly like any other unparseable declaration.
Tightening the executor's own handoff contract to require enumeration is
explicitly out of scope for this change (see Non-Goals) — the guard's job is
to stop and let the operator resolve it (append the real paths, or accept
the risk with the opt-in), not to silently pass a summary it cannot verify.

Alternative considered: diff staged files against
`git diff --name-only <old-base>..HEAD` (the branch's own prior diff)
instead of `files-modified.md` — rejected because it re-derives from the
same git history the bug already demonstrated is unreliable to reason about
at squash time; `files-modified.md` (plus the fixed allowlist) is an
independent, more legible source of truth than another git-log read.

**D3 — Base-advancement detection is a loud diagnostic, not a forced
rebase.** Because D1 already makes a squash-against-merge-base safe
regardless of how far the base has advanced, this change does not require an
explicit rebase step before squashing (contrary to one of the ticket's
suggested directions, evaluated and set aside) — that would add real
conflict-resolution risk with no corresponding safety benefit once D1+D2 are
in place. Instead the script always logs whether the base advanced
(`base-ref tip != merge-base`) and by how many commits, so the operator/
orchestrator can see it happened, without gating the squash on it.

*Confirmed at design-gate round 1 — do not revisit.* AC2 ("base that
advanced mid-run is detected explicitly rather than absorbed") is satisfied
without a forced rebase because D1 changes what "absorbed" means: the reset
target is the merge-base, never the live base tip, so an advanced base is
structurally excluded from the squash by construction, and separately
logged so its existence is visible. A forced rebase would add real
conflict-resolution surface mid-run for zero additional safety once D1
holds.

**D4 — New canonical script `core/scripts/squash-branch.sh`.** Matches this
project's existing pattern (`setup-worktree.sh` etc.): deterministic,
testable, called by the orchestrator instead of recalled from prose. Also
updates `core/roles/orchestrator.md` Phase 3 step 1 (line ~775, the
currently-unspecified "Squash all branch commits..." line) to invoke it
directly rather than leaving the mechanism to be improvised. *(Path
corrected at design-gate round 1 — see Context.)*

**D5 — Test wiring and naming, and the guard's coverage boundary.** The
acceptance test lives at `test/scripts/squash-branch.test.sh`, matching this
repo's convention for script-level tests (`test/scripts/<name>.test.sh`) —
not `core/scripts/*.selftest.sh`, which is reserved for the
rendered-artifact selftest convention exemplified by
`lib/git-child-env.selftest.sh`. It is added as an explicit new conjunct to
`package.json`'s `"test"` script (a hand-maintained chain of `bash
test/scripts/*.test.sh` invocations — nothing auto-discovers test files, so
an unlisted test never runs).

This guard covers only Phase 3 step 1's squash commit. Phase 3 step 2's
archive commit is created *afterward*, as a separate commit, and is not
covered by this guard — correct for reproducing this ticket's actual
incident (the reported revert was staged by the squash's `reset --soft`,
before archiving ever runs), and the coverage boundary is deliberate rather
than accidental.

## Risks / Trade-offs

- [Risk] A legitimate executor edit to a source file it forgot to declare in
  `files-modified.md` trips the guard as a false positive. → Mitigation: the
  guard's job is exactly to surface this loudly for a human/orchestrator
  decision (append the file to the declaration and re-run, or investigate);
  a stop-and-report is the correct, safe behavior for an undeclared file
  either way — silently allowing it would reintroduce exactly the blind spot
  this ticket exists to close. The fixed workflow-artifact allowlist (D2)
  keeps this risk scoped to genuine source-file omissions, not every
  ordinary run's own planning/evaluation paperwork.
- [Risk] `files-modified.md` itself is missing, or present but unparseable
  (free-form prose, a bare count) while staged files outside the D2
  allowlist remain. → Mitigation: both cases require the same explicit
  `--allow-empty-declaration` opt-in and fail loudly by default (D2a/D2b) —
  never silently treated as "nothing to check."
- [Risk] Self-referential test drift (the review's own past failure mode:
  asserting against an inline copy of the pattern rather than the real
  script). → Mitigation: acceptance test invokes the actual
  `core/scripts/squash-branch.sh` file via subprocess, in place, under a
  restoring `trap`, and proves red by mutating that exact repo-path file (not
  an inline copy) to the naive pre-fix behavior.
- [Risk] `git merge-base` is ambiguous under criss-cross history (returns one
  of several valid bases). → Mitigation: use `git merge-base --all` and treat
  more than one result as a loud stop requiring operator attention, rather
  than silently picking one.

## Migration Plan

Additive: new script + new test file, one orchestrator-prose edit, one
`package.json` conjunct. No data migration. Rollback is reverting the script,
the test, the prose edit, and the `package.json` line.

## Open Questions

None outstanding — scope and approach are fully bounded by the ticket's own
acceptance criteria, after design-gate round 1's corrections above.
