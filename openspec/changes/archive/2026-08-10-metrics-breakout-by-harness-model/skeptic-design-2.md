## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read the current `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-metrics-harness-breakdown/spec.md` in full (post round-1 revision).
- **Round 1's sole change request — the nonexistent "METRICS section" in
  `docs/dashboard.md` — is genuinely resolved, not just reworded.**
  - `design.md` now has a "Docs target" decision that: (a) explicitly names
    the gap (no `## METRICS` heading exists today), (b) explains why a full
    retroactive METRICS-panel doc is out of scope, and (c) commits to a
    concrete, bounded resolution — a new `### The METRICS panel` subsection
    under the existing `## What it looks like` heading, structurally
    matching the file's existing per-panel subsection precedent (`### The
    drill-down's TICKET panel`, `### The CHANGES panel`).
  - I independently verified that precedent against ground truth:
    `grep -n "^## \|^### " docs/dashboard.md` shows `## What it looks like`
    at line 15, with `### The drill-down's TICKET panel` (line 73), `###
    The run drill-down's other keys` (line 104), and `### The CHANGES
    panel` (line 127) already nested under it as sibling `###`
    subsections — exactly the pattern design.md claims to be following.
    There is still no existing `METRICS`-named heading anywhere in the
    file (confirmed again this round), so the new subsection is a genuine
    addition, not a collision or a re-purposing of something that already
    exists.
  - `tasks.md` task 4.1 was rewritten to match design.md's decision
    precisely: it names the same gap, the same new subsection
    (`### The METRICS panel`), the same placement (under "What it looks
    like", alongside the same two named sibling subsections), and the same
    bounded content scope (compact tier briefly, expanded tier's fields,
    ending with the new breakdown lines' behavior including the `>1`-value
    gate) — with an explicit "do not attempt a full retroactive doc"
    guardrail. `ticket.md`'s AC text ("Documented in `docs/dashboard.md`'s
    METRICS section") is unchanged, but design.md/tasks.md's resolution is
    a defensible, literal reading of that AC once a "METRICS section" is
    created rather than assumed — the implementer now has one unambiguous
    target instead of two divergent readings.
  - This closes the exact ambiguity round 1 flagged: the implementer no
    longer has to guess between "write a full METRICS-panel doc" (real
    scope creep) and "leave an orphaned note" (fails the AC as read). The
    new subsection is scoped, placed, and content-bounded.
- Reconfirmed `openspec validate metrics-breakout-by-harness-model --strict`
  → `Change 'metrics-breakout-by-harness-model' is valid`.
- Confirmed no source files changed since round 1: `git log --oneline -5 --
  lib/ui/screens/fleet/metrics.js lib/ui/reducer.js
  lib/ui/screens/drilldown.js test/fleet.test.js` shows only pre-existing
  commits (last touch CON-104, unrelated); `git status` shows only the
  untracked `openspec/changes/metrics-breakout-by-harness-model/` directory
  — i.e. round 1's exhaustive line-for-line verification of `metricsFor()`,
  `metricsColumnLines()`, the `terminal`/`withElapsed` definitions, the
  `run.harness`/`run.model` population in `reducer.js`, `drilldown.js`'s
  `harnessText()` field reuse, the `sectionJumpTargets()` defensive-defaults
  call site, and the `test/fleet.test.js` fixture/backward-compatibility
  analysis still applies unchanged this round — none of that ground truth
  moved, and the round-2 diff to design.md/tasks.md touches only the docs
  decision and task 4.1, not any of the technical grouping/rendering
  decisions round 1 already validated.
- Re-read the technical decisions (grouping keys, ALL-history-vs-window
  rationale, rendering gate `>1`, placement between `line7` and `recent
  escalations`, defensive defaults, `f.bar`/`f.dur` reuse) and the spec
  delta's scenarios once more for internal consistency with the (unchanged)
  proposal/ticket — no contradictions found; nothing new was introduced
  this round beyond the docs-target fix.

### Verdict: CONFIRM

### Non-blocking notes

- Same as round 1: worth a sentence in `design.md` noting that a
  harness/model with runs recorded but none yet terminal still gets a
  breakdown entry (`rate: null, done: 0, total: 0`, `avgMs: null`) — not a
  defect, just under-narrated relative to the no-harness-recorded exclusion
  case. Not blocking.
