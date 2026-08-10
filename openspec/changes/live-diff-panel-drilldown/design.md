## Context

The drill-down (`lib/ui/screens/drilldown.js`) is a pure `(run, opts) -> string` renderer with four
panels — TICKET, TIMELINE, GATES, EVIDENCE — reachable via `1`-`4`/`Tab` (`DRILL_PANELS`). All
non-pure work (reading a file, resolving ticket text) happens in `watch.js`'s `draw()`, gated to
"only while this screen is actually open," and is threaded into the renderer through `opts` —
never performed inside the renderer itself. `reducer.js` already tracks `run.worktree` from the
run's `run.start` event. `docview.js` already provides a generic, reusable "read a long text
document in a bounded, scrollable pane" screen, used today by the EVIDENCE panel's file-open flow
(`evidence-reader` capability) and by `ticketview.js`.

Three design decisions were escalated on the ticket and answered by the human (see
`workflow-state.md`):
1. Live-refresh cadence: **every poll** (~1s), not focus/keypress-only.
2. Worktree-gone behavior: an honest **"worktree removed"** message — no persisted snapshot.
3. Binary/large-diff handling: **truncate**, with an explicit marker, not refuse.

## Goals / Non-Goals

**Goals:**
- A fifth CHANGES panel, consistent with the existing four panels' focus/scroll/degrade
  conventions.
- `git diff --stat` recomputed every poll tick while the drill-down is open on that ticket.
- Expand a selected file to its full unified diff via the existing `docview` reader.
- Honest degradation once the worktree is gone, and on a binary/oversized diff.

**Non-Goals:**
- No durable diff persistence (unlike EVIDENCE's `ticket.md`/report convention) — CHANGES is a
  live-only view of an in-flight worktree, by the human's own decision above.
- No staged-vs-unstaged distinction, no diff of a specific commit range, no interactive
  stage/unstage — this is a read-only observability panel, not a git porcelain.
- No change to TICKET/TIMELINE/GATES/EVIDENCE's own existing behavior or specs.

## Decisions

### Decision 1: `git diff --stat`/`git diff -- <file>` shell out from `watch.js`'s `draw()`, gated

Follows the exact pattern `drillTicketText` already establishes (`watch.js` around the
`ticketText.resolve()` call): a small, synchronous, per-poll read gated on
`S.mode === 'drilldown' && S.drillTicket`, computed in `draw()` and threaded into
`router.render()`/`renderDrillDown()` via `opts` (e.g. `opts.diffStat`) — never inside the pure
renderer. This also matches `open-evidence-doc`'s existing precedent of doing filesystem I/O only
from a controller/`draw()`-level seam, wrapped in try/catch.

Using `execFileSync('git', ['diff', '--stat', '--no-color'], { cwd: run.worktree, encoding: 'utf8',
timeout: <bounded> })` — `execFileSync` (not `exec`) avoids shell interpolation of `run.worktree`
entirely, consistent with `session.js`'s existing `execFileSync`/`spawnSync` usage elsewhere in this
codebase. A bounded `timeout` (e.g. 2000ms, well under `POLL_MS`) and a try/catch around the call
mean a slow or failing `git` degrades to "diff unavailable" rather than stalling the poll loop that
every other screen also depends on.

**Alternative considered:** recompute only on panel focus/keypress. Rejected per the human's answer
— every poll is simpler to reason about (one code path, matches every other panel's "always fresh"
behavior) and `git diff --stat` against a single worktree is cheap relative to `POLL_MS`; the
ticket's own concern (cost against a *large* working tree) is addressed by gating computation to
only the one ticket currently drilled into, not the whole fleet, and by the bounded timeout above.

### Decision 2: Worktree-gone detection and message

Before shelling out, `draw()` checks `run.worktree` is set and `fs.existsSync(run.worktree)`. When
either is false, the CHANGES panel renders the fixed degradation string `worktree removed —
CHANGES is only available while a run's worktree exists` (mirroring the exact styling of this
screen's other degradation strings: `no evidence recorded`, `no gate results recorded`, `ticket text
unavailable`), and no `git` call is attempted at all. This covers both a run whose worktree
`cleanup.sh --phase4` has already removed, and (defensively) a `run.worktree` path that has gone
missing for any other reason — the panel does not distinguish these ("worktree removed" is the
honest thing to say either way; the panel is not in a position to explain a filesystem/cleanup
history it cannot see).

### Decision 3: File selection and full-diff expansion reuse EVIDENCE's own focus/selection pattern

CHANGES becomes the fifth entry in `DRILL_PANELS`, gets its own `drillChangesIndex` selection state
(mirroring `drillEvidenceIndex`), and reuses `layout.selectionWindow` for its visible-window
scrolling exactly as `evidenceWindow()` already does. Pressing the open key (`↵`, focus-gated to
CHANGES exactly like EVIDENCE's own gate) on a selected file dispatches a new controller action,
`open-diff-doc`, which shells `git diff -- <file>` (again `execFileSync`, again bounded/try-caught)
and opens the result in `docview` — the same `S.mode = 'docview'` transition `open-evidence-doc`
already uses, with `esc` returning to the drill-down with CHANGES still focused and the same file
still selected (mirroring `evidence-reader`'s existing "esc preserves selection" requirement,
extended here to CHANGES).

**Alternative considered:** a dedicated diff-viewer screen with side-by-side or syntax-highlighted
rendering. Rejected as out of scope for v1 — `docview`'s plain-text scrollable pane is already the
established, reused pattern for "show me the full content of this thing," and a unified diff is
already reasonably readable as plain text (`+`/`-` prefixes carry the signal); this can be revisited
later without changing this change's own scope.

### Decision 4: Binary/large-diff truncation

`git diff --stat` itself is already compact (one summary line per file) and is never truncated.
Truncation applies only to the **expanded full diff** (`git diff -- <file>`, Decision 3): output
beyond a fixed line cap (matching `TICKET_VIEWPORT_ROWS`/`EVIDENCE_MAX_VISIBLE`'s existing "small,
named constant" convention — e.g. `MAX_DIFF_LINES = 2000`) is cut, with a trailing marker line (`…
truncated — diff exceeds Ν lines`) appended, rather than either silently dropping content or
refusing to open the reader at all. A binary file's diff (`git diff` already prints `Binary files a/…
and b/… differ` for these, never an actual patch body) needs no special-case truncation logic; that
one-line message is already short and is shown as-is inside the same reader.

### Decision 5: Footer hints — extend, don't duplicate, the "only advertise a live key" discipline

`5`/`Tab` are always advertised once CHANGES exists as a fifth panel (both are structural, not
conditional — same as `1`-`4`/`Tab` today). The CHANGES-focused footer (new, alongside the existing
"default" and "evidence-focused" footer variants in `renderDrillDown`) shows selection/open hints
only when the stat list actually has at least one file. Note this is narrower than EVIDENCE's own
historical (four-panel-era) "focus switch is inert when there is nothing to select" requirement:
the lazygit-layout pass already made every `DRILL_PANELS` entry a legitimate focus target
regardless of content (confirmed in `lib/ui/screens/drilldown.js`'s current `handleKey` and its
own regression test), so CHANGES follows *that* current behavior — the focus switch itself is
never blocked — and only the footer hints/selection-cursor activity are gated on non-empty
content, matching the *narrower* "keys advertised only when they currently do something"
discipline `sections.js` already establishes, not the older, now-superseded EVIDENCE wording.

### Decision 6: CHANGES joins the right column as a third stacked pane, with a widened content-width floor

CHANGES sits in the same right column as GATES/EVIDENCE (`renderDrillDown`'s existing
`layout.hsplit([timelineBox, rightColumn])` composition), stacked below EVIDENCE, rather than as a
fourth top-level column or replacing TIMELINE's full-width row — this keeps the existing
TICKET-then-TIMELINE/right-column structure intact and requires no change to how `leftContentW` is
derived.

- **Width:** `rightContentWidth(run)` (currently capped at `RIGHT_MAX = 34`, sized for short gate
  names) is extended to also consider the diff-stat line widths — `git diff --stat` lines are
  typically `<path> | <N> +++---`, which routinely exceeds 34 columns for a nested path. Raise
  `RIGHT_MAX` (e.g. to 50) and fold the stat lines' own `f.visibleLength` into the same `Math.max`
  chain `rightContentWidth` already builds from gate/evidence content, rather than giving CHANGES a
  separate width computation. `leftContentW`'s existing floor (`minLeftContent`) and the
  `cols - totalOverhead - minLeftContent` cap on the right column both already protect TIMELINE from
  being crushed by this — no change needed there beyond the new `RIGHT_MAX`.
- **Height reconciliation:** `renderDrillDown`'s existing two-box right-column math
  (`gatesBoxHeight + evidenceBoxHeightNatural = rightTotalHeight`, reconciled against
  `leftNaturalHeight`/the outer `rows` budget) is extended to three boxes:
  `gatesBoxHeight + evidenceBoxHeightNatural + changesBoxHeightNatural = rightTotalHeight`, and the
  same "whichever side is naturally shorter gets padded up to the taller side's total" logic applies
  unchanged — the padding is still applied to TIMELINE (the left column), now absorbing three
  boxes' combined border overhead (6 rows) instead of two (4 rows) when the right column is taller.
  `footerRowCount`'s existing per-branch computation (`confirm` / `evidenceFocused` / default) gains
  a fourth branch, `changesFocused`, alongside `evidenceFocused` — not folded into it — since the
  two panels' hint sets differ.

**Alternative considered:** a fourth top-level column (TICKET | TIMELINE | GATES/EVIDENCE |
CHANGES). Rejected — narrower terminals already `degrade()` (drop borders) well before a fourth
column would fit, and the existing GATES+EVIDENCE stacked-pane precedent is the established pattern
for "a second, size-driven panel sharing TIMELINE's row" — CHANGES is a third instance of the same
pattern, not a new one.

## Risks / Trade-offs

- **[Risk]** `git diff --stat` every poll tick against a very large worktree could still be slow
  even gated to one ticket. **Mitigation:** bounded `execFileSync` timeout (Decision 1) degrades to
  "diff unavailable" rather than blocking the poll loop; this is the same shape of protection
  `open-evidence-doc`'s try/catch already gives a slow/missing file read.
- **[Risk]** A worktree mid-write (agent actively committing) could make `git diff` transiently
  fail or race. **Mitigation:** try/catch degrades that single poll's CHANGES panel to "diff
  unavailable," self-heals on the next poll tick — no different from any other transient read
  failure this dashboard already tolerates.
- **[Trade-off]** No persisted diff snapshot means CHANGES shows nothing once cleanup has run —
  accepted per the human's explicit answer; the PR (linked from EVIDENCE once created) is the
  durable artifact for a finished run, not this panel.

## Migration Plan

Additive only — a new panel, a new icon, a new footer variant, a new controller action. No existing
event schema, state field, or spec requirement changes. No rollback complexity beyond a normal
revert.

## Open Questions

None outstanding — the three questions raised at Planning have been answered (see Context above).
