## Skeptic Report — design gate (round 4)

Cold review. Every conclusion below is derived from the four revised artifacts and
from code I read/executed in this worktree this round — not from the orchestrator's
summary of what was fixed, and not from rounds 1-3's findings.

### What I verified (with evidence)

**Artifacts read in full, this round**
- `proposal.md`, `design.md`, `tasks.md`,
  `specs/dashboard-render-loop/spec.md`, plus `ticket.md`, `workflow-state.md`,
  and `skeptic-design-3.md` (as a claim set, not as fact).
- Baseline `openspec/specs/dashboard-render-loop/spec.md` read in full, so I could
  separate requirements/scenarios this delta authors from ones it leaves untouched
  (the baseline has five requirements; this delta modifies three).

**Round-3's single blocking request — RESOLVED, and I checked for residue beyond
the three named locations.**
- Requirement text (`spec.md:7-26`): the "SHALL write only the rows whose content
  differs" obligation is now followed, in the same paragraph, by an explicit
  carve-out — "A row whose content is unchanged … SHALL NOT be rewritten, with
  exactly one exception: the frame's own last row, which SHALL also be written …
  whenever the redraw writes anything at all". The closing padding sentence
  enumerates "because it is the frame's last row written for cursor-rest purposes"
  as a legitimate written row, so the park write is covered by the padding
  obligation too, not left in a gap.
- `spec.md:54-59` (unchanged-row scenario): WHEN now carries "and that row is not
  the frame's last row". Scoped correctly.
- `spec.md:61-68` (single-changed-row scenario): retitled "…without touching any
  other row **except the frame's last row**", WHEN adds "and the changed row is
  not the frame's last row", THEN is now "that one row's cursor placement and
  padded content, followed by the frame's last row's own cursor placement and
  padded content … with nothing written for any other row" — byte-for-byte what
  task 3.3 tells the executor to assert. The mutually-failing-suites hazard round 3
  identified is gone.
- **Residue sweep (the part I was asked not to take on trust):** I re-read all ten
  scenarios of the modified first requirement and both other modified requirements,
  and grepped all four artifacts for every "only the rows / only that row / nothing
  written / SHALL NOT be rewritten" phrasing. Every surviving instance is qualified
  with the park write in the same sentence: `proposal.md:21` ("…with the cursor
  explicitly parked at the frame's last row afterward"), `proposal.md:26` ("only
  that row plus the trailing cursor-park write"), `tasks.md:38`, `spec.md:9`
  (qualified at :13-21), `spec.md:68` (preceded by the park clause). No fourth
  conflicting location exists. The two round-3 non-blocking notes were also picked
  up: `design.md:61` and task 1.7 now carry the "not purely cosmetic" clamp
  rationale, and task 1.7's overflow-branch parenthetical now concedes the
  shrink-blanking case rather than over-claiming.
- Cross-checked the park write against the scenarios it must NOT break: "An
  entirely unchanged frame writes nothing" (`:70-73`) and "An entirely unchanged
  tick leaves the cursor exactly where it was" (`:94-98`) are both consistent with
  task 1.7's `if (bytes)` guard and Decision 5; the overflow scenario (`:75-82`)
  scopes itself to "does not use per-row diffing or absolute cursor placement",
  and the park scenario (`:84-92`) scopes its WHEN to "via the diff path", so the
  two fallback stories do not collide.

**Ground truth re-read (every code citation the artifacts make)**
- `lib/ui/watch.js:93` `CURSOR_HOME = '\x1b[H'`, `:1237` exports it; `:111-129`
  today's `buildFrame(text, cols, prevLineCount)` with `bytes = CURSOR_HOME +
  lines.join('\n')` (:113), the shrink loop emitting `'\x1b[' + row + ';1H' +
  blank` for `lines.length+1 .. prevLineCount`, `return { bytes, lineCount }`.
  Decisions 1/4/6 describe the current code accurately.
- `:229` `let lastFrameLines = 0;` with the "previous frame's line count" comment
  task 2.1 replaces; `:505` `const totalRows = process.stdout.rows || 0;` already
  exists (task 2.2's "reuse it" is satisfiable); `:544-546` the sole production
  call plus an unconditional `process.stdout.write`; `:589` resize listener;
  `:666` `attachAndRestore(…)` restore callback. Every cited line number is exact.
- `lib/ui/format.js:300-303` — `padTo` = truncate then pad to `n` **visible**
  columns, so Decision 3's "a cols change guarantees every row differs" is a
  guarantee, not a probability.
- `lib/ui/screens/fleet.js:283-289` — `budget = rows - 1` (one row reserved for
  the writer's trailing newline) and `if (sections[i].pinned) continue;` under
  "NEEDS YOU is never trimmed … we lose the header, which is the right thing to
  lose". Decision 6's premise holds. `grep -L` over `screens/*.js` confirms
  `ticketview.js`, `launchplan.js`, `escalation.js` never mention `rows` at all,
  and `drilldown.js` has no `opts.rows` read — so over-tall frames are reachable.
- Executed, this round:
  `ticketview.renderTicketView(<60-line body>, { cols:100, rows:24 })` → **72
  lines** at a 24-row terminal. (The design's own "131 lines" figure came from a
  different fixture; the load-bearing claim — a screen that ignores `rows` can
  produce a frame far taller than the terminal — reproduces.)
- `test/watch.test.js:20-83` — `startsWith(CURSOR_HOME)` (:27),
  `slice(CURSOR_HOME.length)` (:32/:47/:57), `frame.lineCount` (:38/:64/:66-69),
  and the growth test at :80-82 asserting `doesNotMatch(grown.bytes,
  /\x1b\[\d+;1H/)`. Task 3.1 names both the `\x1b[1;1H` prefix change and this
  specific inversion, so no test is left silently expected to still pass.

**Independent checks the prior rounds did not make**
- *Can anything other than `buildFrame` desync the diff cache from the screen?*
  `grep` for `process.stdout.write` / `console.*` in `lib/ui/watch.js` returns
  exactly five writes: the frame (:545), `ALT_SCREEN_ENTER` at startup (:579),
  `ALT_SCREEN_EXIT` in quit (:618) and pre-attach (:653), `ALT_SCREEN_ENTER`
  post-attach (:667). The two `console.error` sites are pre-start (:199, tmux
  missing) and post-alt-screen-exit shutdown (:629). Child processes are spawned
  with `stdio: ['ignore','pipe','ignore']` (:81, :1029), so no subprocess can
  paint over the frame. Nothing outside `draw()` writes into the live frame, so
  `prevFrameLines` remains an honest model of the screen. No change request.
- *Does the smoke gate (task 4.1) survive the diff path?*
  `test/scripts/watch-smoke.test.sh` asserts only on `\x1b[2J`, `\x1b[?1049h`,
  `\x1b[?1049l` counts (lines 70-104) — it never counts `\x1b[H`. Under redirected
  stdout `rows` is `0`, so the normal diff path runs and `CURSOR_HOME` disappears
  from the output; that breaks nothing the smoke test checks. Task 4.1 is
  satisfiable as written, with no hidden edit to that script needed.
- *Overflow tail truncation, worked through by hand:* writing `L > rows` lines
  from home scrolls exactly `L - rows` times, leaving `lines[L-rows … L-1]` on
  physical rows `1..rows` — precisely `lines.slice(Math.max(0, lines.length -
  rows))` (task 1.4). The invariant Decision 6 claims ("absolute row `i`
  corresponds to `prevFrameLines[i]` again") really is restored.
- *Resize sentinel:* `lines[i]` is always a string and `null` never equals one, so
  every row diffs as changed; `[].map(() => null)` is `[]`, so a resize before the
  first draw is harmless; `.length` survives, so the shrink loop still fires. I
  could construct no reachable state where the sentinel misbehaves — including the
  overflow-after-resize case, where the fallback branch ignores content entirely
  and still blanks against the preserved length.
- `openspec validate differential-line-diff-rendering --strict` → **"Change
  'differential-line-diff-rendering' is valid"** (exit 0). All three MODIFIED
  requirement headers match baseline names verbatim.
- No `TODO`/`TBD`/deferred decision anywhere in the four artifacts; Open Questions
  is "None"; every task names a concrete edit and tasks 3.2/3.3 are declared the
  acceptance signal (4.2), so "how would we know this is done" is answered.

### Verdict: CONFIRM

Round 3's blocking contradiction is genuinely and completely reconciled — not
patched in the three named spots and left leaking elsewhere. The spec delta,
design.md Decision 8, task 1.7 and task 3.3 now describe the same bytes for the
same tick, and an executor writing tests from the spec and one writing them from
tasks.md would produce the same suite. Scope stays inside `lib/ui/watch.js`,
`test/watch.test.js` and the spec delta, matching the ticket's scope note. The
design is sound enough to implement.

### Non-blocking notes

1. **Decision 8's new "load-bearing" clamp rationale is true in the abstract but a
   no-op in production.** `draw()` (`watch.js:541`) builds `rendered = … +
   screenText + '\n'`, so `text.split('\n')` always yields a trailing empty entry
   and the frame's last row is *always* a blank padded row. In the 30→20 resize
   case `design.md:61` describes, the shrink loop's clamped blanks therefore
   overwrite a row that was already blank — the park write repairs nothing
   visible; it only matters for a caller (i.e. a unit test) whose `text` lacks a
   trailing newline. The specified behavior (unconditional park write) is right
   either way and the "don't optimize this away" instruction should stay; just be
   aware the stated reason is stronger than reality, in case someone later writes
   a test asserting it.
2. **The requirement text's park clause is not scoped to the diff path.**
   `spec.md:16-21` says the last row SHALL be written "positioned and padded
   exactly as any other written row … whenever the redraw writes anything at all",
   while task 1.7 explicitly excludes the overflow-fallback branch. The overflow
   scenario (`:75-82`) carves out per-row placement wholesale, and in that branch
   the last row *is* still written (via the join), so nothing is ambiguous for an
   executor — but adding "(when the redraw uses the per-row diff path)" to that
   clause would make the requirement self-contained.
3. **The baseline shrink requirement is left literally over-broad across attach.**
   `openspec/specs/dashboard-render-loop/spec.md:41-51` ("WHEN a redraw produces
   fewer lines than the previous redraw THEN every row … is blanked") is untouched
   by this delta, yet Decision 7's `prevFrameLines = []` means the first
   post-attach redraw blanks nothing. That is correct behavior (`\x1b[?1049h`
   clears the alternate buffer, so there is no stale tail) and no task tests the
   contrary, so it is not blocking — but the delta's attach requirement could note
   the exemption in one clause.
4. **Task 3.7's phrasing is loose.** "no `\x1b[<row>;1H` sequences beyond what
   `join('\n')` itself implies" resolves to "none", yet the overflow branch's own
   shrink-blanking loop can legitimately emit them. Writing that test with an
   empty/short `prevLines` keeps the assertion clean; worth saying so explicitly.
5. **The trailing-`'\n'` off-by-one still isn't documented in Decision 6** (round 3
   noted this too). Consequence: a frame with exactly `rows` content lines has
   `lines.length === rows + 1` and takes the overflow fallback. That is the correct
   outcome — it reproduces today's one-line scroll exactly, and `slice(1)` is
   precisely the post-scroll visible tail — but a reader of Decision 6 has to
   rederive it. One sentence would save that.
