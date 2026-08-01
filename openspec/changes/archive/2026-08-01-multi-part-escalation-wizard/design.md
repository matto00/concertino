## Context

Today's escalation plumbing (`core/scripts/emit-event.sh escalation --await ticket=<ID> question=<text> options=a,b`) supports exactly one question with one flat options list. `escalation.raised` carries `question`/`options`/`context`; the dashboard (`lib/ui/screens/escalation.js`) renders one key per option plus a free-text (`t`) reply; an answer is written to `answer.json` via `lib/ui/store.js#writeAnswer` using an `O_EXCL` create-only write (first writer wins, atomically); `--await`'s poll loop (`core/scripts/emit-event.sh`) treats the mere presence of a parseable `answer.json` with a non-empty `answer` field as fully resolved.

CON-46 adds a parallel, additive shape: an ordered list of sub-questions inside one escalation, a wizard-style step-through screen, and a completeness check in the poll loop so a partial answer is never mistaken for a complete one — this project's stated governing failure class (absent data rendering as healthy data).

## Goals / Non-Goals

**Goals:**
- `escalation.raised` can optionally carry `sub_questions` (an ordered list of `{question, options}`), alongside — never replacing — the existing flat `question`/`options` fields.
- `answer.json` can represent a multi-part answer with an explicit, checkable completion marker distinct from "the array happens to be full length."
- The escalation screen renders a step-through wizard for a multi-part escalation: current sub-question only, no way to jump ahead of an unanswered one, per-sub-question free-text reply exactly like today's single reply.
- `--await`'s poll loop resolves a multi-part escalation only once every sub-question has a recorded answer — file-exists is never sufficient on its own.
- Every existing single-question call site and test keeps working byte-for-byte unchanged.

**Non-Goals:**
- Migrating any existing orchestrator call site (budget-exhausted, BLOCKER, etc.) to multi-part. This change only makes the capability available; adopting it for a specific circuit breaker is a separate decision for a future ticket.
- Oversized `sub_questions` truncation-with-persisted-full-copy (the way `context` already does a binary-search truncate + `persist-evidence.sh` ref). See Decision 4/Risk below — an oversized multi-part payload fails the raise outright rather than silently dropping sub-questions.
- Concurrent-multi-dashboard write arbitration beyond "last writer wins, always a structurally valid file" — see Decision 3.

## Decisions

### Decision 1: `sub_questions` travels as a JSON-encoded string field, not a raw-embedded array

`emit-event.sh`'s generic `k=v` mechanism (the `*)` case in its field-parsing loop) already JSON-string-encodes any value that isn't a bare integer/bool. Rather than teach the script a new raw-JSON-embedding code path, a caller passes `sub_questions='[{"question":"...","options":["a","b"]},...]'` as an ordinary field value; it lands in the event line as a JSON **string** containing serialized JSON (double-encoded), e.g. `"sub_questions":"[{\"question\":...}]"`. `lib/ui/reducer.js`'s `escalation.raised` case `JSON.parse`s it into a real array (wrapped in try/catch — a malformed value degrades to "no sub-questions" exactly like a malformed `options` today), mirroring the same `JSON.parse` pattern `--await` already uses for `answer.json`. This needs zero changes to `emit-event.sh`'s core JSON-building/escaping logic, and existing `options=a,b` (comma-string) handling is untouched.

Alternative considered: extend `emit-event.sh` to accept and embed genuinely nested JSON for a specific key (raw, unescaped). Rejected — meaningfully more surface area in a security- and correctness-sensitive shell script (the byte-cap/escaping logic in `json_escape`/`json_value`/`write_line` is deliberately narrow), for no behavioral difference to a consumer that already `JSON.parse`s a string field.

### Decision 2: `answer.json`'s multi-part shape is written incrementally, with an explicit `complete` marker

Single-question `answer.json` is unchanged: `{"answer": "<text>"}`, written once via `writeAnswer`'s `O_EXCL` create. Multi-part `answer.json` is a different, mutually-exclusive shape:

```json
{ "subAnswers": ["yes", null, null], "total": 3, "complete": false }
```

`lib/ui/store.js` gains `writeSubAnswer(root, ticket, index, value, total)`: reads the current file if present (or starts from `total` nulls), sets `subAnswers[index] = value`, recomputes `complete = subAnswers.length === total && subAnswers.every((a) => a != null)`, and writes the whole object back. This means the file legitimately exists in an incomplete state after each sub-answer — exactly the "3 of 5 vs. 5 of 5" state the ticket requires be checkable, not inferred. It also gains a companion read, `readSubAnswers(root, ticket)`, that safely parses the file back (returning `null` on any missing/invalid file rather than throwing) — see Decision 7 for what reads it and why.

`--await`'s poll loop, when it was invoked with `sub_questions` (so it knows it's in multi-part mode and knows `total`), reads `answer.json` every tick and treats it as resolved **only when `complete === true`** — never on file-presence alone, and never by independently re-deriving completeness from `subAnswers.length` (a stale `total` mismatch is exactly the kind of divergence the explicit field is meant to catch structurally rather than by convention). On resolution it collects `subAnswers` into the same role `escalation.answered` now carries as `sub_answers` (plural, mirroring the existing singular `answer` field) and returns them to the caller (one line per sub-answer, in order, since `--await`'s stdout contract is a single string today — see Decision 5).

Alternative considered: only ever write `answer.json` once the human finishes every sub-question (in-memory wizard state only, no partial persistence). Rejected — the ticket explicitly asks `--await`'s poll loop to "distinguish file exists but incomplete from file exists and complete," which presumes partial state legitimately reaches disk; a purely in-memory alternative would also leave the wizard with nothing to resume from if the screen is closed and reopened mid-wizard — see Decision 7, which is what actually cashes in this persistence rather than merely asserting the benefit.

### Decision 3: multi-part writes are atomic via write-temp-then-rename, not `O_EXCL`

`O_EXCL` (today's single-answer safety net) only works for a single create-once write; multi-part needs several updates to the same file as sub-questions are answered one at a time. `writeSubAnswer` writes to `answer.json.tmp-<pid>` in the same directory and `fs.renameSync`s it over `answer.json` — `--await`'s single reader (the only reader of this file) never observes a torn/partial write, since `rename` within one directory is atomic on the filesystems Concertino targets. This is a weaker guarantee than `O_EXCL`'s "first writer wins outright" for the double-answer race — two dashboards racing to answer the *same* sub-question index could both read-modify-write and the second's write wins — but this is the same single-operator-at-a-time assumption the rest of the escalation screen already makes (there's no existing arbitration for two humans racing the same single-question escalation either, beyond `O_EXCL`'s narrower "who creates the file first" race, which doesn't apply once the file already exists across multiple updates). Documented as an accepted, unchanged-class risk below, not solved here.

### Decision 4: an oversized `sub_questions` payload fails the raise outright, not silently

`write_escalation_raised()` has **two** distinct fallbacks that end in the lossy `write_line` (drops every caller field, writes a bare `{"truncated":true}` marker): (a) the initial "no `context` to blame" check (`core/scripts/emit-event.sh:277-283`, `[ -z "$CONTEXT" ]`), and (b) the end of the binary-search truncation loop (`core/scripts/emit-event.sh:352-364`, reached when a *non-empty* `context` exists but truncating it still can't make the line fit). A guard that only intercepts (a) would still let a caller with a small/trivial `context` alongside a genuinely oversized `sub_questions` array fall through to (b) and silently lose `sub_questions` — for the single-question path today that fallback is already lossy (a caller finds out only because chat itself already saw the question via ESCALATION's own text), but for multi-part it is worse: the resulting event would still be `kind:"escalation.raised"` but carry no question, no options, and no sub-questions at all — an escalation a human cannot answer from the dashboard, indistinguishable in the log from a legitimate `--await` failure.

So the guard is independent of which fallback would otherwise fire: **before** `write_escalation_raised()` attempts any context truncation at all, it checks whether `sub_questions` is present and whether the line already exceeds `MAX_LINE` with `context` entirely removed from consideration (i.e. whether `sub_questions` plus the rest of the non-context fields alone cannot fit). If so, the write fails outright (`return 1`, the same exit-1 contract the pre-existing "no context to blame" branch already has) before either fallback (a) or (b) is ever reached — so a small, legitimately-truncatable `context` can never mask an oversized `sub_questions` payload sneaking through fallback (b). The caller's existing contract already says "bail immediately... let the caller fall back to presenting the escalation in chat" for exactly this case — this just makes the check unconditional on which fallback path a given call would otherwise have taken.

### Decision 5: `--await`'s stdout contract for multi-part is newline-joined sub-answers, in order

Today `--await` prints exactly one line: the single answer text. For multi-part, printing `subAnswers` newline-joined (one sub-answer per line, in the same order as `sub_questions`) keeps the same "read stdout, you get the answer(s)" contract for a caller, without inventing a second output channel. A caller that asked for `N` sub-questions reads back exactly `N` lines, positionally paired with the sub-questions it sent — no re-parsing of a JSON blob required for the common case, though the full JSON is also on disk in `answer.json` for anything that wants structure.

### Decision 6: the wizard's "no jumping ahead" rule is structural, not a validated navigation feature

The escalation screen's render function only ever has access to `run.escalation.subQuestions[state.escalationSubIndex]` — the current step — and `handleKey`'s only sub-question action is "answer the current step, then advance `escalationSubIndex` by exactly one." There is no key binding or action type that accepts an arbitrary target index. "Cannot jump ahead of an unanswered one" is therefore true by construction (nothing in the screen's vocabulary can express a jump), not a range check that could later be bypassed.

### Decision 7: opening (or reopening) a multi-part escalation resumes at the first unanswered step, read back from disk

`escalationSubIndex` cannot simply default to `0` every time `watch.js` opens the escalation screen (`case 'open-escalation':`), because a human can back out (`esc` → fleet) and come back into the *same still-live* escalation after already answering one or more steps, or the dashboard process itself can restart mid-wizard. Defaulting to `0` in either case would silently re-render an already-answered step and let `writeSubAnswer`'s overwrite semantics silently replace a previously-recorded sub-answer with no indication it had already been answered — the same "absent data rendering as healthy data" failure class the ticket is about, just triggered by screen navigation instead of the poll loop.

So `open-escalation`, when the target run's `escalation.subQuestions` is present, calls the new `store.readSubAnswers(root, ticket)` (Decision 2) and sets `escalationSubIndex` to the index of the first `null` slot in the returned `subAnswers` (or `0` when the file doesn't exist yet — nothing has been answered). This is a read, not a second write path, and it changes nothing about how an answer is recorded — only which step the wizard opens on. The single-question path is unaffected: it has no `subQuestions`/`escalationSubIndex` concept to restore.

## Risks / Trade-offs

- [Two dashboards/humans race to answer the same multi-part escalation] → accepted, unchanged-class risk (Decision 3); last write to a given sub-question index wins, but the file is always structurally valid JSON for `--await`'s reader — never torn. Decision 7 closes the *single-operator reopen* case (no silent overwrite from simply backing out and back in) but not genuine concurrent access from two dashboards open on the same escalation at once.
- [A `sub_questions` payload plus its per-sub-question options is large enough to blow the 4000-byte event-line cap] → the raise fails outright rather than silently dropping sub-questions (Decision 4, now checked independently of whether `context` is also present); the existing orchestrator-level fallback (present the escalation in chat) already exists for exactly this failure shape.
- [A pre-existing dashboard build/consumer that only knows the single-question shape sees a `sub_questions`-only escalation with no top-level `question`] → out of scope for this change to backfill; `escalation.js`'s render function branches on `esc.subQuestions` presence and only degrades to the single-question rendering when it's absent, so a mixed-version dashboard simply wouldn't show the new field until this change ships everywhere it's read.
