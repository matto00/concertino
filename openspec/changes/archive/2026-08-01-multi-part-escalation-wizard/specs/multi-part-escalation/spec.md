## ADDED Requirements

### Requirement: `escalation.raised` may carry an ordered list of sub-questions

`core/scripts/emit-event.sh escalation --await` SHALL accept an optional `sub_questions` field whose value is a JSON-encoded array of objects, each with a `question` string and an `options` array of strings, in the order they are to be answered. When present, the resulting `escalation.raised` event line SHALL carry this array (JSON-encoded, as any other string-typed field on this event) as `sub_questions`, alongside — never in place of — the event's existing `question`/`options`/`context` fields, which SHALL remain valid and unchanged when a caller omits `sub_questions` entirely.

#### Scenario: A caller raises a multi-part escalation
- **WHEN** an agent calls `emit-event.sh escalation --await ticket=<ID> sub_questions='[{"question":"Keep foo?","options":["yes","no"]},{"question":"Rename bar?","options":["rename","keep"]}]'`
- **THEN** the appended `escalation.raised` event line contains a `sub_questions` field that, once JSON-parsed, yields the two sub-questions in the order given

#### Scenario: An existing single-question caller is unaffected
- **WHEN** an agent calls `emit-event.sh escalation --await ticket=<ID> question="Approve?" options=yes,no` with no `sub_questions` field
- **THEN** the appended `escalation.raised` event line is byte-for-byte the same shape as before this change, with no `sub_questions` field present

#### Scenario: An oversized `sub_questions` payload fails the raise rather than dropping it silently, with no `context` present
- **GIVEN** a `sub_questions` payload large enough that the event line cannot fit within the byte cap, and no `context` field
- **WHEN** the caller raises the escalation
- **THEN** the raise fails outright (non-zero exit, no `escalation.raised` line written) rather than writing a line with `sub_questions` silently dropped and only a bare `{"truncated":true}` marker in its place

#### Scenario: An oversized `sub_questions` payload fails the raise even when a small, truncatable `context` is also present
- **GIVEN** a `sub_questions` payload large enough that the event line cannot fit within the byte cap even with `context` removed entirely
- **WHEN** the caller also passes a small, otherwise-independently-truncatable `context` field alongside it
- **THEN** the raise still fails outright exactly as in the no-`context` case — the presence of a small, truncatable `context` SHALL NOT let `sub_questions` be silently dropped via the `context`-truncation fallback path instead

### Requirement: `answer.json`'s multi-part shape makes partial completion structurally checkable

For a multi-part escalation, `answer.json` SHALL hold `{"subAnswers": [...], "total": <n>, "complete": <bool>}`, where `subAnswers` is an array with one slot per sub-question (unanswered slots are `null`), `total` is the declared sub-question count, and `complete` is an explicit boolean set to `true` if and only if every slot is non-null and `subAnswers.length === total`. This `complete` field SHALL be the sole basis for treating the file as resolved — never `subAnswers.length` alone, and never the file's mere existence. The single-question `answer.json` shape (`{"answer": "<text>"}`) SHALL remain completely unchanged and SHALL NOT gain a `complete` field.

#### Scenario: A partially-answered multi-part escalation is distinguishable from a complete one
- **GIVEN** a multi-part escalation with 3 sub-questions
- **WHEN** 2 of the 3 sub-questions have been answered
- **THEN** `answer.json` has `complete: false` and exactly one `null` slot in `subAnswers`

#### Scenario: A fully-answered multi-part escalation is marked complete
- **GIVEN** a multi-part escalation with 3 sub-questions
- **WHEN** all 3 sub-questions have been answered
- **THEN** `answer.json` has `complete: true` and no `null` slots in `subAnswers`

#### Scenario: The single-question answer shape is unaffected
- **WHEN** a single-question escalation is answered
- **THEN** `answer.json` is exactly `{"answer": "<text>"}`, with no `complete` or `subAnswers` field

### Requirement: `--await`'s poll loop only resolves a multi-part escalation once every sub-question is answered

When `--await` was invoked with `sub_questions`, its poll loop SHALL read `answer.json` on every tick and SHALL treat the escalation as resolved only when the file parses successfully and its `complete` field is `true`. A parseable `answer.json` with `complete: false` (or missing `complete`, or a `subAnswers` array shorter than `total`) SHALL be treated identically to the file not existing yet — the poll loop keeps waiting, exactly as it already does for a not-yet-existing file — and SHALL NOT emit `escalation.answered` or return control to the caller in that state.

#### Scenario: An incomplete answer file does not resolve the wait
- **GIVEN** `--await` is polling for a 3-sub-question escalation
- **WHEN** `answer.json` exists with `complete: false` after 2 of 3 sub-questions are answered
- **THEN** `--await` continues polling and does not emit `escalation.answered`

#### Scenario: A complete answer file resolves the wait
- **GIVEN** `--await` is polling for a 3-sub-question escalation
- **WHEN** `answer.json` exists with `complete: true` and all 3 slots filled
- **THEN** `--await` emits `escalation.answered`, prints each sub-answer on its own line (in sub-question order) to stdout, and exits 0

### Requirement: The escalation screen renders a step-through wizard for a multi-part escalation

When `run.escalation.subQuestions` is present and non-empty, `lib/ui/screens/escalation.js` SHALL render exactly one sub-question at a time — the current step only — with its own options (or free-text `t` reply, using the same key exactly as the single-question screen). The screen SHALL provide no action that answers or navigates to any sub-question other than the current step, and SHALL advance to the next step only after the current step's answer has been recorded. A single-question escalation (no `subQuestions`) SHALL continue to render exactly as it does today.

#### Scenario: The wizard shows one sub-question at a time
- **GIVEN** a live multi-part escalation with 3 sub-questions, none yet answered
- **WHEN** the escalation screen renders
- **THEN** only the first sub-question's text and options are shown, with no way to answer or view sub-questions 2 or 3 yet

#### Scenario: Answering a step advances to the next one
- **GIVEN** a live multi-part escalation with 3 sub-questions, the first already answered
- **WHEN** the escalation screen renders
- **THEN** the second sub-question's text and options are shown

#### Scenario: Free-text reply works per sub-question
- **GIVEN** a live multi-part escalation showing its current sub-question
- **WHEN** the human presses `t` and types a reply, then confirms
- **THEN** that reply is recorded as the current sub-question's answer and the wizard advances to the next sub-question (or finishes, if that was the last one)

#### Scenario: A single-question escalation is unaffected
- **GIVEN** a live escalation with no `subQuestions` field
- **WHEN** the escalation screen renders
- **THEN** it renders exactly as it did before this change, with no wizard step indicator

#### Scenario: Answering the last sub-question returns to the fleet, like the single-question path
- **GIVEN** a live multi-part escalation with 3 sub-questions, the first 2 already answered
- **WHEN** the human answers the 3rd (final) sub-question
- **THEN** the dashboard navigates back to the fleet view immediately, the same way it already does once a single-question escalation is answered

### Requirement: Reopening a still-live, partially-answered multi-part escalation resumes at the first unanswered step

Opening the escalation screen for a run whose live escalation has `subQuestions` SHALL NOT unconditionally start the wizard at step 0. It SHALL instead read back any already-recorded sub-answers and start at the first unanswered step, so that backing out of the screen (or a dashboard restart) and reopening the same still-live escalation never re-renders, and never allows silently re-answering, a sub-question that already has a recorded answer.

#### Scenario: Reopening after backing out resumes at the correct step
- **GIVEN** a live multi-part escalation with 3 sub-questions, the first already answered
- **WHEN** the human backs out of the escalation screen to the fleet and then reopens the same escalation
- **THEN** the screen shows the second sub-question, not the first

#### Scenario: A fresh multi-part escalation with no recorded answers starts at step 1
- **GIVEN** a live multi-part escalation with no `answer.json` written yet
- **WHEN** the escalation screen opens
- **THEN** it starts at the first sub-question
