# Repo audit — 2026-08

A repo-wide sweep performed as part of CON-58 (add `CONTRIBUTING.md`, audit
for modularity/consistency issues). Scope bounded to the four areas the
ticket named — file size/responsibility, keybinding-dispatch duplication,
`core/` vs rendered-copy drift, and `docs/dashboard.md` drift — plus dead
code found incidentally while reviewing those. Each finding below has a
concrete recommendation: **fixed inline** in this change (only where
zero-risk and mechanically verifiable, per this change's design doc
Decision 3) or **follow-up** (proposed as its own ticket).

## 1. Oversized / multi-responsibility files

The ticket named two files (`lib/ui/watch.js` at ~2380 lines, `lib/ui/screens/fleet.js`
at ~1314 lines) from an earlier sweep. Both have grown further since:

| File | Lines (now) | Responsibilities mixed |
| --- | --- | --- |
| `lib/ui/watch.js` | 2,669 | Raw-mode stdin handling, alt-screen buffer management, the differential frame writer (`buildFrame`), the poll loop, session state for every screen (fleet/drilldown/launchpad/settings/escalation/ticketdraft/ticketview), and the action-dispatch `switch` that applies every screen's returned actions |
| `lib/ui/screens/fleet.js` | 1,506 | Section-building (NEEDS YOU/RUNNING/QUEUED/QUICK START/FAILED/DONE/METRICS), rendering, and a large hardcoded `handleKey` dispatch (29 `key === '...'` branches) covering prompt state, queue-focus state, quick-start-focus state, and top-level fleet keys all in one function |
| `bin/concertino` | 1,574 | The CLI entry point: argv parsing/dispatch for every subcommand (`init`, `sync`, `validate`, `diff`, `doctor`, `watch`, `prune`, `upgrade`, `gates`, `eject`, `migrate`, `completion`) plus the render/templating helpers those subcommands call |
| `lib/ui/screens/drilldown.js` | 778 | Second-largest screen — panel rendering (TICKET/TIMELINE/GATES/EVIDENCE) + scroll state + kill/restart confirmation flow |
| `lib/ui/screens/launchpad.js` | 595 | Epic/ticket browsing, pane-focus, batch selection |
| `lib/ui/linear.js` | 539 | Linear API client + pagination + caching-adjacent shaping |

**Recommendation: follow-up ticket(s), not fixed inline.** Splitting
`watch.js` (e.g. separating the raw-mode/alt-screen/frame-writer concerns
from session-state/action-dispatch) or `fleet.js` (e.g. extracting the
prompt/queue-focus/quick-start-focus key-handling into their own modules) is
exactly the kind of structural change this change's design doc calls out as
needing its own review cycle — a mechanical line-count fix here risks
exactly the regression the ticket's acceptance criteria are guarding
against. `bin/concertino`'s per-subcommand size is a natural split point
(one file per subcommand under a `lib/cli/` or similar) if it keeps growing.
None of the three has an obviously safe partial extraction available today,
so this audit does not propose a specific split — only flags that one
should be scoped and designed properly before being attempted.

## 2. Duplicated keybinding-dispatch logic — no shared registry

Confirmed: every screen implements its own hardcoded `if (key === '...')`
chain, with no shared keybinding registry or dispatch table anywhere in
`lib/ui/`.

| Screen | `key === ...` branches | Lines |
| --- | --- | --- |
| `lib/ui/screens/fleet.js` | 29 | 1,506 |
| `lib/ui/screens/launchpad.js` | 19 | 595 |
| `lib/ui/screens/drilldown.js` | 14 | 778 |
| `lib/ui/screens/settings.js` | 13 | 321 |
| `lib/ui/screens/ticketdraft.js` | 9 | 146 |
| `lib/ui/screens/launchplan.js` | 8 | 313 |
| `lib/ui/screens/escalation.js` | 7 | 337 |
| `lib/ui/screens/docview.js` | 5 | 250 |
| `lib/ui/screens/ticketview.js` | 1 | 144 |

(`lib/ui/screens/settings.js` — 13 branches — is a screen added since the
ticket's own sweep; it follows the exact same hand-rolled-per-screen
pattern as the other eight, confirming the pattern is still being repeated
in new code, not just legacy debt.)

Each screen's `handleKey`/`routeHandleKey` is a pure `(key, state) -> action
| null` function — that convention is consistent and good — but the actual
key-to-action mapping is duplicated structurally (an `if` chain per screen)
rather than declared once and dispatched generically. There is no single
place that answers "what does `j` do on every screen" or "is any key bound
to two different actions across screens" without reading all nine files.

**Recommendation: follow-up ticket, not fixed inline.** Extracting a shared
keybinding registry is explicitly named in the ticket as a change large
enough to need its own review cycle — it would touch all nine screens'
key-handling entry points and is exactly the kind of structural change this
audit is scoped to flag, not perform.

## 3. `core/` vs rendered-copy drift (beyond the known CON-52 instance)

Checked every `core/scripts/*.sh` against its rendered copy in
`scripts/concertino/*.sh`, plus `core/scripts/README.md` against
`scripts/concertino/README.md`:

```
for f in core/scripts/*.sh; do
  diff -q "$f" "scripts/concertino/$(basename "$f")"
done
```

**No drift found** — all 12 scripts and the `README.md` are currently
byte-identical between `core/scripts/` and `scripts/concertino/`. The CON-52
instance (a stale `CONCERTINO_BASE_REMOTE` comment in `cleanup.sh`) appears
to have been the only occurrence, and it's already fixed. `concertino doctor`
byte-compares rendered artifacts against `core/` on every run, which is the
mechanism that would catch a future recurrence — see `CONTRIBUTING.md`'s
"`core/` → rendered `scripts/concertino/*` template relationship" section
for why hand-editing a rendered file is the failure mode to avoid.

**Recommendation: none — no fix needed.** Noted here as a completed check,
not a finding requiring action.

## 4. Dead code

- **`lib/ui/cache.js`: unused `EMPTY` export.** `const EMPTY =
  Object.freeze({ fetchedAt: null, tickets: [], epics: [] })` duplicated the
  already-exported `empty()` function (which returns the same shape) and had
  zero references anywhere in the repo outside its own definition/export
  line (verified via a repo-wide grep across `lib/`, `bin/`, `core/`,
  `test/`, `adapters/`, `scripts/`). **Fixed inline** — removed the constant
  and its `module.exports` entry; `empty()` remains the sole API. Zero risk:
  nothing referenced `EMPTY`, confirmed by `npm test` passing unchanged
  after removal.

- **`lib/config.js`: unused `ROLES` export, and a literal role list
  duplicated 6 times instead.** `const ROLES = ['orchestrator', 'executor',
  'evaluator', 'skeptic', 'auditor']` is exported but has zero references
  anywhere outside its own definition/export line. Meanwhile the identical
  literal array `['orchestrator', 'executor', 'evaluator', 'skeptic',
  'auditor']` is hand-written **six** separate times: once inside
  `lib/config.js` itself (line ~281, in the same file that defines the
  unused `ROLES` constant) and five times across `bin/concertino`. This
  looks like an incomplete refactor — `ROLES` was added as the shared
  source of truth but never wired into any of its six duplicate call sites.
  **Not fixed inline** — this is a judgment call about intent (should the
  six call sites be migrated to use `ROLES`, or should `ROLES` simply be
  deleted as dead code?) rather than a mechanically-safe deletion; migrating
  six call sites across two files is also more than the "obviously
  unreachable branch / stale comment" bar this change's design doc sets for
  inline fixes. **Recommendation: follow-up ticket** — either wire
  `lib/config.js`'s `ROLES` into all six duplicate call sites (the more
  valuable fix — a sixth place to add a new role today is a real
  maintenance hazard) or remove the unused constant if there's a reason it
  should stay independent.

- No stale `TODO`/`FIXME`/`XXX` comments referencing already-resolved
  tickets were found (`grep -rn "TODO\|FIXME\|XXX"` across `lib/`, `core/`,
  `bin/`, `scripts/concertino/` returns only non-comment false positives —
  a config-validation string check and two `.replace()` calls using literal
  `'-XXX'` as a placeholder suffix, not a TODO marker).
- No broken `require()` targets were found (verified programmatically across
  every `.js` file under `lib/` and `bin/`).

## 5. `docs/dashboard.md` reconciliation

Enumerated every screen's actual keybinding dispatch (`grep -n "key ==="`
across `lib/ui/screens/*.js`) and diffed against the doc's existing
content. Most of the doc was already current (it had clearly been updated
alongside recent features — CON-53 through CON-57 are all reflected
correctly). Three real gaps were found and **fixed inline** (doc-only,
zero risk):

1. **The drill-down's `k` kill / `r` restart keys, and its EVIDENCE panel's
   PR-vs-doc distinction, were entirely undocumented.** The doc's top-level
   Keys table mentioned only "timeline, gates, evidence" for `l`/`→`; it
   never described that a live run's drill-down also binds `k`
   (kill, behind a `y` confirmation) and `r` (restart, behind a `y`
   confirmation), that `1`-`4`/`Tab` jump/cycle between the four panels, or
   that an EVIDENCE entry opens differently depending on its kind (a `pr`
   entry opens externally in the OS browser — CON-55 — while a plain
   evidence doc opens in the in-TUI reader). Added a new "The run
   drill-down" subsection documenting all of this.
2. **The settings screen (`s` from the fleet view) had no keybinding
   documentation at all** beyond the one-line "open the settings screen"
   entry in the top-level table — nothing about the two-pane
   sections/fields navigation, `S` to save, or the read-only-field
   behavior. Added a new "The settings screen" subsection.
3. **The launch plan's `h` (cycle harness), `m` (cycle agent-merge), `s`
   (cycle speed), and `n` (toggle start-now/hold) keys were never
   mentioned** — the doc described the ports/concurrency preview but not
   these four keys, all of which are live in `lib/ui/screens/launchplan.js`'s
   `handleKey`. Extended the existing launch-plan paragraph to name them.

No stale (documented-but-no-longer-real) keybindings were found — everything
already in the doc still matches current code.
