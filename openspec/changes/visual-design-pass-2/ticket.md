# CON-30: Visual design pass 2 — colour, hierarchy, and density beyond the bordered-pane baseline

## Description

CON-12 delivered the structural layer: bordered panes, focus highlighting, the `box()`/`hsplit()`/`degrade()` primitives in `lib/ui/layout.js`, and the shared `ROLE_COLOUR`/`STATUS_COLOUR` tables in `lib/ui/format.js`. CON-17 removed the flicker. The result is a dashboard that is structurally correct and readable.

It is also flat. This ticket is the follow-on aesthetic pass: make the dashboard look designed rather than merely correct.

## Diagnosis — why it currently reads as bland

This is not a vague complaint; there are two specific causes in the code.

**1. The steady state is almost entirely grey.** `format.js:32`:

```js
const STATUS_COLOUR = {
  'needs-you': yellow,
  running: dim,
  failed: red,
  done: dim,
  pass: green,
  fail: red,
};
```

`running` and `done` are both `dim`. Those are the two statuses that dominate the screen essentially all the time — a healthy fleet is entirely running-and-done. So the normal case renders as grey-on-black with occasional yellow, and the colour vocabulary that does exist is reserved for states you mostly do not want to be in. Colour is currently doing exception signalling only; it does nothing for ordinary hierarchy.

**2. The palette is 3-bit, with no backgrounds.** `format.js:3-13` defines exactly eight SGR codes — bold, dim, and the six base colours (`31`–`36`). There are no background colours at all, which means there is no way to fill, invert, or band anything: no selected-row highlight, no zebra striping, no header fill, no severity band. Every visual distinction available today is foreground-only.

**3. Unfocused panes have no border colour.** `layout.js:38`:

```js
function borderColour(focused) {
  return focused ? (s) => f.bold(f.cyan(s)) : (s) => s;
}
```

Unfocused borders are returned unstyled — full-brightness default foreground. So the chrome competes with the content for attention, and the *structure* of the screen carries no visual weight of its own.

## Scope

Deliberately an aesthetic ticket. No new panes, no new data, no new screens — the existing information architecture is right. Candidate work:

* **Widen the palette.** 256-colour and/or truecolour, with honest capability detection (`$COLORTERM`, `$TERM`) and graceful fallback to the current 3-bit set. Worth knowing: `format.js`'s `ANSI` regex is `/\x1b\[[0-9;]*m/g`, which **already** matches `\x1b[38;5;Nm` and `\x1b[38;2;R;G;Bm`, so `visibleLength`, `truncate`, and `padTo` handle extended colour correctly today with no change. That removes the main risk from this work.
* **Give** `running` **and** `done` **distinct treatments** so the common case has hierarchy. Dim is right for `done` (settled, receding); `running` is the thing you actually care about and should read as active.
* **Background colours** — enabling selected-row inversion, section-header fills, and a stronger focused-pane treatment.
* **Dim the unfocused chrome** so borders recede and content leads.
* **Typographic hierarchy** — the ticket id, title, phase, and elapsed time are currently near-equal in weight; they should not be.
* Spacing and density: rhythm between sections, alignment of columns across sections.

## Constraints that must not regress

* **Decision 2 (structural focus) is non-negotiable.** Focus is signalled by different border *characters* (`┏━┓` vs `┌─┐`, `layout.js:23`), not only colour, so it survives a terminal that renders no colour at all. A richer palette must be additive to that, never a replacement for it.
* `wrap()` **gates every escape on** `isTTY` (`format.js:3`). All new colour must route through the same gate. Note the standing blind spot: `isTTY` is false under `node --test`, so colour output is structurally untestable in-process — tests must assert on the *decision* (which style a given state selects) rather than on emitted bytes.
* `borderColour` colours border characters only, never content, precisely so it cannot clobber a content line's own ANSI or strand a reset mid-line. Keep that separation.
* Degradation stays honest: a narrow terminal, a 16-colour terminal, and a pipe must each produce something correct and legible, not something broken.

## Suggested approach

Worth doing a mockup pass first and agreeing the direction before implementing — this is subjective, and the design gate owns subjective judgement on this project. Reference point is lazygit, which was the stated target for CON-12 and remains the bar: dense, colourful, unmistakable focus, and never noisy.
