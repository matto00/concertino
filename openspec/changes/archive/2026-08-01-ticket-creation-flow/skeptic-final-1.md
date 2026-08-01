## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket/AC re-read**: fetched CON-21 fresh via Linear MCP and read
  `openspec/changes/ticket-creation-flow/ticket.md` — six ACs, cross-checked
  below against code, not against `evaluation-1.md`'s narrative.

- **Diff scope**: `git log --oneline main..HEAD` shows `80aa3ea` (CON-21) on
  top of `ebb3828` (CON-49, already merged into `origin/main` per
  `git merge-base --is-ancestor ebb3828 origin/main`). `git show --stat
  80aa3ea` alone touches exactly `docs/dashboard.md`, `lib/ui/draft.js`
  (new), `lib/ui/linear.js`, `lib/ui/router.js`, `lib/ui/screens/fleet.js`,
  `lib/ui/screens/ticketdraft.js` (new), `lib/ui/watch.js`, the
  `ticket-creation-flow` openspec artifacts, and the corresponding test
  files — matches `files-modified.md` and `proposal.md`'s Impact section
  exactly. No scope creep; the `adapters/*`, `docs/harness-capabilities.md`,
  and `2026-08-01-inline-orchestrator-mode/*` files in `main...HEAD` belong
  to CON-49, confirmed by `git show --stat ebb3828`.

- **Full test suite, fresh run**: `npm test` in the worktree, exit 0. All
  sections report `N passed, 0 failed`; confirmed no hidden failures via
  `grep -n "failed" | grep -v ", 0 failed"` (only matched test names
  containing the word "failed", not failure counts).

- **AC-by-AC trace, read directly from the diff:**
  1. *"`n` distinguishes a ticket id from free text using the existing
     `looksLikeTicket` predicate — one definition, not a fourth."*
     `lib/ui/screens/fleet.js`'s `promptKey` branches on
     `parseTicketInput(value) !== null` (imported from `lib/ui/prompt.js`),
     which is itself built on `looksLikeTicket` — not a duplicate
     predicate. Verified the actual behavior directly:
     `looksLikeTicket('CON-21 fast') === false` while
     `parseTicketInput('CON-21 fast')` succeeds — a bare `looksLikeTicket`
     branch would have regressed today's `"TICKET speed"`/`"TICKET
     --agent-merge"` forms. This refinement is documented in design.md
     Decision 4 and was the exact subject of skeptic-design round 3's
     REFUTE (now fixed). `test/fleet.test.js`'s new cases exercise both
     forms plus a ticket-adjacent-invalid value (`"CON-21 nonsense"`).
  2. *"Free text opens a draft flow that produces title/description/AC and
     shows them for review before anything is created."* `lib/ui/draft.js`
     (`draftTicket`) + `lib/ui/screens/ticketdraft.js`
     (`render`/`handleKey`) + `watch.js`'s `open-ticket-draft` case. No
     provider call happens anywhere before `confirm-draft`.
  3. *"Edit before confirming; abandon without creating anything."*
     `ticketdraft.js`'s field edit sub-mode + `watch.js`'s `cancel-draft`
     (clears `ticketDraft`, no provider call ever made in that path).
  4. *"Confirm creates via the provider, launches via unmodified
     `submitTicket`, same `{{TICKET}}` site."* `watch.js`'s `confirm-draft`:
     `linear.createTicket(...)` then
     `submitTicket(issue.identifier, launchCommand, session)` — the same,
     unmodified function every ticket-id launch already uses. Confirmed
     `submitTicket`/`prompt.js` were not touched by `git diff
     main...HEAD -- lib/ui/prompt.js` (empty diff — the file isn't in the
     changed-files list at all).
  5. *"Provider-aware, per `ticketProvider.kind`."* Implemented as an
     explicit gate — `provider.kind !== 'linear'` shows an inline message
     for any other value, including `github` and `manual` (both valid per
     `config/concertino.schema.json`'s enum, confirmed). This narrows the
     AC's literal wording to Linear-only-for-now; it is documented as a
     Non-Goal in `proposal.md`/`design.md`, stated as human-confirmed at
     planning, and was already scrutinized across three design-gate skeptic
     rounds (`skeptic-design-1/2/3.md`) that converged CONFIRM. I did not
     find new evidence to relitigate an already-approved, explicitly-named
     scope decision — flagged below as a non-blocking note, matching the
     evaluator's treatment, not a defect.
  6. *"Cache updates so the new ticket appears in the launch pad without a
     manual refresh."* `watch.js`'s `confirm-draft` calls the existing
     `refreshLaunchPad()` on success. This is the one AC I did not accept on
     code-reading alone, since the shipped `test/watch.test.js` CON-21 suite
     never opens the launch pad screen first (`launchPad` stays `null`,
     making `refreshLaunchPad()`'s `if (!lp) return` a no-op regardless of
     whether it's actually called) — a real, if narrow, test-coverage gap.
     I wrote and ran my own probe (harness modeled on this file's own
     `setupTicketDraftHarness`/`setupLaunchPadRefreshHarness`, `N` to open
     the launch pad, then the full `n` → draft → `c` confirm path, with a
     fake `fetchTickets` that returns the newly created `CON-99` on its
     second call) and confirmed on the actual on-disk cache
     (`cache.read(root)`) that the new ticket appears after confirm, with no
     manual refresh keypress:
     ```
     ✔ CON-21 manual probe: confirm-draft actually refreshes on-disk cache
       when launch pad is open (25.844443ms)
     ```
     AC 6 holds; the gap is coverage, not behavior — noted below.

- **Debugging-law compliance**: `files-modified.md`'s "Root cause note"
  documents two verification-gate failures during implementation, each with
  a probe-confirmed root cause (not a symptom patch) and a regression test.
  Spot-checked the second one directly: `git diff main...HEAD --
  lib/ui/watch.js` shows `'open-draft-field'` does NOT clear
  `ticketDraft.error`, and `'draft-field-type'` does — matching the claimed
  fix, and `test/watch.test.js`'s "a creation failure keeps the draft screen
  open..." test (which I ran, passing) exercises exactly this by pressing
  `t` (open a field) then asserting the error is still visible.

- **No regressions to the ticket-id fast path**: `lib/ui/prompt.js` (where
  `submitTicket`/`parseTicketInput`/`looksLikeTicket` live) has zero diff
  against `main`. `test/fleet.test.js`'s new cases confirm `"CON-21"`,
  `"CON-21 fast"`, and `"CON-21 --agent-merge"` all still dispatch
  `submit-prompt` unchanged.

- **UI/design judgment**: N/A per this project's configuration — no design
  standard is configured, and this is a TUI (terminal), not a web UI with a
  dev server to screenshot. Read `lib/ui/screens/ticketdraft.js`'s rendering
  logic directly instead: it reuses `layout.box`, `f.bold`/`f.dim`, and the
  same `BOX_BORDER_PADDING_COLS` constant `fleet.js`/`escalation.js`/
  `drilldown.js` already use — consistent with sibling screens, no
  one-off styling invented.

### Verdict: CONFIRM

### Non-blocking notes

1. **AC 5's literal wording ("provider-aware, per `ticketProvider.kind`,
   rather than Linear-only") is satisfied as a gate, not as multi-provider
   support** — `github`/`manual` show an inline "not available" message
   rather than their own creation flow. This narrowing is explicit,
   documented in three planning artifacts as human-confirmed, and was
   independently scrutinized by three design-gate skeptic rounds before
   execution began. Not a defect; noted for visibility only, same as
   `evaluation-1.md`'s own flag.
2. **Test-coverage gap on AC 6**: no test in `test/watch.test.js`'s shipped
   CON-21 suite opens the launch pad screen before running the
   draft→confirm flow, so `confirm-draft`'s call to `refreshLaunchPad()` is
   currently unverified by the automated suite in the one scenario where it
   isn't a guaranteed no-op (`launchPad === null`). I verified the actual
   behavior is correct via an ad hoc probe (see above) — this is a
   recommendation to add a coverage case matching that probe, not a
   blocking defect.
3. Task 6.2's manual live-workspace/live-harness smoke test remains
   unchecked, with `evaluation-1.md`'s reasoning for treating that as an
   acceptable substitution (real Linear writes and real headless harness
   invocations are exactly the risk this flow's own design deliberately
   narrows) standing up under my own reading. Recommend a human perform it
   once before this flow sees real usage.
