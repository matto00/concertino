## 1. Coverage gaps

- [x] 1.1 Add a test seeding a persisted `teamFound: false` cache row together with an unresolvable `ticketProvider.kind`, exercising the `teamNotFoundMessage` guard in `lib/ui/watch.js` (mirror the style of the six existing tests covering the sibling `launchPadStatus` guard).
- [x] 1.2 Remove the duplicated `launchPadStatus`-calling test from `test/launchpad.test.js` (it exercises `ticket-provider.js`, not `lib/ui/screens/launchpad.js`); confirm `test/ticket-provider.test.js` still covers the same assertion.
- [x] 1.3 Fix the gate-message length test's magic threshold: replace the hardcoded `74` with a reference to the real budget (`cols - 4` in `lib/ui/screens/launchpad.js`), correct the misleading "length of the message this replaced" comment, and add a case with a kind longer than ~11 characters to actually exercise truncation.

## 2. Hardening

- [x] 2.1 Move the `parseTicket` call inside `readTickets`'s existing per-file `try/catch` in `lib/ui/tickets/local.js` (no behavior change).
- [x] 2.2 Remove dead exports `TICKETS_DIR` and `STATES` from `lib/ui/tickets/local.js`; keep `parseFrontmatter` exported as a testing seam. **Deviation:** `STATES` was NOT removed — `test/scripts/ticket-state-vocabulary.test.sh` (CON-94, run by `npm test`) `require()`s this module and reads `.STATES` directly to drift-check it against `core/scripts/set-ticket-state.sh`. The ticket's "zero references in `lib/` or `test/`" premise is factually wrong for `STATES`; removing it would break a real, passing gate. `TICKETS_DIR` had genuinely zero references and was removed.
- [x] 2.3 Harden `ALIASES[raw] || raw` and `MODULES[kind]` lookups in `lib/ui/ticket-provider.js` against prototype-chain lookups (`Object.create(null)` or an explicit `hasOwnProperty` guard); grep all read sites of `ALIASES`/`MODULES` first to pick the approach that doesn't break any `Object.prototype` method usage on these objects elsewhere.

## 3. Verification

- [x] 3.1 Run the full test suite; confirm all tests pass, including the new/modified ones from tasks 1.1-1.3.
- [x] 3.2 Confirm no references to `TICKETS_DIR` remain anywhere in `lib/` or `test/` after removal (`STATES` intentionally retained — see 2.2's deviation note).
- [x] 3.3 Confirm the five "Accepted as-is" items from the ticket are untouched.
