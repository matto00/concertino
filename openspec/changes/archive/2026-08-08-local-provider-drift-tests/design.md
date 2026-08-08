## Context

CON-44's local-ticket-provider slice (PR #78) shipped with three places where
the "reuse Linear's logic, never reimplement it" discipline slipped:

1. `lib/ui/tickets/local.js:247-251` reimplements `stateTypesFromConfig`
   verbatim from `lib/ui/linear.js:421-426`, under a comment (line 245-246)
   claiming it is "linear.js's logic reused rather than reimplemented". It
   is not — `linear.js` already exports `stateTypesFromConfig` (its
   `module.exports` block, alongside `deriveEpics` and `OPEN_STATE_TYPES`,
   both of which `local.js` already correctly imports).
2. `lib/ui/tickets/local.js:28` defines `STATES` as a JS array; `core/scripts/set-ticket-state.sh:37`
   defines the same five values again as a space-separated shell string.
   Nothing couples them — a future edit to one and not the other produces a
   local provider that accepts (or rejects) a state its own store disagrees
   with.
3. `set-ticket-state.sh` takes `<tickets-dir>` as its first positional
   argument. Design Decision 3 of the original slice's design doc
   (`docs/superpowers/specs/2026-08-07-local-ticket-provider-design.md`)
   states the tickets path is "fixed, not configurable... A
   `ticketProvider.dir` knob would add config surface and a test matrix for
   a choice nobody has asked to make." Decision 6 specified the script's
   signature as `set-ticket-state.sh <TICKET_ID> <state>` — two arguments,
   no directory. It shipped with three: `<tickets-dir> <TICKET_ID> <state>`.
   In practice this is inert — `lib/cli/render.js:143`'s only production
   call site always passes the literal string `tickets` — but nothing
   currently proves that, and the argument's mere existence contradicts
   Decision 3 as written.

## Goals / Non-Goals

**Goals:**
- Make `stateTypesFromConfig` genuinely shared code, not two copies that
  happen to currently agree.
- Couple `STATES` across its two copies with a test, so a future edit that
  changes one without the other fails loudly instead of shipping.
- Resolve the contradiction between Decision 3 and `set-ticket-state.sh`'s
  actual signature — explicitly, in the design doc, rather than leaving it
  silently inconsistent.
- Document the three scripts missing from `core/scripts/README.md`'s
  Scripts table that the ticket calls out by name.

**Non-Goals:**
- Rewriting `test/scripts/set-ticket-state.test.sh`'s ~30 cases to drop the
  `<tickets-dir>` argument and instead `cd` into a temp directory for
  isolation. That is a legitimate alternative shape, but it is a
  large, purely-mechanical rewrite of an already-well-covered, CON-90-hardened
  test file, for a Low-priority ticket whose own text already names
  "testability against a temp directory" as the reason the argument exists.
  See Decision 2 below for why documenting the exception, not removing the
  argument, is the chosen resolution.
- Moving `linear.js` into a `providers/` directory with a formal interface —
  out of scope per the original slice's design doc, unaffected by this
  change.
- Any change to the five-state vocabulary itself, to `set-ticket-state.sh`'s
  commit/push behavior (`local-ticket-state-durability`), or to the
  state-label mapping (`launchpad-local-parity`) — this change only adds
  drift protection and documentation around existing, unchanged behavior.

## Decisions

### Decision 1 — `stateTypesFromConfig` becomes a re-export, not a reimplementation

`lib/ui/tickets/local.js` already does `const { deriveEpics, OPEN_STATE_TYPES } = require('../linear');`.
Add `stateTypesFromConfig` to that same destructure:

```js
const { deriveEpics, OPEN_STATE_TYPES, stateTypesFromConfig } = require('../linear');
```

and delete the local reimplementation (lines 245-251) entirely, including
its now-doubly-true comment (the comment can be dropped since the import
line and its neighbours already carry the "reused from linear.js" framing
used for `deriveEpics`/`OPEN_STATE_TYPES`). `module.exports` at the bottom
of `local.js` keeps exporting `stateTypesFromConfig` under the same name —
only where the name is *defined* changes, not the module's public shape, so
every call site (`watch.js:334`) is unaffected.

This is the simplest of the three fixes: `linear.js` already exports the
function, `local.js` already has the exact same import pattern in use one
line above for two other names — this just extends that pattern to a third.

### Decision 2 — couple `STATES` with a drift test, following `ticket-pattern.test.sh`'s precedent

Rather than trying to make the shell script *import* the JS array (impossible
without a JS runtime dependency this project deliberately does not take on —
see `local.js`'s own "zero runtime dependencies" comment on its frontmatter
parser), add a new test, `test/scripts/ticket-state-vocabulary.test.sh`,
modelled directly on `test/scripts/ticket-pattern.test.sh`:

1. Extract `lib/ui/tickets/local.js`'s `STATES` array via a small `node -e`
   one-liner (`require('../../lib/ui/tickets/local').STATES.join(' ')`),
   producing a space-separated string in array order.
2. Extract `core/scripts/set-ticket-state.sh`'s `STATES="..."` line via
   `grep`/`sed` (mirroring how `ticket-pattern.test.sh` already extracts a
   bracket expression from multiple shell files).
3. Byte-compare the two space-separated strings. Order matters — both are
   currently written `backlog unstarted started completed canceled`, Linear's
   own `state.type` vocabulary order, and keeping order-sensitivity in the
   comparison catches an accidental reorder too, not just an add/remove.
4. Wire the new suite into `package.json`'s `test` script, next to
   `ticket-pattern.test.sh` — a bash suite not listed there never runs
   (the exact trap `docs/superpowers/specs/2026-08-07-local-ticket-provider-design.md`'s
   Testing section already calls out for `set-ticket-state.test.sh`).

This mirrors `ticket-id-path-safety`'s existing "the pattern stays
byte-identical across every shell copy" requirement shape — same idea,
applied to a five-value vocabulary shared between one JS file and one shell
script instead of a regex shared between five shell files.

### Decision 3 — document the `<tickets-dir>` argument as a deliberate, test-only exception to Decision 3, rather than removing it

Two options were weighed:

- **Remove the argument.** `set-ticket-state.sh` would hardcode `tickets`
  (relative to its caller's cwd, matching how the orchestrator always
  invokes it — see `docs/config-reference.md:216`'s
  `set-ticket-state.sh tickets "$TICKET_ID" started` **against the main
  checkout** note). `test/scripts/set-ticket-state.test.sh` would need every
  one of its ~30 cases rewritten to `cd` into a `mktemp -d` directory (or a
  `tickets/` subdirectory under one) instead of passing the directory
  positionally — including the git-repo cases added by CON-90
  (`local-ticket-state-durability`), which seed a real git working tree and
  would need that tree's root to itself be named appropriately for a
  relative `tickets` path to resolve from within it.
- **Keep the argument, document why.** The argument is real, but *inert* in
  production: `lib/cli/render.js:143` is the only place that ever
  constructs the call, and it always passes the literal string `tickets`.
  Decision 3's actual intent — a project cannot configure a different
  tickets location — already holds; only the *script's own signature*
  looks configurable, and only to someone reading `set-ticket-state.sh` in
  isolation without also reading `render.js`.

This change takes the second option. `docs/superpowers/specs/2026-08-07-local-ticket-provider-design.md`'s
Decision 3 gains an explicit paragraph:

> **Exception:** `core/scripts/set-ticket-state.sh` accepts `<tickets-dir>`
> as its first positional argument, not because the path is configurable in
> production, but so `test/scripts/set-ticket-state.test.sh` can exercise
> the script against an isolated `mktemp -d` scratch directory rather than
> a real project's `tickets/`. The only production call site
> (`lib/cli/render.js`'s rendered orchestrator prose) always passes the
> literal string `tickets`; `test/scripts/local-provider-render.test.sh`
> gains an assertion pinning that literal so this exception cannot silently
> widen into an actual configurable surface.

`set-ticket-state.sh`'s own header comment (lines 12-13, currently just
`Usage: set-ticket-state.sh <tickets-dir> <TICKET_ID> <state>`) gains a
one-line pointer to this same exception, so a reader of the script alone —
without also having Decision 3 open — sees the same explanation.

`test/scripts/local-provider-render.test.sh` gains one new assertion after
its existing `has "names the write-back script" 'set-ticket-state.sh' "$ORCH"`
line, checking the rendered orchestrator prose contains the literal
`set-ticket-state.sh tickets "$TICKET_ID"` call shape — pinning the one
production call site to the fixed value, so a future edit that made the
directory genuinely configurable (e.g. templating in a config value) would
break this test rather than silently reopening the surface Decision 3
excludes.

### Decision 4 — `core/scripts/README.md` gains the three rows the ticket names

Add, alphabetically consistent with the table's existing loose ordering
(grouped by workflow phase rather than strictly alphabetical, so the new
rows are inserted near related entries rather than forced into strict
alpha order):

| Script | Purpose | Args |
|---|---|---|
| `set-ticket-state.sh` | Set a local ticket's state (write-back seam for `ticketProvider.kind: "local"`) | `<tickets-dir> <TICKET_ID> <state>` |
| `check-merge-readiness.sh` | Deterministic pre-merge gate for the auditor (agent-merge): CI green, PR mergeable, this run's gates passed | `<WORKTREE_PATH> <BRANCH> <TICKET_ID>` |
| `next-report-number.sh` | Collision-safe, disk-derived filename number for the evaluator's/skeptic's next review report | `<change-dir> <kind>` |

The ticket names exactly these three ("`check-merge-readiness.sh` and
`next-report-number.sh` are missing too — a pre-existing habit, not a new
one") and explicitly frames the broader gap (other scripts, e.g.
`check-agent-merge-permission.sh`, `next-ticket-id.sh`, are also undocumented)
as out of scope for this fix — so this change adds only the three named
rows, not a full table audit.

## Risks / Trade-offs

- **Decision 3's chosen resolution (document, don't remove) leaves the
  script's own signature still looking configurable to a reader who only
  sees `set-ticket-state.sh`, not the design doc or the render test.**
  Mitigated by putting the exception directly in the script's own header
  comment (Decision 3 above), not only in the design doc — a reader of the
  script alone gets the explanation without cross-referencing.
- **The `STATES` drift test (Decision 2) shells out to `node -e` to read the
  JS array**, adding a Node dependency to an otherwise-pure-bash test file.
  Every other bash suite in `test/scripts/` already assumes Node is on
  `PATH` (this is a Node CLI project; `bin/concertino` itself is a Node
  script), so this is consistent with the rest of the suite, not a new
  category of dependency.
