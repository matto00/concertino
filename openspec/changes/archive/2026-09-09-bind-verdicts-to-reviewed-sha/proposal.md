## Why

A gate verdict in this workflow is bound to a *run*, never to a *commit*. Once the evaluator says PASS, every later commit on that branch inherits the PASS silently. `check-merge-readiness.sh` condition 3 — the mechanical basis of the entire agent-merge chain — reads only the latest evaluator/skeptic verdict *values*, never what state those verdicts were about. There is no artifact anywhere in the pipeline that could be consulted to detect the drift, because the SHA is never recorded.

Both roles already write ``HEAD `<sha>` `` in their reports' first line. That is a prose convention with no consumer — it is the reason HEL-469's drift was noticed at all, and it is exactly the wrong place for a safety property to live.

## What Changes

- `emit-event.sh` accepts and records a `head_sha` on `verdict` events, plus a `head_sha_source` recording whether the emitting role STATED the SHA it reviewed or the script inferred it from git at emit time.
- `check-merge-readiness.sh` condition 3 additionally verifies that reviewed source content has not moved since the latest evaluator PASS and the latest skeptic CONFIRM. Because Phase 3's squash+archive guarantees HEAD differs from every reviewed SHA on healthy runs, the comparison is a path-scoped content diff, not SHA equality.
- Drift is reported as a new distinct outcome — `STALE`, exit 4 — modelled on CON-159's resumable `PENDING`/exit-3. The CON-171 auditor-lease protocol is deliberately left unchanged: the check acquires, and only the auditor's own verdict releases.
- The evaluator and skeptic role prompts are required to pass the SHA they reviewed; the orchestrator prompt gains the exit-4 remediation obligation; the auditor passes the archive prefix and treats exit 4 as not-mergeable.
- A mutation-based self-test proves the refusal actually fires.

## Capabilities

### New Capabilities
- `verdict-sha-binding`: binding each gate verdict to the source state it reviewed, and refusing a merge whose source content has moved since review.

### Modified Capabilities

## Impact

`core/scripts/emit-event.sh`, `core/scripts/check-merge-readiness.sh`, and their `scripts/concertino/**` renders (CON-173). `core/roles/evaluator.md`, `core/roles/skeptic.md`, `core/roles/orchestrator.md`, `core/roles/auditor.md` (this repo tracks no rendered agent definitions, so those have no render target here). Interacts with the CON-171 auditor lease (both lease call sites are in scope) and with CON-159's exit-code contract.
