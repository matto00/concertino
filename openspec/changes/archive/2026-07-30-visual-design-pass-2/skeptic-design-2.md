## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

**Artifacts read as claims, then checked against code:** `ticket.md`,
`proposal.md`, `design.md`, `tasks.md`, `specs/dashboard-visual-design/spec.md`,
plus round 1's `skeptic-design-1.md` and the baseline
`openspec/specs/dashboard-visual-design/spec.md`.

**Ground-truth reads:** `lib/ui/format.js` (full), `lib/ui/layout.js` (full),
`lib/ui/screens/launchpad.js` (constants + `epicRow`/`ticketRow`/`renderLaunchPad`),
`lib/ui/screens/fleet.js` (`statusLine`/`renderRun`/section loop),
`test/layout-colour.test.js`, `test/format-colour.test.js`.

**Executable probe.** Because CR1 was the most involved fix, I did not reason
about it — I implemented the revised design verbatim into a scratch copy of
`lib/` (format.js: `SUPPORTS_256`, `fg()` dispatch, `bgFill`, `running: cyan`;
layout.js: `borderColour(false) → f.dim`, `box()`'s `body`/`fillRow` per
design.md:87-90; launchpad.js: tasks 5.1 + 5.2) and rendered the real launch pad
with `isTTY` forced. Every result below was reproduced on two consecutive runs.

**Per-column fill coverage measured off the real rendered line** (`#` = the
background fill is active on that column, `.` = it is not):

```
epics pane focused, cols=80  (leftPaneWidth 34)
.################################...   → cols 1-32 filled, borders at 0/33. CORRECT.

tickets pane focused, selected ticket priority=High (no inner colour), cols=80
....................................###########################################.
                                     → 43 of 43 inner cols filled. CORRECT.

tickets pane focused, selected ticket is LIVE ('▲ running' → f.yellow), cols=80
....................................########################################....
                                     → fill DIES 4 columns short of the row's edge.

tickets pane focused, selected ticket has UNKNOWN priority ('?' → f.dim), cols=80
....................................############................................
                                     → fill DIES after 12 of 43 columns.
```

Raw line for the unknown-priority case (note the embedded `\x1b[0m`):

```
\x1b[48;5;236m  ▸ [ ] \x1b[2m?   \x1b[0m CON-31    A tick…  Todo        \x1b[0m
```

**Existing colour suite, run against the probe under three ambient
environments** (baseline worktree first, to establish attribution):

```
BASELINE (unpatched) — test/layout-colour.test.js + test/format-colour.test.js
  TERM unset, COLORTERM unset      → pass 12  fail 0
  TERM=xterm-256color              → pass 12  fail 0
  COLORTERM=truecolor              → pass 12  fail 0

PROBE (design implemented verbatim)
  TERM unset, COLORTERM unset      → pass 10  fail 2
  TERM=xterm-256color              → pass  5  fail 7
  COLORTERM=truecolor              → pass  5  fail 7
```

**Openspec hygiene:** `npx openspec validate visual-design-pass-2 --strict` →
`Change 'visual-design-pass-2' is valid`, exit 0. `openspec validate --change
visual-design-pass-2` → `error: unknown option '--change'`. tasks.md 8.3 now
uses the correct positional form and says so. CR8 confirmed fixed.

**Round-1 CR-by-CR result:**

| CR | Claim | My finding |
|----|-------|-----------|
| 1 | bgFill nesting/truncation redesigned | **PARTIAL — see CR1 below.** The `box()`-owns-the-fill / post-truncate-ordering half is real and works (full-width coverage incl. padding, verified above; no bleed past the border even at cols=50 where launchpad.js:375 does re-truncate). The "content is unstyled, by construction" half is **false** for `ticketRow`. |
| 2 | Scope moved to launchpad's focused panes | **CONFIRMED.** `fleet.js:351` is the only `box()` call there and hardcodes `focused: false`; `launchpad.js:310-311` drives `focused` off `lp.pane`. Correct move. |
| 3 | Two-line ambiguity moot at new scope | **CONFIRMED.** `epicRow` (:158-166) and `ticketRow` (:187-208) each emit exactly one line; probe shows one filled content row per selection. |
| 4 | Header banding cut entirely | **CONFIRMED.** Every remaining "band" mention in proposal/design/spec is a Non-Goal statement; the ADDED requirement is retitled "…for focused-pane row selection". No task, no scenario. |
| 5 | proposal's cross-screen claim corrected | **CONFIRMED.** Grep: `STATUS_COLOUR` in `format.js`, `fleet.js`, `drilldown.js`, `banner.js`, `escalation.js` only; `ROLE_COLOUR` in `format.js` + `drilldown.js:126`; `ticketview.js`/`launchplan.js`/`watch.js` reference neither. proposal.md:19 now matches. |
| 6 | running routed through fleet's per-row bar | **CONFIRMED, and it is the right call.** `fleet.js:102` is `f.dim(f.bar(phaseFraction(run), 20))`; `run.status ∈ {needs-you, running, unknown, failed, done}` (:141-144); `drilldown.js` already uses the identical `STATUS_COLOUR[run.status] \|\| f.dim` idiom, so task 6.3 follows existing precedent rather than inventing one. This genuinely answers ticket diagnosis #1. |
| 7 | Both falsified assertions named | **PARTIAL — see CR2.** The two `borderColour(false)` assertions are named correctly (:30-34 and :49-55, both verified present and both verified failing). But the 256-colour tier falsifies **five more**, none named. |
| 8 | openspec invocation corrected | **CONFIRMED** (output pasted above). |

---

### Verdict: REFUTE

The direction is right and round 1's harder judgement calls landed. I want to be
explicit that **Decision 6 is now correct** — routing the per-row bar through
`STATUS_COLOUR[run.status]` puts active colour on every running row for one call
site, reuses an idiom `drilldown.js` already uses, and gives the row four real
weights (bold id / plain branch / status-coloured bar / dim phase+elapsed). That
was the substantive round-1 complaint and it is answered. **Decision 5 remains
the best single change in here.** The **scope move to `launchpad.js` (CR2/CR3) is
correct and well-reasoned**, and **`box()` owning the fill is the right seam** —
I verified it produces a genuinely full-width band including the padding
columns, which is more than round 1's version managed.

What blocks it is that the *other* half of the CR1 fix does not hold against the
code it lands in. design.md:94 asserts the filled row carries no colour of its
own "**by construction, not by convention**" — but the construction is task 5.1,
which removes only the *outer* `f.bold`. `ticketRow` embeds two *inner*
colour-and-reset pairs that are entirely independent of selection state, and the
design's own diagnosis condemns exactly that: "Nesting a background fill around
content that owns its own colour-and-reset is not safe in this codebase's SGR
model, full stop." The probe shows the predicted result: on the single most
common real state (a ticket you just launched, showing `▲ running`) the highlight
stops short, and on an unknown-priority ticket it covers 12 of 43 columns. That
is round 1's rejected "ragged, text-width highlight" outcome reached by a
different route, on the one screen this feature is now scoped to.

Separately, the 256-colour tier as specified makes the existing colour test suite
**environment-dependent** — 12/12 green today in every environment, 5/12 on a
developer's `xterm-256color` terminal and 10/12 in a bare pipe. A change that
makes `node --test` produce different answers depending on who runs it is not
shippable regardless of how it looks.

---

### Change Requests

1. **Decision 4's "filled row content carries no colour, by construction" is
   false for `ticketRow`, and the fill visibly breaks — reproduced.**
   `launchpad.js:191` (`const statusCol = status === '▲ running' ? f.yellow(status) : status;`)
   and `launchpad.js:197-199` (`priorityCol = priorityText == null ? f.dim(f.padTo('?', PRIORITY_WIDTH)) : …`)
   each embed a `\x1b[…m … \x1b[0m` pair *inside* the row's content, and neither
   is conditional on `selected`/`paneFocused` — so task 5.1's removal of the
   outer `f.bold` does not make the row unstyled. Measured coverage (probe, two
   runs, stable):
   - unknown-priority selected row: fill covers **12 of 43** inner columns; the
     embedded `\x1b[2m?   \x1b[0m` at ~column 12 kills the background for the
     entire rest of the row.
   - `▲ running` selected row: fill covers 72 of 76 columns, stopping 4 short of
     the right edge at the `f.yellow` status column's reset.

   Required: make the invariant actually structural, and say in design.md which
   way. Two credible options (I am not prescribing):
   (a) give `ticketRow` a plain-content path used when that row will be filled —
   `priorityCol`/`statusCol` rendered with no escapes at all, so the fill *is*
   the row's whole treatment as Decision 4 intends; or
   (b) make `bgFill` itself nesting-safe by re-opening its own background after
   every embedded reset in `s` (rewrite inner `\x1b[0m` → `\x1b[0m` + the fill
   code). This is a contained string transform inside one function, removes the
   hazard for any future caller, and would let the "forbid nesting" convention
   (and its risk-table entry at design.md:147) be dropped entirely.
   Whichever is chosen, add a task and a test asserting the fill is active on
   **every** column of the filled row for a ticket that is `▲ running` **and**
   for one with unknown priority — the two states that break it today.

2. **The 256-colour tier falsifies five more existing assertions than tasks.md
   7.1 names, and which ones fail depends on the ambient environment.**
   `test/layout-colour.test.js` and `test/format-colour.test.js` force
   `process.stdout.isTTY = true` but never touch `TERM`/`COLORTERM`, so
   `SUPPORTS_256` (design.md Decision 1) resolves from whatever shell runs the
   tests. Measured (baseline 12/12 in all three environments):
   - `TERM`/`COLORTERM` unset → 2 failures (the two tasks.md 7.1 names).
   - `TERM=xterm-256color` **or** `COLORTERM=truecolor` → **7** failures, adding:
     `layout-colour.test.js:21` (`f.cyan('x') === '\x1b[36mx\x1b[0m'`),
     `:26-27` (focused border `/\x1b\[1m\x1b\[36m/`),
     `:40` (`/\x1b\[33mneeds your attention\x1b\[0m/`),
     `:54` (hsplit focused half `/\x1b\[1m\x1b\[36m/`),
     `format-colour.test.js:39` (`f.yellow('x') === '\x1b[33mx\x1b[0m'`),
     and `format-colour.test.js:68` (`/\x1b\[33m/`).

   Required: (i) design.md must state that the colour test files pin the tier
   deterministically — explicitly set *and* delete `TERM`/`COLORTERM` before the
   re-require, the same way they already force `isTTY`, so each tier is tested on
   purpose rather than inherited; and (ii) tasks.md must enumerate all seven
   falsified assertions, not two, since the risk table's own stated mitigation is
   "pre-identify them instead of discovering them mid-implementation."

3. **The change alters behaviour governed by a baseline requirement that is not
   listed as MODIFIED.** Baseline `openspec/specs/dashboard-visual-design/spec.md:53`
   ("Selection and focus are visually distinct states") reads: "A selected row
   within the currently focused pane SHALL render **more prominently (bold and/or
   the pane's accent colour)**…". Decision 4 replaces that bold with a background
   fill and no bold — which is neither of the two means that requirement
   enumerates. design.md:98 argues it "satisfies the spec's requirement at least
   as strongly as bold did", but the spec delta does not amend the requirement, so
   the delivered behaviour would contradict a live requirement while `openspec
   validate --strict` still passes (it checks structure, not semantics). Required:
   add that requirement to `## MODIFIED Requirements` and broaden the enumeration
   to include a background fill.

4. **The 256-colour fill path has no theme-independence story, and it is the
   primary path.** design.md:103 uses `48;5;236` (background only — foreground
   left at the terminal default). On a light-themed terminal that advertises 256
   colours (any `xterm-256color` with a light profile — common) the selected row
   becomes a dark-grey band under near-black default text: dark-on-dark. The risk
   table at design.md:144 reasons about theme independence **only** for the SGR-7
   fallback ("inverts relative to whatever the terminal's colours are"), and that
   reasoning does not transfer to `48;5;236`. Losing bold at the same time
   removes the compensating cue. Required: either pair the background with an
   explicit foreground so the pair is self-consistent regardless of theme (e.g.
   `48;5;236;38;5;253`), or use reverse video at both tiers, or keep bold on top
   of the fill — and record the choice with its reasoning in Decision 4.

5. **design.md:92's central safety claim is factually wrong; correct it so the
   real invariant is the one recorded.** It states `bgFill`'s escape "is never
   itself passed through `truncate` — the round-1 nested-reset bug at
   `format.js:270` is not reachable through this path at all." `box()`'s finished
   lines are re-truncated twice downstream: `layout.js:117` (`hsplit`'s
   `f.padTo(line, p.width)`) and `launchpad.js:375`
   (`out.map((l) => f.truncate(l, cols))`). At `cols=50` the pane widths sum to
   59 (`EPICS_WIDTH 30 + 4 + GAP 1 + rightContentW 20 + 4`), so line 375 really
   does cut a filled row. I verified this particular cut does **not** bleed — with
   the background open the last escape seen is never a reset, so `open` is true
   and `truncate` re-appends one — but the safety therefore rests on the
   *unstyled-content* invariant, which is exactly what CR1 shows is unmet.
   Required: replace the "never passed through truncate" sentence with the actual
   guarantee, naming those two downstream truncation sites.

6. **The spec scenario "A filled row's fill survives truncation" (spec.md:51-56)
   is not satisfiable as written, and task 7.5 inherits the problem.** Under the
   revised design a filled row's `body` is already exactly its final width when
   `bgFill` is applied, so the rendered row does **not** "end with the fill's own
   closing reset" — it ends with the right border's escape. Probe evidence, tail
   of a real filled line: `…\x1b[0m\x1b[1m\x1b[38;5;80m┃\x1b[0m\x1b[0m`. Required:
   restate the THEN as the property actually being guaranteed (the fill's reset
   precedes the right border character, and no background remains active past
   it), and align task 7.5's wording to it.

7. **`launchpad.js:191` hardcodes yellow for `running`, which the modified
   requirement forbids — and it is in the function this change is editing.**
   After task 2.1, yellow is `needs-you` and cyan is `running`; the MODIFIED
   requirement (spec.md:5) says a shared vocabulary "SHALL govern the colour used
   for a given semantic status… everywhere that status is rendered, so the same
   status reads with the same colour on every screen" and "No element SHALL be
   coloured for decoration alone — every colour used SHALL correspond to an entry
   in `ROLE_COLOUR` or `STATUS_COLOUR`." The launch pad would then say
   "running = yellow" on the same dashboard where the fleet says
   "running = cyan". It is pre-existing, but this change is what makes it
   self-contradictory and is already touching `ticketRow`. Required: route it
   through `f.STATUS_COLOUR.running`, or state the carve-out explicitly in
   design.md and narrow the requirement's "everywhere" wording. (Note this does
   not resolve CR1 on its own — a `STATUS_COLOUR.running`-coloured status column
   is still an embedded escape inside the fill.)

---

### Non-blocking notes

- Task 5.2's index bookkeeping is correct as written, and I checked the edge case
  it could have got wrong: `leftContent` may already hold a leading
  `'  ↑ N more'` row, and recording `leftContent.length` at push time (rather
  than a loop counter) handles that shift. The probe filled the right row in
  every case.
- `box()`'s `o.fillRow === i` guard means `null`/omitted can never match, and
  `paneHeight`'s blank padding rows can never be selected. Both fine.
- Round 1's note about mapping `dim` to a real 256 grey (`38;5;240`-ish) went
  unaddressed. Still not a blocker, and still worth a follow-up ticket —
  Decision 5, Decision 6's dim phase/elapsed, and `done` all now lean on SGR 2,
  the one attribute terminals most often render inconsistently.
- Once CR1 and CR4 are settled, worth confirming design.md's Open Questions can
  still honestly say "None". Do not convert these change requests into deferred
  open questions.
