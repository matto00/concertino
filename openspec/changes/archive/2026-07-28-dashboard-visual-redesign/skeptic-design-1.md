## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/dashboard-visual-design/spec.md` in full.
- Read all six current screens (`lib/ui/screens/{fleet,drilldown,launchpad,
  ticketview,launchplan,escalation}.js`) and `lib/ui/format.js` as ground
  truth, specifically to check the design's claims about "today's" behaviour
  (fleet's `sectionHeight`/trim loop, drilldown's `twoCol`/`rightContentWidth`,
  launchpad's `EPICS_WIDTH`/`epicRow`/`ticketRow`, the exact degradation
  strings) against the actual source rather than the design doc's own
  paraphrase.
- Confirmed: no npm dependency is added anywhere in the plan (`package.json`
  today has no `dependencies` block; nothing in proposal/design/tasks
  proposes one). Confirmed: no state-shape/keybinding/reducer/store change is
  proposed (Non-Goals section, `Impact` section). Confirmed: every
  degradation string called out by the ticket (`no telemetry`, `phase
  unknown`, `no evidence recorded`, `no gate results recorded`, `press r to
  fetch` / `no tickets cached yet — press r to fetch`, the malformed-events
  banner) is enumerated in the spec's "Every existing degradation message
  still appears" requirement and referenced by task items 2.3/3.3/4.3/5.4.
  Confirmed: `layout.js` is specified pure (Decision 1's opening line, spec's
  first requirement's second scenario).
- Traced the fleet screen's actual current `sectionHeight()`/render-loop
  arithmetic line-by-line (`fleet.js:190-233`) against Decision 3's claim
  about the new, border-inclusive version, to check whether "2 extra rows per
  visible section" is arithmetically consistent with Decision 1's
  "title-in-border" design — it is not (see Change Request 1 below).
- Checked whether Decision 2's characterisation of the drill-down as already
  having "implicit single-pane focus" (i.e. resolved) is consistent with
  task 3.2, which reopens exactly that question and defers it to a code
  comment at implementation time (it is not — see Change Request 3).

### Verdict: REFUTE

### Change Requests

1. **Fleet section-height arithmetic in Decision 3 doesn't follow from
   Decision 1, and the acceptance-critical NEEDS-YOU-never-trimmed guarantee
   depends on getting this right.** Today's `sectionHeight()`
   (`fleet.js:190-193`) charges a populated section 2 rows (1 title line + 1
   trailing blank) plus 2 rows/run plus an optional "…and N more" row.
   Decision 1 moves the section title into the box's top border ("a top
   border (with `title` woven in if given)"), and every `box()` always draws
   both a top and bottom border. Working through the actual replacement: the
   old "title" content row is gone (now part of the top border), so the net
   new cost per section is `2 (border) + 2*shown + moreFlag` — arithmetically
   identical to today's `2 + 2*shown + moreFlag`, i.e. **zero extra rows**,
   not "2 extra rows per visible section" as Decision 3 states — *unless* the
   existing trailing-blank separator between sections is also kept once
   sections are individually bordered, in which case the real delta is +1,
   not +2. Neither reading matches the design doc's own number. Since task
   2.1 explicitly asks the executor to "extend that accounting to include
   border rows... per design.md Decision 3" and this budget directly gates
   whether NEEDS YOU can ever be pushed off a short terminal, the design doc
   needs to state the corrected formula explicitly (and say whether the
   inter-section blank row survives box-per-section or is dropped now that
   each box's own bottom border provides the visual break), not leave the
   executor to reconcile two inconsistent numbers on their own.

2. **Ambiguous scope for the fleet screen: one box or four?** Decision 2 says
   "the fleet's list becomes **one** focused box rather than a bare list" —
   singular. Task 2.1 says "the NEEDS YOU / RUNNING / FAILED / DONE
   *sections* are drawn through `layout.box()`" and the ticket itself asks
   for bordered "fleet sections" (plural). These read as two different
   designs (one big box wrapping the whole run list vs. four independently
   bordered section boxes) and the doc never states which, nor — if it's
   four boxes — whether all four use the "focused" (heavier) border set
   given the fleet has no multi-pane distinction, or whether some other rule
   applies. Pin this down explicitly in Decision 2 (e.g. "four independently
   bordered section boxes, all rendered with the focused character set, since
   the fleet is a single-pane screen with visual, not navigable, grouping").

3. **Drill-down focus is asserted resolved in design.md but reopened,
   unresolved, in tasks.md.** Decision 2 states the change "generalises...
   drilldown.js's implicit single-pane focus" as an existing, already-settled
   pattern, and the Open Questions section claims "None blocking... resolved
   above." But task 3.2 explicitly asks the executor to "confirm with focus
   rules whether both panes should render as 'focused' (single-pane screen)
   or whether TIMELINE is the implicit focus... and document the choice in a
   comment" — i.e. the exact question the design doc claims to have already
   closed is handed to the executor to decide, with no spec.md scenario
   pinning the answer either way (the "Focus is visually unambiguous"
   requirement's scenarios only cover the launch pad, never drill-down).
   This is a decision deferred that blocks implementation, dressed up as
   already-decided. Resolve it in design.md (state plainly: both drill-down
   panes render with the focused border set, or name the alternative and
   why) and delete the "confirm/resolve" language from task 3.2 — it should
   read as an instruction, not an open question.

4. **Task 3.1 leaves the GATES/EVIDENCE box count undecided, and it isn't
   cosmetic.** "GATES + EVIDENCE stacked on the right, or split into two
   boxes if that reads better — decide and note in a code comment" affects
   real, testable behaviour: two boxes cost twice the border-row overhead of
   one (relevant to the same NEEDS-YOU-guarantee-adjacent budget math raised
   in #1, and to whether "no gate results recorded" and "no evidence
   recorded" can independently lose their border at different terminal sizes
   or must degrade together). This is exactly the kind of call Decision 3
   already makes for the fleet screen (with concrete thresholds and
   rationale) — make the same call here, in the design doc, instead of
   deferring it to an implementation-time code comment with no spec.md
   scenario to check it against.

5. **`box()`'s vertical-padding contract is unstated.** Decision 1 gives an
   explicit horizontal formula (`width - 2*padding - 2` for content width)
   but flatly states content rows as `height - 2` regardless of `padding`'s
   value — no mention of whether `padding` (default 1) also reserves a blank
   row above/below content, or is horizontal-only. Given the ticket's own
   emphasis on "consistent internal padding" as a named goal, and that this
   number changes every box's row budget (feeding directly into the same
   fleet trim-loop math flagged in #1), state explicitly whether padding is
   horizontal-only or also vertical.

6. **`box()`'s title-overflow contract is unstated, in exactly the spot the
   ticket warns is highest-risk.** Decision 1 gives content lines an explicit
   overflow contract ("`…`-marked via `f.truncate`, same overflow contract as
   everywhere else"), but says nothing about what happens when a `title` —
   which will carry dynamic, sometimes-coloured text (fleet's
   `STATUS_COLOUR`-tinted section headings, drill-down's `TIMELINE ▲ N
   malformed` badge) — doesn't fit the border's available width. The ticket
   explicitly calls out that two prior bugs shipped from exactly this
   colour/width interaction going untested under `isTTY = false`; a title
   that isn't given the same explicit truncation contract as content lines is
   the same blind spot recurring in the one new place (borders) the ticket
   was written to fix. Add the same overflow contract for titles that content
   lines already have.

### Non-blocking notes

- The `hsplit`/`box` height-matching precondition ("boxes that are already
  the same height") isn't spelled out mechanically for the caller (i.e. that
  a screen must compute `max(leftLines.length, rightLines.length)` itself
  before calling `box()` twice with an explicit shared height) — but this
  follows naturally from the existing `twoCol`/`renderLaunchPad` pattern
  already in both `drilldown.js` and `launchpad.js`, so it's a reasonable
  inference for a competent implementer and not blocking.
- `MIN_BOX_WIDTH = 8` / `MIN_BOX_HEIGHT = 3`'s justification ("enough for
  border+padding+…") is a little loose arithmetically but is a threshold
  choice, not a correctness-critical formula the way the fleet trim-loop
  budget is — fine as a judgement call.
