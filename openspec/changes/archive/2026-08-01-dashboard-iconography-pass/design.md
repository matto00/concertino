## Context

The dashboard (`lib/ui/`) is a full-screen terminal UI rendered as pure `(state, opts) -> string` functions, one per screen (`fleet.js`, `drilldown.js`, `launchpad.js`, `ticketview.js`, `docview.js`, `escalation.js`, `launchplan.js`). Two existing disciplines this change must not violate:

- **Structural distinction survives colourlessness** (`dashboard-visual-design` spec's "Focus is visually unambiguous" requirement): the codebase already prefers a *character* difference over a colour-only difference wherever a distinction must survive a `isTTY === false` render.
- **No rendered line exceeds its visible-column budget** (`dashboard-visual-design` spec's "No rendered line exceeds its visible-column budget" requirement): every screen funnels its output through `f.truncate`/`f.padTo`, which measure `f.visibleLength` per code point via `format.js`'s `charWidth`/`WIDE` table.

CON-42 (this ticket) was previously, briefly, folded into CON-30's scope and then reverted before CON-30 shipped colour/hierarchy/density work only — this change is the icon work on its own, informed by, but independent of, what CON-30 shipped (`STATUS_COLOUR` is unchanged by this design).

The codebase already has a small, established icon vocabulary: `✓`/`✗`/`○`/`●` (gate status, phase pipeline markers, `drilldown.js`) and `▲` (slow-duration warning, `fleet.js`). These are all narrow (1-column), default-text-presentation Unicode symbols from the Geometric Shapes (`U+25A0`–`U+25FF`) and Dingbats (`U+2700`–`U+27BF`) blocks.

## Goals / Non-Goals

**Goals:**
- Give structural sections/labels/metadata that today carry no non-colour marker (branch row, panel titles, pane titles, metadata fields) a small, consistent icon vocabulary.
- Keep every icon strictly additive: prefixed onto existing text, never replacing it, and never load-bearing for understanding a screen's state.
- Keep every icon inside the existing 1-visible-column budget `format.js` already accounts for, with no change to `format.js` itself.
- Establish a single shared module (`lib/ui/icons.js`) so the vocabulary is defined once and every screen imports named constants rather than inlining glyphs ad hoc.

**Non-Goals:**
- Re-signalling status/state that `STATUS_COLOUR` already encodes (needs-you/running/failed/done, gate pass/fail). The fleet view's NEEDS YOU/RUNNING/FAILED/DONE section headings and the drill-down's/gate's existing `✓`/`✗`/`○`/`●`/`▲` marks are unchanged by this ticket.
- Any change to `format.js`'s `visibleLength`/`truncate`/`padTo`/`WIDE` table, or to `layout.js`'s border/focus logic.
- A user-facing toggle to disable icons. (Not requested by the ticket; icons are additive to existing text, so there is nothing to "turn off" that would change legibility — the plain label is always present regardless.)
- Icon support in `escalation.js` or `launchplan.js` — neither screen has a today-plain structural section header/label in scope for this pass; revisit in a follow-up if needed.
- The launch pad's right-pane (`ticketsTitle`) title: ground truth (`lib/ui/screens/launchpad.js:302-306`) shows this is the currently-selected **epic's name** (or `'─ unassigned ─'` / `'(no epic selected)'`), not a static "TICKETS (N)" label — a prior change already moved the pane headings to `{ "EPICS", the current epic's name }`. A "ticket(s)" icon does not fit content that is actually an epic name; out of scope for this pass rather than inventing a new glyph meaning.
- `ticketDetail.js`'s `metaLine` per-field icons (state/assignee/estimate/epic/labels): `metaLine` joins five distinct fields into one `'   ·   '`-separated string (`lib/ui/ticketDetail.js:26-34`); five additional field-level glyphs are a larger vocabulary/legibility trade-off than this pass's other, more clearly-bounded section-header applications. Only the `DESCRIPTION`/`COMMENTS` headers (Decision 2's `❏`/`✎`) are in scope this pass; a follow-up can revisit per-field metadata icons on their own.
- The drill-down's harness/speed metadata rows (`harnessText`/`speedModelsText`): no glyph in Decision 2's table is scoped to these free-form, multi-value strings (harness+model; speed+per-role models) — a single icon prefixed to a multi-clause value reads as arbitrary rather than as identifying "what kind of row this is" the way the branch/panel-title icons do. Out of scope for this pass.

## Decisions

### Decision 1: A single shared `lib/ui/icons.js` module, not per-screen inline glyphs

Exports a flat table of named constants (e.g. `icons.branch`, `icons.ticket`, `icons.timeline`, `icons.gates`, `icons.evidence`, `icons.description`, `icons.comments`, `icons.epics`, `icons.quickStart`, `icons.queue`, `icons.metrics`), each a bare glyph string (no colour/SGR — callers wrap with `f.dim`/`f.bold`/etc. themselves exactly as they already do for plain text, so icon colour follows the same per-call styling as the label it sits next to, rather than the icon carrying a hardcoded colour of its own).

Alternative considered: inline glyph literals at each call site (as the existing `✓`/`✗`/`○`/`●`/`▲` are today). Rejected — this ticket adds enough new call sites (7+ across 5 files) that a shared table is the only way to keep the vocabulary consistent and auditable in one place, matching the same "shared module, not per-screen duplication" reasoning `STATUS_COLOUR`/`ROLE_COLOUR` already established in `format.js`.

### Decision 2: Glyph selection is restricted to `Emoji_Presentation=No` codepoints from Geometric Shapes / Dingbats / Miscellaneous Technical / Mathematical Operators

Every new glyph is chosen from the same character classes the codebase's existing `✓`/`✗`/`○`/`●`/`▲` already draw from (Geometric Shapes `U+25xx`, Dingbats `U+27xx`), plus two additions from Miscellaneous Technical (`U+23xx`) and Mathematical Operators (`U+22xx`). None of the chosen codepoints carry Unicode's `Emoji_Presentation=Yes` property, which is the actual determinant of whether a terminal's emoji font renders a glyph at 2 columns regardless of what `format.js`'s `WIDE` table (built from East Asian Width, a related but distinct property) says. `format.js`'s `WIDE` table is `East_Asian_Width`-based and does not mark any of the chosen glyphs as wide either, so `f.visibleLength` already measures every one of them correctly as 1 column with zero changes to `format.js`.

The table (glyph, meaning, used at):

| glyph | codepoint | meaning | applied to |
|---|---|---|---|
| `⎇` | U+2387 | branch | drill-down branch row |
| `▤` | U+25A4 | ticket | drill-down `[1] TICKET` panel title |
| `▬` | U+25AC | timeline | drill-down `TIMELINE` panel title |
| `◆` | U+25C6 | gate/checkpoint | drill-down `GATES` panel title |
| `▧` | U+25A7 | evidence/document | drill-down `EVIDENCE` panel title; evidence reader (`docview.js`) doc title |
| `❏` | U+274F | description/page | `ticketDetail.js`'s `DESCRIPTION` header |
| `✎` | U+270E | comment | `ticketDetail.js`'s `COMMENTS` header |
| `▣` | U+25A3 | epic/group | launch pad `EPICS` pane title |
| `▶` | U+25B6 | quick start | fleet view `QUICK START` section title |
| `≡` | U+2261 | queue/list | fleet view `QUEUED (...)` section title |
| `◫` | U+25EB | metrics | fleet view `METRICS` section title |

Alternative considered: Miscellaneous Symbols (`U+2600`–`U+26FF`, e.g. `⚙` gear, `⚠` warning) — richer semantically but rejected: several codepoints in this block carry `Emoji_Presentation=Yes` in practice (rendered as 2-column colour emoji by many terminal font stacks) even where `format.js`'s East-Asian-Width-based `WIDE` table does not catch it — exactly the silent width-budget violation the ticket's own constraints warn against ("must be measured, not assumed to be one character"). Avoiding the block entirely is simpler and more robust than auditing it codepoint-by-codepoint against a property this codebase has no way to check at runtime.

Alternative considered: apply `▤` to the launch pad's right-pane title as well, treating it as a generic "tickets" label — rejected once ground truth showed that title actually renders the currently-selected epic's name, not a "tickets" label (see Non-Goals); applying a ticket icon there would mislabel an epic name as a ticket.

### Decision 3: Icon placement follows the codebase's existing "icon + space + label" convention

Every application prefixes the icon directly onto the existing label string with a single space (`icon + ' ' + label`), exactly matching `gateLine`'s existing `icon + ' ' + name` convention in `drilldown.js`. No icon ever replaces a label or a portion of one. Box titles (`layout.box({ title })`) already run through `f.truncate` with the same ellipsis convention as content — an icon-prefixed title that overflows degrades exactly as an unprefixed one already does (Decision unchanged from `dashboard-visual-design`'s "An overlong coloured title is truncated" scenario; no new truncation logic is needed).

### Decision 4: `STATUS_COLOUR`-governed sections are explicitly out of scope

NEEDS YOU / RUNNING / FAILED / DONE (fleet view section headings), and the existing gate `✓`/`✗`/`○` markers and phase-pipeline `✓`/`●`/`○` markers (drill-down), are unchanged. Per the ticket's own coordination note, an icon duplicating what `STATUS_COLOUR` already signals adds noise, not information — these sections already have a non-colour marker (their existing check/cross/circle glyphs) or their bucket is definitionally the state itself (a "FAILED" heading does not need an icon to say "these are the failed ones" on top of its red colour and its content).

## Risks / Trade-offs

- [Risk] A glyph renders as tofu/replacement-box on a font with genuinely incomplete BMP symbol coverage (rare, but not zero, for Geometric Shapes/Dingbats on some minimal fonts) → Mitigation: the icon is always prefixed onto a fully legible existing label (Decision 3); a tofu box before readable text costs nothing but a slightly odd leading character, never comprehension.
- [Risk] A future contributor adds a new icon call site using a glyph from a risky block (Miscellaneous Symbols / astral pictographs) without knowing this design's `Emoji_Presentation` constraint → Mitigation: `lib/ui/icons.js` carries a header comment stating the constraint and pointing at this design doc; all glyphs are centralised in one file, so there is one place to audit, not N call sites.
- [Trade-off] No capability-detection or opt-out for icons (unlike `format.js`'s colour-tier detection) → Accepted: icons are additive to already-legible text (Decision 3), so, unlike colour (which is invisible on a genuinely colourless terminal and thus needs a same-meaning fallback), there is no "fallback" an icon needs — the worst case is a stray character, not lost information.

## Migration Plan

No data migration. Purely additive rendering-layer change, one commit. Rollback is a plain revert — no persisted state, wire format, or telemetry event is touched.

## Open Questions

None outstanding — glyph choices, placement convention, and the `STATUS_COLOUR` scope boundary are all resolved above.
