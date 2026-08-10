## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-metrics-escalation-history/spec.md` in full.
- Confirmed the design does resolve the ticket's own escalated design
  question ("recent" bounded by box height vs. scrollable) — Decision 3
  windows the full history through `layout.selectionWindow`, mirroring
  `evidenceWindow()`. Verified this precedent against ground truth:
  `lib/ui/layout.js:155` (`selectionWindow(total, selectedIndex, maxVisible,
  currentOffset)`) and `lib/ui/screens/drilldown.js:279-330`
  (`EVIDENCE_MAX_VISIBLE`/`evidenceWindow`/`isSelected` `▸ `/`f.bold()`
  convention) — the call shape design.md describes is accurate.
- Confirmed the `focus === 'quickstart'` precedent the design says
  `focus === 'metrics'` will mirror is real and shaped as described:
  `lib/ui/screens/fleet/keys.js:306-332` (focus block), `:228-248`
  (digit-jump switch, currently `case 'metrics': return null;` at line 245 —
  matches design's claim this becomes a real jump target), and
  `lib/ui/controllers/fleet.js:124-137,240-262` (`focus-quickstart`/
  `move-quickstart-focus`/`exit-quickstart-focus`).
- Confirmed the raw event shapes Decision 1's pairing walk depends on are
  real: `lib/ui/reducer.js:183-220` (`escalation.raised` carries
  `question`/`options`/`sub_questions`(JSON string)/`role`/`context`;
  `escalation.answered`/`.timeout` clear `run.escalation`), and
  `scripts/concertino/emit-event.sh:497-557` (escalation.answered carries
  `answer` or `sub_answers`). The single-escalation-per-run assumption
  Decision 1 relies on matches `reducer.js`'s `run.escalation =` unconditional
  clobber on `escalation.raised`.
- **Traced AC2's central claim — that opening a live entry reuses the exact
  existing `'open-escalation'` handler — against the real handler**
  (`lib/ui/controllers/escalation.js:97-123`) and the real key binding
  (`lib/ui/screens/fleet/keys.js:388-396`, `g`/`↵` → `{ type:
  'open-escalation', ticket }`). Design's plan (`open-historical-escalation`
  dispatching the literal existing `'open-escalation'` action for a
  `resolved: false` entry) is sound and does reuse the one true code path —
  this part of AC2 holds up.
- **Traced the RESOLVED branch of AC2/AC1 all the way through the runtime
  poll loop** (not just the render function) — and found it does not work as
  designed. See Change Request 1 below; this is a reproducible, code-verified
  defect, not a stylistic nitpick, so it blocks CONFIRM.

### Verdict: REFUTE

### Change Requests

1. **The resolved/historical detail view will not stay on screen — it is
   bounced back to the fleet by the existing per-poll "walk back to fleet if
   `run.escalation` clears" check, which design.md explicitly (and
   incorrectly) claims will not fire.**

   Design.md Decision 5 states `S.escalationTicket` is deliberately never
   set for a historical entry ("never reusing `S.escalationTicket` for
   this"), and Decision 4 / tasks.md 3.4 assert this is safe because the
   poll-loop check is "keyed off `S.escalationTicket`" and therefore "cannot
   mistake a historical view for a live one." That assertion is false against
   the actual code. The real check, `lib/ui/watch.js:749-752`:

   ```js
   if (S.mode === 'escalation') {
     const run = S.runs.find((r) => r.ticket === S.escalationTicket);
     if (!run || !run.escalation) backToFleet();
   }
   ```

   is keyed off `S.mode === 'escalation'`, not off `S.escalationTicket` being
   set. When a resolved entry is opened per the design's own plan,
   `S.mode = 'escalation'` while `S.escalationTicket` stays `null` (its
   `createAppState()` default — `lib/ui/app-state.js:44`). `S.runs.find(r =>
   r.ticket === null)` will not match any real run (tickets are non-null
   strings), so `run` is `undefined`, `!run` is `true`, and `backToFleet()`
   fires — which resets `S.mode = 'fleet'` (`lib/ui/app-state.js:428-430`)
   and clears `S.escalationHistoryItem`'s would-be state along with it. This
   check runs every `draw()`, on the stated "per-second" poll cadence
   (`lib/ui/watch.js:4` header comment), so a resolved/timed-out entry opened
   via the new feature would render for at most ~1 second before silently
   snapping back to the fleet view — not merely a subtle bug but a
   near-total failure of AC1 ("opens a detail view showing the full
   question...") for every resolved or timed-out escalation, which is the
   majority case this ticket exists to surface (a still-live escalation is
   the minority; most rows in "recent escalations" are already resolved).

   **Required revision:** design.md must specify an actual code change to
   this poll-loop check — e.g. gate it on `S.escalationTicket != null` (so it
   only fires for the live-ticket-backed path) or add an explicit
   `!S.escalationHistoryItem` exemption — and tasks.md's item 3.4 must be
   rewritten from "confirm... is never triggered" (a false claim) to "modify
   the check so it is never triggered," with the regression test asserting
   the corrected behavior (poll a few times with a historical view open;
   `S.mode` must remain `'escalation'`).

   Related, same root cause, worth folding into the same fix: `lib/ui/
   banner.js:99-102`'s `suppressedOnOwnScreen(mode, escalationTicket,
   liveEscalations)` also keys off `escalationTicket === liveEscalations[0]
   .ticket`, which is likewise always false when `escalationTicket` is
   `null` — so if some OTHER run has a live escalation while a historical
   view (for a resolved entry) is open, the global escalation banner would
   render on top of the historical screen. Not fatal on its own (moot while
   Change Request 1's primary bug still bounces the screen away first), but
   the revision to design.md should account for it so fixing #1 doesn't
   just unmask #2.

### Non-blocking notes

- Design.md's Decision 1 pairing shape (`ticket, role, question, options,
  subQuestions, raisedAt, resolved, decision, resolvedAt, timedOut`) is
  built from the raw event's `ev.options`/`ev.sub_questions` fields, which
  today only get converted to their render-ready shape (`toOptions()`, JSON
  parse of `sub_questions`) inside `reducer.js`'s live-escalation fold
  (`lib/ui/reducer.js:190-201`). Design.md doesn't explicitly call out that
  `metricsFor()`'s new walk needs to replicate that same
  parsing/normalization (not just read the fields off `ev` raw) — worth a
  one-line callout in Decision 1 or a tasks.md sub-bullet so the
  implementer doesn't hand-roll a second, subtly different parser.
- Otherwise the design is internally consistent, appropriately scoped (no
  scope creep beyond the ticket's three ACs), and each of the ticket's three
  acceptance criteria maps to a specific decision/task. No placeholders,
  TBDs, or deferred decisions found.
