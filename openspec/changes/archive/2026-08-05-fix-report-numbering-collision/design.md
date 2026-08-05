## Context

`core/roles/evaluator.md` writes its report to `WORKTREE_PATH/<change-dir>/evaluation-<CYCLE>.md`,
where `CYCLE` is a run-local counter the orchestrator hands it (1, 2, 3, ... within this sub-run,
bounded by `EXECUTION_CYCLES`). `core/roles/skeptic.md` does the same for
`skeptic-<GATE>-<N>.md`, where `N` is the orchestrator's round counter within this sub-run's
design/final gate. Both counters always start fresh at 1 for a new sub-run.

A `fold-in` follow-up (see `followup-triage` spec) reopens an already-archived, already-delivered
change in a **freshly re-created worktree** (`core/roles/orchestrator.md`'s "Triaging a suggested
follow-up" sub-procedure, fold-in branch, step 5). That worktree's change directory is restored
from the archived state, which already contains the first sub-run's `evaluation-*.md` /
`skeptic-*-*.md` files. The new sub-run's counters know nothing about them and start at 1 again —
so its first evaluator report lands at `evaluation-1.md`, directly on top of the first sub-run's.
Observed for real on CON-71 (PR #64's fold-in overwrote PR #63's `evaluation-1.md` /
`skeptic-final-1.md`; caught and hand-fixed before commit, but nothing prevents it happening
silently and merging).

## Goals / Non-Goals

**Goals:**
- A sub-run's evaluator/skeptic report never overwrites a filename an earlier sub-run already
  used in the same change directory, for any number of prior sub-runs (not just one fold-in).
- The fix works from disk state alone — it does not depend on the orchestrator tracking
  cross-sub-run history in `workflow-state.md` (which is itself recreated per sub-run and has no
  natural place to remember "the last sub-run's highest report number").
- If a collision is somehow still about to happen (a bug in the numbering scan, a hand-created
  file with a colliding name), the write fails loudly rather than silently succeeding over
  existing content — both at the report-write layer and, as a backstop, at the
  `persist-evidence.sh` copy layer.
- Single-sub-run runs are byte-for-byte unaffected: with no pre-existing report files, the
  computed number is always 1, 2, 3, ... exactly as today.
- `core/roles/*.md` stay the sole source of truth; `.claude/agents/concertino-*.md` (gitignored,
  rendered at `concertino sync` time) are not hand-edited.

**Non-Goals:**
- Not changing what a sub-run's `CYCLE`/`N` *means* for budget/round-counting purposes
  (`EXECUTION_CYCLES`, `SKEPTIC_FINAL_ROUNDS`, `SKEPTIC_DESIGN_ROUNDS`, the evaluator's
  Final-cycle-behavior check) — those stay exactly as the orchestrator tracks them today. This
  change only touches which literal filename a report is written to.
- Not changing the orchestrator's own logic. It already treats the evaluator's/skeptic's returned
  `Report: <path>` as the literal path to use (for `EVALUATION_REPORT_PATH` on resume, etc.) —
  never reconstructing the filename itself from `CYCLE`/`N` — so a filename that no longer equals
  `<kind>-<CYCLE>.md` requires no orchestrator change.
- Not changing whether/when the orchestrator re-persists planning artifacts (`ticket.md`,
  `proposal.md`, etc.) during a fold-in's plan revision — out of scope for this ticket, which is
  about report-numbering collisions specifically.
- Not adding cross-process locking. This workflow is single-agent-sequential per change directory
  (no two evaluator/skeptic invocations for the same change run concurrently), so a scan-then-write
  approach with a same-script existence re-check is sufficient; a stronger atomic-reservation
  scheme would add real complexity for a race that cannot occur in this workflow's execution model.

## Decisions

### 1. Filename numbering is disk-derived, not run-local-counter-derived

`core/scripts/next-report-number.sh <change-dir> <kind>` (`kind` ∈ `evaluation` |
`skeptic-design` | `skeptic-final`) scans `<change-dir>` for files matching `^<kind>-([0-9]+)\.md$`,
computes `next = (highest matched number found, or 0) + 1`, and:
- if `<change-dir>/<kind>-<next>.md` does not exist (the expected case, guaranteed by
  construction): prints `READY number=<next> path=<change-dir>/<kind>-<next>.md` and exits 0.
- if it unexpectedly *does* exist (scan/regex bug, a hand-created file, a non-numeric or
  zero-padded name the scan miscounted): prints `FAIL <reason>` to stderr and exits non-zero,
  rather than silently returning a number that would collide.

This is called by the evaluator/skeptic immediately before they write their report, and the
returned path is what they write to (via the agent's own Write tool — the script only computes
the path, it does not write the report itself; report content is authored by the calling agent,
same as today).

Why disk-derived rather than the orchestrator remembering a cross-sub-run counter: `CYCLE`/`N` are
already meaningful, bounded, run-local values the orchestrator tracks for budget purposes
(`EXECUTION_CYCLES` etc.) — repurposing them to also be globally-unique-across-sub-runs would
require the orchestrator to somehow learn, at the start of every sub-run including the very first
one, what the previous sub-run's last number was, and to persist that forward through
`cleanup.sh --phase4` destroying the worktree between sub-runs. Deriving the number by scanning
the (already-restored, already-authoritative) change directory needs no new state anywhere and is
correct for the 1st, 2nd, or 10th sub-run identically.

Why not keep the report's own "Cycle N" / "round N" body label in lock-step with the filename
number: they answer different questions. "Cycle 1" in the report body means "the first cycle *of
this sub-run*" (what the orchestrator's Final-cycle-behavior check and human readers care about
when reasoning about this sub-run's own progress). The filename number means "the Nth report ever
written for this change, across every sub-run" (what makes the filename collision-safe). Forcing
them to match would mean either renumbering *this* sub-run's `CYCLE` to start from a disk-scanned
offset (reintroducing exactly the kind of cross-sub-run state-threading this design avoids) or
losing the meaningful "this is my sub-run's 2nd cycle" signal from the report body. Keeping them
independent, and stating both in the report where they differ, is clearer than conflating them.

### 2. `evaluator.md` / `skeptic.md` changes are additive, not a rewrite of the write step

Both roles' existing "Write to `WORKTREE_PATH/<change-dir>/evaluation-<CYCLE>.md`" / "Write to
`WORKTREE_PATH/<change-dir>/skeptic-<GATE>-<N>.md`" instruction becomes: call
`next-report-number.sh` first, then write to the path it returns. The report body template is
unchanged except the header gains the disk-derived number alongside the existing cycle/round
label, e.g. `## Evaluation Report — Cycle 1 (evaluation-4.md)` — so a reader opening the file sees
both numbers and what each means, without needing this design doc to hand.

If `next-report-number.sh` itself fails (`FAIL`): this is the same class of environmental failure
`persist-evidence.sh` fail already gets treated as elsewhere in these roles — tag `BLOCKER`,
include the script's stderr, and do not guess a fallback filename (a guessed fallback is exactly
the silent-collision risk this change exists to close).

### 3. `persist-evidence.sh --no-clobber` is opt-in, and content-aware

Adding an unconditional "refuse if destination exists" to `persist-evidence.sh` would break its
existing, deliberate, and still-needed idempotent-overwrite behavior for planning artifacts
(`ticket.md`/`proposal.md`/`design.md`/`tasks.md`/spec deltas), which legitimately get revised and
re-persisted to the *same* destination path within a sub-run (e.g. across a fold-in's plan
revision). So the guard is:
- **Opt-in** via a new `--no-clobber` flag, positioned after the two required positional args.
  Every existing caller (no flag) keeps today's unconditional-overwrite behavior exactly as
  documented in the script's own "Idempotent/re-runnable" comment.
- **Content-aware even when the flag is passed**: if the destination already exists, compare its
  content to the source. Identical → proceed as a no-op success (this is what a genuine retried
  call for the *same* report looks like — nothing is actually lost). Different → `FAIL <reason>`,
  print no `READY` line, leave the existing destination file untouched.

The evaluator's and skeptic's `verdict.ref` persist call (the one line in each role that runs
`persist-evidence.sh "$TICKET_ID" "WORKTREE_PATH/<change-dir>/<report>"`) gains ` --no-clobber` —
reports are write-once by contract (Decision 1 already makes their source filenames collision-safe
by construction; this is strictly a backstop for if that ever fails). The orchestrator's
planning-artifact persist calls (Phase 1 step 6) are unchanged — still no flag.

Alternatives considered:
- **Unconditional refuse-if-exists (no content comparison):** simpler, but would turn a harmless
  retried call (e.g. the agent's `persist-evidence.sh` invocation is re-run after a transient
  shell error, same source, same content, same destination) into a spurious `FAIL`, which is worse
  than today's behavior for a case that isn't actually a collision.
  Rejected in favor of the content-aware version.
- **Making `--no-clobber` the default for all callers:** rejected — it would break the planning
  -artifact revise-and-re-persist flow described above, which this ticket does not touch.

## Risks / Trade-offs

- **[Risk]** `next-report-number.sh`'s regex-based scan could, in principle, be fooled by a
  filename that matches `<kind>-<digits>.md` but wasn't produced by this workflow (e.g. a human
  drops in `evaluation-999.md` by hand). → **Mitigation:** this only ever makes numbering *skip
  ahead*, never collide — the next real report still lands on a number strictly higher than
  anything present, which is the actual safety property this change needs. Not a regression from
  today (today has no protection at all).
- **[Risk]** Two numbers now appear on report headers (sub-run-local cycle/round, and the
  disk-derived filename number), which is one more thing for a human skimming a report to parse.
  → **Mitigation:** stated explicitly in the header format (Decision 2); the filename number is
  also just the filename itself, so it's redundant with what's already visible in the path.
- **[Risk]** `persist-evidence.sh --no-clobber`'s content comparison reads both files fully. →
  **Mitigation:** these are small markdown report files (single-digit KB); no measurable cost.

## Migration Plan

No data migration. Purely additive to two scripts and two role docs; no schema, event contract, or
existing-file-format change. Rollout is just merging the change — no flag, no phased release.

## Open Questions

None outstanding — scope is bounded to the report-numbering write path and its evidence-persist
backstop, per the ticket's stated acceptance criteria.
