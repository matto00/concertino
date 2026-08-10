## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/run-archive/spec.md` fresh, in full, plus round 2's report
  (`skeptic-design-2.md`) as a claims list only.
- **Round 2 CR1 (date-prompt live-editing state/key-routing undefined) —
  confirmed fixed, and the fix is grounded in real code.**
  - Decision 3 now adds `S.archiveDatePrompt: { bound: 'dateFrom' |
    'dateTo', value: string, error: string | null } | null`, defaulting to
    `null`. tasks.md 2.1 lists exactly this field (alongside the other six
    from Decision 3) in the state-shape task — no drift between the two
    documents' field lists.
  - Read `lib/ui/screens/settings.js:353-360` in full: `if (settings.prompt)
    { ... }` is checked before the `settings.focus`-gated branches
    (`focus !== 'fields'` at line ~385), Escape there returns
    `'settings-cancel-prompt'` (not `'back'`), backspace/printable-char/`↵`
    are each handled distinctly. Design.md Decision 6 and tasks.md 3.3 now
    reproduce this exact shape for the archive screen: `state.archiveDatePrompt`
    is checked first, `esc` returns a new, distinct
    `'cancel-archive-date-prompt'` action (not `'back'`), and
    backspace/type/submit are each separately defined
    (`archive-date-prompt-backspace`/`archive-date-prompt-type`/
    `submit-archive-date-prompt`). This is a faithful mirror of the real
    precedent, not an invented one — the round-2 gap is closed.
  - Read `lib/ui/widgets/textinput.js` in full again: still explicitly
    render-only (no state/key-handling). Design.md Decision 6 no longer
    claims a "shared free-text prompt widget" handles keystrokes — it now
    correctly attributes only the rendering pattern to
    `settings.js`/`textinput.js` and treats `S.archiveDatePrompt` plus its
    own `handleKey` branch as this screen's own responsibility, consistent
    with every other prompt in the codebase (`fleet`'s `S.prompt`,
    `settings.prompt`).
  - tasks.md 4.3-4.6 give the controller four distinct action handlers
    (`open-archive-date-prompt`, `archive-date-prompt-type`/`-backspace`,
    `submit-archive-date-prompt`, `cancel-archive-date-prompt`) — opening
    and submitting are no longer conflated as they were in round 2's
    tasks.md 4.3.
  - spec.md's new "Date-range fields accept `YYYY-MM-DD` via a text prompt"
    requirement includes an explicit "`esc` cancels the prompt only, not the
    whole archive screen" scenario (lines 177-184), matching the
    design/tasks fix.
- **Round 2's non-blocking note (confusing `h`/`l` backward-focus alias
  parenthetical) — confirmed fixed.** Decision 3's field list (design.md
  ~144-149) now frames the earlier `h`/`l` proposal as dropped, explains
  why (query zone is a live text field where `h`/`l` are ordinary typed
  characters), and states Tab/Shift-Tab are the only focus-cycling keys.
  Grepped `design.md`, `tasks.md`, and `specs/run-archive/spec.md` for any
  live `h`/`l` focus-cycling binding: none found outside that one
  historical parenthetical — tasks.md 3.3 and spec.md's focus-tracking
  requirement both only ever mention Tab/Shift-Tab, and now agree with
  design.md.
- **`archiveError` fully removed.** Grepped the entire change directory:
  `archiveError` appears only inside the historical `skeptic-design-2.md`
  report text (expected — it's quoting round 2's own change request), never
  in `design.md`, `tasks.md`, `proposal.md`, or `spec.md`. Decision 3 now
  lists exactly 7 state fields; tasks.md 2.1 lists the same 7, in the same
  set — no orphaned or missing field between the two.
- **Line citations spot-checked against real code, not just quoted.**
  - `lib/ui/screens/settings.js:355` — confirmed via `grep -n "^  if
    (settings.prompt) {"` — is exactly `if (settings.prompt) {`, matching
    design.md's "settings.js:355-360" citation precisely (not an
    approximation).
  - `lib/ui/screens/fleet/keys.js` — confirmed the real precedence order:
    confirmation gates (146-185) → `prompt` (190) → `search` (197) → digit
    jump / `/` (198-244) → `s`/`v`/`N` (340-352), all unconditional and all
    after every gate/prompt. Tasks.md 1.1's claim that `A` should bind at
    "the same unconditional top-level site as `s`/`v`/`N`... after every
    confirmation gate, the `n` prompt, and the `/` search prompt have
    already had first refusal" is accurate against the real file.
  - Confirmed `key === 'A'` is not bound anywhere in
    `lib/ui/screens/fleet/keys.js` or any other screen file — the letter is
    genuinely free, as claimed.
  - Confirmed `S.sessionsData`/reset-path precedent tasks.md 2.1-2.3 cites
    (`lib/ui/app-state.js:297,356,410`) exists as described, supporting the
    claimed mirroring.
  - Confirmed `lib/ui/widgets/textinput.js`'s render-only doc comment is
    unchanged from round 2's reading (still accurate).
- No new implementation files exist yet (`lib/ui/screens/archive.js`,
  `lib/ui/controllers/archive.js`, `test/archive.test.js` all still absent)
  — correctly still a pre-implementation artifact set.
- Grepped for `TODO`/`TBD` across `design.md`, `tasks.md`, `proposal.md`,
  `specs/run-archive/spec.md`: none found.
- Cross-checked all four documents (proposal/design/tasks/spec) against
  each other for the fields, actions, and key bindings introduced by this
  round's fix (`archiveDatePrompt`, `cancel-archive-date-prompt`,
  `archive-date-prompt-type`/`-backspace`, `submit-archive-date-prompt`,
  `open-archive-date-prompt`): every name and every stated behavior
  (esc-cancels-prompt-only, empty-submit-clears-bound,
  invalid-submit-leaves-prompt-open-with-error) appears identically across
  design.md's Decision 6, tasks.md sections 3-4, and spec.md's date-range
  requirement/scenarios — no drift found after three revision passes.
- No new gap surfaced by this round's changes: the fix is additive
  (one new state field, one new handleKey branch, four new controller
  actions) and does not touch any other decision (harness cycling,
  esc-from-archive, drill-down reuse, focus-cycling) that rounds 1-2 had
  already settled and re-verified clean.

### Verdict: CONFIRM

The design is sound and ready for implementation. All three prior rounds'
change requests are fixed and grounded in the real codebase; the fix
introduced no new placeholder, contradiction, or ambiguity across
`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
`specs/run-archive/spec.md`.

### Non-blocking notes

- None beyond what round 2 already noted and this round confirmed fixed.
