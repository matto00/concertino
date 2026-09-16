## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All three ACs addressed explicitly. AC3's reworded invariant (a timeout followed by a
  same-`escalation_id` late chat answer is NOT a violation) is implemented in
  `lib/ui/screens/fleet/metrics.js::buildEscalationHistory` — a later `escalation.answered`
  for an id already timed out overwrites `timedOut: false`, `resolutionChannel`, and
  `decision` on the SAME history entry. Directly covered by a dedicated
  `test/fleet.test.js` test, re-run fresh (365/365 pass) and confirmed to actually catch
  a mutation (see Phase 2 below).
- No AC silently reinterpreted; premise-validation findings from ticket.md (the
  already-fixed multi-part emitter, the narrower chat-fallback gap) are correctly
  reflected — the diff does not "re-fix" `write_sub_answers`/`answer.js`'s
  already-correct one-event-per-completion behavior, it only adds id/channel fields.
- `tasks.md` fully checked off and matches what's implemented — verified against the
  diff task-by-task (see Phase 2 findings below for the per-site verification).
- Scope: touched files match `files-modified.md`'s account exactly (21 files,
  +1278/-93, confirmed via `git diff --stat` against the LIVE-resolved base). The
  CON-189 boundary is honored — `read_raised_field()` was moved/extended (the one
  explicitly allowed shared-surface touch) and the verdict-path/`build_line`/
  `write_line` machinery is untouched.
- No regressions: full `npm test` reaches 2317/2317 pass, exit 0 (see Phase 2).
- API/schema contracts: new `openspec/changes/.../specs/` deltas
  (`escalation-resolution-telemetry`, `escalation-answer-cli`,
  `fleet-metrics-escalation-history`) are present, ADDED requirements, and match the
  implemented behavior scenario-by-scenario (spot-checked against the diff).
- Planning artifacts (proposal/design/tasks) reflect final behavior; `design.md`'s
  9 decisions were each traced to a corresponding code site and hold.
- `workflow-state.md` CONSTRAINTS (C1/C2/C3) honored: no real `concertino sync` was run
  by the executor (render lockstep verified via byte-identical blob hash, not a real
  sync); `openspec validate`/`test:selftest` are not cited as evidence in
  `files-modified.md`; `npm test` was run with the required long timeout and read to its
  own summary line by both the executor's account and my own independent re-run.

### Phase 2: Code Review — PASS

**Fresh gate re-run (never trusted the executor's report):**

- `bash test/scripts/rendered-scripts-drift.test.sh` → 19 passed, 0 failed. Independently
  confirmed `git hash-object core/scripts/emit-event.sh scripts/concertino/emit-event.sh`
  returns the identical blob `32547f873b915c097b6126656240fa262f8d6287` for both files,
  both mode 100755.
- `bash test/scripts/emit-event.test.sh` → 101 passed, 0 failed (matches claim).
- `bash test/scripts/escalation-loop.test.sh` → 68 passed, 0 failed (matches claim).
- `bash test/scripts/escalation-raise-wait.test.sh` → 29 passed, 0 failed (matches claim).
- `node --test test/answer.test.js` → 25/25 (matches claim).
- `node --test test/reducer.test.js` → 64/64 (matches claim).
- `node --test test/fleet.test.js` → 365/365 (matches claim).
- Full `npm test` (600000ms timeout, run in background per C3, read to its own final
  summary line, never `-n`) → `# tests 2317 / # pass 2317 / # fail 0`, process exit 0.
  Exact match to the executor's claim.

**Focus-area verification:**

1. AC3 timeout-then-late-answer: confirmed in `metrics.js` (see above) and the dedicated
   test `metricsFor.recentEscalations: a timeout followed by a late answer on the SAME
   escalation_id reports the answer, timedOut: false (AC3)` — read directly, asserts
   `resolved: true`, `timedOut: false`, `decision: 'late-chat-answer'`,
   `resolutionChannel: 'chat'`. Passes.
2. Every resolution write site carries `escalation_id`, confirmed by reading
   `core/scripts/emit-event.sh` directly:
   - `escalation.answered` single-question (`try_resolve`, ~line 854-869): id via
     `read_raised_field escalation_id`, plus `resolution_channel=dashboard`,
     `answer_source=human`. Confirmed.
   - `escalation.answered` multi-part (`try_resolve`'s `write_sub_answers`-equivalent
     block, ~line 815-829): same three fields, one event, `sub_answers` array intact.
     Confirmed.
   - `escalation.timeout` at THREE sites: `--wait-only`'s deadline check (~line
     921-928), `on_kill` trap (~line 1010-1016), and `--await`'s bottom-of-script
     timeout (~line 1039-1044). All three add `escalation_id` only, no
     `resolution_channel` — matches design.md Decision 4. Confirmed all three
     independently by reading each site.
   - `escalation.answer_discarded` (`discard_stale_answer`, ~line 607-614): id added,
     relies on in-process `ESCALATION_ID` (correct — this function only runs immediately
     after this same process's own raise). Confirmed.
   - `escalation.malformed` (~line 793-805): id via `read_raised_field` (correct — this
     path can run in a separate `--wait-only` poller process that never raised in this
     process). Confirmed.
3. Oversized-line rebuild paths: `ESCALATION_ID` is generated once, before
   `write_escalation_raised()` is invoked, and folded into BOTH `$FIELDS` and
   `$OTHER_FIELDS`. Every rebuild branch inside `write_escalation_raised()` (the
   sub_questions-too-big bail, the no-context fallback, and the binary-search
   truncation loop) rebuilds its candidate line starting from `$OTHER_FIELDS`, which
   already contains `escalation_id` — read the full function body and confirmed the id
   is never dropped on any of the three fallback paths.
4. `read_raised_field()` move: now defined at top level, right after `now_ms()`/before
   `write_escalation_raised()`, and the old in-branch definition inside `--wait-only` was
   deleted with only a pointer comment left behind. Confirmed via diff that its body is
   byte-identical to the pre-existing `--wait-only` version except for the added
   `escalation_id` branch — no logic changed in the move itself, only its scope and one
   new field. `--wait-only`'s own callers (`RAISED_AT=`, sub_questions detection) are
   unchanged in call shape. No evidence of anything relying on the old nested scoping
   (bash function definitions are visible repo-wide within the same script regardless of
   textual position, once execution reaches that point — and every caller executes after
   the definition point in all three modes).
5. `resolution_channel` validation (`core/scripts/emit-event.sh`'s generic k=v loop,
   ~line 279-296): rejects any value not in
   `dashboard|cli|chat|self-approved` with a named-values error message and `exit 1`,
   BEFORE `FIELDS`/`OTHER_FIELDS` are touched and before any write — confirmed by
   reading the case statement's position relative to the write path. `answer_source`
   derivation in `lib/cli/answer.js` (`channel === 'self-approved' ? 'agent-default' :
   'human'`) matches design.md Decision 6 exactly, applied identically at both
   `recordAnswered()` call sites.
6. Backward compatibility: `metrics.js`'s `byId`/`open`-pointer split correctly
   degrades id-less raise/resolve pairs to the pre-existing positional pairing (own
   dedicated test, passing), and an id-bearing resolution whose id matches no raise is
   ignored outright rather than falling back positionally (own dedicated test, passing).
   `readEscalationShape()` and `reducer.js` both default to `null` rather than throwing
   or fabricating a value on an id-less raise.
7. Real tests, not guards that can't fail: mutated `lib/ui/screens/fleet/metrics.js`
   myself (commented out `target.timedOut = false;` in the id-based answered-event
   branch) and re-ran `test/fleet.test.js` — exactly 1 of 365 tests went red (the AC3
   timeout-then-late-answer test), everything else stayed green. Confirms the test
   suite actually exercises the behavior it claims to and isn't vacuous. File restored
   afterward and diff re-confirmed clean (`git diff --stat` empty for that file).
8. CONTRIBUTING.md conformance: comment-heavy provenance style with ticket ids
   (`CON-188 task 3.x`, `design.md Decision N`) followed throughout the diff, matching
   the repo's documented convention; no runtime dependency added (`random_hex()` reuses
   the already-hard-dependency `node`, same pattern as the pre-existing
   `utf8_safe_prefix`); changes are behavior-preserving except where the ticket
   explicitly calls for new behavior; no dead code, no leftover TODO/FIXME found in the
   diff.

No DESIGN.md check applies — this is not a `frontend/**` change (project has no
browser frontend; DESIGN.md is a helio-repo standard, not applicable here).

### Phase 3: UI Review — N/A

No `frontend/**`-equivalent surface changed in the web-UI sense. Per the task brief,
Concertino has no browser frontend; the terminal-dashboard-affecting files
(`lib/ui/reducer.js`, `lib/ui/screens/fleet/metrics.js`) were reviewed as ordinary code
in Phase 2 (pure-function modules with their own `node --test` unit coverage, per this
repo's own documented testing pattern) rather than started as dev servers — no dev
server exists for this project's TUI, and none was started, per the task brief's
explicit instruction.

### Overall: PASS

### Non-blocking Suggestions

- None of substance. The `read_raised_field()` field dispatch (`if/else if/else`
  defaulting silently to `sub_questions` for any unrecognized third arg) is a
  pre-existing pattern this diff extended rather than introduced — worth tightening to
  an explicit `else` branch with an error if a fourth field is ever added, but out of
  scope for this ticket.
