## 1. Linear provider write path

- [x] 1.1 Add `createTicket({ apiKey, teamKey, title, description })` to
      `lib/ui/linear.js` using the existing `httpsTransport`/`postRaw`
      plumbing, issuing an `issueCreate` GraphQL mutation and returning
      `{ id, identifier, url }` on success, throwing on GraphQL error.
      `description` is the caller's fully composed markdown body (title +
      description + acceptance criteria already folded in per design.md
      Decision 1) — this function has no separate acceptance-criteria
      parameter and performs no composition itself.
- [x] 1.2 Update `lib/ui/linear.js`'s header comment to state the
      creation-only write exception explicitly (never status transitions).
- [x] 1.3 Unit tests for `createTicket`: success path, GraphQL error path,
      network error path (mirror existing `fetchTickets` test patterns).

## 2. Headless drafting invocation

- [x] 2.1 Add a drafting helper (new `lib/ui/draft.js` or a function in
      `lib/ui/watch.js`) that spawns `claude -p "<prompt>" --output-format
      json` via `child_process.execFile`, with the free-text seed
      interpolated into the prompt.
- [x] 2.2 Parse the child process's stdout as JSON, validating presence of
      `title`, `description`, `acceptanceCriteria`; treat non-zero exit,
      parse failure, or a missing field as a single "drafting failed" error
      path.
- [x] 2.3 Support cancellation: track the child process handle so a cancel
      keystroke during drafting kills the in-flight process.
- [x] 2.4 Unit tests for the drafting helper: success, non-zero exit,
      malformed JSON, missing field, cancellation (mock `child_process`).

## 3. `n` prompt branch on `parseTicketInput`

- [x] 3.1 In `lib/ui/screens/fleet.js`'s `promptKey`, branch the submit case
      on `parseTicketInput(value) !== null` (imported from `lib/ui/prompt.js`
      — NOT a bare `looksLikeTicket(value)` call, which fails on
      `"CON-21 fast"`/`"CON-21 --agent-merge"` since it requires a
      whole-string match with no whitespace tolerance; see design.md
      Decision 4): ticket-shaped keeps today's `submit-prompt` action
      unchanged; everything `parseTicketInput` rejects dispatches a new
      `open-ticket-draft` action with the raw text as `seed`.
- [x] 3.2 In `lib/ui/watch.js`'s `applyAction`, handle `open-ticket-draft`:
      if `ticketProvider.kind !== 'linear'`, show the existing
      "not available for this provider" treatment inline and do not open
      the draft flow; otherwise start the drafting helper (2.1) and
      transition to a "drafting…" state.
- [x] 3.3 Tests: ticket-shaped input still calls `submit-prompt`/
      `submitTicket` unchanged (no regression) — MUST include explicit cases
      for `"CON-21 fast"` and `"CON-21 --agent-merge"` through the new
      `promptKey` dispatch path, since these are exactly the forms a raw
      `looksLikeTicket` check would misroute; free-text input dispatches
      `open-ticket-draft`; a malformed-but-ticket-adjacent value (e.g.
      `"CON-21 nonsense"`) falls through to `open-ticket-draft` like any
      other rejected input, not a special-cased error; non-Linear provider
      shows the gated message and never starts drafting.

## 4. Draft-review screen

- [x] 4.1 Add `lib/ui/screens/ticketdraft.js` with the standard
      `render(state, opts)` / `handleKey(key, state)` screen contract,
      modeled on `escalation.js`'s per-field edit sub-mode (title,
      description, acceptance criteria fields, each independently
      editable).
- [x] 4.2 Register the new screen in `lib/ui/router.js` under `mode:
      'ticketdraft'`.
- [x] 4.3 Implement confirm and cancel actions: cancel discards the draft
      and returns to the fleet screen with zero side effects; confirm
      dispatches the creation flow (5.x).
- [x] 4.4 Tests for `render`/`handleKey`: field edit, cancel-discards,
      confirm-dispatches, following existing screen test patterns (see
      `test/` for `launchplan`/`escalation` screen tests).

## 5. Creation + launch + cache refresh

- [x] 5.1 On confirm, compose the final markdown body from the draft's
      current `description` and `acceptanceCriteria` fields
      (`description + "\n\n## Acceptance Criteria\n" + acceptanceCriteria`,
      per design.md Decision 1), then call `linear.createTicket` (1.1) with
      `{ apiKey, teamKey, title, description: <composed body> }`.
- [x] 5.2 On success, call the existing `submitTicket(realTicketId,
      launchCommand, session)` unchanged — no new substitution site.
- [x] 5.3 On success, call the existing `refreshLaunchPad()` so the new
      ticket appears in the `N` launch-pad cache without a manual refresh.
- [x] 5.4 On creation failure, keep the draft-review screen open with the
      human's edited content intact and show an inline error (no run
      launched).
- [x] 5.5 Tests: successful confirm creates + launches + refreshes cache in
      that order; failed creation leaves the draft screen open with content
      preserved and no launch.

## 6. Verification

- [x] 6.1 Run the full existing test suite — confirm zero regressions to
      `test/prompt.test.js`, `test/ticket.test.js`, `test/control.test.js`,
      `test/watch.test.js`.
- [ ] 6.2 Manual smoke test in a dev environment: `n` with a ticket id
      (unchanged path), `n` with free text (full draft → edit → confirm →
      launch → cache-refresh path), and `n` with free text under a
      non-Linear `ticketProvider.kind` (gated message, per project's example
      configs in `config/examples/`).
