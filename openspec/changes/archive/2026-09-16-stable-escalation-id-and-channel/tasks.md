## 1. Raise-side: generate the id

- [x] 1.1 In `core/scripts/emit-event.sh`, generate an `escalation_id` (`<TICKET>-<epoch_ms>-<hex>`, design Decision 1) once per raise and write it onto the `escalation.raised` line from `write_escalation_raised()`, so it is present on BOTH the `--await` and `--raise-only` paths. Verify: raise via each mode in a scratch repo and confirm with `jq` that both lines carry a non-empty `escalation_id`, and that two raises in the same second differ.
- [x] 1.2 Confirm the id survives the oversized-line fallbacks in `write_escalation_raised()` (the context-truncation and no-context rebuild paths rebuild the line — the id must not be dropped there). Verify: raise with an oversized `context` and confirm the resulting line still carries `escalation_id` while `context` is truncated.
- [x] 1.3 Verify the multi-part raise carries exactly ONE id for the whole escalation: raise with a 3-entry `sub_questions` array and confirm exactly one `escalation.raised` line with one `escalation_id`.

## 2. Read-back helper

- [x] 2.1 Extend `read_raised_field()` in `core/scripts/emit-event.sh` to serve `escalation_id` alongside `raised_at`/`sub_questions`, reading the LAST `escalation.raised` for the ticket. Verify: a unit-style shell check reads back the id of the most recent of two raises, not the first.
- [x] 2.2 Make the helper return empty (not an error) when no `escalation.raised` exists for the ticket, so Decision 3's omit-the-field behavior is reachable. Verify: call it against a ticket with no raise and confirm empty output and a zero exit.

## 3. Resolution-side: id, channel, source in `emit-event.sh`

- [x] 3.1 Add `escalation_id` to the `escalation.answered` write in the single-question resolve path, with `resolution_channel=dashboard` and `answer_source=human` (Decision 4/6 — this path resolves by observing `answer.json`, the dashboard's write path). Verify: resolve a raise via a written `answer.json` and confirm all three fields on the emitted event.
- [x] 3.2 Add the same three fields to the multi-part `write_sub_answers` resolve path, keeping exactly one emitted event carrying the full `sub_answers` array. Verify: fully answer a 3-part escalation and confirm exactly one `escalation.answered` with the parent id and 3 sub-answers.
- [x] 3.3 Add `escalation_id` (and NO `resolution_channel`) to the `escalation.timeout` write in the `--wait-only`/`--await` deadline paths. Verify: let a raise reach its deadline and confirm the timeout event has the id and no `resolution_channel` key.
- [x] 3.4 Add `escalation_id` to the `escalation.answer_discarded` and `escalation.malformed` writes. Verify: trigger the stale-answer discard and a malformed multi-part `answer.json`, and confirm each event carries the id.
- [x] 3.5 Validate any caller-supplied `resolution_channel` against the four legal values, failing non-zero with a message naming them before writing anything. Verify: an illegal value exits non-zero and appends no event; each legal value is accepted.
- [x] 3.6 Confirm a resolution written for a ticket with no prior raise still appends, with no `escalation_id` key present (Decision 3). Verify: emit a resolution against a raise-less ticket and confirm the event exists and has no `escalation_id` field.

## 4. Chat channel in `concertino answer`

- [x] 4.1 Extend `readEscalationShape()` in `lib/cli/answer.js` to also return the raise's `escalation_id`. Verify: `test/answer.test.js` case asserting the id is read from the most recent raise.
- [x] 4.2 Add a `--channel=<dashboard|cli|chat|self-approved>` selector defaulting to `cli`, refusing an unrecognized value non-zero BEFORE any `answer.json` or event write. Verify: tests covering the default, an explicit `chat`, and a refused bogus value that leaves both files untouched.
- [x] 4.3 Pass `escalation_id`, `resolution_channel` and the channel-derived `answer_source` (Decision 6) through `recordAnswered()` on both the single-question and multi-part-completion paths, leaving the partial-sub-answer and refused-write paths emitting nothing. Verify: tests asserting the emitted event's fields for each path, and that a partial/refused write still emits nothing.

## 5. Consumers

- [x] 5.1 In `lib/ui/screens/fleet/metrics.js`, pair raises to resolutions by `escalation_id` when both carry one, keeping the existing most-recently-opened event-order pairing as the id-less fallback, and ignore a resolution whose id matches no raise. Verify: tests for the interleaved-escalations case (answer to `X` arriving after `Y` was raised closes `X`, not `Y`), the id-less log, and the unmatched-id resolution.
- [x] 5.2 Expose `resolutionChannel` on each history entry and make `timedOut` true only when no answer was ever recorded for that id — a timeout followed by an answered for the same id reports the answer with `timedOut: false`. Verify: tests for the timeout-then-chat-answer sequence and for a genuinely unanswered timeout.
- [x] 5.3 Carry `escalation_id` onto the live escalation object in `lib/ui/reducer.js`'s `escalation.raised` case, leaving its existing clear-on-resolution behavior unchanged. Verify: `test/reducer.test.js` case asserting the id is present on `run.escalation` and that resolution still clears it.

## 6. Role prose

- [x] 6.1 Replace the raw hand-composed `emit-event.sh escalation.answered` chat-fallback instruction in `core/roles/orchestrator.md` with the `concertino answer ... --channel=chat` invocation, while still documenting it as a manual fallback (Decision 8 — keeps `escalation-trust-offramp` true). NOTE: the design gate confirmed only ONE such raw call exists, at roughly `core/roles/orchestrator.md:1698-1701` (the `--await`-timed-out-then-chat-answer branch); the `TUI_ATTACHED=0` branch (~1584-1591) and the chat-reply-during-await branch (~1802-1808) ALREADY call `concertino answer` and need only the `--channel=chat` selector added, not a rewrite. Verify: grep `core/roles/orchestrator.md` itself for any remaining instruction to hand-compose an `escalation.answered` event (expect zero), and confirm each chat branch names the channel selector. Do NOT verify by grepping a "rendered role" in this checkout — see constraint C1.

## 7. Render lockstep and gates

- [x] 7.1 Re-render `core/scripts/emit-event.sh` to its ONE tracked, byte-compared render target, `scripts/concertino/emit-event.sh` (mode 0755), without sweeping unrelated regenerated files into the diff. `core/roles/orchestrator.md` has NO tracked render target in this repo — the harness agent directories (`.claude/agents/`, `.codex/roles/`, `.opencode/agents/`) are gitignored — so there is no role-render diff to produce or inspect, and none should be created. Verify: `bash test/scripts/rendered-scripts-drift.test.sh` reports no content mismatch, and `git status` shows only intended files.
- [x] 7.1a If you need to confirm the orchestrator-role prose renders correctly, do it with a SCRATCH `--out` sync only — `node bin/concertino sync --out=<scratch-dir> --config=<cfg>`, then grep the scratch-rendered file. For `<cfg>` use `config/examples/concertino.json` (or `config/examples/helio.json`) — both are tracked and verifiably present in this worktree. Do NOT expect a `concertino.config.json` in the worktree: it is gitignored/untracked (CON-70) and exists only in the main checkout, so a worktree does not inherit it. (Round 1 called it absent, the orchestrator "corrected" that from the main checkout, and round 2 established round 1 was right for the worktree — this clause records the settled answer.) The `--out=<scratch-dir>` is the load-bearing part, not which config — following the existing pattern in `test/scripts/openspec-validate-cmd.test.sh`. Verify: the scratch-rendered orchestrator file contains the `--channel=chat` instruction and no hand-composed `escalation.answered` call, and `git status` in the worktree is unchanged by this check (constraint C1).
- [x] 7.2 Run the escalation-focused script suites: `bash test/scripts/emit-event.test.sh`, `bash test/scripts/escalation-loop.test.sh`, `bash test/scripts/escalation-raise-wait.test.sh`. Verify: all pass, with the new assertions included.
- [x] 7.3 Run the full suite with an explicit long timeout (`npm test`, never `-n`, `timeout: 600000`) and confirm it reaches its own summary line rather than being read half-finished. Verify: the run's final summary shows no failures attributable to this change; compare any failure against a pristine checkout of the base SHA before treating it as this change's bug (CI has been red on process-teardown assertions since 2026-09-11, CON-196).
- [x] 7.4 Re-run `openspec validate stable-escalation-id-and-channel --type change` and READ its output, not just its exit code (CON-197: it can exit 0 while reporting errors). Verify: the output reports no validation errors.

## 8. Acceptance-criteria verification

- [x] 8.1 Demonstrate AC1 end-to-end in a scratch run: every `escalation.raised` carries an `escalation_id` and every resolution references one. Verify: a transcript showing the raise and each resolution kind with matching ids.
- [x] 8.2 Demonstrate AC2: a raise whose answer is collected in chat produces `escalation.answered` with `resolution_channel: "chat"`, not `escalation.timeout` alone. Verify: a transcript of the raise, the chat-channel answer, and the resulting event.
- [x] 8.3 Demonstrate AC3: `#raises == #resolutions` per run for non-multi-part escalations, and a multi-part raise resolves exactly once. Verify: a transcript counting both kinds over a scratch run's `events.jsonl` by id.

## 9. Final-gate round 1: committed shell-level coverage (constraint C4)

The final gate REFUTED because `core/scripts/emit-event.sh` — the file this ticket
targets — has ZERO committed coverage of its new logic. Every new test added in cycle 1
tests a CONSUMER (`test/answer.test.js`, `test/fleet.test.js`, `test/reducer.test.js`)
against hand-authored fixture events that already assume the fields are well-formed.
The reviewer confirmed the behavior by manual throwaway reproduction; that never runs
again, so `random_hex()`, the validation `case`, or any of the three timeout sites could
silently regress with `npm test` still fully green.

Add COMMITTED assertions that invoke the REAL script and inspect its REAL output. Each
must be red-before-green: prove it fails against the pre-fix script (e.g. via
`git stash`/`git show HEAD:<path>`), not merely that it passes now.

- [x] 9.1 In `test/scripts/emit-event.test.sh`: a real `--raise-only` (and `--await`) invocation logs an `escalation.raised` carrying a well-formed `escalation_id` matching the documented `<TICKET>-<epoch_ms>-<hex>` shape. Verify: assertion fails against the pre-fix script, passes after.
- [x] 9.2 In `test/scripts/emit-event.test.sh`: each of the THREE `escalation.timeout` write sites — `--wait-only`'s real-deadline check, the `on_kill` trap, and `--await`'s bottom-of-script timeout — emits a line carrying `escalation_id` and NO `resolution_channel`. Cover all three distinctly; do not let one site's pass stand in for the others. Verify: each assertion individually red before green.
- [x] 9.3 In `test/scripts/emit-event.test.sh`: `discard_stale_answer()`'s `escalation.answer_discarded` line carries `escalation_id`. Verify: red before green.
- [x] 9.4 In `test/scripts/emit-event.test.sh`: a bogus `resolution_channel=` value is refused with a non-zero exit, a message naming the legal values, and NO event line and NO run dir written (refused before any write). Verify: assert on the absence of the write, not only on the exit code; red before green.
- [x] 9.5 In `test/scripts/emit-event.test.sh`: the moved-to-top-level `read_raised_field()` correctly resolves `escalation_id`, `raised_at` and `sub_questions` from every one of the three modes that now share it (`--await`, `--raise-only` + later `--wait-only`, and the resolve path), including returning empty (not an error) when no raise exists. Verify: red before green where applicable.
- [x] 9.6 In `test/scripts/escalation-loop.test.sh` (the end-to-end suite whose own header calls it "the one test that proves the two halves actually fit together"): a dashboard-resolved answer emits `escalation.answered` carrying `escalation_id`, `resolution_channel: "dashboard"` and `answer_source: "human"`; and a multi-part completion carries the parent `escalation_id` with exactly one event. Verify: red before green.
- [x] 9.7 Re-run the full suite (`npm test`, 600000 ms timeout, never `-n`, read the final summary line) plus `bash test/scripts/rendered-scripts-drift.test.sh`. Verify: all green, and the render pair still shares one blob hash. Do NOT cite `openspec validate` or `test:selftest` as evidence (C2).

## Standing Constraints

- [C1] Never run a real (non-`--dry-run`, non-`--out`) `concertino sync` against this checkout or worktree. Verify any render-target or role-prose question with a scratch `--out` sync into a throwaway directory (the `test/scripts/openspec-validate-cmd.test.sh` pattern), or by reading `core/` directly. A real sync writes into gitignored harness directories and can sweep unrelated regenerated files into the diff. (Agreed at the design gate, round 1.)
- [C2] `openspec validate` and `npm run test:selftest` are NOT evidence. `validate --change` exits 0 while printing "unknown option" (CON-197) and `test:selftest` is a `--dry-run` that asserts nothing (CON-142). Cite a real red-then-green test or a transcript instead. (Agreed at Planning, carried from the delivery brief.)
- [C4] Shell-level behavior in `core/scripts/*.sh` requires COMMITTED, repeatable assertions in `test/scripts/` that invoke the real script and inspect its real output. A reviewer's manual throwaway reproduction is not coverage — it never runs again. JS consumer tests against hand-authored fixture events do not cover the emitter that produces those events. (Agreed at the final gate, round 1.)
- [C3] `npm test` is one serial ~50-suite chain: always pass a 600000 ms timeout and never `-n`. A shorter timeout silently backgrounds the run and a half-finished log reads as a pass. (Agreed at Planning, carried from the delivery brief.)
