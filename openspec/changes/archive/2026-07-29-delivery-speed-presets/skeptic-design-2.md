## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read round 1's report (`skeptic-design-1.md`) in full as a claims list, not fact.
- Read the current `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/delivery-speed-presets/spec.md` fresh, in full.
- Re-read `core/scripts/setup-worktree.sh` in full (206 lines): confirmed the
  header-comment `READY` contract, `detect_harness()`/`HARNESS` resolution
  order, and the single `run.start` emission (lines 192–200) match Decision
  3a's description exactly — `SCRIPT_DIR` (line 50) is the same directory
  `resolve-speed.sh` will be copied into, so `"${SCRIPT_DIR}/resolve-speed.sh"`
  is reachable from inside this script as designed. Round 1's finding #2 is
  resolved.
- Re-read `bin/concertino`'s `cmdEject` (763–817, flat lookup at 795/810),
  `cmdDiff` (1101–1156, flat lookup at 1124/1143), and `cmdValidate`'s Models
  section (1298–1471, hardcoded `modelDefaults`/`models[role]` at 1391–1404) —
  confirmed the exact line numbers task 1.5/Decision 1 cite are correct and
  the scope (`emitClaude`, `emitCodex`, `cmdEject`, `cmdDiff`, `cmdValidate`)
  is complete — no other `c.models` reader exists (`grep -n "c.models\|models\["
  bin/concertino` returns exactly these plus the `withDefaults()` synthesis at
  line 286). Round 1's finding #3 is resolved.
- Confirmed `jq` is already an established dependency in this codebase
  (`core/scripts/check-merge-readiness.sh` already shells out to it), so
  `resolve-speed.sh`'s reliance on it is not a new, untested assumption.
- Read `lib/ui/screens/launchplan.js` in full (194 lines) — its own header
  comment (line 3) states: "The launch plan — the confirm gate. **Pure:
  (state, opts) -> string.**" `render()`/`handleKey()` do no I/O anywhere in
  the file; the only exported "action" helpers (`cycleConcurrency`,
  `withAgentMergeFlag`) are pure functions of already-known values.
- Read `lib/ui/watch.js`'s `open-launchplan` (908–990), `cycle-concurrency`
  (996–998), `cycle-harness` (1000–1013), `cycle-agent-merge` (1015–1020+),
  and the `applyAction` switch's `default: return false;` (1076–1078). Ground
  truth here is decisive:
  - `open-launchplan`'s own comment (908–911): "Ports, base commit and the
    ordered ticket list are all computed **HERE, once**... the plan screen
    itself **stays pure** and just renders this snapshot." It then computes
    `commitSha` via a **synchronous `execFileSync('git', ...)` child-process
    call** (955–966) exactly once, at plan-creation time, and stores the
    result on the `plan` object for `launchplan.js` to render.
  - `cycle-harness`/`cycle-concurrency`/`cycle-agent-merge` are handled by
    dedicated `case` branches in `watch.js`'s switch that mutate the `plan`
    object; `launchplan.js`'s `handleKey()` never mutates state itself — it
    only returns an action-type token that `watch.js` must have a matching
    `case` for. An unmatched action type falls through to `default: return
    false;` — a **silent no-op**.
  - `draw()` (362–491) calls `router.render(currentState(), ...)`
    **unconditionally on every poll** — `POLL_MS = 1000` via `setInterval`
    (line 525), *and* after every keypress (`applyAction(action)) runs =
    draw();`, e.g. line 1091) — regardless of which screen is on top.

### Verdict: REFUTE

Round 1's findings #2 and #3 are now solidly fixed against ground truth (both
independently re-verified above, not just re-read as prose). Round 1's finding
#1 (`resolve-speed.sh`'s signature / no mechanism for the launch-plan preview)
is **only partially fixed**. The script-level fix (optional `$2` harness
override) is correct and matches ground truth. But the orchestrator's revision
of the *TUI-wiring* half of that same finding — which file actually invokes
`resolve-speed.sh` for the preview, and how the `s`-cycle key is supposed to
work — contradicts this codebase's own established architecture and, as
written, would not work at all.

### Change Requests

1. **Task 5.4 / Decision 6 place the synchronous `resolve-speed.sh`
   child-process invocation inside `lib/ui/screens/launchplan.js`, which this
   file's own header comment declares "Pure: (state, opts) -> string" — and
   the established precedent for exactly this kind of one-time, plan-creation
   child-process call (`commitSha` via `execFileSync`, `watch.js:955–966`)
   lives in `watch.js`'s `open-launchplan` case, not in the screen module.
   `design.md`'s own Decision 3 text ("The launch plan screen
   (`lib/ui/screens/launchplan.js`, **via `watch.js`**)...") gestures at
   `watch.js`'s involvement in one parenthetical, but neither `design.md`'s
   Impact section, `proposal.md`'s Impact section, nor a single `tasks.md`
   item (5.1–5.6) touches `lib/ui/watch.js` at all (`grep -c watch.js
   tasks.md` → 0). As written, an implementer following tasks.md would put
   the child-process call inside `render()`/`renderLaunchPlan()`, which
   `draw()` calls unconditionally every 1000ms (`POLL_MS`, `watch.js:525`)
   *and* after every keypress while the launch-plan screen is open —
   re-forking `resolve-speed.sh` on a bare polling timer for a value that
   hasn't changed, which is both the literal "pure screen shells out on every
   render" anti-pattern this codebase's own `open-launchplan` comment
   explicitly designed around, and a needless subprocess spawn once a second
   for as long as a human sits on the launch-plan screen. **Required fix**:
   move the `resolve-speed.sh <speed> <harness>` call into `watch.js`'s
   `open-launchplan` case (computed once at plan creation, alongside
   `commitSha`, stored as e.g. `plan.resolvedModels`), with `launchplan.js`'s
   `render()` only reading that already-resolved field — never invoking a
   child process itself.

2. **No task item adds the `cycle-speed` case `watch.js`'s `applyAction`
   switch needs, so the described `s` key does nothing.** Decision 6 /
   task 5.4 specify `handleKey` returns an `s`-cycling action "same shape as
   `cycleConcurrency`/`h`/`m`" — but `cycleConcurrency`/`cycle-harness`/
   `cycle-agent-merge` are only *effective* because `watch.js`'s switch has a
   matching `case` for each (`watch.js:996–1020`) that actually mutates
   `plan`; any action type without a matching case falls through to
   `default: return false;` (`watch.js:1076–1078`), a silent no-op. Neither
   `design.md` nor any `tasks.md` item (again, zero `watch.js` references)
   adds a `case 'cycle-speed':` branch. As written, pressing `s` on the
   launch-plan screen would render nothing changing and nothing would tell
   the human why. **Required fix**: add a task item for `lib/ui/watch.js`
   covering (a) seeding `plan.speed` (defaulting to `'default'`) and
   `plan.resolvedModels` inside the existing `open-launchplan` case, next to
   where `harness`/`agentMerge` are already seeded (`watch.js:972–978`), and
   (b) a new `case 'cycle-speed':` mutating `plan.speed` through
   `default → fast → slow → default` and re-invoking `resolve-speed.sh` to
   refresh `plan.resolvedModels` for the (possibly now-different)
   speed/harness pair — mirroring how `cycle-harness` (`watch.js:1000–1013`)
   already re-derives `plan.launchCommand` when `harness` changes. The
   existing `cycle-harness` case should also refresh `plan.resolvedModels`
   when it changes `plan.harness`, since the preview is per-(speed, harness)
   and currently nothing invalidates a stale preview when only harness
   cycles.

Both requests target the same underlying gap round 1 raised under finding #1
("no mechanism existed for the launch-plan screen to preview resolved
models... for a human-selected harness") — the script-level half of that gap
is now fixed, but the TUI-wiring half is still incompletely and, in the case
of where the child-process call lives, incorrectly specified against this
repo's own architecture.

### Non-blocking notes

- Decision 5's Claude Code `Agent`-tool `model`-override citation and
  fallback-degradation note, and the new Risk bullet on `concertino
  migrate`'s inability to rewrite flat `models` configs, both directly and
  adequately address round 1's two non-blocking notes — no further action
  needed there.
- Once change request 1/2 are addressed, worth also specifying in tasks.md
  what `plan.resolvedModels` looks like when `resolve-speed.sh` errors or is
  absent (predates this feature) — `design.md`'s prose already says "models
  unknown" rendered gracefully, but no task item states the exact shape
  (`null`? `{ error: '...' }`?) `launchplan.js`'s render would branch on.
