## Skeptic Report — design gate (round 3)

Cold review. Every conclusion below is derived from the revised artifacts and
from the actual code and executed output in this worktree — not from the claim
that round 2's four change requests were addressed.

### What I verified (with evidence)

**Artifacts read in full (revised versions)**
- `proposal.md` (mtime 01:57), `design.md` (01:56), `tasks.md` (01:58),
  `specs/dashboard-render-loop/spec.md` (00:45), plus `ticket.md`,
  `workflow-state.md`, and `skeptic-design-2.md` for the four round-2 requests.
- Baseline `openspec/specs/dashboard-render-loop/spec.md` read in full, to
  separate scenarios carried over from scenarios authored by this delta.

**Ground truth re-read (every code citation the artifacts make)**
- `lib/ui/watch.js:93` `CURSOR_HOME = '\x1b[H'`; `:1237` exports it — Risk
  bullet accurate.
- `lib/ui/watch.js:111-129` — current `buildFrame(text, cols, prevLineCount)`,
  `bytes = CURSOR_HOME + lines.join('\n')` (:113), shrink loop emitting
  `'\x1b[' + row + ';1H' + blank` for `row = lines.length+1 .. prevLineCount`,
  `return { bytes, lineCount }`. Decisions 1/4/6 describe today's code correctly.
- `lib/ui/watch.js:229` `let lastFrameLines = 0;` — the variable task 2.1
  replaces, with the comment task 2.1 says to rewrite.
- `lib/ui/watch.js:505` `const totalRows = process.stdout.rows || 0;` already
  exists; `:506` `screenRows`; `:544` the sole production `buildFrame` call
  followed by an unconditional `process.stdout.write`. Task 2.2's "reuse the
  existing `totalRows`" is satisfiable as written.
- `lib/ui/watch.js:589` resize listener, `:666` `attachAndRestore(...)` restore
  callback (`ALT_SCREEN_ENTER`, raw mode, `resume()`, `running = true`) — both
  cited line numbers exact, both close over `watch()`'s scope.
- `lib/ui/format.js:300-303` — `padTo` = `truncate` then pad to `n` **visible**
  columns, i.e. exactly `cols` visible columns. Decision 3's "a cols change is a
  guarantee, not a probability" holds.
- `lib/ui/screens/fleet.js:280-291` — `budget = rows - 1` with the
  reserved-newline comment, and `if (sections[i].pinned) continue;` under "NEEDS
  YOU is never trimmed … we lose the header, which is the right thing to lose."
  Decision 6's premise holds.
- `test/watch.test.js:20-83` — `startsWith(CURSOR_HOME)` (:27),
  `slice(CURSOR_HOME.length)` (:32/:47/:57), and the growth test at :80-82
  asserting `doesNotMatch(grown.bytes, /\x1b\[\d+;1H/)`. Task 3.1 now names both
  the prefix change and this inversion explicitly (round-2 note picked up).

**Executed evidence (mine, this round)**
```
$ node -e "fleet.renderFleet(runs, { cols:100, rows })"   # 10 runs, 4 needs-you
rows=40 -> lines=27
rows=30 -> lines=27
rows=20 -> lines=18
rows=12 -> lines=14      # > rows: the deliberate NEEDS-YOU overflow
```
Reproduces round 2's measurement exactly. A 30→20 row resize really does take a
real `fleet` frame from 27 to 18 lines, so the shrink-on-resize path Decision 3
now protects is live, not theoretical.

**Round-2 request 1 (resize invalidation regressed the shrink loop) — RESOLVED.**
Decision 3 (design.md:36-41) now specifies `prevFrameLines = prevFrameLines.map(() => null)`
— content invalidated, `.length` preserved — with the 27→18 regression documented
as the reason; task 2.4 matches verbatim and explicitly forbids `= []` here; the
spec's resize requirement (spec.md:126-138) now mandates CONTENT invalidation
"SHALL preserve the previous frame's own line count," distinguished from the
attach reset; task 3.9 adds a regression test for exactly this (null-mapped
`prevLines` of length N, shorter new frame, trailing rows `N` still blanked). I
checked the mechanism itself: `lines[i]` is always a string, `null` never equals
it, so every row diffs as changed; `[].map(() => null)` is `[]`, so a
pre-first-draw resize is harmless. The attach/resize asymmetry is stated in both
Decision 3 and Decision 7 rather than treated as one pattern, as requested.

**Round-2 request 2 (`rows === 0` self-contradiction) — RESOLVED.**
`overflow = rows > 0 && lines.length > rows` is now the sole condition, stated
identically in design.md:50 and task 1.3, with the dropped `prevLines.length > rows`
disjunct explained (redundant given task 1.4's tail truncation) and task 1.3
explicitly instructing the executor not to re-add it. The consequential spec edit
request was also honoured: the overflow scenario (spec.md:66-73) no longer carries
the "…or the immediately previous frame did" clause the truncated-tail cache cannot
observe. `grep` over all four artifacts finds no surviving reference to the old
disjunct except the two that explain its removal. Tasks 3.1/3.2 (pass `rows = 0`,
expect `bytes === ''`) are now implementable.

**Round-2 request 3 (proposal contradicted design on first/post-resize frames) — RESOLVED.**
`proposal.md:7` now says the diff is "the mechanism used for **every** frame except
one: a frame taller than the terminal"; `:8` says the first frame and the
post-resize frame "both still go through the diff path above — NOT the
full-rewrite path" with an invalidated cache. `:21` (the capability-level
statement) agrees, and now matches design Decision 3, task 3.1's `\x1b[1;1H`
row-1 prefix instruction, and spec.md:7-13's "including every row of the very
first frame of a session … positioned via its own cursor placement." The
"three cases" phrasing is gone from every artifact.

**Round-2 request 4 (cursor resting position) — ADDRESSED IN DESIGN, NOT IN THE SPEC.**
Decision 8 (design.md:58-61) takes the explicit decision (park at the last row on
any writing tick), with the rejected alternative recorded and a Risks bullet
(design.md:71). Tasks 1.7, 1.10, 3.3, 3.10 and proposal.md:11/:21/:26 all carry it.
The spec delta added two scenarios for it (spec.md:75-89). But the same delta's
own requirement text and two of its other scenarios still forbid exactly what
Decision 8 mandates — see the change request below.

### Verdict: REFUTE

Three of round 2's four change requests are cleanly and correctly resolved, and
I could construct no reachable state where the new resize sentinel or the
simplified overflow condition misbehaves. Request 4's fix, however, was applied
to `design.md`/`tasks.md`/`proposal.md` but only *added to* the spec delta, not
reconciled with it: the delta now contains a normative `SHALL NOT` and two
scenarios that the cursor-park write violates on essentially every writing tick.
This is the same defect class as round-2 request 3 (the capability-level contract
specifying different bytes than the design/tasks), just relocated from
`proposal.md` into the spec — and the spec delta is the artifact that gets
archived into `openspec/specs/`, so it is the one that must be right.

### Change Requests

1. **The spec delta contradicts its own new cursor-park scenario: a
   `SHALL NOT` and two scenarios forbid the write that Decision 8 / task 1.7
   require.**
   Under task 1.7, a tick where (say) row 3 of a 20-row frame changed and row 20
   did not writes `\x1b[3;1H<row3>` **followed by** `\x1b[20;1H<row20>`. That is
   directly forbidden by three places in
   `specs/dashboard-render-loop/spec.md`, all authored by this delta (none of
   them carried over unchanged from the baseline spec, which I checked):
   - **`spec.md:14-15`** (requirement text): "A row whose content is unchanged
     from the previous frame SHALL NOT be rewritten." The park write rewrites
     the last row whenever it is unchanged but some other row changed. Also
     `:8-10` ("SHALL write **only** the rows whose content differs").
   - **`spec.md:48-52`** (Scenario: *An unchanged row between two consecutive
     polls is not rewritten*): "THEN no bytes are written for that row in this
     redraw — **neither its content nor a cursor placement targeting it**."
     The park write is precisely a cursor placement targeting an unchanged row
     plus its content.
   - **`spec.md:54-59`** (Scenario: *A single changed row is rewritten without
     touching any other row*): "THEN the bytes written for that redraw consist
     of that one row's cursor placement and padded content **only, with nothing
     written for any other row**." Task 3.3 tells the executor to assert the
     opposite ("plus … a trailing `\x1b[<lines.length>;1H` + last-row-content
     cursor-park write"), and task 4.2 names 3.3 as this change's acceptance
     signal. An executor writing tests from the spec and an executor writing
     them from tasks.md produce mutually failing suites.
   Required: reconcile all three, keeping Decision 8 (which I agree is the right
   call) as the authority. Concretely — (a) amend the requirement text at
   `:8-15` so the "only changed rows" obligation is stated with its single
   explicit exception (the frame's last row, rewritten as the cursor-park write,
   whenever the redraw writes anything at all); (b) rewrite the `:48-52`
   scenario's THEN to scope it to rows other than the frame's last row (or add
   an explicit "except as required by the cursor-park scenario" carve-out);
   (c) rewrite the `:54-59` scenario's THEN to be "that one row's placement and
   content, plus the cursor-park write for the last row, and nothing for any
   other row" — which is exactly what task 3.3 already describes. Do not resolve
   this the other way (dropping the park write): the design's reasoning for it is
   sound, and it also turns out to be load-bearing for correctness (see note 1).

### Non-blocking notes

- **The park write is doing more work than Decision 8 credits it with — say so,
  so it is not later "optimized" away.** `\x1b[<row>;1H` for a row beyond the
  terminal's height clamps onto the bottom row (design.md:10 states this itself).
  In the normal diff path the shrink loop can now target rows beyond `rows`,
  because the resize sentinel preserves a pre-resize `prevLines.length` that may
  exceed the new `rows`. When `lines.length === rows` exactly and
  `prevLines.length > rows` (e.g. a 30-row terminal showing a 30-line frame,
  resized to 20 rows with a 20-line frame), the shrink loop's blanks all clamp
  onto row `rows` — blanking the last *real* row the diff loop just wrote. Task
  1.7's park write repairs this, but **only** because it is specified to run
  after the shrink loop (task 1.6). Without it the cache would record content at
  that row while the screen showed blank, and the diff would never repaint it.
  Worth one sentence in Decision 8 / task 1.7 so a future "skip the park write
  when the last row was already in the changed set" tweak does not silently
  reintroduce a permanently blank bottom row.
- Task 1.7's parenthetical rationale for skipping the park write in the overflow
  branch ("`CURSOR_HOME + lines.join('\n')` already ends at the last row exactly
  as today") is imprecise: when that branch's shrink-blanking loop also fires,
  the cursor ends on a blanked row instead. This is today's behavior, so it is
  not a regression and needs no code change — just don't let the stated reason
  become a claim someone later tests.
- `lines.length > 0` in task 1.7 is always true (`String.split('\n')` never
  returns an empty array), so the guard is dead but harmless.
- Round 2's note about `test/watch.test.js:80-82` (growth test assertion
  inverting) is picked up in task 3.1; round 2's note about keeping the
  total-`rows`-vs-`screenRows` arithmetic in the design is partially picked up
  (design.md:50 explains the choice but not the trailing-`'\n'` off-by-one).
  Neither blocks.
- Non-Goals, Migration Plan, Open Questions and the impact list all remain sound;
  no objection. Scope stays inside `lib/ui/watch.js` + `test/watch.test.js` +
  the spec, matching the ticket's scope note.
