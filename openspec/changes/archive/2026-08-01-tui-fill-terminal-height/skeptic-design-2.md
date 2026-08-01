## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read the current `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both
  spec deltas (`specs/dashboard-full-height-layout/spec.md`,
  `specs/docview/spec.md`), `workflow-state.md`, and round 1's
  `skeptic-design-1.md` (treated as a claim to re-check, not as fact).

- **Round 1's change request — checked for actual resolution, not just
  presence of new text.** Round 1 required that `tasks.md`/`design.md` stop
  claiming live-terminal reproduction was unavailable, make it a required
  (not optional) step, and record actual measured evidence (screen, terminal
  size, unused-row count) for the ticket's AC #1. Confirmed:
  - `design.md`'s Context section now has a "Live reproduction (ticket AC
    #1)" subsection (lines 38-63) explicitly stating tmux was available all
    along, crediting the round-1 finding, and reporting per-screen measured
    numbers against a 100x30 terminal for all three affected screens
    (`escalation.js`, `launchplan.js`, `docview.js`/`ticketview.js`).
  - `tasks.md` §6.1 is now checked off (`- [x]`), states the reproduction is
    already done (not deferred/optional), cites the same measured numbers,
    and explicitly says "This satisfies the ticket's AC #1."
  - `tasks.md` §6.2 (new) requires re-running the same three reproductions
    post-implementation to verify the fix, closing the loop.
  - This structurally satisfies round 1's request.

- **Arithmetic check on the newly-added "measured" numbers (design.md lines
  47-56).** For each screen the doc states "content through row X (footer);
  rows X+1-30 blank — N unused rows" against a 30-row terminal, so N must
  equal `30 - X`:
  - `escalation.js`: X=18, claimed N=12. `30-18=12`. Consistent.
  - `launchplan.js`: X=19, claimed N=11. `30-19=11`. Consistent.
  - `docview.js`/`ticketview.js`: X=9, claimed N=**18**. `30-9=21`, not 18.
    **Inconsistent** — "rows 10-30 are genuinely blank" is 21 rows
    (10,11,...,30 inclusive = 21), not 18. Either the stated footer row (9)
    is wrong (should be ~12, if 18 is the correct blank count), or the
    blank-row count (18) is wrong (should be 21, if row 9 is the correct
    footer position), or the row range itself is mistranscribed. As written,
    the three numbers in this one bullet cannot all be true simultaneously.
  - I attempted to sanity-check this independently: `node -e` calling
    `ticketview.renderTicketView()` directly with a short-description,
    no-comments ticket at `cols:100, rows:30` produces a 12-line frame
    (unaffected by `rows` pre-fix, as expected — the bug). Adding the one
    top-bar row `watch.js`'s `computeScreenRows()` reserves
    (`reserved = bannerLines + 1`, `watch.js:731`, with `bannerLines=0` when
    no escalation banner is showing) would put that frame's last line
    ("esc back") at terminal row 13, not row 9 — a different ticket's
    content could plausibly be shorter and land at row 9, so this alone
    doesn't prove the reproduction wasn't run, but it does not corroborate
    row 9 either, and doesn't resolve which of the design doc's own three
    numbers is the mistake.

  This matters because this exact subsection is the artifact round 1 forced
  into existence specifically to give AC #1 ("how much unused space")
  genuine, trustworthy measured evidence rather than a static-trace
  estimate. A self-contradictory measurement in that subsection undermines
  the credibility of the reproduction claim it makes right above it ("no
  live terminal was actually unavailable... confirmed via `tmux
  capture-pane`, not inferred") — at minimum it's a transcription error;
  at worst it signals the number wasn't actually read off a real capture.
  Either way it must not ship into the design as-is.

- Re-verified (not just trusted round 1's prior pass) that the rest of the
  design's file:line claims still hold in the current worktree:
  `escalation.js:187`'s `boxContent.length + 2` and no `opts.rows` read
  anywhere in the file; `launchplan.js:211-226`'s `ticketViewportRows` computed
  but unused by `boxHeight`; `docview.js`'s `bodyBox` unconditional
  `content.length + BOX_BORDER_ROWS`; `fleet.js:836-948`'s existing
  grow-to-fill pattern being mirrored. All accurate.

- Read `specs/dashboard-full-height-layout/spec.md` and `specs/docview/spec.md`
  in full — scenarios match design.md's Decisions 2-5 exactly, no drift, no
  placeholders, no `TODO`/`TBD`.

- Checked scope: all 7 `lib/ui/screens/` files are accounted for (3 changed,
  3 already-correct/no-change, 1 shared function with 2 callers); no work
  beyond the ticket's two ACs; both ACs (reproduce-first, fill-without-
  overflow) are traceable to design content and task items.

### Verdict: REFUTE

### Change Requests

1. `design.md`'s "Live reproduction" subsection (lines 53-56) — the
   `docview.js`/`ticketview.js` bullet's three numbers are internally
   inconsistent: "content through row 9" + "rows 10-30... blank" implies 21
   unused rows, not the stated "18 unused rows". Re-check the actual tmux
   capture for this screen and correct whichever number is wrong (footer
   row, blank-row range, or blank-row count) so all three agree, the same
   way the `escalation.js` and `launchplan.js` bullets already do
   (`30 - X = N` holds for both of those). Propagate the corrected number
   into `tasks.md` §6.1's citation of "docview.js/ticketview.js leaves 18"
   if it changes.

### Non-blocking notes

- Everything else from round 1 is resolved correctly: the false "no live
  terminal available" claim is gone, §6.1 is a completed required step (not
  an optional spot-check), and §6.2 adds the appropriate post-implementation
  re-verification. Once Change Request 1 is fixed, this design is sound
  enough to implement as written — the `Math.max(natural, budget - used)`
  mirroring of the existing `fleet.js`/`drilldown.js`/`launchpad.js` pattern,
  the `rows - 1` reserved-row convention, and the spec deltas all check out
  against the real code.
