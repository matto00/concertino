# CON-95: Local provider test-coverage and hardening gaps

## Description

Collected deferred minors from the CON-44 first slice (PR #78) reviews. Each is small; none blocked merge.

## Coverage gaps

- `teamNotFoundMessage`'s guard is untested. `lib/ui/watch.js` catches around it so an unresolvable `ticketProvider.kind` cannot crash the TUI. Verified by the re-reviewer: removing that specific guard leaves the whole suite passing. No test seeds a persisted `teamFound: false` cache row together with an unresolvable kind. The sibling guard around `launchPadStatus` is covered by six tests; this one has none.
- A duplicated test in the wrong file. `test/launchpad.test.js` gained a test that calls `ticket-provider.launchPadStatus` directly and asserts what `test/ticket-provider.test.js` already asserts — it exercises nothing in `lib/ui/screens/launchpad.js`, the module that file is about. It came verbatim from the plan, not from the implementer. Delete it.
- A magic threshold with a wrong stated derivation. The gate-message length test added during the final fix wave uses `74`, and both the code comment and the report describe it as "the length of the message this replaced" — the replaced message was 36 characters. The number appears to be borrowed from `lib/ui/tickets/local.js`'s sibling gate (73). The test also never references the real budget (`cols - 4` in `lib/ui/screens/launchpad.js`) and never exercises a long kind, so it would not catch a kind over ~11 characters still truncating.

## Hardening

- `parseTicket` sits outside the per-file `try/catch` in `readTickets` (`lib/ui/tickets/local.js`). Safe today — `parseTicket` is pure string/regex work with no throwing path on any string input — but the invariant is enforced only by that happening to be true, not by the structure. Moving the call inside the existing `try` is two lines and changes no behaviour.
- Dead exports. `parseFrontmatter`, `TICKETS_DIR` and `STATES` are exported from `lib/ui/tickets/local.js` with zero references anywhere in `lib/` or `test/`. `parseFrontmatter` is arguably a reasonable testing seam; the other two are surface for nothing.
- Prototype-chain lookups. `ALIASES[raw] || raw` and `MODULES[kind]` in `lib/ui/ticket-provider.js` are plain-object index lookups, so a hand-written kind of `constructor` / `toString` / `hasOwnProperty` resolves to an inherited member. Pre-existing for `MODULES`; `ALIASES` inherited it. Both the schema and `concertino validate` reject such a kind, and `ensureLaunchPad`'s catch downgrades the result to a gate message, so the worst case is an ugly string rather than a crash. `Object.create(null)` or a `hasOwnProperty` guard closes it.

## Accepted as-is, recorded so they are not re-litigated

- `labels: solo` without brackets silently yields `[]` rather than a one-item list or a malformed file. The loss is dashboard-side only — the orchestrator reads `harness:` straight from the frontmatter prose, so CON-62's per-ticket override is not affected. Documented in `docs/config-reference.md`.
- Frontmatter `---\n---\n` with no blank line falls through to "no frontmatter". Empty frontmatter has no `title`, so it is malformed either way — identical end state.
- A pathologically mixed-ending frontmatter (LF opening fence, CRLF interior line) normalises the rewritten line to the fence's ending. No real editor produces that shape; frontmatter-vs-body differing endings work correctly.
- `lib/ui/controllers/draft.js`'s `createTicket` call is on an unguarded throw path, but is unreachable: the `open-ticket-draft` gate admits only `kind === 'linear'`, for which `moduleFor` cannot throw.
- The `catch (e)` in `ensureLaunchPad` is broad, so a genuine `TypeError` inside a provider's `launchPadStatus` would render as a gate message. Defensible at a TUI boundary — the message is shown verbatim, never swallowed — and the alternative is the wrecked terminal that motivated the guard.

## Acceptance Criteria (derived from ticket scope)

1. A test exists that seeds a persisted `teamFound: false` cache row together with an unresolvable `ticketProvider.kind`, exercising the `teamNotFoundMessage` guard in `lib/ui/watch.js` (mirroring the six tests already covering the sibling `launchPadStatus` guard).
2. The duplicated `launchPadStatus` test in `test/launchpad.test.js` (which exercises nothing in `lib/ui/screens/launchpad.js`) is removed; `test/ticket-provider.test.js`'s existing coverage of that assertion is retained.
3. The gate-message length test's magic threshold is corrected: it references the real budget (`cols - 4` in `lib/ui/screens/launchpad.js`) rather than a hardcoded, wrongly-derived `74`, and exercises a long kind (over ~11 characters) to actually catch truncation regressions. The wrong "length of the message this replaced" comment is corrected or removed.
4. `parseTicket`'s call in `readTickets` (`lib/ui/tickets/local.js`) is moved inside the existing per-file `try/catch`, with no behavior change.
5. Dead exports `TICKETS_DIR` and `STATES` are removed from `lib/ui/tickets/local.js` (zero references in `lib/` or `test/`). `parseFrontmatter` may be retained as a testing seam — do not remove unless also unused as such.
6. `ALIASES[raw] || raw` and `MODULES[kind]` lookups in `lib/ui/ticket-provider.js` are hardened against prototype-chain lookups (e.g. via `Object.create(null)` or a `hasOwnProperty` guard), so a hand-written kind of `constructor` / `toString` / `hasOwnProperty` no longer resolves to an inherited member.
7. The five "Accepted as-is" items are explicitly out of scope — no changes should be made for them.
8. Full test suite passes after all changes.
