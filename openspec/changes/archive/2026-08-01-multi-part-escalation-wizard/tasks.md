## 1. `emit-event.sh`: raise a multi-part escalation

- [x] 1.1 Accept an optional `sub_questions` field (JSON-encoded array of `{question, options}`) through the existing generic field-parsing loop — no new special-casing needed for the write itself (Decision 1).
- [x] 1.2 In `write_escalation_raised()`, add an oversized-`sub_questions` guard that runs *before* any context-truncation attempt — independent of whether `context` is present or absent — and fails the raise (return 1) rather than reaching either existing lossy fallback (the "no context to blame" branch at `core/scripts/emit-event.sh:277-283`, or the end of the binary-search truncation loop at `core/scripts/emit-event.sh:352-364`) (Decision 4).
- [x] 1.3 When invoked with `sub_questions`, have `--await` capture the raw value into its own variable (analogous to the existing `CONTEXT` capture — the generic field-parsing loop doesn't stash a raw value for anything else today) and parse it up front to learn `total` (the sub-question count) before entering the poll loop.

## 2. `emit-event.sh`: resolve a multi-part escalation

- [x] 2.1 In multi-part mode, each poll tick reads `answer.json`, and treats the escalation as resolved only when it parses and `complete === true` (never on file-presence or `subAnswers.length` alone).
- [x] 2.2 On resolution, emit `escalation.answered` with a `sub_answers` field (mirroring the existing singular `answer` field) and print each sub-answer on its own line, in sub-question order, to stdout; exit 0.
- [x] 2.3 Keep the existing single-question poll path (no `sub_questions` given) completely unchanged.
- [x] 2.4 Verify the existing timeout/kill-signal handling (`on_kill`, the deadline loop) applies identically to the multi-part path — no separate timeout logic needed.

## 3. `lib/ui/store.js`: multi-part answer writes

- [x] 3.1 Add `writeSubAnswer(root, ticket, index, value, total)`: read the current `answer.json` if present (or start from `total` nulls), set `subAnswers[index] = value`, recompute `complete`, write via a temp-file-then-`renameSync` (Decision 3) — never `O_EXCL` (that only works for a single create).
- [x] 3.2 Leave `writeAnswer` (the single-question path) completely unchanged.
- [x] 3.3 Add `readSubAnswers(root, ticket)`: safely parse `answer.json` back into `{subAnswers, total, complete}`, returning `null` on any missing file or parse failure — never throwing. Used by `watch.js` (task 5.5) to resume the wizard at the correct step.

## 4. `lib/ui/reducer.js`: surface sub-questions on `run.escalation`

- [x] 4.1 In the `escalation.raised` case, `JSON.parse` `ev.sub_questions` (when present) into `run.escalation.subQuestions`, degrading to absent/undefined on a parse failure — never throwing.
- [x] 4.2 Confirm `escalation.answered`/`escalation.timeout` still null out `run.escalation` for a multi-part escalation exactly as they do today for single-question.

## 5. `lib/ui/screens/escalation.js` and `watch.js`: wizard UX

- [x] 5.1 When `run.escalation.subQuestions` is present and non-empty, render only the current step (`state.escalationSubIndex`) — its question text and options (or the existing free-text `t` flow) — never any other step.
- [x] 5.2 On answering the current step (option key or free-text confirm), call the new `answer-sub` action (index, value, total); `watch.js` wires this to `store.writeSubAnswer`. If the write does not yet make the answer complete, stay on the escalation screen and advance `state.escalationSubIndex` by exactly one — no action type accepts an arbitrary target index (Decision 6). If the write makes it complete (the last sub-question), navigate back to the fleet immediately, exactly mirroring `answerEscalation`'s existing behavior for the single-question path (no separate "waiting" interim screen state needed).
- [x] 5.3 Handle the "already answered" race for a sub-answer write the same way `answerEscalation` already handles it for the single-question path (surface `result.error` as a notice rather than crashing or silently continuing).
- [x] 5.4 Confirm the single-question render/handleKey paths (no `subQuestions`) are provably unchanged (existing tests must keep passing unmodified).
- [x] 5.5 In `watch.js`'s `case 'open-escalation':`, when the target run's `run.escalation.subQuestions` is present, call `store.readSubAnswers(root, ticket)` (task 3.3) and set `state.escalationSubIndex` to the index of the first `null` slot in the result (or `0` when no file exists yet) — never defaulting to `0` unconditionally — so backing out and reopening a still-live, partially-answered multi-part escalation resumes at the correct step instead of silently risking an overwrite of an already-recorded answer (Decision 7).

## 6. Documentation

- [x] 6.1 Document the multi-part invocation form (`sub_questions=<json>`) in `core/roles/orchestrator.md`'s "How to raise one" section, alongside the existing single-question example — informational only, no change to which circuit breakers use it.

## 7. Tests

- [x] 7.1 `test/escalation.test.js`: add coverage for the wizard render/handleKey path (step-through, no-jump-ahead, free-text per step, navigate-to-fleet on completion), for `writeSubAnswer`/`readSubAnswers`'s incremental/complete semantics, and for `open-escalation`'s resume-at-first-unanswered-step behavior (task 5.5); confirm existing single-question cases are untouched.
- [x] 7.2 `test/scripts/escalation-loop.test.sh`: add coverage for `--await`'s multi-part resolution (incomplete file does not resolve, complete file does), and two distinct oversized-payload cases per Decision 4 — (a) `sub_questions` oversized with no `context` at all, and (b) `sub_questions` oversized with a small, otherwise-truncatable `context` also present — both must fail the raise outright rather than silently dropping `sub_questions` — alongside existing single-question coverage.

## 8. Verification

- [x] 8.1 Run the full test suite; all existing escalation-related tests pass unmodified alongside the new multi-part coverage.
- [x] 8.2 Manual smoke check (or scripted equivalent): raise a multi-part escalation end-to-end (raise → dashboard wizard answers each step → `--await` returns all sub-answers in order) against a live worktree.
