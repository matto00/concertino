## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 5 ticket ACs traced to implementation:
  - AC1 (`escalation.raised` carries structured `context`): `core/scripts/emit-event.sh`'s
    `context` special-case (`write_escalation_raised`) confirmed end-to-end with a manual
    run (`gather-escalation-context.sh dependency ...` piped into `context=` on
    `emit-event.sh escalation --await`) — the emitted `escalation.raised` line carried the
    full multi-line context verbatim.
  - AC2 (orchestrator gathers via script, no new decision point): `core/roles/orchestrator.md`
    diff adds the `gather-escalation-context.sh` call immediately above the existing
    `emit-event.sh escalation --await` call, with the documented "raise without `context=`"
    fallback (design.md Decision 2/5, spec.md requirement 4).
  - AC3 (screen renders above options, degrades honestly): `lib/ui/reducer.js` +
    `lib/ui/screens/escalation.js` diffs are additive-only; `test/escalation.test.js`'s new
    cases (with context, multi-line, truncated-with-ref, no-context) all pass.
  - AC4 (4000-byte cap never violated, visible truncation, reuse of CON-10's
    `persist-evidence.sh` mechanism rather than a second one): verified the binary-search
    truncation logic in `write_escalation_raised()` against `core/scripts/emit-event.sh`,
    confirmed it calls `persist-evidence.sh "$TICKET" <tmpfile>` (no new persistence
    directory), and confirmed the oversized-context test (`test/scripts/emit-event.test.sh`)
    asserts the raised line is `<= 4000` bytes, is valid JSON, and `question`/`options` are
    unaffected.
  - AC5 (tests: with / without / oversized context): present in
    `test/scripts/emit-event.test.sh`, `test/scripts/gather-escalation-context.test.sh`,
    `test/reducer.test.js`, `test/escalation.test.js` — all pass (see Phase 2).
- No AC silently reinterpreted. Notably, the executor did **not** overclaim the "five kinds
  map 1:1 onto the four 'Always reaches the human' bullets" — `skeptic-design-1.md`'s
  non-blocking note 1 flagged this risk during design, and the orchestrator.md diff
  explicitly hedges ("Not every escalation fits one of the five kinds cleanly... `CONTEXT` is
  simply empty"), correctly addressing it rather than glossing over it.
- Task list (`tasks.md`) fully checked off and matches the diff; three deviations are flagged
  and justified in `files-modified.md` (task 4.3 — no rendered/gitignored agent file exists to
  mirror, confirmed; task 6.1 — corrected typo'd validate command per the skeptic's note; task
  2.8 — added temp-file cleanup per the skeptic's note). None is scope creep; all are
  responses to design-gate feedback.
- No unnecessary changes outside ticket scope — `git diff --stat` shows exactly the files the
  proposal's Impact section named (plus the openspec change-dir artifacts and
  `package.json`'s one-line test-script addition).
- No regressions: full `npm test` passes, including the untouched
  `test/scripts/escalation-loop.test.sh` end-to-end path (12/12) and every pre-existing case
  in `test/scripts/emit-event.test.sh` (59/59, all new + old).
- API contract: `escalation.raised`'s new fields are additive/optional per spec.md
  requirement 5, consistent with the "no Modified Capabilities" claim in proposal.md (no
  existing spec governs this event).
- Planning artifacts reflect final implemented behavior — design.md's 5 decisions match the
  diff exactly; no stale or contradicted statements found.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Mirroring convention**: `diff core/scripts/gather-escalation-context.sh
  scripts/concertino/gather-escalation-context.sh`, same for `emit-event.sh` and both
  `README.md`s — all byte-identical, confirming the stated convention is actually followed.
- **DRY**: `gather-escalation-context.sh` reuses the exact `k=v` first-`=`-split parsing
  convention `emit-event.sh` already uses; no duplicated cap/persistence logic (that stays
  solely in `emit-event.sh` per Decision 1).
- **Readable / no magic values**: kind/field names match the ticket's enumeration verbatim;
  the binary-search truncation loop is commented with the rationale (build-then-measure,
  JSON-escaping makes the budget non-analytic).
- **Modular**: formatter (pure, stdout-only) vs. transport (cap/truncate/persist) are cleanly
  separated per Decision 1 — confirmed `gather-escalation-context.sh` has no reference to
  `MAX_LINE` or `persist-evidence.sh`.
- **Error handling**: `gather-escalation-context.sh`'s `fail()` writes `FAIL <reason>` to
  stderr, exits non-zero, prints nothing to stdout — verified via
  `test/scripts/gather-escalation-context.test.sh`'s missing-field and unknown-kind cases.
  `emit-event.sh`'s failed-persist path correctly omits `context_ref` rather than emitting a
  dangling one (spec requirement 3, scenario 3) — verified by the "failed persist" test case
  (unwritable evidence dir) passing.
- **Tests meaningful**: re-ran the full suite myself (`npm test`, exit 0) — 59/13/20/22/39/10/
  13/12 passed across the bash suites, plus the full `node --test` run, with zero failures.
  Also independently confirmed `openspec validate escalation-context-payload --strict` passes.
  Additionally ran a hand-built end-to-end check outside the test suite (gather →
  `emit-event.sh escalation --await` → read back `escalation.raised`) to confirm the JSON
  event actually carries the multi-line dependency context verbatim, not just that the unit
  tests pass in isolation.
- **No dead code**: no `TODO`/`FIXME`/unused-import markers in any touched file (grepped).
- **No over-engineering**: the binary-search truncation is the minimum machinery needed to
  respect an exact byte cap given JSON-escaping's non-analytic overhead; no premature
  abstraction (e.g., no generic "attach arbitrary payload to any event" mechanism, consistent
  with the design's stated Non-Goal).
- **Durability (CON-10 mechanism reuse)**: `emit-event.sh`'s oversized-context path calls
  `persist-evidence.sh "$TICKET" <tmpfile>` — the identical script/destination
  (`<main checkout>/.concertino/runs/<TICKET>/evidence/`) CON-10 introduced and
  `test/scripts/persist-evidence.test.sh` already proves survives worktree removal
  (`ref still exists after worktree removal` / `ref still readable after worktree removal`,
  both passing). No second persistence path was invented, matching the ticket's explicit
  steer.

Non-blocking observations (do not affect verdict — see below):
- `write_escalation_raised()`'s byte-prefix truncation (`cut -b "1-${mid}"`) truncates at an
  arbitrary byte offset, which could split a multi-byte UTF-8 character mid-sequence if
  `context` contains non-ASCII text near the truncation boundary. This isn't exercised by any
  test (all oversized-context tests use ASCII `x` filler) and isn't required by the ticket's
  ACs, but is worth a follow-up if multi-byte context (e.g. non-English identifiers) is
  expected in practice.
- `gather-escalation-context.sh`'s `blocker` kind embeds `output` verbatim with no truncation
  of its own; the ticket's "first lines of its output" phrasing appears to assume the
  *caller* (orchestrator) selects the first lines before passing `output=`, which is a
  reasonable division of labor but isn't stated explicitly anywhere in the role-doc diff.

### Phase 3: UI Review — N/A
This project has no UI review configured (per task instructions) — skipped per instructions.
Dashboard rendering correctness was instead verified via Phase 2's automated
`test/reducer.test.js` / `test/escalation.test.js` runs (all passing) rather than a live dev
server.

### Overall: PASS

### Non-blocking Suggestions
- Consider whether `write_escalation_raised()`'s byte-offset truncation should snap to a UTF-8
  character boundary rather than an arbitrary byte, if non-ASCII context text is expected.
- Consider stating explicitly in `core/roles/orchestrator.md` (or `gather-escalation-context.sh`'s
  header comment) that `output=` for the `blocker` kind should already be pre-truncated to
  "first lines" by the caller, since the script itself does not truncate it.
