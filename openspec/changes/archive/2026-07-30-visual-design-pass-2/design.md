## Context

`lib/ui/format.js` exports eight SGR codes (`bold`, `dim`, and six 3-bit foreground colours) behind a single `isTTY`-gated `wrap()`. `lib/ui/layout.js`'s `box()`/`borderColour()` consume those to draw every screen's bordered panes, with focus signalled structurally (different border character sets, `layout.js:23`) and, additively, by colour (`borderColour(true)` returns bold+cyan; `borderColour(false)` returns the identity function — no colour at all). `STATUS_COLOUR` maps `running` and `done` to the same `dim`, so the two statuses that dominate a healthy fleet screen are visually identical.

This change widens the palette and adds a background-fill primitive without touching the structural-focus contract, the `isTTY` gate, or the border/content colour-separation guarantee that `borderColour` exists to preserve (CON-12 design.md Decision 1 note: colouring border characters only, never content, so it can never clobber a content line's own ANSI or strand a reset mid-line).

## Goals / Non-Goals

**Goals:**
- Detect 256-colour terminal support once, at require time, alongside the existing `isTTY` check, with an honest fallback to the current 3-bit palette.
- Give `running` a distinct, active-reading treatment that is visible at the row level on the fleet screen (the screen the ticket's diagnosis #1 is about), not only in a section-title word — see Decision 6.
- Add a background-fill primitive, gated by the same rules as every other colour function, owned by `layout.box()` itself, usable for the launch pad's focused-pane row selection.
- Dim unfocused pane borders so they recede behind content.
- Typographic hierarchy on the fleet screen (bold ticket id; dimmed elapsed time/phase; an active-coloured progress bar for `running` rows).

**Non-Goals:**
- Truecolour (24-bit) support — see proposal.md Non-Goals.
- Section-header background banding — proposed in round 1, cut after design-gate feedback (CR4): no screen's header layout (title woven into the box border, `layout.js:80`) has a settled story for how a background band interacts with the border-colour separation rule, and cutting it keeps `bgFill` to the one call site (row selection) this design can actually verify end-to-end. Revisit as a follow-up once that border interaction is worked out on its own.
- Background-fill row selection on any screen other than `launchpad.js` — `fleet.js` has no focused pane (by contract, per the baseline spec) and its rows are two lines each, both properties that make "the selected row" ambiguous or inapplicable there; see Decision 4.
- Per-screen rollout of the border-dimming/status-colour changes beyond what `fleet.js`, `drilldown.js`, and `launchpad.js` already inherit for free via the shared modules — `ticketview.js`, `launchplan.js`, and `watch.js` reference none of `STATUS_COLOUR`/`ROLE_COLOUR`/`borderColour` directly today beyond `layout.box`'s own border dimming, and stay untouched otherwise.
- Any change to `visibleLength`/`truncate`/`padTo` — the `ANSI` regex already matches `38;5;N`/`48;5;N` sequences (confirmed in the ticket), so the width-measurement code needs no change. (`truncate`'s single-boolean `open`-tracking limitation at `format.js:270`, surfaced during round-1 review, is real but stays out of scope — Decision 4's revised design routes around it rather than fixing it; see that decision.)
- Any change to keybindings, data model, or screen composition.

## Decisions

### Decision 1 — Two-tier capability detection, not three

`format.js` gains a single require-time constant:

```js
const TTY = !!process.stdout.isTTY;
const SUPPORTS_256 = TTY && (
  /-256color|^(xterm|screen|tmux|rxvt)/.test(process.env.TERM || '') ||
  !!process.env.COLORTERM
);
```

Two tiers result: `none` (`!TTY` — nothing is emitted, unchanged from today) and either `basic` (3-bit, today's codes) or `ansi256` (256-colour, `SUPPORTS_256`). This mirrors the existing `isTTY` require-time-decision pattern (`format.js:3`) exactly, so the established test technique (force the flag/env, clear `require.cache`, re-require) keeps working unchanged.

**Testing implication (CR2, round 2):** because `SUPPORTS_256` now reads `$TERM`/`$COLORTERM` at require time, it is a second axis a test must pin, alongside `isTTY`, or the tier — and therefore which SGR codes come out — depends on whoever's shell happens to run `node --test`. Every colour test file that forces `isTTY` before re-requiring `format.js`/`layout.js` MUST also explicitly set the tier it wants: `delete process.env.TERM; delete process.env.COLORTERM;` for a test asserting basic-tier (3-bit) output — which is every existing colour test today — before the `require.cache` clear and re-require. This is additive to, not a replacement for, the existing `isTTY`-forcing pattern; see tasks.md 7.2 for the specific files and assertions this affects.
**Alternative considered:** a third `truecolor` tier keyed off `COLORTERM === 'truecolor'`. Rejected for this change — see proposal.md Non-Goals; it roughly doubles the surface (RGB palette tables plus a 24-bit-to-256 downgrade path) for marginal visual gain over 256-colour, and the ticket itself frames 256-colour and truecolour as alternatives, not a required pair.

### Decision 2 — Semantic colour functions stay the same names, dispatch internally

`f.red`, `f.green`, `f.yellow`, `f.blue`, `f.magenta`, `f.cyan` keep their existing signatures (`(s) => string`) so every existing call site (`ROLE_COLOUR`, `STATUS_COLOUR`, screen code) is untouched. Internally each now dispatches on `SUPPORTS_256`:

```js
function fg(basicCode, palette256) {
  return (s) => wrap(SUPPORTS_256 ? `38;5;${palette256}` : basicCode, s);
}
const red    = fg('31', 203);
const green  = fg('32', 114);
const yellow = fg('33', 221);
const blue   = fg('34', 75);
const magenta= fg('35', 176);
const cyan   = fg('36', 80);
```

**Alternative considered:** exposing separate `redBasic`/`red256` functions and having call sites choose. Rejected — it pushes the capability-tier decision out to every call site (exactly the sprawl the ticket's own "removes the main risk from this work" framing is warning against); a single dispatch point keeps the risk contained to `format.js`.

### Decision 3 — `STATUS_COLOUR.running` gets a new colour, `done` is untouched

```js
const STATUS_COLOUR = {
  'needs-you': yellow,
  running: cyan,     // was dim — the common, "worth watching" case now reads as active
  failed: red,
  done: dim,          // unchanged — settled/receding is correct
  queued: dim,
  pass: green,
  fail: red,
};
```

`cyan` is chosen over introducing a new colour name because it is already the accent used for `executor` in `ROLE_COLOUR` and for focused borders — reusing it for "active" keeps the vocabulary small rather than adding a colour whose meaning has to be learned separately. `ROLE_COLOUR` and `STATUS_COLOUR` remain semantically distinct tables (per format.js's own header comment) even though they now share a colour value; nothing about the tables' independence changes, only that they overlap on one hue.

**Alternative considered:** introducing a distinct `active`/bright-cyan-256 tone reserved only for `running`. Rejected for this change to keep the basic-tier fallback meaningful (`cyan` already has a 3-bit code; a bespoke "active" tone would only exist in the `ansi256` tier, meaning `running` would be indistinguishable from `executor`'s cyan in the fallback tier in a way it currently is not from anything). Revisit once truecolour lands.

### Decision 4 — Background-fill primitive, owned by `box()`, applied post-truncation, nesting-safe against embedded resets, on `launchpad.js` only (revised after design-gate round 1 and round 2 REFUTE)

**Round-1 finding (kept here for the record, not re-litigated):** the original version of this decision had the *caller* wrap an already-styled line in `bgFill` before handing it to `layout.box()`. Reproduced against the real render path, that breaks two ways: (a) `box()`'s `padTo`/`padding` add columns *outside* the fill, so the highlight stops short of the row's full width; (b) when `box()`'s internal `f.truncate` cuts a string that already contains a `bgFill`-then-inner-colour composition, `format.js:270`'s `open` flag (a boolean, not a nesting-aware counter) gets cleared by the *inner* reset, so `truncate` fails to re-close the *outer* fill — the background bleeds past the row into the border. More fundamentally: an SGR reset (`\x1b[0m`) is global, not scoped — any content the fill wraps that carries its own internal reset will cut the fill short at that point, regardless of where the truncation/padding bug is fixed.

**Round-2 finding (also kept here for the record):** round 1's fix moved the fill's application to *after* `box()`'s own truncate/pad pipeline (point 1 below, unchanged since round 1 and confirmed correct by the round-2 skeptic's probe), but paired it with a *convention* — "the row content given to `box()` for a filled row carries no colour of its own" — enforced only by `launchpad.js` happening not to violate it. It already did: `ticketRow`'s `statusCol` (`f.yellow` for `▲ running`) and `priorityCol` (`f.dim` for an unknown priority) each embed their own colour-and-reset pair, independent of `selected`. Reproduced against the real render: the fill covered 72 of 76 columns for a `▲ running` row (stopping at the status column's reset) and 12 of 43 columns for an unknown-priority row (stopping at the priority column's reset) — round 1's rejected "ragged, text-width highlight" outcome, reached by a different route. A convention that the one existing caller already broke is not a fix.

**Revised design (round 2) — `bgFill` itself is made nesting-safe, so no invariant is required of the content it wraps:**

1. **`box()` owns the fill, applied strictly *after* its own truncate/pad pipeline**, spanning the padding columns too (not just the inner content), so the highlight always covers the row's full width with no separate caller-side step to get wrong (unchanged since round 1, reconfirmed by the round-2 probe to produce genuinely full-width coverage including padding, with no bleed past the border even when `launchpad.js`'s own downstream re-truncation at narrow widths applies — see point 3 below):

   ```js
   // inside box()'s content-row loop, after computing `inner` exactly as today:
   const body = ' '.repeat(padding) + inner + ' '.repeat(padding);
   out.push(colour(set.v) + (o.fillRow === i ? f.bgFill(body) : body) + colour(set.v));
   ```

   `opts.fillRow` is an optional 0-based content-row index (`null`/omitted = no row filled).

2. **`bgFill` re-opens its own background immediately after every embedded reset in its input**, rather than requiring the caller to hand it unstyled content. An SGR reset is global, not scoped — so the fix is to make the one function that owns the fill aware of that and route around it, instead of asking every present and future caller to avoid ever producing a reset:

   ```js
   function bgFill(s) {
     if (!TTY) return s;
     // 256-tier: explicit background *and* foreground, so the pair is
     // legible regardless of the terminal's own theme (CR4 — a
     // background-only fill reads as dark-on-dark on a light-themed
     // 256-colour terminal, since the default foreground is left alone).
     // Basic-tier fallback stays reverse video, which is theme-independent
     // by construction (it inverts relative to whatever the terminal's
     // colours are) and untouched by this fix.
     const open = SUPPORTS_256 ? '\x1b[48;5;236m\x1b[38;5;253m' : '\x1b[7m';
     // Re-open immediately after every embedded reset in `s`, so content
     // that carries its own inner colour-and-reset (a status word's
     // colour, a dim priority marker) does not end the fill early — the
     // fill simply resumes on the far side of whatever reset the content
     // already had. `s` itself never legitimately needs the fill "off"
     // partway through (see Risks — this assumes the whole wrapped string
     // is meant to be one filled band, true of every current caller).
     const patched = s.split('\x1b[0m').join('\x1b[0m' + open);
     return open + patched + '\x1b[0m';
   }
   ```

   This removes the round-2 hazard at its source rather than constraining callers: `launchpad.js`'s `statusCol`/`priorityCol` keep their own inner colour untouched (see point 4 below) and the fill still spans the row's full width regardless. It also means the "forbid nesting" convention is no longer needed anywhere in this design and the round-1 risk-table entry for it (design.md's Risks, below) is retired rather than carried forward.

   **Why this stays safe under `truncate`'s boolean (not nesting-depth-aware) `open` tracking (CR5 — see also point 3):** `bgFill`'s output never has two *concurrently* open spans — every `open` sequence is immediately followed, eventually, by a `\x1b[0m` before the next `open` sequence begins (open → content → reset → reopen → content → … → final reset). That is sequential open/close, not true nesting (two opens live at once with only one reset), which is exactly the hazard round 1 and round 2 diagnosed. `format.js:270`'s `open = m[0] !== '\x1b[0m'` only needs to know whether the *most recently seen* escape was an opener or a reset to decide whether a cut needs a trailing reset appended — that is well-defined and correct for a sequential open/close/open/close string, regardless of how many times it repeats.

3. **Two downstream truncation sites exist after `box()` returns, and both remain safe under this design — correcting a factual error in round 1's version of this decision.** Round 1's text claimed `bgFill`'s escape is "never itself passed through `truncate`," which is false: `box()`'s finished lines are re-truncated again at `layout.js:117` (`hsplit`'s `f.padTo(line, p.width)`) and at `launchpad.js:375` (`out.map((l) => f.truncate(l, cols))`, reached when `cols=50` makes the pane widths sum to more than available space). The actual guarantee, verified by the round-2 probe at `cols=50`: because a filled row never has two concurrently open spans (point 2's argument), a cut landing inside an open fill span is detected correctly by `truncate`'s `open` flag and a closing reset is re-appended at the cut point, exactly as it already does for any other single open SGR span — no bleed past the border.

4. **Row content keeps its own inner colour — no plain-content requirement.** `ticketRow`'s `statusCol` and `priorityCol` are unchanged by this decision beyond one fix folded in here (CR7): `statusCol`'s `▲ running` case currently hardcodes `f.yellow(status)`, which after Decision 3 makes the launch pad say "running = yellow" on the same dashboard where the fleet says "running = cyan" — self-contradictory once this change makes `running`'s colour a shared, spec-governed vocabulary entry (see the ADDED "Status colour is consistent across screens" requirement). Fixed by routing it through the vocabulary: `const statusCol = status === '▲ running' ? f.STATUS_COLOUR.running(status) : status;`. `priorityCol`'s `f.dim` for an unknown priority is untouched — `dim` is not part of `STATUS_COLOUR`/`ROLE_COLOUR` and was never claimed to be.

**Scope: `launchpad.js`'s epics/tickets panes, not `fleet.js`.** Per CR2: `fleet.js:351` hardcodes `focused: false` for every section (correctly, per the baseline spec's "single-input-target screens never claim a focused border" requirement — the fleet has no pane-switch key and by contract cannot have a focused pane), so "the selected row in the currently-focused pane" can never be true there. `launchpad.js` is the one screen with a real pane-switch key (Tab/←/→) and an existing, spec-covered bold-focused/dim-unfocused selection convention (`epicRow`/`ticketRow`, `launchpad.js:158-208`). This is where the background-fill treatment belongs, not fleet.

**Behaviour change to `epicRow`/`ticketRow`:** the `selected && paneFocused` branch, which today returns `f.bold(line)`, instead returns the **plain** `line` — no outer bold — while any inner colour the row's own content already carries (`ticketRow`'s `statusCol`/`priorityCol`) is left exactly as it renders for an unselected row. `renderLaunchPad` tracks that row's index in `leftContent`/`rightContent` as it builds them and passes it to `layout.box()` as `fillRow`, which applies the background fill (per points 1–2 above, now nesting-safe against that inner colour). The `selected && !paneFocused` branch is **unchanged** (`f.dim(line)`, no fill — `box()` is never given a `fillRow` for the unfocused pane's box). This is a straight swap of *how* the focused-pane selection is emphasised (bold text → filled row), not an addition on top of bold; it satisfies the spec's "Selection and focus are visually distinct states" requirement at least as strongly as bold did (that requirement is broadened in this change's spec delta — see the MODIFIED Requirements section — to name background fill alongside bold/accent-colour as a valid "renders more prominently" treatment), and at the `basic` tier (reverse video, SGR `7`) it remains a real, distinct visual state.

**Single-line rows only — no "which of two lines" ambiguity (CR3 is moot at this scope):** `epicRow`/`ticketRow` each already produce exactly one content line per row (unlike `fleet.js`'s two-line `renderRun` cards, which this change does not touch). `fillRow` names one `box()` content-row index and fills exactly that one line — there is no second line belonging to the same logical row that could be left inconsistently styled.

**Header banding is cut from this change** (CR4 in round 1's numbering) — see proposal.md Non-Goals. `bgFill` therefore has exactly one caller (`layout.box`'s `fillRow` path); the "single function, not a `bg(colourName)` factory" rationale from round 1 still holds for that one use.

**Degraded (borderless) rendering is unaffected:** when `layout.degrade()` is true, `launchpad.js` falls back to its existing plain `.map(l => f.truncate(l, width))` path with no `box()` call at all, so `fillRow` simply does not apply there — the row's plain-outer/coloured-inner content (now identical to any other degraded row's treatment) still renders there exactly as before, which is an acceptable, honest degradation, not a broken one.

### Decision 5 — `borderColour(false)` returns `f.dim`, not identity

```js
function borderColour(focused) {
  return focused ? (s) => f.bold(f.cyan(s)) : f.dim;
}
```

One-line change. `f.dim` already no-ops under `!isTTY` (same `wrap()` gate every other colour function uses), so this is fully covered by the existing degradation guarantee — a colourless terminal renders unfocused borders exactly as before (no escapes at all), only a TTY rendering with colour changes.

This directly falsifies two existing assertions in `test/layout-colour.test.js` under forced `isTTY` (both named explicitly in tasks.md 5.1, per CR7): the unfocused-box test at :30-34 (`assert.doesNotMatch(out[0], /\x1b\[/)`), and the `hsplit()` composition test at :49-55, whose left (unfocused) half assertion (`assert.doesNotMatch(out[0].split(' ')[0], /\x1b\[/)`) is exactly the same claim restated across two boxes. Both are updated (not deleted) to assert `f.dim`'s escape instead.

One clarifying note for whoever reads this later: on `fleet.js` specifically, *every* border on the screen ends up dimmed (there is no focused pane there — see Decision 6's Non-Goal note and the baseline spec's "single-input-target screens" requirement), so this reads as "all chrome recedes," not "focused chrome contrasts against dimmed chrome." That is the intended outcome (ticket diagnosis #3: chrome competing with content), not a sign that focus-contrast broke on that screen.

### Decision 6 — Fleet-screen typographic hierarchy, plus a row-level active-status treatment (revised after design-gate round 1 REFUTE)

**Round-1 finding (CR6, the gate's own subjective-judgement call):** the round-1 design left `STATUS_COLOUR.running`'s new `cyan` reachable from exactly two call sites in the whole codebase — `fleet.js:334` (a section box's *title* word, e.g. "RUNNING") and `drilldown.js:284` (the header's status word) — neither of which is a fleet *row*. Traced through, a healthy fleet screen after the round-1 design would have one word turn cyan in a border and every running row unchanged: `f.dim` bar (`fleet.js:102`), unstyled status/phase text, `f.dim` elapsed. Combined with round-1's own 4.2 (dimming phase and elapsed further), the steady-state row would have gotten *greyer*, not more colourful — answering none of the ticket's diagnosis #1 ("the normal case renders as grey-on-black … colour does nothing for ordinary hierarchy"). Since the ticket hands this specific subjective call to the design gate, that finding stands as the gate's judgement, not a mechanical defect, and this revision is written to answer it directly rather than paper over it.

**Revised call-site changes, all in `fleet.js`'s `renderRun`/`statusLine` (:47-107):**

1. **Ticket id is bold.** `f.padTo(run.ticket, 9)` (:90) becomes `f.bold(f.padTo(run.ticket, 9))`.
2. **Phase and elapsed time are dimmed.** `f.padTo(run.phase, 11)` (:55) and `f.dur(run.elapsedMs)` (:80) are each wrapped in `f.dim`.
3. **The per-row progress bar carries the run's status colour, not a hardcoded `f.dim`.** `f.dim(f.bar(phaseFraction(run), 20))` (:102) becomes `(f.STATUS_COLOUR[run.status] || f.dim)(f.bar(phaseFraction(run), 20))` — `run.status` is one of `needs-you`/`running`/`unknown`/`failed`/`done` (`fleet.js:141-144`); `STATUS_COLOUR` has no `unknown` entry, hence the `|| f.dim` fallback, which also preserves today's exact rendering for that case. This is the row-level answer to CR6: every `running` row's bar reads `cyan` (active), every `done` row's bar stays `dim` (settled), every `failed` row's bar now reads `red` — a bonus consequence of reusing the existing `STATUS_COLOUR` vocabulary through one more call site, not a new colour decision.

**Resulting row tone (answering CR6's "state what the mid-tone is"):** a rendered run now carries four distinct weights instead of round-1's flat two — bold (ticket id), unstyled/default (branch name, on the same line), status-coloured (the bar: cyan/dim/red by `STATUS_COLOUR[run.status]`), and dim (phase, elapsed). That is the density the ticket's lazygit reference bar asks for, achieved by recolouring an element (the bar) that already exists on every row rather than adding a new one.

No new shared helper is introduced — every change above is a wrap at an existing render call site, exactly the kind of per-field styling `format.js`'s existing exports already support. Scoping this to `fleet.js` (per Goals/Non-Goals above) keeps the diff small and reviewable; `drilldown.js` inherits the `STATUS_COLOUR.running` change at its one existing call site (:284) automatically, with no code change of its own required.

## Risks / Trade-offs

- **[Risk] `SUPPORTS_256`'s `$TERM`/`$COLORTERM` heuristic misdetects on an unusual terminal emulator** (declares 256-colour support it doesn't actually have, or vice versa) → **Mitigation:** the detection only ever *adds* colour on top of what `isTTY` already gates; a false positive produces wrong colours, never broken layout or unreadable text (width math is colour-tier-independent, per `visibleLength`'s existing handling of `38;5;N`), and a false negative only costs the aesthetic upgrade, falling back to today's already-shipped 3-bit behaviour.
- **[Risk] `bgFill`'s reverse-video fallback (`\x1b[7m`) reads differently across terminal themes** (light vs dark background) → **Mitigation:** reverse video is a well-established, universally supported SGR specifically because it inverts *relative to whatever the terminal's colours are*, so it stays legible on both; this is the same reasoning that makes it a safe minimum-capability fallback rather than a hand-picked colour pair that could clash with an arbitrary theme.
- **[Risk] The 256-tier fill was originally background-only (`48;5;236`), which is not theme-independent** — on a light-themed terminal that advertises 256-colour support, a dark-grey background under the terminal's own (near-black) default foreground reads as dark-on-dark (CR4, round 2) → **Mitigation:** Decision 4's `bgFill` now pairs the background with an explicit light foreground (`48;5;236;38;5;253`) at the 256 tier, so the pair is self-consistent regardless of the terminal's theme; the basic-tier reverse-video fallback was already theme-independent for the reason in the bullet above and needed no change.
- **[Risk] Reusing `cyan` for `STATUS_COLOUR.running`, `ROLE_COLOUR.executor`, and the focused-border accent** could read as those concepts being related when they are not, and now shows up on the same screen twice (a `running` row's bar next to a border that is never focused on `fleet.js` — so this specific collision does not actually occur there; `drilldown.js` and `launchpad.js`, which do have focused borders, are where it is worth an eyeball) → **Mitigation:** role gutter, status field, and border chrome are visually separated by position on every screen that shows more than one of them; flagged for a manual look in tasks.md 6.1 rather than assumed fine.
- **[Risk] `test/layout-colour.test.js` and `test/format-colour.test.js` currently assert the pre-change behaviour, and separately never pin `$TERM`/`$COLORTERM`** — two distinct problems, both round-2 findings (CR2). First: the unfocused-border assertions (two of them, not one) become false once `borderColour(false)` returns `f.dim`. Second, and more insidious: once `SUPPORTS_256` exists, five *more* existing assertions that hard-code 3-bit escape sequences (`\x1b[36m`, `\x1b[33m`, etc.) become environment-dependent — they pass or fail depending on the ambient shell's `TERM`/`COLORTERM` when `node --test` happens to run, not on anything the change did wrong. Measured: 12/12 pass with `TERM`/`COLORTERM` unset, but only 5/12 pass under `TERM=xterm-256color` or `COLORTERM=truecolor`, with no code change at all — a genuinely flaky suite. → **Mitigation:** tasks.md 7.1 updates the two border assertions; tasks.md 7.2 (new) explicitly pins `TERM`/`COLORTERM` (deletes both, forcing the basic tier) in every existing colour-test file's setup, the same way those files already force `isTTY` before re-requiring — so the suite's tier is chosen on purpose, not inherited, and is identical in CI and on a developer's `xterm-256color` terminal.
- **[Risk] `bgFill`'s reset-rewrite assumes every embedded `\x1b[0m` in its input is meant to be re-opened** — i.e., that the whole string handed to it is meant to be one continuously filled band, never a string that legitimately wants the background "off" for part of its length → **Mitigation:** true of every current caller (`launchpad.js`'s `epicRow`/`ticketRow`, where the entire row is the filled band); flagged here so a future caller needing partial-fill semantics within one `fillRow` string knows this implementation does not support that, rather than rediscovering it by reproducing a bug. (This retires the round-1/round-2 "forbid nesting is a convention, not enforced" risk — the fix in Decision 4 point 2 makes nesting-safety a property of `bgFill` itself, not something callers must remember.)

## Migration Plan

No data migration. This is a pure rendering-layer change behind existing `isTTY`/capability gating — deploys as a normal merge, no feature flag needed (a terminal that doesn't advertise 256-colour support simply continues to render the pre-change 3-bit palette, which is not a "degraded" state but the same code path as today). Rollback is a plain revert.

## Open Questions

None — the design gate's subjective-judgement role (per the ticket's "Suggested approach") is exercised over Decisions 3–6 above (colour choices, scope of the typographic pass) rather than left open here.
