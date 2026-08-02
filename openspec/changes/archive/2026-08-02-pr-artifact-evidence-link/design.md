## Context

The drill-down's EVIDENCE panel (`lib/ui/screens/drilldown.js`) currently understands exactly one
kind of artifact: a file, persisted via `persist-evidence.sh`, referenced by an `evidence` event's
`ref`/`label` fields, opened via the `open-evidence-doc` action into `docview.js`'s in-TUI reader
(`evidence-reader` capability). CON-55 asks for a second kind — a PR — surfaced in the same list
but opened externally (the OS default browser) instead of internally.

`reducer.js` already pushes every event onto `run.events` regardless of `kind` (no reducer change
needed to make a new event kind reach the screens). `describeEvent()`'s TIMELINE rendering has a
safe default for an unrecognized kind (renders `ev.kind` as the label), so this is additive
everywhere it touches, not a breaking change to the existing event schema.

The orchestrator creates the PR in Phase 3 Delivery step 4 (`gh pr create`) and already knows the
resulting `PR_URL` at that point (it is passed to the auditor in step 6 verbatim). That is the one
place in the whole workflow the URL is known and durable — nothing needs to be inferred or fetched
later.

## Goals / Non-Goals

**Goals:**
- Surface a run's PR in the EVIDENCE panel once it exists, visually distinct from file artifacts.
- Pressing Enter on it opens the URL in the OS default browser instead of the doc reader.
- Fail visibly, never crash, if the browser-open command is unavailable or fails.
- Leave every existing file-based evidence behavior (selection, windowing, doc-reader open, esc
  return) byte-for-byte unchanged.

**Non-Goals:**
- Cross-platform browser-open support. This tool is Linux-only in practice (every other
  process-spawning code path in the repo — `session.js`'s `tmux attach`, `draft.js`'s `claude -p`
  — assumes a Linux/POSIX shell already); `xdg-open` is the only opener implemented. A future
  platform is a follow-up, not blocking here.
- Multiple PR artifacts per run. A run has exactly one PR in this workflow's model (Phase 3 creates
  it once; there is no re-creation path). The design still degrades sanely if more than one `pr`
  event is ever present (last one wins — see Decision 2), but nothing here builds multi-PR UI.
- Changing `reducer.js`'s event ingestion. It is already kind-agnostic; nothing about a new kind
  requires touching it.

## Decisions

### Decision 1: New event kind `pr`, not a variant of `evidence`

Emit `kind: 'pr'` (fields: `url`, `label`) as its own top-level event kind, rather than
`kind: 'evidence'` with a discriminator field (e.g. `evidenceType: 'pr'`).

Rationale: `evidence` events' contract (per `evidence-telemetry`'s spec) is specifically "a durable
local `ref` a human can read via the doc reader" — every existing consumer (`evidenceItems()`,
`persist-evidence.sh`'s own callers) assumes `ref` resolves to a readable file. Overloading that
same kind with a URL-only variant would mean every future `ref`-reading call site also has to
learn to skip PR-shaped entries. A distinct `kind` keeps the file-artifact contract exactly as
strict as it is today, and is exactly the precedent this schema already follows for orthogonal
concerns (`verdict`, `escalation.raised`, `note`, etc. are all separate kinds, not variants of one
generic "thing happened" event).

**Alternative considered:** `kind: 'evidence', evidenceType: 'pr'`. Rejected — it would require
every `ref`-reading call site (todo and future) to branch on `evidenceType` to know whether `ref`
is safe to `fs.readFileSync`, where a distinct kind makes that impossible to get wrong by
construction (a `pr` event simply has no `ref` field at all).

### Decision 2: `evidenceItems()` merges both kinds into one list; last `pr` event wins

`evidenceItems(run)` becomes `(run.events || []).filter((ev) => ev.kind === 'evidence' || ev.kind
=== 'pr')`, preserving event order (oldest first, same as today). Since a run has at most one PR
in practice, no dedup logic is needed for the common case; if more than one `pr` event is ever
present (e.g. a future re-run scenario), the panel does not need to hide the earlier one — it
simply renders every `pr` event it has, exactly like it already would for two `evidence` events
with the same label. Nothing about this decision requires the panel to reason about "the current"
PR versus a stale one; that's a non-goal (see above), and the simplest correct behavior (render
what's in the log, in order) already holds.

### Decision 3: A new `open-external-url` action, not overloading `open-evidence-doc`

`handleKey()`'s `drillFocus === 'evidence'` branch, on `\r`, currently always returns
`{ type: 'open-evidence-doc', ticket, ref, label }`. It now branches on the selected item's `kind`:
a `pr` item returns `{ type: 'open-external-url', ticket, url, label }` instead; an `evidence` item
returns the existing action unchanged. This keeps `open-evidence-doc`'s contract (a `ref` that is
always a readable-file path, or degrades to "file not found") exactly as it is today — no new
optionality for its existing consumer (`watch.js`'s handler) to account for — and gives the new
external-open path its own contract (a `url`, no filesystem read at all) instead of overloading one
action type with two incompatible shapes of payload.

### Decision 4: Browser-open lives in `watch.js`, synchronous, `execFileSync`-based, one dedicated helper

`watch.js` already imports `execFileSync` from `child_process` (used for tmux-adjacent process
work). The new `open-external-url` handler calls a small helper, `openInBrowser(url)`, implemented
with `execFileSync('xdg-open', [url], { stdio: 'ignore' })` wrapped in try/catch. On success:
no-op (the browser opens in the background; the dashboard keeps running exactly as before — no
mode change, no re-render beyond whatever already happens). On failure (throw — `xdg-open` missing,
non-zero exit, anything): set `drillNotice` to a visible message
(`could not open <url> in a browser: <reason>`), reusing the exact mechanism the
`restart-confirmed` handler already uses for its own visible failure (`drillNotice = result.error`)
— no new UI plumbing, no new state shape.

**Alternative considered:** spawn `xdg-open` detached/async (`spawn(..., { detached: true,
stdio: 'ignore' }).unref()`) instead of `execFileSync`. Rejected for v1: `execFileSync` blocking
the poll loop for the sub-second duration `xdg-open` itself takes to hand off to the desktop's
URL handler and return is not observable (every other synchronous `execFileSync` call in this file
already blocks the same poll loop for tmux queries of similar or greater cost); a detached spawn
adds an unref/error-listener surface for a failure mode (`xdg-open` missing) that must be
synchronously known before an accurate `drillNotice` can be set anyway, since the notice has to be
visible on the very next render.

### Decision 5: One new icon, no new colour vocabulary

`icons.js` gains one glyph (`icons.pr` or `icons.link`) drawn from the same restricted codepoint
classes (`Emoji_Presentation=No`, Geometric Shapes/Dingbats/Misc Technical/Math Operators) the
file's header comment already constrains every glyph to. `evidenceLines()` prefixes a `pr`-kind
entry's label with this icon instead of the plain `▸ `/`  ` selection marker prefix file entries
use today — file entries are visually unchanged; only the new kind gets a distinguishing prefix,
per the ticket's "render distinctly... so it's clear Enter will leave the TUI" acceptance
criterion. No new colour is introduced — the existing `f.bold` (selected) / plain (unselected)
styling applies identically to both kinds, keeping this a minimal, additive visual change.

### Decision 6: Emission point — Phase 3 Delivery step 4, immediately after `gh pr create`

The orchestrator's `core/roles/orchestrator.md` gains one `emit-event.sh` call directly after PR
creation (before step 5's "post the PR link back to the ticket"):
`scripts/concertino/emit-event.sh pr ticket=$TICKET_ID role=orchestrator url="$PR_URL"
label="PR: <title>"`. This is the same "emit telemetry at the point the fact becomes durable"
discipline the orchestrator role already follows for every other phase transition and evidence
call — no new timing concept, just one more call site.

## Risks / Trade-offs

- [Risk] A desktop environment with no default browser handler configured makes `xdg-open` exit
  non-zero or hang → Mitigation: `execFileSync` surfaces a non-zero exit as a thrown error, caught
  and turned into a visible `drillNotice`; a hang is bounded the same way any other blocking
  `execFileSync` call in this file already is today (no new timeout mechanism is introduced, matching
  existing precedent — this is not a regression, since no such timeout exists for the file's other
  `execFileSync` calls either).
- [Risk] `xdg-open` is not installed at all (minimal/headless environments) → Mitigation: this is
  exactly the "browser-open command fails" acceptance criterion; caught identically to the
  non-zero-exit case above.
- [Trade-off] Linux-only (`xdg-open`) with no `open`/`start` fallback for macOS/Windows → accepted
  per Non-Goals; this project's other process-spawning code already assumes the same platform.

## Migration Plan

No data migration. Existing runs with no `pr` event simply show no PR entry in EVIDENCE (the
existing "no evidence recorded" fallback, or the existing file-only list, is unaffected) — this is
purely additive to the event schema and the panel's rendering. No rollback concerns beyond
reverting the code change.

## Open Questions

None outstanding — the design self-resolves the one representational choice (event kind shape) and
the one platform-scope question (Linux-only) that the ticket flagged as open.
