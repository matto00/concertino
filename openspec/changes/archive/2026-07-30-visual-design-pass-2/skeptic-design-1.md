## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

**Artifacts read (as claims, then checked against code):** `ticket.md`,
`proposal.md`, `design.md`, `tasks.md`,
`specs/dashboard-visual-design/spec.md`, `workflow-state.md` (SKEPTIC_CYCLE: 0
→ this is round 1).

**Ground-truth reads (not narrative):**
- `lib/ui/format.js` — confirmed `TTY`/`wrap` at :3-4, the eight SGR codes at
  :6-13, `ANSI = /\x1b\[[0-9;]*m/g` at :44 (does match `38;5;N`/`48;5;N`, so
  the ticket's "no change needed to `visibleLength`/`truncate`/`padTo`" premise
  for *width* is correct), `STATUS_COLOUR` at :33-41. `running: dim` and
  `done: dim` confirmed. `queued: dim` **does** exist at :38 (the ticket's
  quoted table omits it; design.md Decision 3 and tasks.md 2.1 are the ones
  that got it right).
- `lib/ui/layout.js` — `borderColour` at :38-40 returns identity when
  unfocused, confirmed. `box()`'s content pipeline at :88-89 confirmed:
  `f.padTo(f.truncate(raw, innerWidth), innerWidth)` then `padding` spaces
  *outside* that, between content and border character.
- `lib/ui/screens/fleet.js` — `STATUS_COLOUR` is consumed at **exactly one**
  place, :334 (`colourTitle` for the section box title, used at :344 and
  :351). Every section box is drawn with `focused: false`, hardcoded, at :351.
  A run row is **two** lines (`renderRun`, :86-107). The progress bar is
  `f.dim(f.bar(...))` at :102. Phase and elapsed time live inside
  `statusLine()` (:55, :80), not at a top-level render site.
- Cross-screen grep for `STATUS_COLOUR|ROLE_COLOUR|borderColour` across
  `lib/` and `test/`.
- `test/layout-colour.test.js`, `test/format-colour.test.js`, and
  `test/fleet.test.js:646-682` read in full.

**Baseline is green:** `node --test test/layout-colour.test.js
test/format-colour.test.js test/fleet.test.js test/layout.test.js` → 111 pass,
0 fail. So any breakage after this change is attributable to it.

**Openspec hygiene:** `npx openspec validate visual-design-pass-2` and the same
with `--strict` both report *valid*. (Note: the command named in tasks.md 6.2
is not — see CR 8.)

**Reproduced defect probes** (run twice, stable both times; deterministic pure
code, no flake) — simulating Decision 4's "`bgFill` applied by the caller as
the outermost wrap" and pushing the result through the real `layout.box()`
path:

```
# fill ends at the last visible char; 20 blank columns follow INSIDE the box,
# and the leading padding space sits OUTSIDE the fill:
"│ [48;5;236m  ▸ [1mCON-30   [0m my-branch[0m                    │"

# narrow case — no closing reset at all before the border:
"│ [48;5;236m  ▸ [1mCON-30   [0m my-… │"
```

Root cause of the second, located: `format.js:270`, `open = m[0] !== '\x1b[0m'`
— the *inner* reset emitted by `f.bold` clears `truncate`'s `open` flag even
though the outer `48;5;236` background is still open, so `truncate` returns
without a reset and the background bleeds over the box's right padding, the
right border character, and onward.

---

### Verdict: REFUTE

The **direction is largely right and I want to say so plainly**, because most
of these change requests are about execution detail, not about rejecting the
approach:

- **Two-tier detection with an honest 3-bit fallback (Decision 1) is the right
  call**, and cutting truecolour (proposal Non-Goals) is correctly reasoned —
  256 delivers the hierarchy goal without an RGB table or a downgrade path.
- **Keeping the semantic function names and dispatching internally (Decision
  2) is exactly right** — pushing tier choice to call sites would be the
  sprawl this project should refuse.
- **Reusing `cyan` for `running` rather than minting an "active" hue (Decision
  3) is good judgement**, and the stated reason (a bespoke 256-only tone would
  collapse into `executor`'s cyan in the fallback tier) is the correct reason.
  The `ROLE_COLOUR`/`STATUS_COLOUR` hue overlap risk you flagged for me is, in
  my judgement, **acceptable** — role and status never occupy the same column
  on any screen, and a small vocabulary beats a learnable-but-larger one. That
  one is settled; don't revisit it.
- **`borderColour(false) → f.dim` (Decision 5) is the single best change in
  here** and I'd take it on its own. It is also the only one that improves the
  flagship screen unconditionally.
- The risk table is genuinely good — pre-identifying the two falsified test
  assertions instead of discovering them mid-implementation is the right habit.

What blocks it is that the two headline *new* pieces — the background fill and
the `running` recolour — do not survive contact with the code they land in.
`bgFill` as specified renders a broken highlight and bleeds colour past its
reset (CR 1), and its stated trigger condition can never fire on the screen
it's scoped to (CR 2). Meanwhile the `running → cyan` change, traced to real
call sites, moves one word in one border and leaves the ticket's own diagnosis
#1 — "the normal case renders as grey-on-black … colour does nothing for
ordinary hierarchy" — substantially unanswered (CR 6). Since the ticket
explicitly hands subjective judgement to this gate, I'm exercising it there
rather than letting a change ship that satisfies its own spec deltas while
missing the complaint that motivated it.

---

### Change Requests

1. **`bgFill` as an "outermost wrap" is incompatible with `layout.box()`'s
   content pipeline — two separate, reproduced failures.** design.md:87 and
   tasks.md 4.3 instruct the caller to wrap an already-styled line. Pushed
   through `layout.js:88-89` that yields:
   - **(a) Ragged, text-width highlight.** `f.padTo` appends its pad spaces
     *after* `bgFill`'s closing `\x1b[0m`, and `box()`'s `padding` spaces
     (:89) sit outside the fill entirely. The result is a fill that stops at
     the last visible character instead of spanning the row — see the first
     probe line above. A selected-row band that doesn't span the row is worse
     than today's bold-only selection and is exactly the "noisy" result the
     lazygit bar rejects.
   - **(b) Stranded background / colour bleed on truncation.** When the line
     is cut, `truncate` emits no closing reset because `format.js:270`'s
     `open` boolean was cleared by the *inner* `f.bold` reset. The `48;5;236`
     background then bleeds over the box's right padding and right border
     character — see the second probe line. This is precisely the
     "clobber content ANSI / strand a reset mid-line" failure that
     `borderColour`'s border/content separation exists to prevent, so
     design.md:87's appeal to that same discipline as justification does **not
     hold**: `borderColour` wraps tiny, separate border strings that are never
     truncated, whereas `bgFill` wraps the whole line that *is*.

   Required: design.md must specify the actual seam and ordering — e.g. fill a
   line already padded to the box's inner width so no cut occurs, and/or make
   `box()` own the fill so the pad and the padding columns fall inside it —
   and must state how nested resets are handled (options: make `truncate`
   always re-append `\x1b[0m` when it emitted any escape and cut; or track
   `open` as a depth rather than a boolean at `format.js:270`; or forbid
   nesting and have the caller pass an unstyled line). Whichever is chosen,
   add a task and a test asserting a truncated filled line ends in a reset.

2. **Task 4.3's trigger condition can never be true on `fleet.js`.** It says
   apply `bgFill` "when that row is in the currently-focused pane"; design.md
   Decision 4 and the spec delta's scenario ("the fleet view's
   currently-focused pane renders its selected row") say the same. But
   `fleet.js:351` hardcodes `focused: false` for every section, and the
   *baseline* spec requires it to: "A screen where every keypress is
   interpreted the same way … (the fleet view's four sections) SHALL render
   all of its boxes with the same (plain) border set." The fleet has no
   focused pane and by contract cannot acquire one. An implementer reads this
   two ways — apply the fill to the fleet's single flat selection
   unconditionally, or never apply it (leaving `bgFill` unused and the new
   spec scenario unverifiable). Decide and say so. Note the screen that
   *does* have a focused pane, and an explicit
   bold-focused/dim-unfocused selection convention already, is
   `launchpad.js` (:155, :307-311) — if the focused-pane framing is what you
   want, launchpad is where it belongs, and scoping to fleet needs a different
   justification. Also fix the spec-delta scenario wording accordingly.

3. **"The selected row" is ambiguous: a fleet run row is two lines.**
   `renderRun` (fleet.js:86-107) emits a ticket line plus a bar/status line.
   Filling one of the two would read as a rendering bug; filling both is a
   different visual weight than the wording implies. State which, and state
   what happens to the row's own inner styling (the `f.dim` bar at :102 will
   read differently on a filled background — dim-on-fill is often illegible).

4. **The section-header band is promised but never implemented.**
   proposal.md:9 says `bgFill` is "used for … a section-header band";
   design.md Decision 4 justifies a single `bgFill` (rather than a `bg()`
   factory) precisely on there being "two current uses"; and the ADDED spec
   requirement is titled "… for selection **and header banding**". No task in
   tasks.md applies it to a header, and no scenario covers it. Either add the
   task + scenario, or cut header banding from proposal.md:9, Decision 4, and
   the spec requirement's prose. If you keep it: on the fleet the section
   title is woven *into* the box top border (`layout.js:80`,
   `fleet.js:351` passes `title: colourTitle(s.title)`), so a background band
   on the title needs an explicit story about how it interacts with the
   border-colour separation rule — a band that stops mid-border-line will look
   broken.

5. **proposal.md:17 states something false about the other screens.** It
   claims "`drilldown`, `launchpad`, `ticketview`, `launchplan`, and `watch`
   already consume `STATUS_COLOUR`, `ROLE_COLOUR`, and `borderColour` … so
   they inherit the `running`/`done` distinction … automatically, for free."
   Grep says otherwise: `STATUS_COLOUR` appears only in `banner.js`,
   `escalation.js`, `drilldown.js` and `fleet.js`. `launchpad.js`,
   `ticketview.js`, `launchplan.js` and `watch.js` reference **none** of the
   three tables (they inherit the dimmed border only, via `layout.box`). The
   scope cut itself is fine — there's nothing to do on those screens — but the
   honest justification is "only `fleet.js` and `drilldown.js` render a run
   status at all, so the `running`/`done` distinction is confined to those
   two." That correction matters because it is what exposes CR 6.

6. **[Design judgement — the call the ticket asked this gate to make] The
   `running` recolour does not answer diagnosis #1.** Traced to real call
   sites, `STATUS_COLOUR.running` is read in exactly two places:
   `fleet.js:334` (the section box's *title*) and `drilldown.js:284` (the
   header's status word). So after this change a healthy fleet screen — the
   flagship, and the ticket's own example of the problem — has one word
   ("RUNNING", in a border) turn cyan, and every running *row* stays exactly
   as grey as it is today: `f.dim` bar (:102), plain-default status parts,
   `f.dim` elapsed. The ticket's diagnosis is not "the RUNNING heading is
   grey", it is "the *normal case* renders as grey-on-black … colour is doing
   exception signalling only; it does nothing for ordinary hierarchy." Worse,
   tasks 4.2 dims phase *and* elapsed, so the steady-state row gets **greyer**
   than it is now. Against the stated bar (lazygit: dense, colourful,
   unmistakable focus) the delivered screen would still fail "colourful" and
   would not tell you at a glance which run is the interesting one.

   Required: add at least one **row-level** active treatment so the common case
   carries hierarchy, and name it in design.md and tasks.md. I'm not
   prescribing the answer, but the cheapest high-leverage candidate is sitting
   at `fleet.js:102` — the per-row progress bar is the one element that means
   "this is running" and it is currently `f.dim`; routing it through
   `STATUS_COLOUR[s.statusKey]` puts the active colour on every running row for
   one call site, and keeps `done`/`failed` rows correctly settled. Whatever
   you choose, also state what the *mid* tone of a row is — after 4.1/4.2 the
   row has a bold top and a dim bottom and nothing in between, which is a
   two-tone row, not the three-or-four-tone density lazygit gets.

7. **tasks.md 5.1 names one falsified assertion; there are two in that file.**
   Besides "an unfocused box's border carries no colour even under isTTY"
   (`test/layout-colour.test.js:30-34`), the `hsplit()` test at :49-55 asserts
   `assert.doesNotMatch(out[0].split(' ')[0], /\x1b\[/)` for the unfocused
   half — also false once `borderColour(false)` returns `f.dim`. design.md:103
   likewise says "**assertion**" singular. Task 5.5 would eventually catch it,
   but a mechanical implementer following 5.1 literally will be surprised;
   name both.

8. **tasks.md 6.2's command does not exist.** `openspec validate --change
   visual-design-pass-2` → `error: unknown option '--change'`. The working
   invocation is `openspec validate visual-design-pass-2` (optionally
   `--strict`); both pass today. Also "confirm … `openspec archive` hygiene are
   clean" has no defined pass condition — either name the command and its
   expected output or drop it.

---

### Non-blocking notes

- **Consider mapping `dim` to a real 256 grey at the `ansi256` tier.** So much
  of this design leans on recession (`done`, unfocused borders, the bar, phase,
  elapsed) that it is worth noting SGR 2 is the one attribute terminals most
  commonly ignore or render inconsistently. `38;5;240`-ish gives reliable,
  tunable recession where 256 is available, with SGR 2 as the fallback —
  structurally identical to the `fg(basicCode, palette256)` helper Decision 2
  already introduces. Explicitly *not* a blocker: `dim` is honest today and
  this can follow.
- The chosen 256 values (203/114/221/75/176/80) are a sane, muted, modern set
  and I have no objection to any of them. Worth eyeballing 80 (cyan) against
  the focused border's bold+cyan once implemented, since the same hue will now
  carry both "focused chrome" and "running status" — that's the one place the
  vocabulary reuse could get muddy in practice, even though I've endorsed the
  reuse in principle.
- On the fleet, `borderColour(false) → f.dim` means *every* border on the
  screen dims (there is no focused pane there). That is a good outcome — chrome
  recedes, content leads, which is ticket diagnosis #3 — but it is not the
  "focus contrast" framing design.md Decision 5 uses. Worth one sentence in
  Decision 5 so nobody later reads the fleet's uniformly-dim borders as a bug.
- design.md's Open Questions correctly says "None"; after CRs 1-4 are resolved
  that should still be true. Don't convert these change requests into deferred
  open questions.
