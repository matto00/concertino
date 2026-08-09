## Context

CON-98 needed several judgment calls escalated during Planning rather than
decided silently, and its own follow-up (this ticket) was itself filed the
same way — see the transcript: CON-100 posed three open questions, the
orchestrator raised them as one multi-part escalation, and the human's
answers ("both" / "conditional" / "escalations-answered") are the concrete
inputs this design implements. That resolution loop is the worked example
this design generalizes: any future design ticket should go through the same
shape without a human having to hand-answer bespoke escalation wording each
time.

This project already has two adjacent, directly reusable mechanisms:
- CON-62's per-ticket label-override pattern (`harness-identity` capability)
  — checked at Setup, right after fetch, before branch derivation.
- `followup-triage`'s fold-in/standalone/discard sub-procedure, with an
  existing requirement (CON-30) that a `fold-in` verdict must actually revise
  the plan and execute, not just get recorded.

## Goals / Non-Goals

**Goals:**
- Let a ticket be filed honestly as "design" work from the start.
- Reuse the existing escalation and triage machinery rather than inventing a
  parallel decision scheme.
- Make "done" for a design ticket well-defined and resumable across
  compaction, exactly like every other phase transition in this workflow.

**Non-Goals:**
- No new script. Detection is an inline label/title check (mirrors CON-62,
  which also needed no new script). Triage reuses
  `scripts/concertino/triage-followup.sh` verbatim.
- No change to how an ordinary (non-design) ticket is planned, executed, or
  delivered — every change here is additive and gated on `TICKET_TYPE ==
  design`.
- No attempt to auto-detect "is this really a design question" heuristically
  from ticket prose. Detection is the explicit label/title signal only —
  same fail-loud-on-ambiguity posture as the harness-override precedent, not
  a guess.
- No new evaluator/skeptic role behavior. A `fold-in` scope re-enters the
  ordinary pipeline unmodified — the evaluator/skeptic review whatever code
  that scope produces exactly as they would for any other ticket. A ticket
  with no `fold-in` scope never reaches them at all.

## Decisions

### Detection: label wins, title is a fallback, no "unsupported value" case

Unlike `harness:<value>` (an open value set, so an unrecognized value must
hard-stop), "design" is a single boolean-ish signal — a ticket either is or
isn't one. So detection is: label `type:design` (exact match) if present;
else title starts with the literal prefix `[DESIGN] `; else ordinary ticket.
No ambiguity case exists the way it does for harness overrides (two
*agreeing* signals is not a conflict), so there is nothing to hard-stop on.
Recorded as `TICKET_TYPE: design | feature` in `workflow-state.md`,
resolved once at Setup like every other run-level decision in this
document.

**Alternative considered:** a `^type:(.+)$` open label scheme mirroring
`harness:` exactly, to leave room for future ticket types (`spike`,
`chore`, ...). Rejected for now — CON-100 only asked for `design`, and an
open value set would need its own unsupported-value hard-stop path with no
concrete second type to validate it against. Revisit if a second type is
ever actually proposed.

### Extracting open questions: a line matching /open questions?/i, escalate if absent

**Revised after design-gate round 1 REFUTE.** The original rule ("look for
a `##`-headed section") does not actually match CON-100's own `ticket.md`,
the worked example the design cited as proof: `grep -n "^#" ticket.md`
shows only `## Description` / `### Problem` / `### Proposal to evaluate` /
`## Related` — no heading anywhere named "Open questions". The real text,
"Open questions this ticket should resolve:", is a **plain paragraph
line** (ending in a colon) nested inside the `### Proposal to evaluate`
body, immediately followed (after one blank line) by the bullet list of
the three actual questions. Most real ticket bodies will be shaped this
way — a lead-in sentence, not a dedicated top-level heading — so the
extraction rule has to match on the sentence, not assume a heading exists.

Corrected rule: scan `ticket.md` line by line (heading or plain paragraph,
any nesting level) for a line whose text matches the regex
`/open questions?/i`. On the first match, take the markdown bullet list
that immediately follows it (skipping only blank lines — stop at the first
non-bullet, non-blank line) as the question set; each bullet becomes one
`sub_questions[]` entry in a single multi-part escalation, exactly the
mechanism already used for CON-100 itself. **Re-verified against the real
file:** applying this rule to `ticket.md` matches line 15 ("Open questions
this ticket should resolve:") and extracts exactly the three bullets at
lines 17–19 — the three questions this change's own Planning pass actually
raised. If no line in the ticket matches `/open questions?/i` at all
(never mind a following bullet list), or a match exists but no bullet list
immediately follows it, this is a Planning ESCALATION on its own (single
question: "What should this design ticket resolve?") rather than a silent
no-op or a guess at unstructured prose — a design ticket with nothing
extractable is either mis-typed or under-specified.

**Alternative considered:** requiring `options=` for every question
up front (bounded choices only, like CON-100's three). Rejected as a hard
requirement — some open questions are genuinely open-ended ("what should the
API shape be?"). `sub_questions[]` already supports free-form answers when
no natural bounded option set exists; the orchestrator states the best
options it can but is not blocked from raising a question without a clean
enum.

### Per-question triage, not a bespoke verdict scheme

Rather than inventing a new fold-in-shaped decision for design tickets, each
answered question that plausibly implies future work is run through the
existing "Triaging a suggested follow-up" sub-procedure verbatim:
`description` = the question + its answer, `files=unknown` (no code diff
exists yet — already a supported `triage-followup.sh` input), and the
orchestrator's own `ac_relevant`/`effort` judgment exactly as it already
states for the Phase 3/Phase 4 call sites. This makes design-ticket Planning
the third invocation site of an already-specified, already-tested
procedure, instead of a fourth decision scheme a reader has to learn
separately. `fold-in` is what makes the pipeline shape "conditional" per the
human's answer: it is `followup-triage`'s own existing requirement — extend
`ticket.md`/`proposal.md`/`design.md`/`tasks.md`, re-validate, re-run the
design gate, then execute — applied here with no modification needed to
that requirement's actual mechanics, only to the sentence naming its call
sites.

A question whose answer plainly implies no action (e.g. CON-100's own third
sub-question, "escalations-answered" — a pure definition, not a build) does
not need a wasted triage round-trip: the orchestrator may record it as an
implicit `discard` directly, stating why, rather than mechanically
triaging every single answer regardless of content. This mirrors Planning's
existing "self-approve everything else" posture for non-architectural
decisions.

**Alternative considered:** a single combined escalation asking
fold-in/standalone/discard for the whole ticket at once, rather than
per-question. Rejected — CON-98-shaped tickets can easily have a mix (one
question implies real, executable scope; another is pure policy), and
collapsing them loses exactly the distinction the pipeline-shape answer
("conditional") called for.

### Definition of done, and the no-code Phase 4 precondition

A design ticket is done when: every posed question has a recorded triage
verdict; every `standalone` verdict has an actually-filed ticket (its
identifier recorded); every `fold-in` verdict's combined scope has
completed ordinary delivery (merged, per this run's `AGENT_MERGE`
resolution). A recorded verdict with no corresponding filed ticket or
completed delivery does not satisfy this — identical in spirit to
`followup-triage`'s existing CON-30 fix, just checked at the design-ticket
level instead of per individual suggestion.

When no question triaged to `fold-in`, nothing was ever executed or pushed,
so Phase 4's existing "human 'merged' confirmation or auditor `MERGE`
verdict" precondition cannot be satisfied and must not be required.

**Step order is unchanged (clarified after design-gate round 1 REFUTE).**
"Cleanup proceeds once the closing comment is posted and every
`standalone`/`discard` verdict has resolved" names the alternate *entry
condition* that substitutes for the ordinary "human 'merged' confirmation
or auditor `MERGE` verdict" gate before Phase 4 begins — it does not invert
Phase 4's own existing internal step order. Phase 4 still runs in its
existing order for this branch: (1) `cleanup.sh --phase4` (worktree
removal, plus its documented local-`<base>` fast-forward), then (2) set
the ticket Done and post the closing comment, then (3) the hygiene check —
identical to an ordinary ticket's Phase 4, just reached via the new
entry condition instead of a merge confirmation.

`cleanup.sh`'s fast-forward-after-merge step is safe to run unmodified
here even though nothing merged: `attempt_fast_forward()` first compares
local `<base>`'s tip against the fetched remote tip and returns immediately
(`FF_STATUS="current"`, a no-op) when they already match, which is the
expected state here since this branch never pushed anything new to
`<base>`. If some unrelated commit landed on `<base>` from a different run
while this design ticket was in flight, fast-forwarding to it is exactly
the same, already-correct behavior `cleanup.sh` performs for every ordinary
ticket's Phase 4 today — not a new risk this design introduces. No change
to `cleanup.sh` itself is needed (confirming this design's existing
Non-Goal of no script changes).

When at least one question triaged to `fold-in`, the ticket behaves exactly
like an ordinary delivery from that point on (including the existing
merged-confirmation precondition and existing Phase 4 step order), since
real code now exists and needs the same review/merge discipline as any
other change.

**Alternative considered:** always requiring a (possibly empty) PR even for
a pure-decision design ticket, to keep Phase 4 uniform. Rejected — an empty
PR with no reviewable diff is a false formality; the decisions are already
durably recorded via the Linear closing comment and persisted planning
evidence (`ticket.md`, and the escalation/triage trail in
`.concertino/runs/<ticket>/events.jsonl`), which does not depend on git
history the way code review does.

**Note on DoD reading past the literal human answer.** The approved answer
to question 3 was the short form "escalations-answered (every escalation
raised got answered — no additional doc-summary requirement)." This
design's actual DoD ("every `standalone` verdict has an actually-filed
ticket... every `fold-in` verdict's scope has completed delivery") is
stricter than that literal phrase: it requires the *actions implied by* an
answer, not merely the answer's presence. This is a direct, non-architectural
application of the already-established `followup-triage`/CON-30 precedent
("a recorded fold-in decision never led to the plan actually being
revised" — the exact failure mode this stricter reading exists to close for
design tickets too), not a new open design question — so it is treated as
self-approvable per Planning's existing "self-approve everything else"
posture, rather than re-escalated. The literal "no additional doc-summary
requirement" half of the answer is respected as-is: nothing here requires a
separate decisions document beyond the closing comment and the ordinary
escalation/triage telemetry trail.

**Note on the fold-in sub-procedure's step 1 at the new Planning-time call
site.** `followup-triage`'s existing fold-in mechanics open with "make the
change directory editable again" (undoing an `openspec archive` the Phase
3/Phase 4 call sites always perform before triage can run, since delivery
always archives the change ahead of any follow-up surfacing). At the new
design-ticket Planning call site, no archive has happened yet — Planning
runs before Phase 3 delivery, on a still-open (un-archived) change
directory — so that step is inapplicable by construction, not omitted by
oversight: there is nothing to restore. The remaining fold-in steps (extend
`ticket.md`/`proposal.md`/`design.md`/`tasks.md`, re-validate, re-run the
design gate, execute) apply unchanged.

## Risks / Trade-offs

- **A design ticket with a `fold-in` scope has two "definitions of done"
  layered** (its own question-triage completeness, plus the ordinary
  pipeline's evaluator/skeptic/delivery gates for the executed scope). →
  Mitigation: the layering is additive, not a new gate — the ordinary
  pipeline's gates are entirely unmodified; the only addition is the
  closing-comment content requirement (Q&A summary alongside the merged PR
  link).
- **A malformed or missing "Open questions" section silently produces no
  escalation on a mistyped ticket.** → Mitigation: absence itself is
  escalated (see "Extracting open questions" above) rather than treated as
  "nothing to do" — a design ticket always produces at least one
  escalation before Planning can complete.
- **Reusing `followup-triage` for a Planning-time call, when its spec today
  only names two (both post-Planning) call sites, risks the wording reading
  as though a third caller is unauthorized.** → Mitigation: the
  `followup-triage` spec delta in this same change updates that requirement
  text to name three call sites explicitly, keeping the "one shared
  procedure, not reimplemented per caller" property the capability's own
  Purpose statement already asserts.
