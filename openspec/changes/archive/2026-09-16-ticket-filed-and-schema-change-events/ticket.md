# CON-190 + CON-191: Emit ticket.filed provenance and schema.change instrumentation-drift events

## Description

Two paired tickets delivered as one lane, because both add new event kinds to the same emitter (`core/scripts/emit-event.sh`) and both exist to make longitudinal claims about the delivery loop safe to make.

**CON-190 (High) — Emit `ticket.filed` with full provenance, including originating repo, and mirror it to Linear.** Ticket provenance is recorded nowhere and cannot be reliably inferred. `createdBy` is useless (all 1,326 Linear issues across CON and HEL show one operator, because agents file under the operator's API key). The obvious proxy — creation time against the run timeline — fails: a published 3.00x "autonomous origination" lift was an artifact of scoring each repo's tickets against only that repo's runs. Scored against the union of runs in BOTH repos, 33 of the 72 CON tickets counted as "not in-run" were created during an active helio run, and the lift collapses to 1.18x, i.e. chance. Tail-length sweeps (15/30/60/120min) and an hour-of-day-matched base rate were tried; the signal is gone, not noisy, and more data will not recover it. The fix is to record provenance at the moment a ticket is filed, including `origin_repo`, whose omission is precisely what made the 3.00x wrong.

**CON-191 (High) — Emit `schema.change` for any change to event emission, including rendered copies in consuming repos.** A self-modifying system edits its own instrumentation as part of the work, and the event log does not distinguish "the metric moved because the world changed" from "the metric moved because its definition changed". This produced a wrong published finding twice, in opposite directions. Helio's mechanical escalations went 13, 14, 0, 0, 0 by ISO week — a hard cliff at W35. First attribution (wrong): CON-126/CON-138/CON-148, refuted by dates, since all three merged after helio's last mechanical escalation and concertino emitted 8 mechanical escalations in W35 after two of them merged. Second conclusion (also wrong): unexplained. Actual cause: decomposing by raising role shows the cliff is entirely in the `script` role (11, 13, 0, 0, 0) while orchestrator-raised volume stayed flat (53, 53, 31, 60, 53); mechanical escalations come from `cleanup.sh`, and the cause was CON-128 "Disable cleanup.sh's automatic concertino sync in this checkout" — committed in the HELIO repository, to a RENDERED COPY of a framework script. The search failed twice because a change to what gets measured need not appear anywhere in the measuring system's own history.

## Acceptance criteria — CON-190

- Every ticket filed by a role in a new run produces a `ticket.filed` event carrying `ticket_id`, `origin_ticket`, `origin_repo`, `origin_role`, `origin_phase`, `origin_kind` (`followup` | `roadmap` | `escalation-split` | `human`), `suggested_by` (`agent` | `human`), and a `triage` block (`ac_relevant`, `effort`, `overlap`, `recommendation`).
- `origin_repo` is present and correct when a role running in helio files a CON ticket.
- The corresponding Linear issue carries `origin_kind` and `origin_ticket` (label or structured line in the description), so provenance survives independently of the event log and is queryable from Linear.

Note: the `triage` block costs nothing new — `triage-followup.sh` already computes file overlap between the suggested follow-up and the run's own diff, prints it, and throws it away. Persisting it distinguishes attention that stays inside the work from attention that wanders.

## Acceptance criteria — CON-191

- A local patch to a rendered script in a consuming repo is detectable from that repo's event log alone.
- `run.start` or an equivalent event carries enough version information to tell whether two runs were measured by the same instrumentation.
- An unknown `role` value is rejected on emit.

## Verified premise corrections (Setup, CON-136 premise validation)

These were established against the live tree before planning and are binding on the design. Full evidence: `.concertino/runs/CON-190/evidence/premise-validation.md`.

1. **`schema.change` does not exist as an event kind** — confirmed, zero hits tracked and untracked, case-insensitive, with a known-failable positive control. The archived-doc hits are English prose ("no schema change required"), NOT references to an event kind.
2. **CON-191 scope item 3's corpus claim is partially stale.** It asserts "the corpus contains `orchestorator` alongside `orchestrator`; any grouping by role silently splits." Concertino's own 2,589-event corpus contains ZERO occurrences; helio's 9,519-event corpus contains exactly ONE. The defect is real but is a single event, not a systemic split. Scope is unchanged — an unknown-role guard is still the stated acceptance criterion — but no claim may be made that this fixes a widespread split.
3. **The real role vocabulary is seven values, not five.** Across both corpora: `orchestrator`, `script`, `skeptic`, `evaluator`, `auditor`, `dashboard`, `executor`. `emit-event.sh` itself defaults `ROLE` to `script` (`CONCERTINO_ROLE:-script`). A role allowlist that admits only the five agent roles would refuse `cleanup.sh`'s and `setup-worktree.sh`'s own emissions and break the run.
4. **CON-191 has partial scaffolding that must not be rebuilt**, and none of it satisfies AC1: `sync-provenance` (CON-128) prints binary/core provenance at sync/diff time; `rendered-script-drift-gate` (CON-172) byte-compares `core/scripts/**` against `scripts/concertino/**` in this repo's own test suite; `concertino doctor` byte-compares rendered artifacts against core; `.concertino.env` already carries a `# concertino:sync v<VERSION>` stamp. All are sync-time or this-repo-test-time only. What is absent is any durable EVENT and any RUNTIME drift detection readable from a consuming repo's own event log.
5. **CON-190's only ticket-filing site in any role** is `core/roles/orchestrator.md`'s `standalone` triage verdict, rendered by `lib/cli/render.js`'s `standaloneTicket` block in three provider variants (linear/github via `mcp__linear__save_issue`; local via `next-ticket-id.sh`). No other role files tickets.

## Handover constraints (CON-189, merged into this base)

The emitter is now strict, verified empirically in a scratch repo:

- A `verdict` without `category`, or with an illegal one, is refused: non-zero exit AND no event appended. Valid categories: `mechanical`, `spec-divergence`, `design-judgment`, `intent-mismatch`.
- A `skeptic` verdict without `gate` (`design`|`final`) is refused.
- A STATED `head_sha` that is not exactly 40 hex chars is refused.
- An OMITTED `head_sha` remains legal by design (the auditor passes none; most historical verdicts carry none) and records `head_sha_source=inferred`. Do not "fix" this.
- `read_raised_field()` reads `escalation.raised` fields and defaults silently to `sub_questions` for an unrecognized argument. CON-189 deliberately left it untightened because its fields were disjoint. **If either new event adds a field read back through that path, tightening it becomes this lane's responsibility.**
- Historical events were never rewritten or backfilled, and committed tests assert the ~2,300-event corpus still folds correctly. Backward compatibility is a hard constraint: CON-192 (follow-up survival report) is a declared downstream consumer of this historical data.

## CON-191 self-reference (must be resolved deliberately, not silently)

CON-191 requires emitting an event whenever event emission changes. This very change alters event emission, so the design MUST state explicitly whether this delivery emits its own `schema.change` event, and why. Silently doing either is a defect.
