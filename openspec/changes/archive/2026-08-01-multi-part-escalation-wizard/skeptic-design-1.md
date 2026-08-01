## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/multi-part-escalation/spec.md` in full (all under
  `openspec/changes/multi-part-escalation-wizard/` in the worktree).
- Cross-checked design/proposal claims against the actual current code, not
  just the narrative:
  - `core/scripts/emit-event.sh` (full file, 460 lines): confirmed the
    generic `*)` field-parsing case (lines 215-217) really does
    JSON-string-encode any non-numeric/bool value, backing Decision 1's
    claim that `sub_questions` needs no new escaping code path.
  - Confirmed `write_escalation_raised()`'s actual structure (lines
    269-365): the "no context to blame" bail (lines 277-283), the
    context-persist + binary-search truncation loop (lines 297-350), and a
    **second, later** fallback (lines 352-364, "even an empty context...
    doesn't fit... fall through to the same last-resort") that also ends in
    the lossy `write_line` (drops every caller field, writes a bare
    `{"truncated":true}`).
  - Confirmed `lib/ui/store.js#writeAnswer` (lines 199-228) really is an
    `O_EXCL`/`wx`-flag create-only write, matching Decision 3's framing of
    what multi-part must diverge from.
  - Confirmed `lib/ui/reducer.js`'s `escalation.raised` case (lines
    137-153) and `escalation.answered`/`escalation.timeout` case (155-158)
    match what design.md/tasks.md describe as the extension point.
  - Confirmed `lib/ui/screens/escalation.js`'s `handleKey` (lines 181-220)
    only ever returns `{type:'answer', ...}` for the current, single
    question — no action carries an arbitrary target index — supporting
    Decision 6's "no jump ahead is structural" argument.
  - Confirmed `lib/ui/watch.js` never reads `answer.json` anywhere today
    (`grep -n "answerPath|answer.json|readFileSync.*answer"` across
    `lib/ui/*.js` and `lib/ui/screens/*.js` — the only hits are the write
    path and comments); the dashboard has no existing plumbing to read
    persisted sub-answers back.
  - Confirmed `test/escalation.test.js` and `test/scripts/escalation-loop.test.sh`
    exist today with real single-question coverage the design commits to
    leaving untouched.
- Grepped the whole change directory for `TODO|TBD|figure out|placeholder`
  — none found; no hand-waved decisions.
- Traced both of the ticket's named correctness requirements to spec.md's
  ADDED requirements: "no sub-question sent back until all answered" →
  `--await`'s poll-loop requirement (spec.md lines 33-45, `complete===true`
  is the sole resolution basis); "3 of 5 vs 5 of 5 distinct/checkable" →
  the `answer.json` requirement (spec.md lines 15-31, explicit `complete`
  boolean, never inferred from array length).
- Traced "existing single-question behavior preserved": explicit unchanged
  scenarios in spec.md (lines 11-13, 29-31), explicit tasks (2.3, 3.2, 5.4),
  and explicit non-goals in design.md — consistent throughout, not just
  asserted once.

### Verdict: REFUTE

The two named correctness requirements are well-designed and consistently
threaded through proposal/design/spec/tasks. However, two concrete gaps
undermine the plan as written — one directly touches the ticket's own
"never silently drop data" governing concern, the other is an internal
contradiction between design.md's stated rationale and what tasks.md
actually schedules.

### Change Requests

1. **Decision 4 / Task 1.2's oversized-payload guard doesn't cover all the
   paths that can silently drop `sub_questions`.** `design.md` Decision 4
   and `tasks.md` task 1.2 only add a new "fail outright" branch at the
   *first* "no context to blame" check
   (`core/scripts/emit-event.sh:277-283`, `[ -z "$CONTEXT" ]`). But
   `write_escalation_raised()` has a **second** fallback
   (`core/scripts/emit-event.sh:352-364`, reached when a *non-empty*
   `context` exists but the binary-search truncation loop still can't make
   the line fit — e.g. a small/trivial `context` alongside a genuinely
   oversized `sub_questions` payload) that falls through to the same lossy
   `write_line` (drops every caller field, including `sub_questions`, and
   writes a bare `{"truncated":true}` marker). Decision 4's own reasoning
   is that this exact silent-drop is "worse" for multi-part than for
   single-question — but as scoped, it only intercepts the first fallback,
   not the second. A caller with a non-trivial `context` field and an
   oversized `sub_questions` array would still hit the silent-drop path
   the ticket explicitly calls out as its governing failure class ("absent
   data rendering as healthy data" — here, a `kind:"escalation.raised"`
   event with no question, no sub-questions, that a human can't answer,
   indistinguishable from a real failure). Fix: either (a) check
   `sub_questions` size independently of `context` and fail outright before
   attempting context truncation at all, or (b) also intercept the
   lines 352-364 fallback with the same "fail outright when `sub_questions`
   is present" branch Decision 4 describes for the first one. Update
   design.md Decision 4 and tasks.md task 1.2 accordingly, and add a test
   case to task 7.2 for "context present but small, `sub_questions` alone
   oversized" (distinct from the "no context at all" case already planned).

2. **Decision 2's "persisted resume point" claim isn't backed by any task.**
   `design.md` Decision 2 justifies incremental `answer.json` persistence
   partly by arguing the rejected in-memory-only alternative "loses wizard
   progress across a dashboard restart mid-wizard for no benefit" — i.e.
   it frames the persisted `subAnswers` array as "the wizard's own
   persisted resume point" (design.md:37). But no task in tasks.md (4.x or
   5.x) restores `state.escalationSubIndex` from the persisted file when
   the escalation screen (re)opens, and `lib/ui/watch.js`/`store.js` have
   no existing path that reads `answer.json` back at all today (verified:
   `answerPath`/`answer.json` only appear at the write call site and in
   comments, never in a read). As scoped, `state.escalationSubIndex`
   defaults to 0 on every open (task 5.1) with no restore path, so: (a) the
   claimed "survives a dashboard restart" benefit is not actually delivered
   by the plan, and (b) even without a restart, simply backing out of the
   escalation screen (`esc` → fleet) and reopening the *same still-live*
   multi-part escalation would re-render from sub-question 1, silently
   letting a human re-answer (and via `writeSubAnswer`'s overwrite
   semantics, silently *replace*) an already-recorded sub-answer with no
   indication it was already answered. This is a real internal
   contradiction between design.md's rationale and tasks.md's actual
   scope, not just a nice-to-have gap. Fix: either add a task (plus the
   necessary reducer/store surface — e.g. exposing `subAnswers`/first-null
   index alongside `subQuestions` in `run.escalation`) to derive the
   wizard's initial step from persisted state on open, or explicitly
   demote this to a stated Non-Goal in design.md so the contradiction is
   resolved and an implementer isn't left to guess which claim governs.

### Non-blocking notes

- Task 1.3 ("`--await` parse `sub_questions` up front to learn `total`")
  will need a raw-string capture analogous to the existing `CONTEXT`
  variable (`core/scripts/emit-event.sh:187-188, 206-214`) since the
  generic `*)` field-parsing case never stashes a raw value for anything
  but `context` today. Not a design flaw — just worth calling out
  explicitly in task 1.3 or 1.1 so an implementer doesn't have to
  reverse-engineer it, given Decision 1 states "no new special-casing
  needed for the write itself" (true for the write, not true for reading
  `total` back out).
