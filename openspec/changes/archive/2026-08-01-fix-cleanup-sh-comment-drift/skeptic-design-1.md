## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Current stale state matches the ticket's narrative.** Read
   `core/scripts/cleanup.sh` and `scripts/concertino/cleanup.sh` at HEAD
   (lines 40-60 of each): both currently carry the *identical* stale
   two-line comment ("... only ever writes CONCERTINO_BASE_BRANCH today ...
   CONCERTINO_BASE_REMOTE is not currently rendered"). This confirms design.md's
   claim that the CON-32 fix was already reverted and both files are
   currently in sync on the *wrong* text — not a live drift between the two
   files right now, just a shared staleness. Matches the ticket/proposal/design
   description exactly.

2. **CON-32's actual merged content matches the proposed replacement text
   verbatim.** `git show d2f4859 -- scripts/concertino/cleanup.sh` shows the
   CON-32 diff replacing the stale comment with:
   ```
   # `concertino sync`'s renderEnv writes both CONCERTINO_BASE_BRANCH and
   # CONCERTINO_BASE_REMOTE (see bin/concertino), the latter from
   # project.baseRemote (defaulting to origin). Default both with
   # ${VAR:-default} anyway, matching setup-worktree.sh's own fallback, so this
   # is correct even against a stale .concertino.env rendered before this field
   # existed, or one that predates a `concertino sync` re-run.
   ```
   This is character-for-character identical to the text quoted in design.md
   Decision 2. `git show d2f4859 --stat` also confirms that commit touched
   only `scripts/concertino/cleanup.sh`, not `core/scripts/cleanup.sh` —
   the exact asymmetry the ticket describes as root cause.

3. **Line numbers cited in tasks.md are accurate.** `core/scripts/cleanup.sh`
   lines 51-52 are indeed the two stale comment lines (verified via `grep -n`).

4. **`concertino sync` is a real, invokable command that does a verbatim
   copy for `.sh` files**, not a template render. `bin/concertino` line 110
   uses `fs.copyFileSync(src, dest)` for this asset class, confirming
   design.md's premise (no templating variables inside `.sh` files) and that
   task 2.1-2.3's plan (re-run sync, diff, re-run sync again, expect no-op)
   is mechanically sound and will actually exercise the regression path.

5. **The "no other file pair currently differs" audit claim is independently
   reproducible.** I ran my own diff across all 10 `core/scripts/*.sh` /
   `scripts/concertino/*.sh` pairs (assert-phase, check-merge-readiness,
   cleanup, emit-event, gather-escalation-context, persist-evidence,
   resolve-speed, setup-worktree, start-servers, triage-followup) — zero
   differences found, matching design.md's Context section and confirming
   task 3.1's audit will presently be a clean re-verification (not
   presupposing there's nothing to fix, correctly worded as "fix any other
   pair found").

6. **The CON-38 precedent for skipping specs is real and matches, not just
   asserted.** Read the archived change at
   `openspec/changes/archive/2026-07-30-codex-worker-dispatch-caution/`:
   proposal.md states "New Capabilities: (none)" / "Modified Capabilities:
   (none — this is a comment added to a template file, not a behavioral or
   rendering change)" — the same pattern used in this ticket's proposal.md.
   The directory has no `specs/` subdirectory, and its `workflow-state.md`
   explicitly documents "archiving will use --skip-specs, the tool's
   documented path for infra/doc-only changes." This is a real, applicable
   precedent, not a hallucinated one.

7. **The precedent commit cited in AC3** ("chore: re-render
   scripts/concertino/emit-event.sh from updated core") exists in git log
   (commit 085c960), confirming this project does in fact maintain a
   core/scripts → scripts/concertino render relationship with prior
   re-render commits as precedent for this ticket's approach.

### Checks for the usual failure modes

- **Placeholders/hand-waving:** none found. The exact replacement comment
  text is fully specified (Decision 2), not deferred.
- **Internal contradictions:** proposal, design, and tasks agree on scope,
  approach, and verification method throughout.
- **Ambiguity:** task 1.1 gives literal text to paste; tasks 2.1-2.3 give a
  concrete, mechanically verifiable sequence (sync → diff → sync again →
  expect no-op); task 3.1 gives a concrete audit procedure. No task is open
  to two reasonable readings.
- **Scope drift:** none — impact section lists exactly the two files plus a
  bounded audit; design.md's Non-Goals explicitly excludes adding sync
  tooling/checks, correctly deferring that to a future ticket if warranted.
- **Missing contract updates:** N/A — this is comment-only prose with no
  behavioral, schema, or API change; the no-spec-delta decision is
  well-founded and precedented (see #6 above).
- **AC coverage:** AC1 → task 1.1. AC2 → tasks 2.1-2.3 (with Decision 3
  explicitly requiring a *real* sync run, not just visual diff — good
  skepticism baked into the plan itself). AC3 → task 3.1. All three ACs are
  covered by a task.

### Verdict: CONFIRM

### Non-blocking notes

- Design.md's Decision 3 already anticipates and preempts the most likely
  reviewer objection (proving via sync output, not eyeballing) — good, no
  further note needed here.
- Task list doesn't explicitly say "commit the audit's outcome" if task 3.1
  finds nothing to fix, but this is a standard executor-workflow concern
  (commit whatever changed), not a design gap.
