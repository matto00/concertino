# Files modified — CON-21 (ticket-creation-flow)

## Source

- `lib/ui/linear.js` — added `createTicket({ apiKey, teamKey, title, description })`
  (resolves the team key to a UUID via `TEAM_QUERY`, then issues the new
  `ISSUE_CREATE_MUTATION`); updated the file's header comment to state the
  creation-only write exception (never a status transition).
- `lib/ui/draft.js` (new) — the headless drafting helper: spawns
  `claude -p ... --output-format json` via `child_process.execFile`, parses
  the response into `{ title, description, acceptanceCriteria }`, and
  supports cancellation (kills the in-flight child process).
- `lib/ui/screens/fleet.js` — `promptKey` now branches the `n` prompt's
  submit case on `parseTicketInput(value) !== null` (imported from
  `lib/ui/prompt.js`) instead of always dispatching `submit-prompt`;
  non-ticket-shaped input dispatches a new `open-ticket-draft` action.
  Renders a "drafting…" state on the prompt while a headless invocation is
  in flight, and ignores further typing/backspace/submit until it settles
  or is cancelled.
- `lib/ui/screens/ticketdraft.js` (new) — the draft-review screen: renders
  the three editable fields (title/description/acceptanceCriteria) and
  handles per-field edit mode (modeled on `escalation.js`'s reply sub-mode),
  confirm and cancel/abandon.
- `lib/ui/router.js` — registered the new `ticketdraft` screen under
  `mode: 'ticketdraft'`.
- `lib/ui/watch.js` — new `ticketDraft`/`draftCancel`/`draftSeq`/
  `draftCreateSeq` state; `applyAction` cases for `open-ticket-draft`
  (provider gate + kicks off the drafting helper), `open-draft-field`,
  `draft-field-type`, `draft-field-backspace`, `commit-draft-field`,
  `cancel-draft`, and `confirm-draft` (composes the final markdown body,
  calls `linear.createTicket`, then the existing `submitTicket`, then
  `refreshLaunchPad()`); `cancel-prompt` now kills an in-flight drafting
  invocation; `SCREEN_LABELS` gained a `ticketdraft` entry.

## Docs

- `docs/dashboard.md` — updated the `n` key's description and added a
  "Starting a run from an intention" section describing the free-text
  draft flow, its provider gate, and that it is the dashboard's only write
  to the ticket provider (creation only, never a status transition).

## Tests

- `test/linear.test.js` — `createTicket` unit tests: success (two round
  trips: team resolution then `issueCreate`), unresolved team, GraphQL
  error, network error, non-success response, required-argument checks,
  default empty description.
- `test/draft.test.js` (new) — `draftPrompt`/`parseDraftOutput` unit tests
  (envelope parsing, unwrapped shape, malformed JSON, missing field) and
  `draftTicket` tests (success, non-zero exit, malformed output, missing
  field, cancellation, cancel-after-settle no-op).
- `test/fleet.test.js` — `promptKey` tests: ticket-shaped input (including
  `"CON-21 fast"`/`"CON-21 --agent-merge"`) still submits unchanged; free
  text and ticket-adjacent-but-invalid input (`"CON-21 nonsense"`) open the
  ticket-draft flow; every key but escape is a no-op while drafting.
- `test/ticketdraft.test.js` (new) — `render`/`handleKey` unit tests for
  the draft-review screen: field rendering (including the empty-field and
  error/creating states), overview key bindings, field-edit key bindings
  (including the single-line-vs-multiline Enter distinction and
  escape-commits-not-discards), and the router seam.
- `test/watch.test.js` — five end-to-end integration tests driving the real
  `watch()` loop (linear.js/draft.js faked via `require.cache`
  substitution, matching the existing `setupLaunchPadRefreshHarness`
  technique): the full free-text → draft → confirm → create → launch path
  (with the composed body asserted); the non-Linear provider gate; a
  creation failure leaving the draft screen open with content preserved
  and no launch; abandoning the draft; and cancelling while drafting
  (kills the child process, and a late resolution is a no-op).
- `test/scripts/watch-smoke.test.sh` — updated the shell-injection
  regression's expected output: `$(touch ...)` is no longer ticket-shaped,
  so it now takes the free-text path into the ticket-draft flow, where this
  script's config (no `ticketProvider`) gates it off inline — same
  "never executed, never silently swallowed" property, different message.

## Root cause note (systematic-debugging.md)

Not a bug fix — this is new-feature work. Two verification-gate failures
surfaced during implementation and were each resolved with a one-attempt,
root-cause fix (no debugging-budget escalation needed):

1. `test/scripts/watch-smoke.test.sh`'s shell-injection regression expected
   the literal string `not a ticket id`. Root cause: that message is only
   emitted by `submitTicket`'s own validation, which non-ticket-shaped
   input (including the injection payload) no longer reaches — it now takes
   the `open-ticket-draft` branch instead. Fixed by updating the test's
   expected output to the new (still-safe) provider-gated message; probe:
   re-ran the script and confirmed the marker file is still never created
   and the new message is what actually appears.
2. A new `watch.test.js` integration test expected a rendered creation-error
   string on screen after a redraw triggered by re-opening a field. Root
   cause: `open-draft-field`'s handler cleared `ticketDraft.error` (mirroring
   `open-prompt`'s "fresh state" behavior), so the very keypress used to force
   the redraw erased the error before it could be observed. Fixed by moving
   the error-clear to `draft-field-type` instead (mirrors `prompt-type`'s
   "clear the stale error once the human starts actually correcting
   something" discipline, not merely opening the field) — probe: the test's
   `t` keypress after the failure settles now leaves `draft.error` visible
   until a character is actually typed, and the test passes.
