## Skeptic Report — design gate (round 2)

Cold review. Every conclusion below is derived from the revised artifacts and
from the actual code in this worktree — not from the claim that round 1's six
change requests were addressed.

### What I verified (with evidence)

**Artifacts read in full (revised versions)**
- `proposal.md` (mtime 01:00), `design.md` (01:01), `tasks.md` (01:02),
  `specs/dashboard-render-loop/spec.md` (00:45), plus `ticket.md`,
  `workflow-state.md` (`SKEPTIC_CYCLE: 0`), and `skeptic-design-1.md` for the
  six round-1 requests.

**Ground truth re-read (every code citation the new artifacts make)**
- `lib/ui/watch.js:111-129` — current `buildFrame(text, cols, prevLineCount)`,
  `bytes = CURSOR_HOME + lines.join('\n')`, shrink loop at :122-127,
  `return { bytes, lineCount }`.
- `lib/ui/watch.js:495-546` — `cols` at :495, **`totalRows = process.stdout.rows || 0`
  already exists at :505**, `screenRows` at :506, the sole production
  `buildFrame` call at :544. Task 2.2's "reusing the existing `totalRows`
  local … if present" is satisfied: it is present.
- `lib/ui/watch.js:150-156` — `attachAndRestore` **is** `try { fn() } finally { restore() }`,
  so Decision 7's "the restore callback already runs on both paths" is true.
- `lib/ui/watch.js:666-671` — the `attachAndRestore(...)` call and its restore
  callback (`ALT_SCREEN_ENTER`, raw mode, `resume()`, `running = true`); the
  callback closes over `watch()`'s scope, so `prevFrameLines = []` is reachable
  there. Line citation accurate.
- `lib/ui/watch.js:589` — `process.stdout.on('resize', () => { if (running) runs = draw(); });`
  Line citation accurate.
- `lib/ui/watch.js:1234-1238` — `CURSOR_HOME` is exported on :1237 exactly as
  design.md's Risk bullet claims.
- `lib/ui/format.js:300-303` — `padTo` = `truncate` then pad to `n` **visible**
  columns. Decision 3's "cols change is a guarantee, not a probability" is
  correct.
- `lib/ui/screens/fleet.js:275-291` — `budget = rows - 1` with the reserved-row
  comment, and `if (sections[i].pinned) continue;` under "NEEDS YOU is never
  trimmed … we lose the header, which is the right thing to lose."
- `grep -ln rows lib/ui/screens/*.js` → only `fleet.js`, `launchpad.js`,
  `drilldown.js`; `grep -n rows lib/ui/screens/drilldown.js` shows **prose only**
  (:62, :145, :312, :437-443), no `opts.rows` read. Design.md:10's claim about
  which screens bound their height holds.
- `grep -rn "25l|25h" lib/ scripts/ test/` → **no match anywhere in the repo**:
  the dashboard never hides the terminal cursor (basis for request 4).
- `grep -rn buildFrame` → exactly one production call site (:544) plus
  `test/watch.test.js`. Risk bullet accurate.
- `test/watch.test.js:20-83` — the existing suite: `startsWith(CURSOR_HOME)`
  (:27), `slice(CURSOR_HOME.length)` (:32, :47, :57), and the growth test at
  :80-82 asserting `doesNotMatch(grown.bytes, /\x1b\[\d+;1H/)`.
- `test/scripts/watch-smoke.test.sh` — every invocation redirects stdout to a
  file (`> "$OUT"`), so `process.stdout.rows` is `undefined` and `rows` is `0`
  on every gate run. The `rows === 0` branch is not a test-only curiosity; it
  is the branch the smoke gate exercises.

**Executed evidence (mine, this round)**
```
$ node -e "fleet.renderFleet(runs, { cols: 100, rows })"   # 10 runs, 4 needs-you
rows=40 -> lines = 27
rows=30 -> lines = 27
rows=20 -> lines = 18
rows=12 -> lines = 14        # > rows: the deliberate NEEDS-YOU overflow, confirmed
```
A rows-shrinking resize (30 → 20) shortens the frame from **27 lines to 18**.
This is the executed basis for request 1 below. `rows=12 -> 14 lines` also
independently confirms Decision 6's premise (over-tall frames are reachable
and intended).

**Round-1 requests that ARE resolved (verified, not taken on trust)**
- **R1 (attach cache invalidation)** — resolved. Decision 7 + task 2.3 + spec
  `MODIFIED` "Attach suspends and restores…" requirement with the new scenario
  ("The first redraw after returning from attach rewrites every row"), and
  `proposal.md:26` now explicitly retracts the old "untouched by this ticket's
  scope" assertion. The `try/finally` premise checks out (`watch.js:150-156`).
  `prevFrameLines = []` is also the *correct* invalidation here specifically,
  because `\x1b[?1049h` clears the buffer — there is no stale tail to blank.
- **R2 (over-tall frames)** — substantially resolved. Decision 6 + tasks
  1.3/1.4/3.7/3.8 + the spec's "A frame taller than the terminal falls back to
  a full rewrite" scenario + a Non-Goal ruling out fixing `screens/*`. I
  checked the arithmetic myself: with `rendered` carrying a trailing `'\n'`,
  `lines.length = content + 1`, so `lines.length > rows` fires exactly when
  newline flow would scroll — consistent with `fleet.js`'s own `rows - 1`
  budget. And `lines.slice(lines.length - rows)` is precisely the tail the
  scroll leaves at physical rows `1..rows`. The reasoning is sound. One
  internal inconsistency remains (request 2).
- **R3 (resize contradiction)** — the *contradiction* is resolved: proposal,
  design Decision 3, and the spec delta now all say "resize forces a full
  rewrite," a rows-only scenario was added, and the `cols` argument is
  correctly restated as a `padTo` guarantee. But the mechanism chosen to
  implement it introduces a new, worse defect (request 1).
- **R5 (test rewrite scope / `CURSOR_HOME` fate)** — resolved. Task 3.1 names
  the 3-byte → 7-byte prefix change explicitly as a semantic rewrite; task 1.8
  decides unambiguously that the constant and its export are **kept**, with the
  greppability guarantee addressed in a Risk bullet.
- **R6 (task 4.2 acceptance signal)** — resolved. Tasks 3.2/3.3 are named as
  the acceptance signal; the unverifiable manual check is demoted to an
  explicit nice-to-have.
- Both round-1 non-blocking notes are also picked up (Decision 5's
  `if (frame.bytes)` guard at the call site; comment rewrites made explicit in
  tasks 1.9, 2.1, 2.2 and a Risk bullet).
- Spec delta hygiene: all three `MODIFIED` requirements carry their existing
  scenarios forward, and the untouched "A shrinking frame leaves no stale
  trailing rows" requirement (`specs/dashboard-render-loop/spec.md:41`) really
  is still satisfied by tasks 1.3/1.6 in both the diff and fallback paths —
  I traced the overflow → non-overflow transition and the tail-truncation
  keeps it correct.

### Verdict: REFUTE

Four of the six round-1 requests are cleanly resolved. R2 is resolved with one
internal inconsistency left in it. **R3's fix is where this fails:** the design
now invalidates the resize cache by assigning `prevFrameLines = []`, which
throws away the previous frame's *length* — and that length is the only input
to the shrink-cleanup that the existing, already-shipped spec requirement
"Shrinking the terminal during a run does not corrupt the display" depends on.
The delta's own retained scenario for that requirement is therefore
unsatisfiable by its own task 2.4. Plus one artifact-level contradiction that
is a recurrence of round-1 R4, and one user-visible consequence of the
mechanism switch that no artifact addresses.

### Change Requests

1. **Resize invalidation as `prevFrameLines = []` regresses the spec'd
   shrink-on-resize cleanup — the delta contradicts its own retained
   scenario.**
   Task 2.4 and Decision 3 both specify `prevFrameLines = [];` in the resize
   listener. The shrink-blanking loop (task 1.6, and `watch.js:122-127` today)
   is driven entirely by `prevLines.length`. With the cache emptied, that loop
   cannot fire on the resize-triggered redraw — `0 > lines.length` is never
   true.
   Executed evidence that this is a live path, not a theoretical one: a
   30 → 20 row resize takes `fleet` from **27 lines to 18** (see above). Today
   `lastFrameLines = 27 > 18` blanks rows 19-27, which cleans the still-visible
   stale rows 19-20 (the writes to rows 21-27 are harmless no-ops). After this
   change those rows keep pre-resize content, because the alternate screen is
   not cleared by a resize. That is exactly the corruption
   `specs/dashboard-render-loop/spec.md:102-106` was written to prevent, and
   the delta *retains* that scenario verbatim
   (`specs/.../spec.md:124-128`: "blanks trailing rows exactly as a regular
   poll-tick redraw would, leaving no stale content from the larger,
   pre-resize frame") while task 2.4 makes it impossible.
   Required: invalidate the *content* without discarding the *length*. Round
   1 offered the shape that works — a `forceFullRedraw` flag `draw()`/
   `buildFrame` consumes (every row counts as changed, `prevLines.length` still
   drives the shrink loop) — or equivalently seed `prevFrameLines` with a
   sentinel array of the same length that can never equal a padded line. Pick
   one, state it in Decision 3, fix task 2.4, and make sure the retained resize
   scenario and the new rows-only scenario are both satisfiable by the chosen
   mechanism. Note this does **not** apply to attach (Decision 7): there
   `\x1b[?1049h` genuinely clears the buffer, so `= []` is correct and should
   stay — the two invalidations are not the same operation and the design
   should say so rather than treating them as one pattern.

2. **The `rows === 0` case: Decision 6's stated condition contradicts
   Decision 6's stated consequence, and tasks 1.3 and 3.1/3.2 are jointly
   unimplementable as written.**
   Decision 6 defines the fallback as firing when `overflow` **or when
   `prevLines.length > rows`**, then asserts two sentences later: "When `rows`
   is `0` … `overflow` is always `false` and this fallback never triggers."
   That is false for the second disjunct: with `rows = 0`, any non-empty
   `prevLines` satisfies `prevLines.length > 0`, so the fallback fires on
   **every** frame after the first. Task 1.3 repeats the condition verbatim.
   Task 3.1 then instructs: "Pass `0` … for `rows` in every test that is not
   specifically testing overflow fallback, so those tests exercise the normal
   diff path" — under task 1.3's condition those tests exercise the *fallback*
   path instead, and task 3.2 ("`bytes === ''` on the second call") fails
   outright. An executor must guess which of the two mutually exclusive
   readings is authoritative, and the two guesses produce different production
   behavior for non-TTY stdout — which is not hypothetical: every
   `test/scripts/watch-smoke.test.sh` invocation redirects stdout to a file, so
   `rows` is `0` for the whole smoke gate.
   Required: state the condition once, unambiguously (e.g.
   `if (overflow || (rows > 0 && prevLines.length > rows))`), and fix task 1.3
   to match. While you are there, resolve whether the second disjunct is needed
   at all: task 1.4 already stores only the visible tail
   (`length <= rows`), and both attach and resize now reset the cache, so with
   `rows > 0` I can construct no reachable state where `prevLines.length > rows`
   — either drop it or keep it and label it defensive, so a later reader does
   not mistake it for load-bearing. If it is dropped, the spec scenario at
   `specs/.../spec.md:66-74` ("…**or the immediately previous frame did**")
   must lose that clause, since the truncated-tail cache cannot observe it.

3. **`proposal.md:8` and `:20` still contradict the design about the first
   frame and the post-resize frame — round-1 R4 recurring in new words.**
   `proposal.md:8`: the full-frame cursor-home + newline-flow path "is kept,
   and used deliberately, in three cases … **the very first frame of a
   session** …, **the frame immediately following a terminal resize** …, and
   any frame taller than the terminal". `proposal.md:20` repeats it: those
   three "still do a full newline-flow rewrite."
   Design Decision 3 says the opposite and is right: "the first frame needs no
   special code path" — an empty cache makes every row count as changed, so the
   first frame is written through the **diff** path as per-row
   `\x1b[<row>;1H` writes, never `CURSOR_HOME + join('\n')`. Same for the
   post-resize frame under Decision 3's cache reset. Task 3.1 agrees with the
   design (it tells the executor to expect the row-1 prefix `\x1b[1;1H` "wherever
   a full-rewrite frame (first frame — empty `prevLines`) is being asserted
   on"), and so does the spec delta (`specs/.../spec.md:7-13`: every written
   row, "including every row of the very first frame of a session", is
   "positioned via its own cursor placement (`\x1b[<row>;1H`)"). Only
   `CURSOR_HOME + lines.join('\n')` is genuinely newline flow, and only the
   over-tall case uses it.
   Required: rewrite `proposal.md:8` and `:20` so the mechanism claim matches —
   one fallback case (over-tall, plus the frame after one if request 2 keeps
   that guard), and two cache-invalidation cases (first frame / resize) that go
   through the diff path with an empty-or-sentinel cache. This matters beyond
   wording: `:20` is the change's capability-level statement of the contract,
   and as written it specifies different bytes for the single most-asserted
   path in `test/watch.test.js` than the spec delta does.

4. **No decision anywhere about where the terminal cursor comes to rest — the
   mechanism switch moves it from a stable position to a per-tick-varying one,
   and the cursor is visible.**
   `grep -rn "25l|25h" lib/ scripts/ test/` returns nothing: the dashboard
   never emits `\x1b[?25l`, so the terminal's cursor is visible for the whole
   session. Today `bytes = CURSOR_HOME + lines.join('\n')` ends with the
   frame's trailing padded line, so the cursor lands at the bottom of the frame
   on every single tick — stable and out of the way. Under the diff path the
   last byte written is the last *changed* row's padded content, so the cursor
   comes to rest at the right-hand edge of whichever row happened to change
   (the clock row, an idle timer, a progress bar) and moves vertically from
   tick to tick; on an unchanged tick nothing is written at all, so it sits
   wherever the previous tick abandoned it. A blinking cursor jumping around
   mid-dashboard once a second is a user-visible regression of the very
   "visual stillness" property CON-17 and this ticket exist to improve, and
   neither `design.md`'s Decisions nor its Risks / Trade-offs mention it.
   Required: take an explicit decision — cheapest is to append a fixed
   trailing cursor placement to a non-empty diff frame (park it where the
   full-rewrite path leaves it today, i.e. the frame's last row) so the resting
   position is unchanged from today; hiding the cursor for the session is the
   other option but is a broader behavior change with its own
   restore-on-every-exit-path obligation, which this ticket's scope note does
   not obviously cover. Add the corresponding task, and if the resting position
   is chosen as a guarantee, a spec scenario. Explicitly accepting the jitter
   with a stated rationale in Risks / Trade-offs is also an acceptable
   resolution — what is not acceptable is that the design is silent on it.

### Non-blocking notes

- `test/watch.test.js:80-82` ("a frame that grows … blanks nothing") asserts
  `doesNotMatch(grown.bytes, /\x1b\[\d+;1H/)` — under task 3.4 growth now
  writes per-row placements, so this assertion inverts. Task 3.1 names the
  `CURSOR_HOME`-prefix tests specifically but not this one; naming it too would
  keep the executor from "fixing" a red test by weakening the regex. It will
  fail loudly either way, so this is a note, not a request.
- Decision 6's choice of total `rows` over `screenRows` is correct and I
  verified the off-by-one against `fleet.js:280-283`'s reserved-row comment and
  the trailing-`'\n'` in `rendered` (`watch.js:539`). Worth keeping that
  arithmetic in the design as a sentence — it is the kind of thing a later
  reader will otherwise re-derive nervously.
- The Non-Goals (no sub-row diffing, no generic diff utility, no `screens/*`
  edits) and the Migration Plan remain sound; no objection.
