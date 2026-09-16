# Files modified — CON-188

Enumerated against the LIVE-resolved review base (`resolve-review-base.sh`),
BASE_SHA `4965929b96670ad7c7aecbe39864f9a1c7e61127`.

- `core/scripts/emit-event.sh` — render SOURCE. Generates `escalation_id`
  (`<TICKET>-<epoch_ms>-<hex>`) once per raise, folded into both `FIELDS` and
  `OTHER_FIELDS` so it survives the oversized-line rebuild paths. Adds
  `resolution_channel` validation (four legal values, refused non-zero before
  any write) to the generic k=v argument loop. Moves `read_raised_field()` to
  top level (was previously nested inside the `--wait-only` branch only) and
  extends it to serve `escalation_id` alongside `raised_at`/`sub_questions`,
  so `try_resolve()` and every timeout/discard/malformed write site can read
  it back regardless of which process (raiser vs. a later `--wait-only`
  poller) is doing the resolving. Adds `escalation_id`/`resolution_channel:
  "dashboard"`/`answer_source: "human"` to both `escalation.answered` write
  sites in `try_resolve()` (single-question and multi-part). Adds
  `escalation_id` only (no `resolution_channel`) to all three
  `escalation.timeout` write sites (`--wait-only`'s deadline check, `on_kill`,
  and `--await`'s own bottom-of-script timeout). Adds `escalation_id` to
  `escalation.answer_discarded` and `escalation.malformed`.
- `scripts/concertino/emit-event.sh` — byte-identical re-render of the above
  (`test/scripts/rendered-scripts-drift.test.sh` verified green).
- `core/roles/orchestrator.md` — replaces the one raw hand-composed
  `emit-event.sh escalation.answered` chat-fallback call (the root
  `TUI_ATTACHED=1` `--await`-timeout branch, ~line 1699 pre-change) with
  `concertino answer ... --channel=chat`, documented as the same manual
  fallback with a different mechanism (keeps `escalation-trust-offramp`
  true per design.md Decision 8). Adds `--channel=chat` to the two branches
  that already called `concertino answer` (`TUI_ATTACHED=0` and the
  chat-reply-during-`--await` branch). Updates one stale cross-reference
  paragraph that described the root `--await`-timeout fallback as "still
  uses a raw emit-event.sh call" now that it doesn't.
- `lib/cli/answer.js` — `readEscalationShape()` now also returns the raise's
  `escalation_id` (null when absent). `cmdAnswer()` gains a `--channel=
  <dashboard|cli|chat|self-approved>` selector, defaulting to `cli`, refused
  non-zero before any `answer.json`/event write on an unrecognized value.
  `answer_source` is derived from the channel (`self-approved` →
  `agent-default`, everything else → `human`), never supplied independently.
  Both `recordAnswered()` call sites (single-question and the multi-part
  completing write) now pass `resolution_channel`/`answer_source`, plus
  `escalation_id` when the raise carried one. The partial-sub-answer and
  refused-write paths are unchanged (still emit nothing).
- `lib/ui/reducer.js` — `escalation.raised` case carries `escalationId` onto
  `run.escalation` (`ev.escalation_id` or `null`); resolution still clears
  `run.escalation` unconditionally, unchanged.
- `lib/ui/screens/fleet/metrics.js` — `buildEscalationHistory()` rewritten to
  pair a raise to its resolution by `escalation_id` via a `Map` (never
  removing an entry once closed, so a late chat answer after a timeout can
  still update the SAME entry — AC3's explicit non-violation case), falling
  back to the pre-existing positional `open`-pointer pairing only for
  id-less (pre-CON-188 or straddling-upgrade) events. A resolution whose id
  matches no known raise is ignored outright rather than falling back
  positionally. Each history entry gains `resolutionChannel` (from
  `escalation.answered`'s `resolution_channel`, or `null`); `timedOut`
  reports `false` whenever a later answer for the same id superseded an
  earlier timeout.
- `test/answer.test.js` — 6 new CON-188 tests: default channel is `cli`;
  `--channel=chat` carries `resolution_channel`/`answer_source` and the
  raise's `escalation_id`; `--channel=self-approved` derives
  `answer_source=agent-default`; a bogus `--channel` is refused before any
  write (no `answer.json`, no event); multi-part completion carries the
  parent `escalation_id`; a raise-less resolution carries no `escalation_id`
  key at all.
- `test/fleet.test.js` — updated one pre-existing `deepEqual` assertion to
  include the new `escalationId`/`resolutionChannel` fields (the entry
  shape changed additively). Added 5 new CON-188 tests: id-based pairing
  does not misattribute an answer to a more-recently-raised entry (the
  defect this ticket exists to fix); id-less events still pair positionally
  (fallback); an unmatched `escalation_id` is ignored, not misattributed;
  the timeout-then-late-chat-answer sequence reports the answer with
  `timedOut: false` (AC3's explicit case); a genuinely unanswered timeout
  stays `timedOut: true` with `resolutionChannel: null`.
- `test/reducer.test.js` — 3 new CON-188 tests: `escalation_id` surfaces on
  `run.escalation` as `escalationId`; absent on a pre-CON-188 raise (stays
  `null`); resolution still clears `run.escalation` including its
  `escalationId`.
- `openspec/changes/stable-escalation-id-and-channel/` — the full planned
  change (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/**`,
  `workflow-state.md`, `.openspec.yaml`, `skeptic-design-{1,2}.md`) was
  present in the worktree but never committed; committed here as part of
  this same delivery. `tasks.md` has every task checked off.

## Not touched (scope discipline, CON-189 note)

CON-189 owns the verdict event path of the same `emit-event.sh` file. This
change touched only: the escalation raise/resolution paths, and
`read_raised_field()` (moved and extended, per design.md's explicit
allowance — "kept deliberately out of shared surfaces beyond that helper").
The generic `build_line`/`write_line` machinery and the `verdict`-kind
handling (`head_sha`/`head_sha_source`, the auditor-lease release) are
byte-for-byte unchanged. No refactor of either was attempted even where one
might have been tempting (e.g. `read_raised_field` and the verdict path's
own "read the log back" pattern are structurally similar) — flagged here
for CON-189, not folded in.

## Final-gate round 1 (constraint C4): committed shell-level coverage

The round-1 skeptic REFUTEd on evidence, not behavior: every new assertion in
cycle 1 exercised a *consumer* (`test/answer.test.js`, `test/fleet.test.js`,
`test/reducer.test.js`) against hand-authored fixture events, and the
skeptic's own confirmation of `core/scripts/emit-event.sh`'s new logic was
manual/throwaway (never runs again). Added COMMITTED, repeatable assertions
against the REAL script's REAL output:

- `test/scripts/emit-event.test.sh` — 26 new assertions (94→127 in that
  suite's first block; unaffected `head_sha` block unchanged), covering:
  task 9.1 (`--raise-only`/`--await` raise a well-formed `<TICKET>-<epoch_ms>-
  <hex>` `escalation_id`, and two same-process raises get distinct ids);
  task 9.2 (all three `escalation.timeout` sites — `--wait-only`'s
  real-deadline check, the `on_kill` TERM trap, and `--await`'s
  bottom-of-script timeout — each individually asserted to carry
  `escalation_id` and NO `resolution_channel` key); task 9.3
  (`escalation.answer_discarded` carries the id); task 9.4 (a bogus
  `resolution_channel` is refused non-zero, names the legal values on
  stderr, and — asserted on absence, not just the exit code — creates
  NEITHER a run directory NOR an event line; the four legal values are
  separately asserted to be accepted and recorded verbatim); task 9.5 (the
  moved-to-top-level `read_raised_field()` is exercised CROSS-PROCESS — a
  `--raise-only` call in one process, resolved later by a separate
  `--wait-only` process, must read back the same `escalation_id` and the
  correct `sub_questions`/`total` — plus the no-prior-raise case returning
  empty, not an error).
- `test/scripts/escalation-loop.test.sh` — 6 new assertions (68→74) added to
  the existing real-`--await`-plus-real-dashboard-writer flow: a
  single-question dashboard resolution carries the SAME non-empty
  `escalation_id` as its raise, `resolution_channel: "dashboard"`, and
  `answer_source: "human"`; a multi-part completion carries the SAME
  non-empty parent `escalation_id` (the existing "exactly one
  escalation.answered" assertion already covers the resolves-once half).

### Per-assertion red-before-green record

All new assertions were proven red by reverting `core/scripts/
emit-event.sh` to `git show HEAD~1:core/scripts/emit-event.sh` (the
pre-CON-188 committed version) in place, running the suite, then restoring
the fixed version and re-verifying the render pair (`git hash-object`) still
shares one blob hash before re-running green.

- `test/scripts/emit-event.test.sh`: 12 of the 26 new assertions failed
  red (`--raise-only`/`--await` id-shape, distinct-ids, all three timeout
  sites' id assertions, `answer_discarded`'s id, all four
  `bogus resolution_channel` assertions, the cross-process
  `read_raised_field` id match). The other 14 (each timeout site's
  "NO resolution_channel key", the four "legal channel accepted/recorded"
  pairs, "sub_questions total=2", and the two no-prior-raise checks) were
  already true pre-fix by construction (a field that was never added can't
  be present; a value the pre-fix script never validated was always
  "accepted"; a raise-less resolution never had an id to omit) — these are
  documented, not silently smuggled in as if red-proven. The two
  "SAME escalation_id" comparisons were initially written as two separate
  non-empty + equality checks and found to pass VACUOUSLY pre-fix
  (empty === empty); rewritten as single combined non-empty-AND-equal
  assertions before being accepted as evidence — see the two
  `escalation-loop.test.sh` entries below for the same fix.
  94 passed/0 failed → (revert) 115 passed/12 failed → (restore) 127
  passed/0 failed.
- `test/scripts/escalation-loop.test.sh`: all 6 new assertions failed red
  (`raise carried a non-empty escalation_id` ×2, the two combined
  SAME-NON-EMPTY-id checks, `resolution_channel=dashboard`,
  `answer_source=human`). The initial versions of the two "SAME id" checks
  compared the raise's id string directly against the answered event's id
  string — both would be `""` pre-fix, so an early draft of this check
  passed vacuously; rewritten into one combined node script asserting
  non-empty AND equal, re-verified red (fails on `!!rid` being false) before
  being accepted. 68 passed/0 failed → (revert) 68 passed/6 failed →
  (restore) 74 passed/0 failed.

### Post-fix full verification

- `bash test/scripts/rendered-scripts-drift.test.sh` → 19 passed, 0 failed.
- `git hash-object core/scripts/emit-event.sh scripts/concertino/emit-event.sh`
  → both `32547f873b915c097b6126656240fa262f8d6287` (render pair still
  byte-identical).
- `bash test/scripts/escalation-raise-wait.test.sh` → 29 passed, 0 failed
  (unchanged, sanity-rerun).
- Full `npm test` (`timeout: 600000`, never `-n`, final summary read, not
  just exit code): exit 0; `node --test`: `# pass 2317 / # fail 0`; every
  shell suite green, including the updated counts (`emit-event.test.sh`
  127 passed, `escalation-loop.test.sh` 74 passed, `escalation-raise-wait.
  test.sh` 29 passed, `rendered-scripts-drift.test.sh` 19 passed).
- `openspec validate "stable-escalation-id-and-channel" --type change` →
  output read: "Change 'stable-escalation-id-and-channel' is valid" (smoke
  check only, per C2 — not cited as evidence of anything else).

No implementation behavior changed in this round — every new assertion
confirmed the existing shipped behavior; none revealed a defect.

## Root cause / probe evidence (systematic-debugging.md — n/a, no bug fixed)

This is a feature addition, not a bug fix — no "root cause" applies. Every
new behavior was verified with red-before-green: the JS-side tests
(`test/answer.test.js`, `test/fleet.test.js`, `test/reducer.test.js`) were
run against the pre-CON-188 versions of `lib/cli/answer.js`,
`core/scripts/emit-event.sh`, `lib/ui/reducer.js`, and
`lib/ui/screens/fleet/metrics.js` respectively (via `git show HEAD:<path>`)
and shown to fail exactly the new assertions (5/25, 1/64, 4/365 failures
respectively), then restored and shown green. The shell-side raise/resolve
behavior was additionally smoke-tested directly against `core/scripts/
emit-event.sh` in scratch git repos (raise-only, wait-only resolve/timeout,
multi-part, invalid-channel refusal, chat-channel resolution, raise-less
resolution) before the JS layer was touched.
