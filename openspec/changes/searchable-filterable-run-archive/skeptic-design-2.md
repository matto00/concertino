## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/run-archive/spec.md` fresh, in full, plus round 1's report
  (`skeptic-design-1.md`) as a claims list only.
- **Round 1 CR1 (empty-query semantics) — confirmed fixed.** Re-read
  `lib/ui/screens/fleet/search.js:17-21`: `matchesQuery` still returns
  `false` on a null/whitespace-only query exactly as before. Decision 2's
  "Correction" block, spec.md's Requirement 2 (item 1), and tasks.md 3.1/3.4
  now all state the archive screen's own explicit bypass
  (`passesSubstringFilter`: empty/whitespace → `true` without calling
  `rowMatches`; non-empty → `rowMatches` unmodified) — matches the real code
  and no longer misattributes the behavior to `rowMatches` itself.
- **Round 1 CR2 (wrong file for mode registration) — confirmed fixed.**
  Re-read `lib/ui/router.js:14-58`: `SCREENS` is the real per-mode
  render/handleKey registry (`fleet`, `settings`, `sessions`, `presets`,
  etc.), and `watch.js` calls into it uniformly. proposal.md's Impact
  section and tasks.md 5.1 now correctly point at `lib/ui/router.js`'s
  `SCREENS` map, not `watch.js`.
- **Round 1 CR3 (no focus-tracking field) — confirmed fixed.** Decision 3
  adds `S.archiveFocus` (`'query'|'harness'|'dateFrom'|'dateTo'|'list'`),
  and tasks.md 2.1-2.3/3.2/3.3 thread it through app-state, render, and
  `handleKey`. Compared against the actual `settings.js` precedent it now
  cites (`settings.focus`-gated dispatch, `settings.js:213-214,385-395`) —
  the concept-level precedent is right (a screen with several zones needs a
  focus field), though see non-blocking note below on one leftover wrinkle.
- **Round 1 CR4 (harness/date interaction unspecified) — only partially
  fixed; new Decision 6 introduces a fresh gap.** See Change Request 1
  below — Decision 6 specifies the harness-cycle and date-format/validation
  rules soundly, but the date-prompt's own live-editing mechanism (where
  the typed-but-uncommitted text lives, and how keystrokes route to it) is
  still undefined, which is the same category of gap as round 1's CR3/CR4,
  now surfaced one layer deeper.
- Read `lib/ui/widgets/textinput.js` in full: it is explicitly documented
  as **render-only** ("cursor/backspace key handling stays with each
  caller's own `handleKey`") — there is no shared prompt *state/key-handling*
  widget anywhere in the codebase, only a shared render shape. Grounds
  Change Request 1.
- Read `lib/ui/screens/settings.js:351-360`: `settings.prompt` (a local
  `{ path, value, error }` object) is checked and dispatches **before**
  `settings.focus`-gated routing, and Escape while `settings.prompt` is set
  cancels the prompt only (`settings-cancel-prompt`), not the whole screen.
  This is the real precedent Decision 6 claims to mirror but tasks.md never
  actually reproduces — grounds Change Request 1.
- Confirmed via `grep` (`lib/ui/watch.js:1174-1252`, `onKey`/`applyAction`)
  that every screen's prompt is driven character-by-character through the
  normal key-event loop, not a blocking/synchronous input call — so a
  missing per-keystroke routing rule is a real implementation gap, not a
  moot point.
- Confirmed `lib/ui/prompt.js` (imported by Decision 6's citation) is
  `submitTicket`/`parseTicketInput` — the `n` prompt's *validation* logic,
  not a reusable prompt UI/state module either.
- No new implementation files exist yet (`lib/ui/screens/archive.js`,
  `lib/ui/controllers/archive.js`, `test/archive.test.js` all still absent)
  — correctly still a pre-implementation artifact set.
- Grepped for `TODO`/`TBD` in the change dir — none found.

### Verdict: REFUTE

### Change Requests

1. **Decision 6 / Decision 3 / tasks.md 2.1 / tasks.md 3.3 / tasks.md 4.3
   still leave the date-from/date-to free-text prompt's own live-editing
   state and key-routing undefined — a new instance of the same gap round
   1's CR3/CR4 flagged.** Decision 6 says `↵` on the date-from/date-to
   field "opens the shared free-text prompt widget (the same one
   `n`/settings' free-text field edit already use)" — but there is no such
   shared widget: `lib/ui/widgets/textinput.js`'s own header comment says
   plainly "Render-only: cursor/backspace key handling stays with each
   caller's own `handleKey`." Every existing consumer (`fleet`'s `n`
   prompt via `S.prompt`, `settings.js`'s field-edit prompt via
   `settings.prompt = { path, value, error }`) owns **its own** state field
   holding the currently-open prompt's staged, uncommitted text, and **its
   own** `handleKey` branch that is checked *before* any focus-gated
   routing (`settings.js:355-360`: `if (settings.prompt) { ... }` precedes
   the `settings.focus` branches at line 385+). Decision 3's seven state
   fields (`archiveQuery`, `archiveHarnessFilter`, `archiveDateFrom`,
   `archiveDateTo`, `archiveSelected`, `archiveFocus`, `archiveError`) have
   no equivalent slot — `archiveDateFrom`/`archiveDateTo` are the
   *committed* ms-epoch values, and `archiveError` is explicitly only "a
   one-line notice," not a place to hold in-progress typed text or which
   bound is currently being edited. Concretely, as written, the design
   cannot answer:
   - Where does the text the operator is mid-typing (e.g. `"2026-07-"`,
     before submitting) live between keystrokes?
   - What does `handleKey` do with a printable-character keypress, a
     backspace, or an Escape *while the prompt is open* — tasks.md 3.3
     only defines the single `↵` that opens the prompt
     (`open-archive-date-prompt`) and unconditionally states "`esc` (any
     focus): returns `{ type: 'back' }`," with no carve-out for an
     open prompt. Taken literally, pressing Escape to cancel a half-typed
     date would exit the entire archive screen back to the fleet instead
     of just closing the prompt — the opposite of the `settings.prompt`
     precedent Decision 6 claims to mirror (`settings-cancel-prompt`
     there closes only the prompt).
   - tasks.md 4.3 names one controller entry ("`open-archive-date-prompt` /
     the date-prompt's submit handler") as if opening and submitting are
     the same action; they are two different events separated by however
     many keystrokes the operator types in between, and nothing describes
     the actions fired for those intervening keystrokes.
   **Fix:** add an explicit state field (e.g. `S.archiveDatePrompt: {
   bound: 'dateFrom' | 'dateTo', value: string, error: string | null } |
   null`) to Decision 3 and tasks.md 2.1, and add a
   `state.archiveDatePrompt`-gated `handleKey` branch to tasks.md 3.3 that
   is dispatched *before* the `archiveFocus`-based branches (mirroring
   `settings.js:355-360`'s ordering exactly): Escape cancels the prompt
   only (clears `archiveDatePrompt`, returns to normal `archiveFocus`
   routing), backspace/printable-char mutate `archiveDatePrompt.value`,
   and `↵` invokes task 3.4's parser and either commits (
   `archiveDateFrom`/`archiveDateTo` set, `archiveDatePrompt` cleared) or
   sets `archiveDatePrompt.error` and stays open. Also correct Decision 6's
   "shared free-text prompt widget" framing to name only the rendering
   (`lib/ui/widgets/textinput.js`'s `inputLines`) as shared, and the
   key-handling as this screen's own, per its own documented convention.

### Non-blocking notes

- Decision 3's parenthetical — "`Shift-Tab` (or `h`/`l` while a filter
  field, not the list, has focus) cycles backward — mirroring
  `settings.js`'s own `Tab`/`h`/`l` focus-cycling keys exactly" — is
  internally confusing (it groups `h` *and* `l` together as both moving
  focus *backward*, whereas the actual `settings.js` precedent
  (`settings.js:388,395`) uses `l`/`h` for opposite directions, forward and
  back respectively) and isn't reflected anywhere in tasks.md 3.3 or
  spec.md's "Tab moves forward / Shift-Tab moves backward" requirement (no
  `h`/`l` mentioned in either). Since the query zone is a live text field
  where an operator may legitimately want to type the letters `h`/`l` as
  part of a search string, binding them to focus movement there would also
  be a usability regression if ever implemented. Recommend deleting this
  parenthetical from Decision 3 and keeping Tab/Shift-Tab as the only
  cycling keys, matching tasks.md/spec.md exactly (which already agree
  with each other and are sound as written).
- Round 1's non-blocking notes (fleet.js/keys.js citation-consistency,
  Decision 2's "share predicate not target list" reasoning, Decision 4's
  "no navigation stack" reasoning) remain accurate and unchanged; no new
  issues found there.
