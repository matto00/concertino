## Context

Concertino's own delivery workflow (this repo) is self-hosted: `core/roles/*.md`
are the canonical, harness-neutral role instructions; `concertino sync` renders
them into `.claude/agents/*.md` (Claude Code) and `.codex/agents/*.toml`
(Codex). `core/scripts/*.sh` are the canonical scripts; this repo's own
`scripts/concertino/*.sh` mirror them 1:1 for its own dogfooding config. Any
change to orchestrator behavior or a new shared script must land in `core/`
first and be synced, not hand-edited only at the root.

Three points currently surface a suggested follow-up with no structured basis
for approval:
1. The evaluator's "Non-blocking Suggestions" (report section, read by the
   orchestrator only at final PASS presentation).
2. The skeptic's "Non-blocking notes" (same — read at presentation time).
3. The orchestrator's own Phase 4 step 4 post-cleanup observation
   (`core/roles/orchestrator.md`, backed by `orchestrator-turn-discipline`'s
   spec, which explicitly justifies a bare `question=`/`options=` escalation
   shape today by asserting "no `gather-escalation-context.sh` kind fits this
   case").

CON-30 is the concrete failure this design must close: a fold-in suggestion
was escalated, approved, and the answer was durably recorded
(`escalation.answered`) — but nothing in the workflow ever revised the current
run's `ticket.md`/`proposal.md`/`design.md`/`tasks.md` to cover the added
scope, so the work the human thought they'd approved never happened until the
mistake was found and split back out by hand.

## Goals / Non-Goals

**Goals:**
- One shared classification mechanism (a script + one orchestrator
  sub-procedure), called from both existing follow-up-surfacing points,
  rather than reimplemented per call site.
- The mechanical signal (file overlap) computed from real git state, not
  self-reported — this is the one signal a script can check without trusting
  the caller.
- The escalation the human sees carries the classification's reasoning as
  `context=`, reusing CON-11's existing context-carrying mechanism, not a new
  screen or field.
- A `fold-in` verdict provably changes the plan: the design requires a
  concrete, checkable state change (updated `ticket.md` acceptance criteria,
  `proposal.md`/`design.md`/`tasks.md`, a re-run design-gate skeptic
  `CONFIRM`) before Execution is allowed to proceed past that point — not
  merely a recorded answer.
- `standalone` produces a concrete artifact (a filed Linear ticket) rather
  than just an approved suggestion that the human has to remember to action
  themselves.

**Non-Goals:**
- Not building a general-purpose "effort estimation" or "AC-relevance
  inference" model. Those two signals are judgment calls the calling role
  (orchestrator, reading the evaluator/skeptic report or its own observation)
  states explicitly as script inputs; the script's own computation is limited
  to the one mechanically checkable signal (file overlap).
- Not changing `core/roles/evaluator.md` or `core/roles/skeptic.md` behavior —
  they keep writing suggestions into their reports exactly as today. The
  triage step is entirely the orchestrator's, since it is the one place all
  three surfacing points already converge (it alone reads both reports and
  owns its own Phase 4 observation).
- Not adding another kind to `gather-escalation-context.sh` (currently six:
  `dependency`, `api-change`, `budget`, `blocker`, `contradiction`,
  `ticket-ambiguity`). That script's kinds are pure formatters over
  caller-supplied fields with no computation; `triage-followup.sh` needs to
  shell out to `git diff` and apply a decision table, which is a different
  shape of script. Keeping it separate avoids overloading
  `gather-escalation-context.sh`'s closed, kind-enum contract (already
  specified and tested) with a computed recommendation it was never designed
  to produce.
- Not automating the `fold-in` re-planning pass end-to-end without human
  visibility — the human still approves the triage recommendation before any
  re-planning starts; this design only guarantees that *if* they approve
  fold-in, the re-planning actually happens next, in the same run.

## Decisions

### 1. `triage-followup.sh` is a standalone script, not a `gather-escalation-context.sh` kind
Rationale: covered under Non-Goals above. Its interface mirrors that script's
conventions for consistency (`FAIL <reason>` to stderr + non-zero exit on bad
input; nothing on stdout on failure; a plain-text block on stdout on success)
without extending its closed enum.

Usage:
```
core/scripts/triage-followup.sh \
  description="<one-line description of the suggested follow-up>" \
  files="<comma-separated files the follow-up would touch, or 'unknown'>" \
  ac_relevant=<yes|no> \
  effort=<small|large> \
  worktree=<WORKTREE_PATH> \
  base=<base-branch, optional>
```
- `base=`, when omitted, defaults to `${CONCERTINO_BASE_BRANCH:-main}` — the
  same convention `core/scripts/cleanup.sh` and `core/scripts/assert-phase.sh`
  already use, read from the environment rather than hardcoded to `main`.
- `files=unknown` is a legitimate input (a suggestion may not name concrete
  files yet) — file overlap is then scored as `unknown`, which the decision
  table treats the same as "no overlap" (never *assume* overlap the caller
  didn't state).
- Mechanical step: `git -C <worktree> diff --name-only <base>...HEAD` to get
  the current change's already-modified files; intersect with `files=`.
  Overlap is `none` / `partial` / `high` (>=50% of the follow-up's named
  files already appear in the change's diff).
- Decision table (deterministic, stated in the script as a comment so it's
  auditable, not tuned model judgment):

  | ac_relevant | effort | overlap        | recommendation |
  |-------------|--------|----------------|-----------------|
  | yes         | *      | *              | fold-in (it's already in scope — this shouldn't have been a "follow-up" at all) |
  | no          | small  | high           | fold-in |
  | no          | small  | partial/none   | standalone |
  | no          | large  | *              | standalone |

  (`discard` is never the script's own recommendation — the script has no
  signal for "not worth doing," only for scope/cost. `discard` remains an
  option the human can always pick regardless of the recommendation; the
  script's output states this explicitly so the recommendation is read as
  "if this is worth doing at all, here's how," not "should we do it.")
- Output: a plain-text block (mirroring `gather-escalation-context.sh`'s
  kind blocks) stating the four inputs, the computed overlap, and the
  resulting recommendation with the one-line rule that produced it — this is
  what gets passed as `context=`.

### 2. The orchestrator owns triage; evaluator/skeptic are unchanged
Both non-blocking-suggestion sources are read by the orchestrator already
(Phase 3 Delivery, "read the final evaluation report now — the only time a
PASS report is read"); adding the triage call there is a read-time addition,
not a new write responsibility for those roles.

### 3. Shared sub-procedure, two call sites
`core/roles/orchestrator.md` gains one named sub-procedure ("Triaging a
suggested follow-up") that:
1. Identifies `description`/`files` for the suggestion (from the report text
   for Phase 3 call sites; from its own observation for Phase 4).
2. States its own judgment for `ac_relevant`/`effort` (these are exactly the
   kind of call an orchestrator reading the ticket + the change's diff is
   positioned to make — not a new capability, just made explicit and
   structured instead of implicit).
3. Runs `triage-followup.sh`, capturing its stdout as `$TRIAGE_CONTEXT` (on
   `FAIL`, falls back to raising the escalation without `context=`, exactly
   like the existing `gather-escalation-context.sh` fallback rule — never
   blocks the escalation on a failed triage call).
4. Raises `emit-event.sh escalation --await` with
   `context="$TRIAGE_CONTEXT"` (when non-empty) and
   `options=fold-in,standalone,discard`.
5. Branches on the answer (see Decision 4).

Both call sites (Phase 3, Phase 4) invoke this sub-procedure by name rather
than repeating steps 1-5.

### 4. Answer handling — the CON-30 fix
- **`discard`**: no further action; note it in the delivery/closing summary.
- **`standalone`**: file a new Linear ticket (`mcp__linear__save_issue` with
  no `id`) summarizing the suggestion, `description`, and a link back to the
  current ticket; note the new ticket ID in the summary. No re-planning, no
  scope change to the current run.
- **`fold-in`**: the orchestrator does not proceed past this point until it
  has:
  1. **Made the change directory editable again.** Both triage call sites
     (Phase 3 Delivery's step 6, Phase 4's step 4) are reached *after* Phase
     3 step 2 has already archived the change (`openspec archive
     <CHANGE_NAME> --yes` has already moved it out of
     `openspec/changes/<CHANGE_NAME>/` into its archive location, and merged
     its `specs/` delta files into the canonical `openspec/specs/`).
     `openspec validate` cannot operate on an archived change directory, so
     move the directory back to `openspec/changes/<CHANGE_NAME>/` first —
     this is required, not optional, and is the same location the added
     scope's edits below land in.
  2. Extended `ticket.md`'s acceptance-criteria section, now at that
     restored path, to state the added scope explicitly (this is what the
     evaluator and the final-gate skeptic trace acceptance criteria from —
     an extended `tasks.md` with no corresponding `ticket.md` change is
     unverifiable downstream, and risks the fresh design-gate re-run in step
     4 below flagging the extra scope as unexplained drift against an
     unchanged ticket), plus `proposal.md` (What Changes / Capabilities),
     `design.md` if the added scope needs its own decisions, and `tasks.md`
     for the added scope — a real edit, not a comment recording the
     decision.
  3. Re-run `openspec validate --change <CHANGE_NAME>`.
  4. Re-run the design-soundness skeptic gate (fresh spawn, `GATE=design`) on
     the revised plan, bounded by the same `SKEPTIC_DESIGN_ROUNDS` this run
     already resolved at Setup.
  5. Only once that gate `CONFIRM`s: if triage happened at the Phase 3 call
     site, proceed into (or back through) Execution for the added scope
     before Delivery; if it happened at the Phase 4 call site, re-enter
     Execution for the added scope instead of ending the run — Phase 4's
     "genuinely complete" cleanup does not run until this new scope has been
     executed, evaluated, and gated exactly like the original scope was.
  6. **Re-archive once the added scope has shipped — but only after
     resolving the `specs/` delta collision this second archive pass would
     otherwise hit.** The change's own `specs/<capability>/spec.md` delta
     files still contain the `## ADDED Requirements` blocks the *first*
     archive pass already merged into the canonical `openspec/specs/`; a
     second, naive `openspec archive <CHANGE_NAME> --yes` re-processes those
     same delta files and aborts (`"<header> ... - already exists"`,
     `Aborted. No files were changed.`) because it tries to re-add a
     requirement header the canonical spec already has — reproduced
     directly against two independent real archived changes in this repo,
     not a hypothetical. Before this re-archive call, the orchestrator must
     state explicitly which of the following two applies (tied to whether
     step 2's `design.md` revision introduced any new/modified spec
     requirement for the added scope):
     - **Step 2 added no new/modified spec requirement:** re-archive with
       `openspec archive <CHANGE_NAME> --yes --skip-specs` — there is
       nothing new for the canonical specs to receive, so skipping spec
       processing entirely is correct, not a shortcut.
     - **Step 2 did add a new/modified spec requirement:** first reset the
       change's `specs/<capability>/spec.md` delta file(s) to contain *only*
       the deltas for the newly-added scope (remove or rewrite the entries
       the first archive pass already merged — those are now stale
       duplicates that will collide), then re-archive normally (without
       `--skip-specs`), so the genuinely new requirement is still merged
       into the canonical specs. Defaulting to `--skip-specs` unconditionally
       here would silently drop that new requirement — the same
       "recorded intent, no durable spec change" gap CON-30 was about, just
       relocated to the spec layer instead of the plan layer.

  This sequencing (revise plan → validate → design-gate → execute → resolve
  the `specs/` collision → re-archive) is exactly Phase 1 + the Phase 2
  loop's existing procedure, re-entered for the added scope, plus the
  archive/restore/re-archive handling this change directory's own lifecycle
  requires — no new gate type, just the existing ones invoked again with the
  plan actually updated first, which is the one step CON-30 skipped.

## Risks / Trade-offs

- [Risk] The orchestrator's own `ac_relevant`/`effort` judgment could be
  wrong, producing a misleading recommendation → Mitigation: the escalation
  always shows the four raw inputs plus the one-line rule that fired, not
  just a bare verdict — a human catching a wrong `ac_relevant`/`effort` call
  in the visible context is exactly the CON-11 pattern this design reuses,
  and `discard`/`standalone`/`fold-in` all remain selectable regardless of
  the recommendation.
- [Risk] A `fold-in` re-planning pass could itself run unbounded → Mitigation:
  it reuses the existing `SKEPTIC_DESIGN_ROUNDS` circuit breaker unchanged;
  no new unbounded loop is introduced.
- [Risk] Filing a standalone Linear ticket automatically could create noise
  for low-value suggestions → Mitigation: `discard` exists precisely for
  this; the ticket is only filed once the human has explicitly picked
  `standalone` for that specific suggestion.
- [Trade-off] This adds one more escalation round-trip at Phase 3 Delivery
  when there are non-blocking suggestions worth triaging (most PASS reports
  have none, or only style nits not worth triaging) → accepted, since the
  alternative (CON-30's silent gap) costs a full wasted round-trip later.
