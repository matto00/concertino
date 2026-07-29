## Context

`lib/ui/reducer.js#reduce` is a pure fold: event log + tmux window state ->
the `Run` model every screen renders. It holds no ambient I/O and nothing in
it reads from disk beyond the event log `store.js` already hands it. Ticket
title/description are not events — they come from Linear, fetched once by
the orchestrator at Setup and never logged verbatim to `events.jsonl` (the
`run.start` event carries only `branch`/`worktree`/`dev_port`/`backend_port`/
`harness`/`model`, per `reducer.js`'s own `applyEvent`). So resolving ticket
text is necessarily a small I/O read outside `reduce()`, same shape as the
existing `queuedTitles` read in `lib/ui/watch.js`'s `draw()` (`cache.read(root)`,
gated on the queue being non-empty, passed through `opts` to `router.render`).

Two sources already hold the text `lib/ui/cache.js` (`.concertino/cache/linear.json`,
written by the launch pad's bulk fetch) and, once this change ships,
`.concertino/runs/<TICKET_ID>/evidence/ticket.md` (written by
`core/scripts/persist-evidence.sh`, the same mechanism `evidence-telemetry`
already uses for `proposal.md`/`design.md`/`tasks.md`). The cache is bulk and
volatile — refreshed on demand, scoped to currently-open tickets, so a closed
ticket silently drops out of it. The persisted `ticket.md` is a per-run
snapshot, written once during that run's own Planning phase, and — critically
— it is copied into the main checkout specifically so it survives
`cleanup.sh --phase4` destroying the worktree (this is `persist-evidence.sh`'s
entire reason to exist; see `evidence-telemetry`'s spec). It is therefore the
more honest source when both exist, and the only source at all once a run's
worktree is gone.

`core/roles/orchestrator.md`'s Phase 1 step 6 already loops over
`proposal.md`, `design.md`, `tasks.md`, and spec deltas, calling
`persist-evidence.sh` for each and emitting an `evidence` event on success.
`ticket.md` is written one step earlier in the same phase (step 2, "Scaffold
the change and write ticket context") and is not currently in that loop —
adding it is the one-line role change the ticket's own notes anticipate.

`lib/ui/screens/ticketview.js` already solves the adjacent "show a ticket's
markdown-ish description as readable, wrapped, bounded terminal text" problem
for the launch pad's own ticket viewer — but that screen reads straight from
`ticket.description`/`ticket.title` (cache fields, already plain enough for
its own purposes) and has never needed to strip markdown syntax, because
nothing in this codebase has needed the "plain text, not raw markup" property
before. This change is the first caller that does, since a Linear description
written for a human reader in a browser is full of `#`/`*`/`` ` ``/`[]()`
markup that reads as noise on an 80-column terminal panel shared with three
other panels.

## Goals / Non-Goals

**Goals:**
- Show the ticket title in the drill-down header and the description in a
  readable, bounded TICKET panel.
- Resolve text from the persisted `ticket.md` when present, falling back to
  the launch pad cache, falling back to an honest `ticket text unavailable`.
- Render markdown as plain text; strip control bytes the same way every other
  panel on this screen already does (through `f.truncate`).
- Never let a long description grow the panel past a fixed budget; truncate
  visibly when it does, the same convention TIMELINE already uses.
- Work for a finished run whose worktree has been destroyed (only ever read
  the persisted copy or the cache — never the worktree path).

**Non-Goals:**
- No interactive scrolling of the TICKET panel. The drill-down screen has no
  existing scroll/pane-focus concept (`design.md`'s Decision 2 for this
  screen's original build: "no second input target for a focused style to be
  distinguished from"); adding one for a single panel would be new
  interaction surface the ticket does not ask for. "Truncate visibly" (the
  acceptance criterion's own alternative to scrolling) is sufficient and
  consistent with how TIMELINE already handles overflow.
- No full markdown rendering (no tables, no nested lists with indentation
  preserved, no syntax-highlighted code fences). The acceptance criterion is
  "rendered as plain text, not raw markup" — stripping the syntax noise, not
  reproducing Linear's rich-text layout in a terminal.
- No change to how the launch pad's own `ticketview.js` screen sources its
  data (still cache-only) or displays it (still raw markdown-ish text) —
  out of scope for this ticket, and that screen has never claimed the "plain
  text" property.
- No new `evidence` event schema. `ticket.md` reuses the existing `evidence`
  event kind exactly as `proposal.md`/`design.md`/`tasks.md` already do.

## Decisions

### Decision 1: Read ticket text from the persisted path directly, not by scanning `evidence` events

`persist-evidence.sh`'s destination is deterministic:
`<main checkout>/.concertino/runs/<TICKET_ID>/evidence/<basename of SOURCE_PATH>`.
Since the orchestrator always writes the scaffolded file as `ticket.md`
(`core/roles/orchestrator.md` Phase 1 step 2's `WORKTREE_PATH/<change-dir>/ticket.md`),
the persisted copy's path is always
`.concertino/runs/<TICKET_ID>/evidence/ticket.md` — computable with no event-log
read at all. `lib/ui/ticket-text.js` builds this path directly (`path.join(root,
'.concertino', 'runs', ticket, 'evidence', 'ticket.md')`) and reads it if present.

Alternative considered: filter `run.events` for `kind === 'evidence'` with a
`ticket.md`-shaped `label`/`ref`, mirroring how `evidenceLines()` already
reads the EVIDENCE panel's list. Rejected — it makes ticket-text resolution
depend on `reduce()` having successfully parsed that specific event (fragile
against a malformed log line, an orchestrator that hasn't emitted it yet this
poll, or a future relabeling of the evidence event), for no benefit: the
destination path is already fully determined by
`persist-evidence.sh`'s own naming convention, which this module can rely on
directly, the same way `evidence-telemetry`'s own tests already assert
against that exact path shape.

### Decision 2: `lib/ui/ticket-text.js` is impure (reads disk), separate from `reducer.js`

`reduce()`'s purity (no I/O, no clock, testable via a passed-in `now`) is a
design property the codebase repeatedly protects — reap.js, retention.js and
`queuedTitles` in `watch.js` all keep filesystem/tmux reads at the impure
edge and feed pure functions their result, never the other way around.
`ticket-text.js` follows the same shape: `resolve(root, ticket, cache) ->
{ title, description } | null` is a small, directly testable function (it is
impure only in the sense that it does one `fs.readFileSync`, exactly like
`cache.js#read` does — same "missing/malformed degrades to null, no thrown
error" contract, so a caller never needs a try/catch of its own).

`watch.js`'s `draw()` calls it once per poll, **gated on
`mode === 'drilldown'`** (mirroring the existing `queuedTitles` gate on a
non-empty queue) — there is exactly one ticket whose text the current frame
can possibly show, so reading it for every run in the fleet every poll would
be pure waste. The result is passed through `opts.ticketText`, the same seam
`queuedTitles` already uses, so `router.js` needs no change and `drilldown.js`
picks it up in its existing `render(state, opts)`.

Alternative considered: fold ticket text onto the `Run` object inside
`reduce()`. Rejected — it would make `reduce()` impure (a disk read per run,
every poll, whether or not the drill-down is even open), a much larger
behavior change to a function every other screen also depends on being pure
and cheap, for a value only one screen ever needs.

### Decision 3: Parse `ticket.md`'s title from its first heading; scope the description to its `## Description` section, not the whole remainder

The orchestrator's own ticket.md convention (unchanged by this proposal,
already followed by every existing run's scaffolded file) opens with
`# <TICKET_ID>: <Title>`. `ticket-text.js` extracts the title with
`/^#\s*(?:\S+:\s*)?(.+)$/` against the first non-empty line (stripping a
leading `TICKET-ID:` token if present, falling back to the whole heading text
if the line doesn't match that shape at all — never throwing on an
unexpected first line).

**Revised per the design-gate skeptic's first change request:** the
description is *not* "everything from the second line onward" — a real
`ticket.md` (this very run's own file, read as ground truth during that
review) routinely carries multiple `##` sections beyond the description
proper (`## Where the text comes from`, `## Acceptance criteria`, `## Notes`,
`## Metadata` with `Priority`/`URL` bullets). Feeding all of that into a
panel already capped at 5 rows (Decision 7) would as likely show boilerplate
(a redundant `Description` heading, `Priority: High`, a raw URL) as the
actual descriptive prose the acceptance criteria ask the panel to show.

So `ticket-text.js` scopes the description to the content of the first `##
Description` heading it finds (case-insensitive match on the heading text),
up to the next `##`-level heading or end of file. This is safe to rely on:
`core/roles/orchestrator.md` step 2 is updated by this same change (task 5.1)
to write `ticket.md` with a `## Description` section immediately following
the title, so every run's `ticket.md` from this change forward has one.
For a `ticket.md` that predates this change (no `## Description` heading at
all — the only case where "no such section" can occur, since it is now
mandatory going forward), `ticket-text.js` falls back to everything between
the title and the first `##` heading it finds (or the whole remainder, if
the file has no `##` headings at all) — i.e. the introductory prose before
any subheading, which is the closest available approximation to "the
description" for a file written before the convention existed. Either way,
the extracted text is handed to `lib/ui/markdown.js` unmodified (still
markdown — stripped at render time, not parse time, so the persisted file
itself stays a faithful, unmodified copy of what the orchestrator wrote).

Alternative considered: require the orchestrator to write a stricter,
machine-structured `ticket.md` (e.g. a `TITLE:`/`BODY:` split with no
markdown at all). Rejected — `core/roles/orchestrator.md`'s ticket.md is read
directly by the executor/evaluator/skeptic sub-agents as prose context, not
just by this dashboard feature; losing its markdown section structure for
their benefit would be a worse trade than one dashboard-side heading-scoped
parse. Requiring the one section heading (`## Description`) this change
already needs to add is the smaller, more targeted convention change.

Alternative considered (raised in the same skeptic review): silently accept
full-body inclusion as a documented trade-off instead of scoping the parse.
Rejected — the ticket's own acceptance criteria specifically ask for "the
description in a readable block," and a 5-line-capped panel that can fill
with `Priority: High` and a raw URL instead of the actual description is not
a minor trade-off, it is the panel failing its own acceptance criterion on
any ticket with a `## Metadata`-shaped tail (which, per this run's own
`ticket.md`, is not a rare shape).

### Decision 4: Cache fallback needs no parsing

The launch pad cache's ticket records (`lib/ui/linear.js`'s `title`/
`description` fields, written straight from Linear's GraphQL response) are
already split into title and description — no heading to parse, no format
convention to match. `ticket-text.js`'s cache path is therefore just a
`cache.read(root).tickets.find((t) => t.identifier === ticket)` lookup handing
back `{ title, description }` directly.

### Decision 5: A small, local markdown-to-plain-text helper, not a dependency

`lib/ui/markdown.js#toPlainText(md)` strips, in order: fenced code blocks'
backtick fences (keeping the code's own text), heading `#` markers, blockquote
`>` markers, bullet markers (`-`/`*`/`+` -> `• `), ordered-list numbering,
inline code backticks, `**bold**`/`__bold__`/`*italic*`/`_italic_` markers, and
`[text](url)` link syntax (kept as `text`, the URL dropped — this is a
120-column-or-narrower terminal panel, not a browser; a bare URL competing
with the link text for the same bounded width is worse than dropping it, and
the panel already truncates visibly when content overflows). It does not
touch control bytes — those are handled downstream, same as every other
string on this screen (see Decision 6).

Alternative considered: pull in an existing markdown-to-text npm package.
Rejected — `package.json` has zero runtime dependencies today (`bin/concertino`'s
own header: "Zero dependencies"), and the transformation this ticket actually
needs (strip syntax noise, do not reproduce rich layout — see Non-Goals) is a
handful of regexes, not a parser. Adding a dependency for that is a worse
trade than the ~20 lines this needs.

### Decision 6: Control-byte stripping stays implicit, via the existing final `f.truncate` pass

Every other panel on this screen (TIMELINE, GATES, EVIDENCE) gets its control-
byte safety for free from `renderDrillDown`'s existing final line
`out.map((l) => f.truncate(l, cols)).join('\n')` — `f.truncate` already runs
every line through `stripUnsafeControls` before measuring/truncating it (see
`format.js`'s own header comment: "the way to a terminal, is where hostile
control bytes stop being possible"). The TICKET panel's content lines flow
through that exact same final pass — no separate call to
`stripUnsafeControls` is needed in `ticket-text.js` or `markdown.js`, and
adding one would be redundant with, not an improvement on, the mechanism the
ticket's own note ("the way the launch pad already strips them") is pointing
at.

### Decision 7: Bounded height via a fixed content-row budget, truncated visibly — not measured against remaining screen space

TIMELINE/GATES/EVIDENCE's widths are already computed from available columns
minus overhead (`rightContentWidth`, `leftContentW`); doing the equivalent for
TICKET's *height* against whatever vertical space TIMELINE/GATES/EVIDENCE
don't use would require restructuring their existing height-reconciliation
math (`targetHeight`, `evidenceBoxHeight`) to know about a panel above them
that doesn't exist yet in that computation — a much larger, riskier change to
logic three panels already depend on being stable.

Instead, TICKET gets its own fixed cap, independent of terminal height:
`TICKET_MAX_LINES = 5` content rows (title-less; the title is already in the
header, see Decision 8) for the description body. When the wrapped
description has more than 5 lines, only the first 5 are shown, followed by a
dimmed `… N more lines` row (mirroring TIMELINE's own `… N earlier events`
convention exactly — `f.dim`, prefixed ellipsis, count of what's hidden).
This bounds the panel's contribution to the screen to a small, constant
number of rows regardless of description length, satisfying "long
descriptions do not push the timeline or gates off the screen" without
touching the existing panels' sizing math at all.

Alternative considered: size TICKET dynamically from remaining terminal rows
after TIMELINE/GATES/EVIDENCE claim theirs. Rejected for this change — real
coupling to the existing height-reconciliation code for a benefit ("show a
few more lines on a very tall terminal") the ticket does not ask for; a fixed
cap is simpler, satisfies every acceptance criterion, and is not a one-way
door (a follow-up can make it dynamic later without touching the resolution
or rendering logic this change adds).

### Decision 8: Title in the header (new row), description in a new panel below the phase pipeline

The header already carries three rows (`ticket + changeName` / `branch` /
`worktree + ports`) each paired with a right-aligned status field. A fourth
row, directly under row 1, carries the ticket title alone (`f.bold`,
`f.truncate`'d to `cols`, or the `ticket text unavailable` fallback in
`f.yellow` matching the other degradation strings) — it has no natural
right-aligned counterpart, so it is not forced into `splitLine`'s two-column
shape.

The TICKET panel itself goes between the phase pipeline and the TIMELINE/
GATES/EVIDENCE row — after the pipeline (which is itself a single dense line,
costing nothing to keep first) and before the three-panel split, so a
narrow-terminal degrade (`layout.degrade`) drops its border in the same pass
as the other three, top to bottom, rather than being visually disconnected
from them. Its `pane()` call carries a `title: 'TICKET'`, matching
TIMELINE/GATES/EVIDENCE, which all pass a box title today — the new panel is
not a visual exception among its siblings.

## Risks / Trade-offs

- **[Risk]** `ticket.md`'s first-line-heading parse assumes every existing
  run's file matches `# <anything>` on its first non-empty line. →
  Mitigated: every current orchestrator-written `ticket.md` already does
  (Decision 3); a file that doesn't match still degrades to "whole first line
  as title", never a thrown error, per `ticket-text.js`'s `null`-safe read
  contract (Decision 2).
- **[Trade-off]** A fixed 5-line cap means a very short terminal and a very
  long description both get exactly 5 lines' budget — not adaptive. →
  Accepted per Decision 7; "truncate visibly" is the acceptance criterion's
  own explicit alternative to scrolling, and a constant bound is what makes
  this change safe to add without touching the existing panels' height math.
- **[Risk]** The cache fallback can show a *stale* title/description (fetched
  before the ticket was last edited in Linear) for a run whose `ticket.md`
  was never persisted. → Accepted: this is the documented trade-off of using
  the cache at all (`cache.js`'s own header: "never the source of truth"),
  and the persisted copy — preferred whenever it exists — has no such
  staleness (it is exactly what the run worked from, by construction).
- **[Risk]** A `ticket.md` persisted before this change (no `## Description`
  heading yet, since that convention is introduced by this same change) falls
  back to "prose before the first `##` heading" (Decision 3), which is a
  looser approximation than the scoped section match every run gets going
  forward. → Accepted: this only affects runs whose Planning phase completed
  before this change ships, is strictly better than today's total absence of
  a TICKET panel, and self-heals — every run from this change forward gets
  the precise, section-scoped parse.
- **[Risk]** A persisted `ticket.md` that exists but is empty or
  whitespace-only (e.g. a write interrupted mid-Planning) would, without
  guarding against it, resolve to `{ title: '', description: '' }` — which
  passes a bare `null` check and would render an empty title row / empty
  panel instead of the mandated `ticket text unavailable` honesty fallback.
  → Mitigated: `ticket-text.js#resolve` treats a blank title (after trimming)
  as equivalent to an unreadable file — it falls through to the cache, and
  only returns `null` (triggering the fallback text) once the cache lookup
  also comes up empty. Covered by an explicit test case (task 2.3).

## Migration Plan

Purely additive: three new modules (`ticket-text.js`, `markdown.js`,
`textwrap.js` extracted from `ticketview.js` with no behavior change), one
new panel and one new header row in `drilldown.js`, one new gated read in
`watch.js#draw`, and a one-line addition to `core/roles/orchestrator.md`'s
existing persist-evidence loop plus its `evidence-telemetry` spec delta. No
schema change, no config change. A run in flight when this ships simply has
no persisted `ticket.md` yet for its already-completed Planning phase; the
drill-down falls back to the cache for it exactly as it does for any older
run, and gets the persisted copy on its next run. Rollback is reverting the
`drilldown.js`/`watch.js` changes and the role-prompt line; nothing else in
the run/event/schema surface is touched.

## Open Questions

None outstanding.
