## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and round 1's
  `skeptic-design-1.md` in full.
- Confirmed **round-1 Change Request 1 is closed**: design.md's Decision now
  reads `const cols = Math.max(40, (opts && opts.cols) || 80);` before deriving
  `innerCols`, and tasks.md 2.3 states the same. Verified this literally matches
  the fallback convention already used at every other `cols` derivation in the
  file: `lib/ui/screens/fleet.js:599` (`buildHeadTail`) and `:960`
  (`renderFleet`), both `Math.max(40, (opts && opts.cols) || 80)`, and `:505`
  (`Math.max(40, o.cols || 80)`). The `test/fleet.test.js:2148` caller that
  omits `cols` will now get the same `80`-default fallback as every other
  reader in `visibleWindow`, closing the `NaN` risk. Confirmed.
- Confirmed the stale `fleet.js:196` reference is now reconciled to `:288` in
  design.md's Context section (tasks.md already had it correct in round 1).
- Confirmed a new task (2.1) explicitly adds `require('../textwrap')` to
  `fleet.js`, closing round 1's non-blocking note.
- **Round-1 Change Request 2 ("suffix appended unbounded after wrap can
  overflow the border") is claimed closed by reserving `suffixWidth` before
  wrapping** (`opts.cols - 8 - suffixWidth`). I did not take design.md's
  arithmetic ("the last line's length is at most `(opts.cols - 8 -
  suffixWidth) + suffixWidth = opts.cols - 8`") on faith — I read the actual
  `textwrap.wrap()` implementation the design commits to reusing "verbatim"
  and reproduced the arithmetic against it. **The guarantee does not hold**;
  see Change Request 1 below, which is a new, narrower gap than round 1's,
  not the same one restated.

### Verdict: REFUTE

### Change Requests

1. **The suffix-reservation fix (design.md Decision, "`fleet.js:288`
   (`renderRun`, NEEDS YOU row)"; tasks.md 2.2) still allows the last wrapped
   line + appended suffix to exceed `opts.cols - 8`, because it assumes
   `textwrap.wrap(text, width)` treats `width` as a hard cap — it does not.**
   `lib/ui/textwrap.js:14` clamps its input: `const w = Math.max(10, width);`.
   When the reserved width `opts.cols - 8 - suffixWidth` is less than 10 (or
   negative, which happens whenever the suffix alone is within 10 columns of
   or wider than the available budget), `wrap()` silently wraps against `10`
   instead of the intended (smaller or negative) reservation — so the design's
   own equality `(opts.cols - 8 - suffixWidth) + suffixWidth = opts.cols - 8`
   is false in exactly this case, because the first term is not what's
   actually fed to the wrapper.

   This is not a contrived edge case. `run.escalation.options` comes straight
   from event data (`lib/ui/reducer.js:61-65`'s `toOptions(ev.options)` —
   arbitrary strings, not a fixed `approve`/`deny` pair), so `keys = '   ' +
   options.join(' / ')` can be long even at a normal terminal width, and the
   file already floors box width at 40 columns elsewhere in this same design
   (`Math.max(40, ...)` at `fleet.js:505/599/960`, and design.md's own CR1 fix
   for `sectionHeight`) — so a 40-column terminal (`innerCols` floor 36,
   `opts.cols - 8` = 28 in `renderRun`) is an explicitly supported case, not
   an extreme one.

   Reproduced directly against this worktree's actual `textwrap.js`/`format.js`
   with realistic (not exaggerated) data — a two-option escalation (`approve`/
   `deny`) plus a stale marker, at the 40-column floor:

   ```
   suffix = ' [stale]' + '   approve / deny'   // suffixWidth = 25
   budget = opts.cols - 8 = 28                  // innerCols floor 36, minus 8
   reserved = budget - suffixWidth = 3          // what design.md says to pass to wrap()
   wrap(question, 3) actually wraps at Math.max(10, 3) = 10
   last wrapped line + suffix = "entirely [stale]   approve / deny"
   visibleLength = 33  >  budget (28)
   ```

   i.e. the NEEDS YOU box border overflows by 5 columns with entirely
   ordinary data — exactly the "corrupting the box borders" failure the
   ticket's acceptance criteria rules out, and the same failure mode round 1's
   Change Request 2 originally flagged, just via a different mechanism (the
   wrapper's own width floor) than the one design.md's current text addresses
   (unbounded suffix without reservation). The current revision covers one
   cause of overflow but not this one.

   Required revision: design.md/tasks.md must account for `textwrap.wrap`'s
   `Math.max(10, width)` floor when deriving the question's wrap width, e.g.
   by explicitly capping/handling the case `opts.cols - 8 - suffixWidth < 10`
   — such as reserving the suffix on its own line when it can't fit combined
   with even a minimally-wrapped question (falling back to appending the
   suffix as a new line rather than tacking it onto the last wrapped line), or
   truncating the *composed* last line back down to `opts.cols - 8` after
   appending (the "re-truncate" alternative round 1 already offered but
   design.md chose not to take). Whatever the fix, it must not rely on
   `wrap()` honoring a width smaller than 10, since it does not.

### Non-blocking notes

- The reservation approach as currently written also does not address a
  second, related `wrap()` property: a single word longer than the wrap width
  is still emitted whole on its own line (`textwrap.js:22-29`'s loop only
  breaks *between* words). This means even with Change Request 1 fixed, an
  unusually long single "word" (no spaces) in the question could itself
  exceed `opts.cols - 8 - suffixWidth` and, once the suffix is appended,
  overflow the border independent of the `Math.max(10, width)` floor. This is
  lower-severity (existing callers of `wrap()` for the context field already
  accept this same limitation, and long single unbroken tokens in a
  human-authored question are less likely than the CR1 scenario above), so
  it's not required blocking, but the eventual fix for CR1 should ideally also
  cover it (e.g. the "re-truncate the composed last line" alternative handles
  both issues in one mechanism, whereas widening the reserved-width approach
  alone would only fix CR1).
