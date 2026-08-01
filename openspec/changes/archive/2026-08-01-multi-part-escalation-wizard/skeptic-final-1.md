## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Ground truth re-established, not trusted from prior reports.**
   - Read `ticket.md`, `design.md` (Decisions 1-7), `tasks.md`, `spec.md`, `files-modified.md`, `evaluation-1.md` directly from `WORKTREE_PATH`.
   - `git log --oneline -5` confirms commit `4d35232` is the executor's commit, on top of `fb40cf6` (CON-48, unrelated, already on `main`).
   - `git diff main...HEAD --stat` (excluding `openspec/`) touches exactly the 9 files listed in `files-modified.md`: `core/roles/orchestrator.md`, `core/scripts/emit-event.sh`, `lib/ui/reducer.js`, `lib/ui/screens/escalation.js`, `lib/ui/store.js`, `lib/ui/watch.js`, `test/escalation.test.js`, `test/reducer.test.js`, `test/scripts/escalation-loop.test.sh`. No scope creep.

2. **The core correctness requirement — traced to actual code, not asserted:**
   - `lib/ui/store.js:258-296` (`writeSubAnswer`): writes `{ subAnswers, total, complete }` with `complete = subAnswers.length === total && subAnswers.every((a) => a != null)` — an explicit boolean, not inferred from array shape alone. Refuses to overwrite an already-answered slot (`subAnswers[index] != null` -> `reason: 'answered'`).
   - `core/scripts/emit-event.sh:492-524` (the multi-part poll branch): resolves **only** when `a.complete === true` (read directly from the node snippet) — a parseable-but-incomplete file produces no output from the `node -e` and the shell loop simply `sleep 1`s again. It does **not** re-derive completeness from `subAnswers.length`.
   - `lib/ui/watch.js:1146-1161` (`answerEscalationSub`): only calls `backToFleet()` when `result.complete === true`; any other successful write stays on the escalation screen and advances `escalationSubIndex` by exactly one.
   - `lib/ui/screens/escalation.js:238-286` (`handleKey`): the wizard's only sub-question action is `answer-sub` for the *current* `subIndex`; grepped the whole `lib/ui/` tree for `answer-sub`/`escalationSubIndex` writers — the only places that set `escalationSubIndex` are `answerEscalationSub` (index+1, clamped) and `open-escalation`'s resume logic (`store.readSubAnswers` + `resumeSubIndex`). No code path accepts an arbitrary target index — Decision 6's "structural, not validated" claim holds.

3. **Independent live end-to-end reproduction** (not the executor's/evaluator's own tests — a script I wrote and ran myself against a throwaway repo, spawning the real `core/scripts/emit-event.sh escalation --await` as a child process and driving it through the real `lib/ui/reducer.js`, `lib/ui/store.js`, and `lib/ui/screens/escalation.js` modules):
   - `escalation.raised` correctly parsed into `run.escalation.subQuestions` (3 items).
   - Rendered wizard shows step 1 only.
   - Answering step 0 (`writeSubAnswer` via the real handleKey-derived action) yields `complete: false`; pressing a key belonging to a *later* step while on step 0 returns `null` (no-op) — no jump-ahead.
   - After 1/3 and 2/3 answered, waited >1s each time and confirmed the backgrounded `--await` process was still running (`kill -0` succeeded) and no `escalation.answered` had been logged — i.e., "3 of 5"-equivalent state genuinely does not resolve the wait.
   - `readSubAnswers`/`resumeSubIndex` at the 2/3 point correctly identified index 2 as the resume point (simulating a reopen).
   - Answering the 3rd (final) sub-question made `complete: true`; the backgrounded `--await` process then exited 0, printed `"yes\nrename\nship\n"` on stdout (newline-joined, in order), and the log contained exactly one `escalation.answered` event carrying `sub_answers: ["yes","rename","ship"]`.
   - This reproduces, from scratch and independent of the shipped tests, exactly the behavior the ticket's core correctness requirement demands.

4. **Gates re-run fresh, output read myself (not merely trusting the evaluator's paste):**
   - `npm test` → exit 0, `977 passed, 0 failed` (`node --test` + all 16 bash gate scripts).
   - `bash test/scripts/escalation-loop.test.sh` run standalone → `28 passed, 0 failed`, including the two Decision-4 oversized-payload cases and the "incomplete file does not resolve — `--await` is still running" check (verified this check is a real `kill -0` on the backgrounded PID after a live `sleep 2`, not a mocked value).
   - Read `test/escalation.test.js`'s new wizard/store/`resumeSubIndex` tests (lines 317-490) — meaningful, not superficial: they assert exact rendered text per step, exact action shapes, exact file contents after each write, and the no-jump-ahead no-op.

5. **AC-by-AC trace against ticket.md's Scope section:**
   - `escalation.raised` schema extension, additive — `emit-event.sh:220-231` (field-parsing loop adds `sub_questions` alongside `question`/`options`, never replacing); single-question path verified byte-for-byte unchanged by the existing pre-CON-46 tests in `escalation-loop.test.sh` still passing.
   - `answer.json` checkable-completeness shape — `store.js` as above.
   - Wizard step-through UX, no jump-ahead, per-step free text — `escalation.js` as above; free-text confirmed to route through the same `answer-sub` action (line 260).
   - `--await`'s poll loop distinguishes incomplete/complete — confirmed both by code reading and live reproduction.
   - Documentation — `core/roles/orchestrator.md:543-568` documents the `sub_questions=` form.
   - Decision 7 (resume-at-first-unanswered-step) — `watch.js:1472-1498`, confirmed live.

6. **UI/design judgment (Step 4 of my instructions):** N/A per this project's Setup — no design standard and no UI review configured for Concertino. Not applicable; skipped per instructions rather than guessed.

### Verdict: CONFIRM

The implementation matches design.md's Decisions 1-7 faithfully, every ticket AC traces to real, exercised code, the regression suite is meaningful (verified by reading it and by an independent from-scratch reproduction of the exact "N of M answered never resolves; M of M resolves, in order" behavior), the byte-cap oversized-payload guard (Decision 4) is exercised by both required cases, and the diff shows no scope creep beyond the 9 files the change legitimately needed to touch. All gates re-run fresh here (977/977 node tests, 28/28 escalation-loop bash tests) pass. This ships.

### Non-blocking notes
- `lib/ui/store.js:230-236`'s `readAnswerFileRaw` has an unused `catch (e)` binding (evaluator already flagged this; harmless, no lint gate configured).
- `writeSubAnswer`'s fallback-to-fresh-nulls when a stale `answer.json`'s `subAnswers.length !== total` (store.js:273-275) is a defensive branch that shouldn't be reachable in practice (a live escalation's `total` is fixed for its lifetime) but is worth a one-line comment noting it would silently discard any previously-recorded answers if it ever did fire — not blocking, since nothing in the current design can trigger it.
