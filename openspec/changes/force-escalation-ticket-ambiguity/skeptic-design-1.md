## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/escalation-context/spec.md`, `specs/ticket-drafting-escalation/spec.md`, and
  `workflow-state.md` in full.
- Confirmed `git status --short` shows only the untracked `openspec/changes/force-escalation-ticket-ambiguity/`
  directory and `git diff main...HEAD --stat` touches none of `core/laws/`,
  `core/roles/orchestrator.md`, or `core/scripts/gather-escalation-context.sh` — this
  worktree's copies of those files are ground truth (main), not yet modified, so
  grounding the review against them is valid.
- Read `core/laws/README.md` and `core/laws/verification-before-completion.md` in full —
  the two-law table format, one-concern-per-law pattern, and the "Banned hedge language"
  precedent the design cites all check out as described.
- Read `core/scripts/gather-escalation-context.sh` in full — `VALID_KINDS`, the five
  existing `case` blocks, and the `require`/`fail` helpers match the design's description
  exactly; the sixth-kind addition (task 2.1) slots into this cleanly.
- Read `openspec/specs/escalation-context/spec.md` in full — its "five kinds" requirement
  and field lists match design.md's Context section and the proposed spec delta exactly.
- Read `core/roles/orchestrator.md` Phase 4 (lines ~429–497) and the "How to raise one"
  section (lines ~507–570) in full, and grepped the whole file for `mcp__linear`,
  `save_issue`, and case-insensitive `law` — `save_issue` (and `mcp__linear` anything)
  appears **zero times** in `core/roles/orchestrator.md`, and case-insensitive `law`
  appears **zero times** in the entire file. Also grepped the whole repo
  (`core/`, `scripts/`, `openspec/specs/`) for `save_issue`: zero hits anywhere.
- Read `core/roles/executor.md` lines 1–55 to confirm the "Iron Laws" bullet-list pattern
  (`WORKTREE_PATH/.concertino/laws/<file>.md`, two entries) that task 3.3 claims to mirror.

### Verdict: REFUTE

Two of the design's three concrete deliverables rest on a factual premise about
`core/roles/orchestrator.md` that ground truth does not support. Both are fixable at the
design layer without re-scoping the change, but as written an executor following
`tasks.md` literally will either invent unscoped new behavior or write dead prose.

### Change Requests

1. **The Phase 4 step 4 "wiring" decision assumes a ticket-authoring/filing flow that
   does not exist.** `design.md`'s Context section (lines 16–19) and Decisions section
   (lines 96–104), and `tasks.md` task 3.1, all describe the new law as gating an
   existing sequence: human answers "yes, file it" → orchestrator drafts the follow-up
   ticket's content → orchestrator calls `mcp__linear__save_issue`. Ground truth
   (`core/roles/orchestrator.md` lines 473–484) shows Phase 4 step 4 is *only* a single
   one-shot `emit-event.sh escalation --await` call with a generic `question=`/`options=`
   pair (e.g. "should I file a follow-up ticket for the sync drift?"). The numbered
   Phase 4 list ends at step 5 ("End your turn") once that one escalation resolves —
   there is no drafting step, no `mcp__linear__save_issue` call, and no `save_issue`
   reference anywhere in the role file or the repo (`grep -rn save_issue core/ scripts/
   openspec/specs/` returns nothing). Task 3.1 as written asks the executor to insert an
   instruction "before calling `mcp__linear__save_issue`" — a call site that doesn't
   exist. The executor is left to either (a) build the actual draft-then-file sequence
   itself (undisclosed scope growth — this is exactly the kind of "concrete runtime
   ticket-drafting flow" the proposal explicitly says CON-50 does *not* build for its
   other two consumers, yet here it would be building one anyway without it appearing in
   Impact/Non-Goals/tasks), or (b) attach the new law's prose to a call that never
   happens, which is dead instruction text and directly undercuts design.md's own stated
   Goal ("Apply the rule concretely... so this change ships real behavior change, not
   only a documentation artifact") — there is no real "yes → draft → save_issue" behavior
   for the law to intercept, so the wiring would be no more of a behavior change than the
   CON-21/ad-hoc-session cases this design explicitly treats as documentation-only.
   **Required revision:** either (a) design.md/tasks.md must spell out the actual
   draft-then-file sequence being added at Phase 4 step 4 as new, in-scope work (and
   reflect that in Impact and the tasks' verification section), or (b) redefine
   concretely what "governed by `ticket-drafting-escalation.md`" means at a step that
   currently only asks yes/no and never authors ticket text — e.g., binding the law to
   the *question-drafting* itself, since that's the only ticket-adjacent text Phase 4
   step 4 currently produces.

2. **Task 3.3 assumes orchestrator.md already has a "list of laws it reads," matching
   executor.md's pattern — it does not.** Task 3.3 reads: "Add
   `core/laws/ticket-drafting-escalation.md` to the orchestrator role's list of laws it
   reads at the point of use (matching how executor.md lists its two bound laws)."
   Ground truth: `core/roles/executor.md` lines 44–48 has an explicit "Iron Laws" bullet
   list (`WORKTREE_PATH/.concertino/laws/systematic-debugging.md` and
   `.../verification-before-completion.md`) under its Input/Steps section. `core/roles/
   orchestrator.md` has **no such section** — a case-insensitive grep for `law` across
   the entire file returns zero matches. There is nothing to "add to." An implementer
   will have to guess whether to fabricate a new orchestrator-wide "Iron Laws" section
   (mirroring executor.md's placement) or a narrower, Phase-4-local reference. Given this
   law's scope is explicitly "bound to: orchestrator" for exactly one moment of use
   (Phase 4 step 4), a repo-wide "list of laws" section would over-generalize the
   binding beyond what the proposal describes. **Required revision:** task 3.3 (and the
   corresponding design.md text) should state concretely that this is the *first* law
   reference orchestrator.md gets, and specify where it is introduced — a single inline
   pointer to `WORKTREE_PATH/.concertino/laws/ticket-drafting-escalation.md` at Phase 4
   step 4 itself is the scope-consistent choice, not a new document-wide list modeled on
   a different role file's unrelated section.

### Non-blocking notes

- The rest of the design is well-grounded: the sixth `gather-escalation-context.sh` kind
  (task 2.1/2.2), the new law file's frontmatter/table-row additions (task 1.1/1.2), the
  spec deltas, and the "six kinds" language update to "How to raise one" (task 3.2) all
  check out cleanly against the current script, README, and spec text with no
  placeholders or contradictions. Once Change Requests 1–2 are resolved, this looks ready
  to execute.
