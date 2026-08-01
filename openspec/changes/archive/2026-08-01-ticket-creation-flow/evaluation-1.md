## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none blocking.

- All six ticket ACs addressed:
  - Ticket-shape branch: implemented via `parseTicketInput(value) !== null`
    (`lib/ui/prompt.js`) rather than a bare `looksLikeTicket` call. This is a
    documented, deliberate refinement (design.md Decision 4), not a silent
    reinterpretation — `looksLikeTicket('CON-21 fast')` is `false` (whole-
    string match) even though that input must keep launching today, so a
    bare-predicate branch would have been a regression. `parseTicketInput`
    itself is built on the single `looksLikeTicket` predicate, so "one
    definition, not a fourth" still holds. Verified via `fleet.test.js`'s new
    `"CON-21 fast"`/`"CON-21 --agent-merge"` cases.
  - Free-text draft flow (title/description/acceptanceCriteria, reviewed
    before creation): implemented (`lib/ui/draft.js`, `lib/ui/screens/ticketdraft.js`).
  - Edit-before-confirm / abandon-with-zero-side-effects: implemented
    (`ticketdraft.js` field edit + `cancel-draft`, which only ever clears
    in-memory state — no provider call happens before `confirm-draft`).
  - Confirm creates via provider then launches through unmodified
    `submitTicket`, same `{{TICKET}}` site: implemented (`watch.js`
    `confirm-draft` case calls `linear.createTicket` then `submitTicket`
    unchanged).
  - "Provider-aware, per `ticketProvider.kind`, rather than Linear-only":
    implemented as an explicit provider **gate** (Linear-only for v1;
    github/manual show the same "not available for this provider" message
    the launch pad already uses), not full multi-provider support. This
    narrowing is documented as a Non-Goal in proposal.md/design.md and
    stated as "confirmed by the human before this design was written" —
    consistent across every planning artifact, not an executor-invented
    shortcut. Flagging for visibility, not blocking.
  - Cache refresh without manual refresh: implemented via the existing
    `refreshLaunchPad()` (Decision 5), triggered after a successful create.
- Tasks 1.1–5.5 and 6.1 all checked and match the diff. Task 6.2 (manual
  smoke test against a live Linear workspace / real Claude harness) is left
  unchecked — see the dedicated assessment below.
- No scope creep: `git diff ebb3828...HEAD` (the correct base — local `main`
  is 2 commits behind `origin/main`; `ebb3828`/CON-49 is already merged and
  not part of this ticket) touches exactly the files proposal.md's Impact
  section named, plus tests and docs. No unrelated files changed.
- No regressions: `lib/ui/linear.js`'s existing read-only functions are
  untouched aside from the additive `createTicket`/`ISSUE_CREATE_MUTATION`
  and an updated header comment; `fleet.js`'s `promptKey` keeps the existing
  `submit-prompt` path byte-for-byte for ticket-shaped input.
- Spec delta (`specs/ticket-draft/spec.md`, new capability) matches the
  implemented behavior scenario-by-scenario (checked against `watch.js`/
  `ticketdraft.js`/`draft.js`).
- Design skeptic rounds (skeptic-design-1/2/3) converged to CONFIRM; the
  round-3 REFUTE (design.md's Goals section still citing the disproven raw
  `looksLikeTicket` predicate) is fixed in the current design.md, and the
  related non-blocking note (tasks.md section 3's heading) is also fixed.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates (fresh run, in `WORKTREE_PATH`, `CLEAN_WORKTREE` not set at this
speed):**
```
npm test
```
Exit 0. `node --test`: 1096 passed, 0 failed (includes the new
`test/draft.test.js`, `test/ticketdraft.test.js`, new cases in
`test/fleet.test.js`/`test/linear.test.js`, and 5 new CON-21 integration
tests in `test/watch.test.js`). All `test/scripts/*.test.sh` suites passed,
including the updated `watch-smoke.test.sh` shell-injection regression
(re-verified the root-cause note in `files-modified.md`: the payload now
takes the free-text → ticket-draft path and is gated off inline before any
subprocess/network call, same "never executed" property, different message).

No canonical code-quality/design standard is configured for this project
(confirmed — no lint config in the repo, no standards doc referenced), so no
[mechanical] citations apply beyond general review:

- **DRY**: `createTicket` reuses `TEAM_QUERY`/`postRaw`/`httpsTransport`
  rather than adding parallel plumbing; `draftTicket` follows the same
  injectable-transport-seam discipline `fetchTickets` already established.
- **Readable**: field/action names are direct (`open-draft-field`,
  `commit-draft-field`, `confirm-draft`); no magic values beyond named
  constants (`REQUIRED_FIELDS`, `BOX_BORDER_PADDING_COLS`, matching sibling
  screens).
- **Modular**: drafting (`draft.js`), Linear write (`linear.js`), screen
  (`ticketdraft.js`), and orchestration (`watch.js`'s `applyAction` cases)
  are cleanly separated; `linear.js` stays a thin transport layer per
  design.md Decision 1 (composition of the final ticket body happens once,
  in `watch.js`'s `confirm-draft`, not inside `linear.js`).
- **Type safety**: plain JS project, no type-escape hatches introduced;
  required-field/argument checks are explicit (`createTicket`'s
  teamKey/apiKey/title guards; `parseDraftOutput`'s per-field validation).
- **Security**: `postRaw` passes GraphQL variables as a parameterized
  `variables` object (no string interpolation into the query) — no
  injection risk in the new `issueCreate` mutation. `draft.js` spawns via
  `execFile` with an argument array (`['-p', prompt, ...]`), never
  `shell: true` — no shell-injection risk from the free-text seed, matching
  the existing shell-injection regression's own expectations.
- **Error handling**: every new async boundary (drafting invocation, Linear
  create) has an explicit reject/catch path that surfaces an inline error
  and preserves in-progress human input (draft fields, or the original `n`
  prompt text) rather than failing silently or losing data.
- **Tests meaningful**: exercise real regressions, not tautologies — e.g.
  `fleet.test.js`'s new cases specifically assert `"CON-21 fast"` still
  submits (would catch a regression to the raw-`looksLikeTicket` mistake
  design.md explicitly warns against); `watch.test.js`'s 5 new integration
  tests drive the real `watch()` loop with only `linear.js`/`draft.js` faked
  at the network/subprocess boundary (the same seam `setupLaunchPadRefreshHarness`
  already uses), asserting the composed body, the real launched ticket id,
  cache-refresh ordering, failure-preserves-draft, abandon-is-a-no-op, and
  cancel-kills-the-child-process-and-a-late-resolution-is-a-no-op.
- **No dead code**: no leftover TODO/FIXME in any new file; no unused
  exports found.
- **No over-engineering**: no premature multi-harness abstraction (explicit,
  documented v1 scope to Claude Code only, per design.md Decision 2); no
  speculative provider abstraction beyond the existing gate pattern.
- Root-cause fixes for the two verification-gate failures encountered during
  implementation (documented in `files-modified.md`) are genuine root-cause
  fixes, not symptom patches — confirmed against the diff (`watch-smoke.test.sh`'s
  updated expectation; `open-draft-field` no longer clearing `ticketDraft.error`,
  moved to `draft-field-type` instead).

**Assessment of task 6.2 (left unchecked):** Acceptable substitution, not a
gap. Task 6.2 calls for a manual smoke test against a *live* Linear
workspace and a *real* Claude Code harness invocation — both are external,
non-deterministic systems that a write-capable automated test should not
touch (a real `issueCreate` mutation against a real workspace, run
repeatedly in CI/evaluation, is exactly the kind of accidental-write risk
design.md itself calls out as the reason this write path is deliberately
narrow). The substitution offered — `test/watch.test.js`'s 5 new end-to-end
tests, plus `test/draft.test.js`'s envelope-parsing tests and
`test/linear.test.js`'s `createTicket` tests — fakes only the two external
seams (`lib/ui/linear.js`'s `createTicket`, `lib/ui/draft.js`'s
`draftTicket`) while driving the *real* `watch()` loop, `fleet.js`
dispatch, and `ticketdraft.js` render/handleKey through the full flow. This
mirrors the codebase's own existing pattern for `fetchTickets`/`resolveTeam`
(also seam-faked, never live-tested in the suite). What remains genuinely
uncovered by any automated test — real Linear GraphQL schema/field-name
correctness against production, and the real `claude -p --output-format
json` envelope shape from an actual harness invocation — is inherent to
task 6.2's own description and cannot be safely automated without the exact
risk the executor named. Recommend the human perform 6.2 once, live, before
this flow sees real usage (see Non-blocking Suggestions), but this does not
block a PASS here.

### Phase 3: UI Review — N/A
This project has no UI review configured for Phase 3 (per instructions);
dev-server steps skipped.

### Overall: PASS

### Non-blocking Suggestions
- Before this flow is used for a real ticket, have a human run tasks.md
  6.2's manual smoke test once against a live Linear workspace / real
  Claude Code harness (ticket-id path, free-text path end to end, and the
  non-Linear-provider gate) — the automated suite covers the application
  logic on both sides of that boundary but cannot verify the live external
  shapes themselves.
- Local `main` in this repo is 2 commits behind `origin/main` (missing
  `ebb3828`/CON-49 and `e92a0ad`/CON-50); not a defect in this change, but
  worth a `git fetch && git merge --ff-only` before the next diff review
  elsewhere in this repo so `main...HEAD` diffs stay accurate without
  needing the `ebb3828...HEAD` workaround this review used.
