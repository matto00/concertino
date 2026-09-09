## Context

Confirmed at `8c746fb` (see `.concertino/runs/CON-161/evidence/premise-validation.md`):
`core/roles/executor.md`'s resume note skips step 1 (the only step reading
`ticket.md`/canonical standards/Iron Laws) and jumps straight to step 2;
`core/roles/evaluator.md`'s resume note explicitly says "do NOT re-read the
ticket/proposal/design/tasks." Both roles do, however, already read
`workflow-state.md` fresh every cycle (budgets, ports, `EVALUATION_REPORT_PATH`
plumbing) — it is the one file guaranteed to be in a resumed agent's context.

Precedent already in this repo: CON-166 (verdict-SHA binding) made a resume
mismatch mechanically detectable (`STALE`, exit 4) while leaving the fix
itself — re-running the evaluator — as a prompt-followed step. CON-173 did the
same for rendered-script drift. Both leave *remediation* to the agent but make
*silence* impossible.

**This run is itself an instance of the problem it fixes.** If this design
gate agrees a methodology constraint (e.g. "the divergence check's marker
format must be exact-string, not fuzzy") and a later executor/evaluator cycle
drops it because nothing carried it forward, that would be a live
demonstration of CON-161, not a hypothetical — noted explicitly rather than
silently re-applied by orchestrator fiat.

## Goals / Non-Goals

**Goals:**
- Every resumed executor/evaluator cycle has automatic access to every
  standing methodology constraint agreed so far, without any new file to
  separately re-read.
- Divergence between what `tasks.md` says was agreed and what
  `workflow-state.md` carries forward is detected mechanically, not left to
  an agent noticing.
- A single, explicit placement decision (Concertino core vs. per-repo).

**Non-Goals:**
- Automatically re-applying a dropped constraint. Per the CON-166 precedent,
  detection is mechanical; remediation is a prompt-level obligation (an agent
  reading the `DIVERGED` failure and fixing it) — this change does not attempt
  to make an LLM's adherence to a written rule itself mechanical, which is a
  different, harder problem (see CON-140/CON-146, explicitly out of scope
  here).
- Solving *how* a constraint is phrased/generalized. This only fixes the
  carry-forward and detection; judgment about what counts as a "standing
  constraint" worth promoting stays with the orchestrator.

## Decisions

### Decision 1: Option 1 (promote into workflow-state.md) — but not alone

The ticket's own reasoning for option 1 is sound: `workflow-state.md` is
already the one file every resume path reads, so writing constraints there
is the cheapest way to make them *reachable*. But reachable is not the same
as *binding* — a constraint that is merely present in a file an LLM is
supposed to honor is still exactly the kind of prompt-level obligation this
batch has twice found insufficient on its own (CON-140/CON-146: the rule was
already in the role doc, in force, and still wasn't followed on first field
test).

So this change ships **option 1 plus a slice of option 3**: promote
constraints into `workflow-state.md` (closes the *reachability* gap — a
constraint dropped from `tasks.md`'s re-read is no longer dropped from the
one file that IS re-read), and add a mechanical divergence check modeled on
option 3 (closes the *silence* gap — if a constraint doesn't make it into
`workflow-state.md`, or `tasks.md` is edited without a matching update, the
run fails loudly instead of quietly drifting). Option 2 (make `tasks.md` part
of the resume read everywhere `workflow-state.md` is read) is rejected: it
reopens exactly the cost CON-146 already measured — a full planning-artifact
re-read on every resumed cycle — for the same reachability benefit option 1
gets far more cheaply, and it does nothing for the silence problem option 3
addresses.

This mirrors CON-166's own asymmetry directly: make *detection* mechanical
(the divergence check, run as an explicit Phase 3 step 0), leave *response* as a
prompt obligation (the orchestrator/executor act on a `DIVERGED` failure the
same way they'd act on any other gate failure) — because full mechanical
enforcement of "an LLM actually followed a written rule" is not achievable
without solving CON-140/CON-146's much larger problem, which this ticket
explicitly distinguishes itself from.

### Decision 2: Marker format, and why a same-instruction dual-write isn't enough (revised after skeptic round 1)

**Round-1 flaw, found by the skeptic and left on record rather than quietly
fixed:** the original design had the same orchestrator instruction write both
the `tasks.md` marker and the `workflow-state.md` `CONSTRAINTS` entry, at the
same moment. A constraint the orchestrator never promotes in the first place
therefore leaves **no marker on either side**, and an id-diff check between
two empty sets returns `OK (none)` — passing silently on exactly the failure
mode `ticket.md` describes. That version of the check could only ever catch a
half-completed dual write by a single actor within one instruction: real, but
much narrower than "closes the silence gap," which is what design.md
previously (and wrongly) claimed. This is documented here, deliberately, as a
finding this design gate produced — the ticket asked for exactly this kind of
honesty about self-referential misses.

**Revised approach: turn omission into an affirmative record.** Every time
the orchestrator receives a skeptic verdict at the design gate or the final
gate — CONFIRM or REFUTE, every round — it appends exactly one entry to a new
`workflow-state.md` field, `CONSTRAINT_REVIEWS`:

```json
{"verdict_seq": <n>, "gate": "design|final", "round": <n>, "verdict": "CONFIRM|REFUTE", "promoted": ["C1", ...]}
```

`promoted` is the (possibly empty) list of constraint ids newly written to
`CONSTRAINTS` as a result of that verdict. A companion counter,
`SKEPTIC_VERDICTS_TOTAL`, is incremented by the orchestrator immediately after
every skeptic spawn returns — independent of whether a promotion happens —
giving the check a second, independently-written number to compare against
`len(CONSTRAINT_REVIEWS)`.

**Round-2 flaw, found by the skeptic and fixed here rather than glossed over:**
`agreed_at` allows `"planning"` (a Planning ESCALATION can itself settle a
standing constraint), but the review record above is defined as one entry
*per skeptic verdict* only — a Planning-agreed constraint has no skeptic
verdict to attach a review to, so it could never appear in
`CONSTRAINT_REVIEWS`, making the three-way check permanently unsatisfiable
for any run that promotes at Planning. Fixed by widening `gate` to include
`"planning"`: the orchestrator appends a `{"gate":"planning",...}`
`CONSTRAINT_REVIEWS` entry the moment a Planning ESCALATION resolution
promotes a constraint, with `verdict` set to `"n/a"` and `round` to `1`. This
entry counts toward the three-way id-union comparison exactly like any other,
but **does not** count toward `SKEPTIC_VERDICTS_TOTAL` (which remains, by
definition, a count of skeptic spawns only). The count check is therefore:
`len(CONSTRAINT_REVIEWS where gate != "planning") == SKEPTIC_VERDICTS_TOTAL`.

This does not make full mechanical enforcement possible — nothing prevents
the orchestrator from writing `"promoted": []` for a verdict that should have
promoted something, which is a false record, not an omission. But it
converts the original failure mode (a silent, undetectable omission) into a
strictly narrower one (an affirmative false statement the orchestrator itself
had to author), and it gives the mechanical check something concrete to
verify: **every skeptic verdict has a recorded review**, even when that
review's answer was "nothing to promote." That is the honest scope of this
fix; design.md previously overstated it, and doesn't now.

**Marker format**, unchanged in shape but now checked three ways, not two:

- `tasks.md`: a `## Standing Constraints` section, one bullet per constraint:
  `- [C<n>] <text>`.
- `workflow-state.md`: `CONSTRAINTS` is a single-line JSON array (same
  line-oriented convention as the existing `PENDING_ESCALATION` field) of
  `{"id":"C<n>","text":"...","agreed_at":"planning|design-gate|final-gate","retired":false}`.
  `retired` defaults to `false`; the orchestrator may flip it to `true` for a
  constraint later superseded or explicitly expired (per the ticket's own
  "this exception must be able to expire" example) — the id is never removed,
  so the id-diff check keeps working; resuming roles skip any entry with
  `retired: true`.
- `check-constraints-carryover.sh` parses all three (`tasks.md`'s marker
  ids, `CONSTRAINTS`'s ids via `jq -r '.[].id'`, and the union of every
  `CONSTRAINT_REVIEWS[].promoted` id) and requires **three-way set equality**,
  plus `len(CONSTRAINT_REVIEWS) == SKEPTIC_VERDICTS_TOTAL`. `jq` is assumed
  available (already a dependency of this repo's own scripts, e.g.
  `openspec status --json | jq`).

### Decision 2a: where the check actually runs, and its I/O contract (revised after skeptic rounds 1 and 2)

**Round-1 flaw:** `tasks.md`/`spec.md` originally said "the existing
Execution/Evaluation phase-assertion gate." There is no such gate —
`core/scripts/assert-phase.sh` only implements `setup|servers|delivery|cleanup`
(verified directly against the script), and the orchestrator never calls it
with any other phase. A faithful implementation of the original tasks would
have shipped a check that is never executed.

**Round-1 fix, and the round-2 flaw it introduced:** round 1 re-targeted the
check at the existing `delivery` phase gate. But `assert-phase.sh delivery`
runs at `core/roles/orchestrator.md` Phase 3 step 4, which is **after** step 3
("Archive the planned change") has already moved
`openspec/changes/<CHANGE_NAME>/` to
`openspec/changes/archive/<YYYY-MM-DD>-<CHANGE_NAME>/` — verified directly
against archived runs on disk. At the moment `assert-phase.sh delivery` fires,
`openspec/changes/<CHANGE_NAME>/tasks.md` and `.../workflow-state.md` no
longer exist at that path, so the check would resolve `MISSING` on **every**
run, unconditionally. Wiring it inside `assert-phase.sh delivery` was itself
the same class of mistake as round 1's phantom phase — a real gate, at the
wrong point in the pipeline.

**Resolution:** stop wiring this into `assert-phase.sh` at all. Run
`check-constraints-carryover.sh <WORKTREE_PATH> <CHANGE_NAME>` as an
**explicit new orchestrator step — Phase 3, step 0 — before step 1's
`design.md` re-persist and before the squash/archive**, at the point the
planning artifacts still live at their pre-archive path and the run's
constraint record (per Decision 2 above) is already final: the final gate's
last CONFIRM has already been reviewed and recorded (`CONSTRAINT_REVIEWS`
appended, `SKEPTIC_VERDICTS_TOTAL` incremented) as part of concluding Phase 2,
before Phase 3 is ever entered. Change-dir resolution:
`$WORKTREE_PATH/openspec/changes/<CHANGE_NAME>/{tasks.md,workflow-state.md}`
(matching `core/roles/executor.md`'s own convention) — now genuinely valid at
call time, unlike the post-archive `delivery` phase. The orchestrator treats
any non-zero exit exactly like any other Phase-3 environmental gate failure:
a `BLOCKER`, surfaced to the human, not proceeding to the squash/archive until
resolved. This sidesteps `assert-phase.sh`'s phase enum entirely — no edit to
that script, no new phase, no exit-code interaction with its existing
contract — which also resolves round 1 CR1/CR3 more simply than folding into
an existing phase ever would have.

Exit codes, defined for the standalone script (unchanged from round 1's
values, still local to this script only — no collision with
`check-merge-readiness.sh`'s `STALE`/exit-4, which this script never touches):

- `0` — `OK` (three-way match, and review-count match) or `OK (none)` (no
  constraints/reviews anywhere and `SKEPTIC_VERDICTS_TOTAL` is `0`/absent).
- `1` — `DIVERGED: <reason>` (id sets disagree, review-count mismatch, or
  malformed JSON in a field that IS present — see the absent-vs-malformed
  rule below).
- `2` — `MISSING <path>` — either input file does not exist at all. **This is
  deliberately distinct from `0`**: a missing `tasks.md` or
  `workflow-state.md` file must never be read as "nothing to check." (This is
  distinct from an existing `workflow-state.md` simply lacking the
  `CONSTRAINTS`/`CONSTRAINT_REVIEWS`/`SKEPTIC_VERDICTS_TOTAL` lines — see
  below.)

**Absent-field vs. missing-file semantics (round-2 CR3):** every
`workflow-state.md` written before this change lands — and this run's own,
which does not exist yet at the time this design gate runs — has none of
these three fields. Rule, stated explicitly so an implementer cannot guess
wrong: a `workflow-state.md` file that **exists** but omits `CONSTRAINTS` or
`CONSTRAINT_REVIEWS` reads as `[]`; omits `SKEPTIC_VERDICTS_TOTAL` reads as
`0`. This is the backward-compatible reading required for every pre-this-change
and in-flight run to keep passing. A field that IS present but fails to parse
as valid JSON is `DIVERGED` (exit 1), never silently treated as absent —
absent and malformed are different failure shapes and must not be conflated.
The `workflow-state.md` **file itself** being absent is `MISSING` (exit 2),
never `OK (none)` — a run that has reached Phase 3 always has a
`workflow-state.md` (Setup writes it), so this branch is a hard environmental
error, not a normal empty case.

### Decision 2b: workflow-state.md's own invariant (revised after skeptic round 1)

**Round-1 flaw:** `workflow-state.template.md` line 4 states the file "Holds
ONLY ids/paths/counters — never prose procedure." A `"text":"read token
values from source, never transcribe them"` entry is prose procedure,
verbatim — the original task added `CONSTRAINTS` without touching that
invariant, which would have shipped a silent contradiction of the file's own
documented contract.

**Resolution:** this is a deliberate, narrow exception, stated as such. The
template comment is amended to: "Holds ONLY ids/paths/counters — never prose
procedure, **except `CONSTRAINTS`, a bounded exception carrying short
standing-constraint text (see `methodology-carryover` spec) — every other
field keeps the original invariant.**" The exception is bounded (one field,
short entries, no nested procedure) rather than opening the file to arbitrary
prose.

### Decision 3: Concertino level, not per-repo

This ships in `core/roles/orchestrator.md`, `core/roles/executor.md`,
`core/roles/evaluator.md`, `core/workflow-state.template.md`, and
`core/scripts/check-constraints-carryover.sh` — Concertino level, answering
the ticket's open question. Reasoning: the gap is structural to the
orchestrator/executor/evaluator resume contract itself (which files get
re-read on resume), not to anything helio-specific about how helio tickets
are written. Every consuming repo (helio today, any future one) inherits the
same resume-skip behavior verbatim from these role docs, so every consuming
repo has the same gap. A per-repo fix would have to be re-derived and
re-applied in each downstream repo's own prompt layer, with no shared
detection — exactly the kind of duplicated, driftable fix Concertino exists
to avoid. The one per-repo artifact this change touches is the render mirror
in `scripts/concertino/` (via direct `cp`, per CON-173's live drift gate,
not `concertino sync` per this delivery's own instructions) — that mirror
update ships in the same commit as the `core/` change, in this repo, since
this repo self-hosts its own delivery.

## Gate-Chain Implications Checklist

N/A — this change does not touch `.husky/**` or any script `.husky/pre-commit`
invokes.

## Risks / Trade-offs

- **False negative if the orchestrator writes a dishonest `CONSTRAINT_REVIEWS`
  entry.** `CONSTRAINT_REVIEWS` converts a silent omission into an affirmative
  record, but nothing stops the orchestrator from recording `"promoted": []`
  for a verdict that should have promoted a constraint — that remains a
  prompt-level failure the mechanical check cannot see, exactly like
  CON-166/CON-173's own accepted limit (mechanical detection of drift, not
  mechanical prevention of dishonest recording). What IS now caught
  mechanically: an unrecorded verdict at all (`SKEPTIC_VERDICTS_TOTAL` vs.
  `len(CONSTRAINT_REVIEWS)` mismatch) and any three-way marker disagreement
  after a review was recorded.
- **Marker-id bookkeeping is manual.** The orchestrator must pick a fresh
  `C<n>` id per constraint. Low risk in practice — this repo's own
  `next-report-number.sh`/`next-ticket-id.sh` precedent shows a small helper
  script is the standard way this repo avoids id collisions; not adding one
  here is a deliberate scope cut (a single delivery run agrees at most a
  handful of constraints, so collision risk is negligible and a full
  allocator would be over-engineering for this change).
- **Phase 3 step 0 timing.** Running the check once, at the start of Phase 3
  (Delivery), means divergence is only caught at the end of the
  Execution/Evaluation loop, not after every individual cycle. Accepted: no
  existing per-cycle gate exists to hang it off without inventing new phases
  (CR1), and catching it before archiving/squashing is still strictly better
  than never catching it.
