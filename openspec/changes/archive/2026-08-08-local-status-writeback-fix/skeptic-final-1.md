## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- Read `ticket.md` (CON-90) in full; identified the two acceptance criteria:
  (1) no spurious dirty-tree escalation on a local-provider run, (2) the
  state transition durable somewhere a collaborator can see, or the docs
  say plainly it isn't and why.
- Read `design.md`, `tasks.md`, `spec.md`
  (`specs/local-ticket-state-durability/spec.md`), `files-modified.md`,
  `evaluation-1.md`, `skeptic-design-1.md`, `skeptic-design-2.md` — treated
  all as claims, not fact.
- `git diff main...HEAD --stat` — confirms the diff touches exactly
  `core/scripts/set-ticket-state.sh`, `test/scripts/set-ticket-state.test.sh`,
  `docs/config-reference.md`, plus openspec change-dir artifacts. No
  drive-by edits: `git diff main...HEAD -- core/scripts/cleanup.sh
  scripts/concertino/cleanup.sh` is empty, confirming the design's "zero
  change to cleanup.sh" goal actually held.
- Read the full shipped `core/scripts/set-ticket-state.sh` (172 lines).
  **Decision 2's specific defect (round-1 design-skeptic's finding) is
  correctly fixed**: both `git -C "$DIR" add -- "$ID.md"` and `git -C "$DIR"
  commit ... -- "$ID.md"` use the file's basename, never the pre-existing
  `$FILE` variable (`"$DIR/$ID.md"`) that would double-prefix under `-C`.
- **Independently reproduced** (not reusing the test file or either design
  skeptic's transcripts) in a fresh scratch repo
  (`/tmp/.../scratchpad/repo-verify`): seeded a git repo with
  `tickets/CON-12.md`, ran `bash core/scripts/set-ticket-state.sh tickets
  CON-12 started` with cwd = repo root (the exact relative-`$DIR` shape
  `lib/cli/render.js:143`'s real orchestrator call uses) — result: exit 0,
  `OK CON-12 started` on stdout, a stderr note that the push didn't land (no
  remote configured, expected), one new commit `tickets: CON-12 -> started`
  touching only `tickets/CON-12.md`, and a clean working tree. This is the
  exact failure mode the design-gate skeptic caught in round 1; confirmed
  fixed against ground truth, not just against the test suite's own
  assertion of itself.
- Confirmed `lib/cli/render.js:143` (the only call site referencing
  `set-ticket-state.sh` in `lib/`) is inside the `local:` provider block —
  `linear`/`github` never invoke this script, so the design's "zero
  behavior change for other providers" claim holds structurally, not just
  by assertion.
- Ran `bash test/scripts/set-ticket-state.test.sh` directly: 54 passed, 0
  failed, including the required relative-`<tickets-dir>` regression case
  (3.7) that specifically targets the round-1 defect, and confirmed by
  reading the test source (`test/scripts/set-ticket-state.test.sh:319-345`)
  that it genuinely runs `(cd "$REPO" && "$SCRIPT" tickets CON-12 started)`
  — the real production call shape — not another absolute-path case in
  disguise.
- Ran the full `npm test` suite myself, fresh, to completion:
  `# pass 1666`, `# fail 0` (node --test), `0` occurrences of `not ok` across
  the whole bash-test chain, ending `npm test exit=0`. Matches the
  evaluator's claimed numbers, independently reproduced rather than trusted.
- Read `docs/config-reference.md`'s diff in full: the rewritten section
  accurately describes the commit + best-effort-push behavior and honestly
  documents the residual push-protected-branch case (still trips
  `cleanup.sh`'s existing, unmodified `diverged` escalation) rather than
  overclaiming a universal fix — matches design.md's Non-Goals and Risks
  sections verbatim in substance.
- Cross-checked `tasks.md`'s `[x]` items against the diff — all task-group 1
  (commit), 2 (push), 3 (tests, including the required 3.7 regression), 4
  (docs) items are genuinely reflected in the shipped code, not just
  checked off.
- GATE=final's UI/design-judgment step is N/A per the task framing (no
  design standard configured, no UI change in this diff — confirmed by the
  diff stat: no `lib/ui/` or frontend files touched). No dev-server
  verification needed.

### Acceptance criteria traced

1. **"A local-provider delivery run completes without a spurious dirty-tree
   escalation."** — Traced to `core/scripts/set-ticket-state.sh:147-169`:
   after the rewrite, the script commits the single rewritten file (removing
   the precondition that made the main checkout dirty) and best-effort
   pushes it, so in the common case (unprotected remote) local `<base>`
   stays in lockstep with its remote and `cleanup.sh`'s existing dirty/
   fast-forward check finds nothing to escalate on. Verified this is not
   just a design claim: independently reproduced a clean working tree after
   the commit in my own scratch-repo run above.
2. **"The state transition is durable somewhere a collaborator can see, or
   the docs state plainly that it is not and why."** — Traced to the same
   commit step (durable in local git history unconditionally, whenever
   `tickets/` is a real git working tree) plus the best-effort push
   (durable on the remote in the common case). The residual case (protected
   remote → commit stays local-only) is explicitly and accurately documented
   in `docs/config-reference.md`'s rewritten section, matching the ticket's
   own "or the docs state plainly that it is not and why" fallback clause.

Both ACs are met by real, traced, independently-verified code and docs —
not merely asserted by the evaluator.

### Verdict: CONFIRM

### Non-blocking notes

- The two prior design-gate skeptic rounds did their job: round 1 caught
  the exact `$FILE`-vs-basename pathspec defect that would have silently
  reintroduced this same bug's failure mode; round 2 confirmed the fix and
  the required regression test. I re-verified both independently at this
  gate rather than trusting either report, and they hold up.
- `docs/config-reference.md`'s residual-risk framing (protected branch →
  still escalates, but meaningfully rather than as guaranteed busywork) is
  the right level of honesty for a fix that explicitly does not claim to
  close every escalation path — good practice, not a gap.
- Task 5.3's note that `scripts/concertino/set-ticket-state.sh` (the synced
  copy) doesn't exist in this checkout is accurate and correctly scoped as
  out-of-scope pre-existing gap, not something this change needed to fix.
