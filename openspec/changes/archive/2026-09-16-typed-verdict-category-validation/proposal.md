## Why

The corpus holds ~2,300 `verdict` events. Each records a pass/refute outcome
and nothing about *what kind* of objection it was, so the loop records what it
*did* thoroughly and what it *judged* barely at all. The most interesting
available question is therefore unanswerable: is the Skeptic's objection
profile shifting from mechanical toward design judgment over time?

Two adjacent defects make the same recorded chain less trustworthy than it
looks. Nothing validates the `head_sha` written onto a verdict, and the corpus
already contains three malformed ones (a 39-character SHA on HEL-1107, and
8-character SHAs on HEL-1105 and HEL-1121) — a verdict recorded against a
malformed SHA is worse than one recorded against none, because it looks
verified. Separately, on HEL-1109 an orchestrator emitted a second `verdict`
event for a review the skeptic had already recorded, producing two entries for
one review; an orchestrator-authored verdict is indistinguishable in kind from
a forged one, which is precisely what the cold-gate design exists to prevent.

All three land in the same region of `core/scripts/emit-event.sh` (the `k=v`
case statement and the `verdict` block), so they ship together rather than
contending on that file across three branches.

## What Changes

- **Add a required `category` enum to every `verdict` event** (CON-189), with
  exactly four values: `mechanical`, `spec-divergence`, `design-judgment`,
  `intent-mismatch`. Validated on emit — an unknown value is refused rather
  than passed through by the generic `k=v` passthrough, which accepts
  anything today.
- **State the enum, and when each value applies, in the three role
  definitions that emit verdicts** — `core/roles/evaluator.md`,
  `core/roles/skeptic.md`, `core/roles/auditor.md`. No other role emits a
  `verdict` event (`executor.md` emits none).
- **Validate `head_sha` format on emit** (CON-187): a *stated* `head_sha`
  must be a 40-character hex SHA. This applies to stated SHAs only. An
  omitted `head_sha` stays legitimate and unchanged — `auditor.md` passes
  none at all and relies on emit-time inference, and an inferred SHA comes
  from `git rev-parse HEAD`, so it is 40 characters by construction.
- **Make a duplicate verdict record preventable or mechanically detectable**
  (CON-194), and **state plainly in `core/roles/orchestrator.md` that the
  orchestrator never emits `verdict` events**. The existing prohibition at
  `orchestrator.md:900` is scoped narrowly to representing a CON-152
  override; it is widened to a general rule.
- **Historical events are never rewritten or migrated.** Every consumer keeps
  a defined, non-crashing behavior for a `verdict` event carrying no
  `category` and for one carrying a malformed `head_sha`, so the existing
  ~2,300-event corpus stays readable. Past tickets in this batch leaned on
  historical event data; breaking it is not acceptable.
- **Update `test/scripts/emit-event.test.sh:692`**, whose existing fixture
  passes `head_sha=deadbeef` (8 characters) and which the new validation
  necessarily breaks. The fixture is corrected; the validation is not
  weakened to accommodate it.

**Not a free-text reason field.** Free text would need a model to classify
it, which is exactly the unauditable step this taxonomy exists to avoid.

## Capabilities

### New Capabilities
- `verdict-category`: the required four-value category enum on every
  `verdict` event — its legal values, its emit-time validation, where each
  value applies, and the tolerance guarantee for historical uncategorized
  verdicts.
- `verdict-authorship`: which role may author a `verdict` event, and how a
  duplicate or ambiguous verdict record for a single review is prevented or
  made mechanically detectable.

### Modified Capabilities
- `verdict-sha-binding`: its "Verdict events record the reviewed SHA"
  requirement currently constrains only whether the SHA was stated or
  inferred, not whether a stated value is well-formed. It gains a format
  constraint on a stated `head_sha`, while its existing omitted-SHA and
  unresolvable-HEAD scenarios keep their current behavior unchanged.

## Impact

- `core/scripts/emit-event.sh` — the `k=v` case statement (a new `category`
  case alongside CON-188's `resolution_channel`) and the `verdict` block.
- `scripts/concertino/emit-event.sh` — the rendered copy, which
  `test/scripts/rendered-scripts-drift.test.sh` (in the `npm test` chain)
  byte-compares against `core/scripts/`. Both copies must be updated
  identically, preserving the executable bit. `concertino sync` is NOT run
  in this batch by owner instruction.
- `core/roles/{evaluator,skeptic,auditor}.md` — each states the enum and
  passes `category=` on its verdict emission.
- `core/roles/orchestrator.md` — the widened never-emit-verdicts rule.
- `test/scripts/emit-event.test.sh` — new mutation-proven coverage, plus the
  corrected `head_sha=deadbeef` fixture.
- Consumers that read `verdict` events, none of which may crash on a
  category-less historical event: `lib/ui/reducer.js`,
  `lib/ui/screens/fleet/metrics.js`, `scripts/concertino/check-merge-readiness.sh`.
- No runtime dependency is added (this repo's `dependencies` is empty by
  policy). No migration of `.concertino/runs/**/events.jsonl`.

**Tension this change must resolve explicitly, not silently:**
`emit-event.sh`'s documented contract is "ALWAYS exits 0 in normal mode —
telemetry must never fail a delivery run," yet CON-189 requires rejecting a
verdict. A rejected verdict means *no* verdict is recorded, which is the
CON-185 "PR opened with zero gate verdicts" hazard. CON-188 set a precedent
for a non-zero exit on an invalid `resolution_channel`, but on
`escalation.answered`, not on `verdict`. `design.md` decides this.
