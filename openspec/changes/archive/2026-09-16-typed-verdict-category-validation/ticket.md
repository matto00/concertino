# CON-189: Require a typed category on every verdict event

## Description

This lane delivers THREE tickets together because all three modify the same
region of `core/scripts/emit-event.sh` (the `k=v` case statement and the
`verdict` block). Delivering them separately would mean three-way rebase
contention on one file. CON-189 is the primary (Urgent).

**CON-189 — Require a typed category on every verdict event.**
The corpus holds ~2,300 `verdict` events, each carrying a pass/refute outcome
and nothing about *what kind* of objection it was. The loop records what it
*did* thoroughly and what it *judged* barely at all, so the most interesting
available question is unanswerable: is the Skeptic's objection profile
shifting from mechanical toward design judgment over time? Add a required enum
on every `verdict` event:

```
mechanical       — gate failed, lint, type error, broken test
spec-divergence  — implementation does not match the written spec
design-judgment  — sound but wrong-shaped; an opinion about structure
intent-mismatch  — satisfies the acceptance criteria, misses the point
```

Constrain the enum in the role definitions and validate on emit — reject an
unknown value rather than passing it through. Do NOT add a free-text reason
field in place of this: free text would need a model to classify it, which is
exactly the unauditable step this taxonomy exists to avoid.

`intent-mismatch` is the load-bearing category. It is the only one that
records a reviewer noticing that work satisfies its stated acceptance criteria
and still misses the point.

**CON-187 — Validate `head_sha` length when recording a verdict.**
A verdict recorded against a malformed SHA is worse than one recorded against
none, because it looks verified. Validate on write: reject anything that is
not a 40-character hex SHA where a full SHA is expected.

**CON-194 — Orchestrators can emit verdict events the skeptic also emits.**
On helio HEL-1109 the orchestrator emitted its own verdict after the design
gate's round-2 CONFIRM, creating two log entries for one review. Two entries
for one review makes verdict counting ambiguous, and an orchestrator-written
verdict is indistinguishable in kind from a forged one — the very thing the
cold-gate design exists to prevent.

## Acceptance criteria

### CON-189
* Every `verdict` event emitted by a new run carries a category from the enum.
* `emit-event.sh` rejects a `verdict` with a missing or unknown category.
* The three role definitions (`core/roles/{evaluator,skeptic,auditor}.md`)
  state the enum and when each applies.

### CON-187
* `emit-event.sh` rejects (or pads-and-warns) a `head_sha` that is not a
  40-character hex SHA where a full SHA is expected.

### CON-194
* A duplicate/ambiguous verdict record is prevented or made mechanically
  detectable.
* The orchestrator role doc states plainly that it never emits verdicts.

## Verified premise corrections (established before Planning; treat as ground truth)

These were measured against the live tree, not assumed. Full evidence:
`.concertino/runs/CON-189/evidence/premise-validation.md` in the main checkout.

1. **CON-187's stated hazard is INACCURATE for the shipped consumer.** The
   ticket claims a short SHA means "any automated staleness or gate-chain
   check comparing a recorded verdict SHA to the current head would silently
   treat that verdict as belonging to a different commit." Measured: git
   resolves both a 39-char and an 8-char abbreviation via `cat-file -e`,
   `merge-base`, and `diff`, and `git diff --name-only <39char> <full>`
   returns EMPTY. `check-merge-readiness.sh`'s `stale_check` — the only
   shipped consumer — uses exactly those git-object operations, so it PASSES
   rather than mis-flagging. The hazard is real only for a STRING-comparing
   consumer (CON-185's planned check; a driver's grep audit). The defect
   (zero validation) and the fix are still valid; only the rationale is
   corrected.
2. **CON-187 UNDERCOUNTS the defect.** Not one malformed SHA but three:
   HEL-1107 skeptic (39 chars), HEL-1105 skeptic (8 chars), HEL-1121
   evaluator (8 chars) — 3 of 173 non-null stated SHAs.
3. **`head_sha` is ABSENT on most verdicts, legitimately.** 1,659/1,832 helio
   and 429/481 concertino verdicts have `head_sha: null`. `auditor.md`'s emit
   passes NO `head_sha` at all and relies on emit-time inference. Validation
   must therefore apply to STATED SHAs only — a hard-fail on an absent
   `head_sha` would break the auditor.
4. **CON-194's first fix option is NOT mechanically enforceable.** "Make
   verdict events writable only by the reviewing role and reject an
   orchestrator-authored one" cannot work in the emitter: `role=` is
   caller-asserted and `emit-event.sh` has no access to caller identity. On
   HEL-1109 the orchestrator emitted `role=skeptic` — it IMPERSONATED the
   reviewing role. The enforceable options are: always populate `gate` so a
   same-gate duplicate is detectable; the doc prohibition; consumer-side
   dedupe.
5. **CON-194's `gate`-population discriminator is unsound retroactively.** 23
   helio + 3 concertino skeptic verdicts carry a populated `gate`, nearly all
   pre-CON-166 with no SHA, so historical `gate` population cannot be
   attributed to orchestrator authorship.
6. **The orchestrator doc already partially covers CON-194.**
   `core/roles/orchestrator.md:900` says "Never emit a `verdict role=skeptic`
   event yourself" — but scoped narrowly to representing a CON-152 override.
   It needs widening to a general prohibition, not writing from scratch.
7. CON-189's corpus counts are slightly stale (measured 2,313, ticket says
   2,290). Immaterial to the argument.

## Binding constraints for this lane

1. **`test/scripts/rendered-scripts-drift.test.sh` is in the `npm test` chain**
   and byte-compares `core/scripts/**` against `scripts/concertino/**`.
   Editing `core/` alone turns CI red. Both copies MUST be updated
   byte-identically. The `.sh` render is a verbatim copy (no templating).
   **Do NOT run `concertino sync`** — the owner forbade it for this batch
   (helio gets one deliberate sync after the whole batch). Copy
   `core/scripts/emit-event.sh` to `scripts/concertino/emit-event.sh`
   directly, preserving the executable bit.
2. **`test/scripts/emit-event.test.sh:692` uses `head_sha=deadbeef`** (8
   chars). CON-187's validation WILL break this existing test. Fix the
   fixture as part of the change; do not weaken the validation to
   accommodate it.
3. **The emitter's documented contract is "ALWAYS exits 0 in normal mode —
   telemetry must never fail a delivery run."** CON-189 AC2 requires
   rejecting a verdict. A rejected verdict means NO verdict is recorded,
   which is exactly the CON-185 "PR with zero gate verdicts" hazard. CON-188
   set a precedent for `exit 1` on an invalid `resolution_channel`, but on
   `escalation.answered`, not `verdict`. **This tension must be resolved
   explicitly in `design.md`, including what happens to a verdict emitted
   with no category by an un-updated caller, and whether historical
   uncategorized events in `events.jsonl` must remain readable.** Past
   tickets in this batch leaned on historical event data.
4. **A validation that cannot fail is worse than none (CON-197 precedent).**
   Prove by MUTATION that an invalid category and a short `head_sha` each
   actually produce a failure. The pre-fix baseline is recorded: today
   `category=totally-bogus`, a missing category, and `head_sha=deadbeef` all
   exit 0. Every new assertion must be shown RED against the pre-fix script
   before being shown green.
5. **`read_raised_field()`'s field dispatch defaults silently to
   `sub_questions` for an unrecognized argument** (`emit-event.sh:442-465`,
   `else v = last.sub_questions`). CON-188's evaluator flagged tightening
   this to an explicit error when a fourth field is added. Rule on whether
   this lane is that fourth field.
6. `npm test` is one serial ~50-suite chain: always allow a long timeout,
   never pass `-n`. `npm run test:selftest` asserts nothing (CON-142) — never
   cite it as evidence.
7. `openspec validate "<NAME>" --type change` is the working form on 1.10.0
   (`--change` is rejected for `validate`; do NOT accept its `--changes`
   suggestion, which validates every change instead of the named one). It IS
   a live gate — it exits 1 on real errors. When probing any exit status,
   use `PIPESTATUS` or capture the status before piping: `cmd | tail -2; echo
   $?` captures `tail`'s status and is the most repeated measurement error in
   this batch.
8. `concertino.config.json` is gitignored/untracked and ABSENT from this
   worktree (CON-70). Never write an acceptance criterion that validates it
   from inside a worktree.
9. Record FULL 40-character SHAs for every gate verdict — pointedly, on the
   ticket that adds 40-char SHA validation.
