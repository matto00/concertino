## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 ("Root cause identified and written up"): satisfied — `proposal.md` "Why", `design.md`
  "Context", and `tasks.md` 1.1 all record the confirmed mechanism (`cleanup.sh:164-196`, stderr-only
  note, no re-raise/telemetry). Verified directly against the implemented code: the pre-change
  behavior described matches `core/scripts/cleanup.sh` at the commit before CON-99
  (`95307e2:core/scripts/cleanup.sh`).
- AC2 ("A retry ... that doesn't actually resolve the underlying blocker can no longer result in a run
  silently reaching delivered/done"): satisfied via the human's own recorded resolution in
  `design.md` (Decision 1-3) — non-silent via `gate.warning` telemetry, not via blocking. No
  reinterpretation beyond what the design doc already records as escalated/resolved.
- All `tasks.md` items marked `[x]` match what was implemented: `gate.warning` emission added at both
  branches (confirmed-still-behind and unknown-state) in `core/scripts/cleanup.sh:196-206`, re-synced
  byte-identically to `scripts/concertino/cleanup.sh` (confirmed via `diff`, identical), spec delta
  confirmed to already match (task 3.1), and test coverage added per 4.1-4.4.
- No scope creep: `git diff 95307e2..9fdd272 --name-only` touches only `core/scripts/cleanup.sh`,
  its synced copy, `test/scripts/cleanup.test.sh`, and the change's own `openspec/changes/...`
  artifacts. Nothing outside ticket scope.
- No regressions: the bounded retry/skip loop shape, exit code, and unconditional `run.end
  status=delivered` are unchanged (confirmed by diff — only additive `echo`/`emit-event.sh` lines
  inserted, no control-flow changes) and covered by existing + new tests.
- API/schema: `gate.warning` is an already-established event kind (CON-80); no reducer changes
  needed and none made, consistent with `design.md` Decision 1's own claim (verified: no
  `lib/ui/reducer.js` changes in the diff).
- Planning artifacts (`spec.md`'s MODIFIED requirement and its 4 scenarios) match the implemented
  behavior exactly: field names (`resolved=`, `reason=`), `gate=phase:cleanup`, and all four scenario
  outcomes (success, skip, confirmed-behind, unknown-state) are present and asserted in the test
  additions.

### Phase 2: Code Review — PASS
Issues: none.

Ran fresh (not trusting `files-modified.md`):
- `npm test` — exit 0. `node --test`: 1722 tests, 1722 pass, 0 fail. All bash suites (including
  `test/scripts/cleanup.test.sh` and `test/scripts/assert-phase.test.sh`) reported "N passed, 0
  failed", including the new `gate.warning` assertions:
  `gate.warning event emitted after a still-dirty retry exhaustion`, `gate.warning gate=phase:cleanup`,
  `gate.warning resolved=false`, `gate.warning reason names main as still behind`, `gate.warning ticket
  tagged`, `run.end still status=delivered alongside the gate.warning` — both for the confirmed-behind
  and fetch-failed/unknown-state paths — plus new `hasnt "gate.warning"` negative assertions on the
  skip-only and successful-retry paths.
- `openspec validate gate-cleanup-retry-outcome --strict` — "Change 'gate-cleanup-retry-outcome' is
  valid".

Standard checklist (no canonical standard document configured for this project — none to cite
mechanically beyond general code-quality review):
- DRY: reuses `emit-event.sh`, `SCRIPT_DIR`, `CONCERTINO_ROLE=script` prefix, and the existing
  `UNKNOWN_REASON`/`FF_REASON` variables rather than introducing new ones. Matches
  `assert-phase.sh`'s existing `gate.warning` call-site style (`CONCERTINO_ROLE=script
  "${SCRIPT_DIR}/emit-event.sh" gate.warning ...`), confirmed via `grep -n emit-event.sh
  core/scripts/{cleanup,assert-phase}.sh`.
- Readable: variable renames (`NOTE`/`UNKNOWN_NOTE` extracted before the `echo`) are minimal and
  purposeful — needed so the same string can be reused as both the stderr note and the `reason=`
  payload, avoiding duplicated string construction. Comments cite CON-99 and explain the "why", not
  just the "what".
- Modular: change is confined to the two `if`/`elif` branches already handling this case; no new
  functions, no restructuring beyond what's needed.
- Type safety: n/a (bash).
- Security: `reason=` values are passed to `emit-event.sh` the same way every other field-value pair
  in this script already is (space/quoting handled identically to the pre-existing `question=` field
  on the escalation call two lines above) — no new injection surface introduced.
- Error handling: `|| true` on both new `emit-event.sh` calls matches every other call site in this
  script (confirmed via grep) — a telemetry failure cannot fail `cleanup.sh --phase4`, consistent with
  the design's stated risk acceptance.
- Tests meaningful: new assertions check the actual event fields (`gate`, `resolved`, `reason`
  content via regex, `ticket`) via the same `node -e ... JSON.parse` pattern already used elsewhere in
  this test file, not just presence-of-string checks — a regression that dropped a field or picked the
  wrong branch would be caught. Negative (`hasnt`) assertions on the three other paths (skip, diverged
  skip, successful retry) guard against over-firing.
- No dead code: no unused imports/vars; `UNKNOWN_NOTE`/`NOTE` are both used by their respective `echo`
  and `emit-event.sh` calls.
- No over-engineering: no new abstraction, function, or config knob introduced — the two branches are
  extended in place, matching the ticket's tightly-bounded ask.
- Behavior-preserving: confirmed via diff that the only change is two new `echo`/`emit-event.sh`
  statements per branch (plus the pre-existing `NOTE`/`echo` text restructured to share a variable) —
  no control-flow, exit-code, or `run.end` change. `scripts/concertino/cleanup.sh` re-sync verified
  byte-identical to `core/scripts/cleanup.sh` via `diff`.

### Phase 3: UI Review — N/A
This project has no UI review configured for this change (per instructions); dev-server steps
skipped.

### Overall: PASS

### Non-blocking Suggestions
- None beyond what the skeptic's design-gate report already flagged as non-blocking (the
  `tasks.md:61` `openspec validate --change ...` command typo) — not load-bearing for this
  implementation, since the executor ran the correct invocation.
