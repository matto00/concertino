## Why

An orchestrator sometimes has several genuinely independent sub-questions to ask a human at once (e.g. three separate REFUTE items needing separate decisions), but today's escalation wire format is strictly one question with one flat options list. Forcing every multi-part case through manual synthesis into a single combined question was considered and rejected as not worth dodging the real feature. Without structural support, a caller either drops sub-questions on the floor or an implementer is tempted to treat a partially-answered escalation as fully resolved — exactly this project's governing failure class (absent data rendering as healthy data).

## What Changes

- Extend the `escalation.raised` event schema to optionally carry an ordered list of sub-questions (`subQuestions`), each with its own `question` text and `options` list, alongside — never replacing — the existing single-question (`question`/`options`) shape. Existing single-question callers (`emit-event.sh escalation --await ticket=... question=... options=...`) keep working completely unchanged; multi-part is strictly additive.
- Extend `answer.json`'s shape to represent one answer per sub-question, plus an explicit completeness marker, so "3 of 5 answered" is a distinct, checkable state from "5 of 5 answered" — never inferred from array length or a partially-filled object that happens to parse.
- Add a wizard/step-through mode to the escalation screen (`lib/ui/screens/escalation.js`): when `run.escalation.subQuestions` is present, render sub-question N of the total, accept an answer (option key or free-text `t`), advance to N+1, and disallow jumping ahead of an unanswered sub-question. Free-text reply works per-sub-question exactly as it does today for the single-question case.
- Update `core/scripts/emit-event.sh`'s `--await` poll loop to accept a multi-part invocation (an ordered list of sub-questions passed by the caller), write/track partial answers as the wizard progresses, and only treat the escalation as resolved once every sub-question has a recorded answer — never on the mere presence of `answer.json`, which the single-question path still treats as sufficient today.
- The single-question path's behavior, wire shape, and performance characteristics are unchanged; multi-part is a new, additive capability layered on the same `escalation.raised` / `answer.json` / poll-loop plumbing.

## Capabilities

### New Capabilities

- `multi-part-escalation`: an ordered, wizard-style set of sub-questions within a single escalation — schema, answer completeness semantics, screen UX, and the `--await` poll-loop's completeness check — that a caller can raise instead of (never instead of requiring) today's single-question escalation.

### Modified Capabilities

(none — the single-question escalation flow's existing requirements are unchanged; this change adds a new, parallel shape rather than modifying `escalation-context`, `escalation-deadline-source`, `escalation-trust-offramp`, `cross-screen-escalation`, or `post-completion-escalation-visibility`, none of which specify the base question/options/answer contract itself.)

## Impact

- `core/scripts/emit-event.sh` — new multi-part invocation form, JSON building for `subQuestions`, poll-loop completeness check.
- `lib/ui/store.js` — a per-sub-question write path (`writeSubAnswer`) and a matching safe read-back (`readSubAnswers`), alongside the existing `writeAnswer` (unchanged).
- `lib/ui/reducer.js` — `escalation.raised` case needs to surface `subQuestions` onto `run.escalation`.
- `lib/ui/screens/escalation.js` — wizard rendering/`handleKey` branch alongside the existing single-question rendering.
- `lib/ui/watch.js` — `open-escalation` handling resumes the wizard at the first unanswered step (reading persisted sub-answers back via `store.readSubAnswers`), and a new `answer-sub` action wired to `store.writeSubAnswer`.
- `core/roles/orchestrator.md`'s "How to raise one" section — document the multi-part invocation form for a caller that has several genuinely independent sub-questions.
- Tests: `test/escalation.test.js`, `test/scripts/escalation-loop.test.sh` — new coverage for the wizard path; existing single-question coverage must keep passing unmodified.
