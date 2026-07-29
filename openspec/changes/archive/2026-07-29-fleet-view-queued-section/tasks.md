## 1. Shared rendering plumbing

- [x] 1.1 Add `queued: dim` to `f.STATUS_COLOUR` in `lib/ui/format.js`.
- [x] 1.2 In `lib/ui/screens/fleet.js`, add an `unselectable` flag to the
      `sections` array entries (default falsy for the existing four), and
      change the shared `sections.forEach` loop so `index` is never
      incremented (for shown or hidden/capped rows) when
      `s.unselectable` is true.
- [x] 1.3 Add a `linesPerRow` field to every `sections` entry (`2` set
      explicitly on `NEEDS YOU`/`RUNNING`/`FAILED`/`DONE`, `1` on `QUEUED`),
      per design.md Decision 2. Change `sectionHeight(s, i)` to compute
      `2 + s.linesPerRow * shown[i] + (overflow ? 1 : 0)` instead of the
      hardcoded `2 + 2 * shown[i]` — `sectionHeight` and the row-generation
      loop (task 2.2) MUST stay in lockstep on how many lines a section's
      row costs, exactly like `s.unselectable` already must stay in lockstep
      between the index-skip (1.2) and the render branch (2.2).
- [x] 1.4 Add a single-line `renderQueuedRow(ticket, position, title, width)`
      helper alongside `renderRun`, per design.md Decision 2 (no status,
      phase, elapsed, or progress bar) — must emit exactly 1 line, matching
      the `linesPerRow: 1` set in 1.3.

## 2. QUEUED section

- [x] 2.1 Build the `QUEUED` section entry from `queueState.pending` (array
      of ticket ids) when `queueState && queueState.pending.length`, with:
      `title` = `QUEUED (<n>, running <maxConcurrent> at a time)` using
      `queueState.maxConcurrent` (no new config plumbing — see design.md
      Decision 4), `statusKey: 'queued'` (wires up the `f.STATUS_COLOUR`
      entry from task 1.1 — without this the title renders uncoloured),
      `cap: MAX_FINISHED`, `unselectable: true`, `linesPerRow: 1` (task 1.3),
      inserted after `RUNNING` and before `FAILED` in the `sections` array.
- [x] 2.2 In the per-row render loop (`fleet.js`, currently calling
      `renderRun(s.group[k], ...)` unconditionally), branch on
      `s.unselectable` to call `renderQueuedRow` (task 1.4) instead of
      `renderRun` for the QUEUED section, passing each item's 1-based queue
      position and the title looked up from `queuedTitles` (task 3.1) —
      per design.md Decision 5, the same `unselectable` flag drives both the
      index-skip (1.2) and this render-function choice; do not add a second
      flag. Verify the `… and N more queued` overflow line matches the
      existing capped-section format, and that `height()`/the trim loop
      (now reading `linesPerRow` per 1.3) stay correct for a populated
      QUEUED section.
- [x] 2.3 Ensure `QUEUED` never renders when `queueState` is absent or
      `pending` is empty, matching today's behavior with no queue.

## 3. Ticket-title lookup plumbing

- [x] 3.1 In `lib/ui/watch.js`'s `draw()`, when `queueState &&
      queueState.pending.length`, build a `Map<identifier, title>` from
      `cache.read(root).tickets` (design.md Decision 3) and pass it to
      `router.render`/the fleet screen as a new opt (`queuedTitles`).
- [x] 3.2 Update `render(state, opts)` in `fleet.js` to forward
      `queuedTitles` from `opts` into `renderFleet`'s internals alongside
      the existing `queueState` forwarding, for use by task 2.2's
      `renderQueuedRow` calls.

## 4. Tests

- [x] 4.1 `test/fleet.test.js`: QUEUED section renders with correct title
      (count + `queueState.maxConcurrent`, coloured via `statusKey: 'queued'`)
      when `queueState.pending` is non-empty, and is absent when
      `queueState` is null/empty (extends the existing queueState/queueNotice
      test block).
- [x] 4.2 Queued row shows position + ticket id, and title when present in
      `queuedTitles`; no title falls back to id-only, with no fabricated
      status/phase/elapsed/bar.
- [x] 4.3 QUEUED trims under a height budget identically to FAILED/DONE
      (shown count reduces, `… and N more queued` line appears), and is
      never treated as the pinned section (NEEDS YOU stays the only pinned
      one).
- [x] 4.4 **Height-budget regression test with a populated QUEUED section**
      (closing the gap the design-gate review found): analogous to the
      existing `'the total-height cap holds with all four sections
      populated'` test, but with NEEDS YOU/RUNNING/QUEUED/FAILED/DONE all
      populated together — assert the total rendered line count never
      exceeds the given `rows` budget and NEEDS YOU/the header are never
      pushed off the top, proving `sectionHeight`'s `linesPerRow` (task 1.3)
      change keeps the height computation and the actual 1-line QUEUED rows
      in lockstep.
- [x] 4.5 **Row-index regression test (the ticket's primary constraint):**
      render `RUNNING` + non-empty `QUEUED` + `FAILED`/`DONE` together with
      a given `selected` index pointing at a `FAILED`/`DONE` row, and assert
      the row rendered as selected is the same run `runs[selected]` refers
      to — with and without a non-empty `QUEUED` section present — proving
      QUEUED's presence never shifts the mapping.
- [x] 4.6 Confirm no queued row is ever rendered with the `▸` selection
      marker for any valid `selected` value.

## 5. Verification

- [x] 5.1 Run the full test suite (`npm test` or equivalent) and lint;
      fix any regressions in existing fleet/watch tests caused by the
      `sections` shape change.
- [x] 5.2 Manually sanity-check `openspec validate --change
      fleet-view-queued-section` passes and `files-modified.md` lists every
      touched file.
