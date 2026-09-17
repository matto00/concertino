## Standing Constraints

- [C1] Never rewrite, reorder, or backfill any existing `.concertino/runs/**/events.jsonl`; new validation governs only new emissions, and the ~2,300-event corpus must still fold (CON-192 consumes it next).
- [C2] Every change to a file under `core/scripts/` must be mirrored into `scripts/concertino/` as a faithful byte-identical copy in the same commit, never hand-authored independently; `concertino sync` must NOT be run in this lane.
- [C3] Every new refusal must be placed below the CON-171 auditor-lease release in `emit-event.sh`, never in the argument-parsing loop, so a refused invocation can never strand a Phase-4 teardown lease.
- [C4] Every new validation must be proven failable by mutation: show a non-zero exit AND that no event was appended, and show that the pre-change script accepted the same input. A green suite against unmutated input is not evidence.
- [C5] Any enumeration or hashing of rendered scripts MUST be recursive over `scripts/concertino/**/*.sh`, including the nested `lib/` directory that `emit-event.sh` actually sources; and any drift test MUST mutate a NESTED fixture, because a top-level-only test certifies the wrong case and passes while the detection gap is live.

## 1. Emitter: ticket.filed field and enum validation

- [x] 1.1 Add `ticket.filed` required-field validation to `core/scripts/emit-event.sh` (`ticket_id`, `origin_ticket`, `origin_repo`, `origin_role`, `origin_phase`, `origin_kind`, `suggested_by`, `triage`), refusing non-zero with no event appended; verify by emitting with each field omitted in turn and confirming rc!=0 and no new log line.
- [x] 1.2 Validate the `origin_kind` enum (`followup`|`roadmap`|`escalation-split`|`human`) and the `suggested_by` enum (`agent`|`human`); verify an illegal value for each exits non-zero naming the legal values and appends nothing.
- [x] 1.3 Place both checks below the CON-171 lease release (constraint C3); verify by confirming the existing lease-release tests still pass and adding one asserting a `ticket.filed` refusal does not strand a lease.
- [x] 1.4 Confirm no other event kind is affected; verify by emitting a `phase.enter` and a `gate.result` with none of the new fields and confirming both still append with rc=0.

## 2. Emitter: closed role validation

- [x] 2.1 Add role validation to `core/scripts/emit-event.sh` accepting exactly `orchestrator`, `executor`, `evaluator`, `skeptic`, `auditor`, `script`, `dashboard`; verify each of the seven appends with rc=0.
- [x] 2.2 Refuse any other role non-zero with no event appended; verify `role=orchestorator` now exits non-zero and appends nothing, and record the pre-change RED baseline showing it was previously accepted with rc=0 (constraint C4).
- [x] 2.3 Verify the emitter's own default still works: emit from a script setting no `CONCERTINO_ROLE` and confirm the event appends with `role` recorded as `script`.
- [x] 2.4 Verify a `script`-role `run.end` is never refused, so runs still become terminal; assert against `cleanup.sh`'s actual invocation shape.
- [x] 2.5 Verify the role refusal also sits below the lease release; add a test asserting a role-refused auditor `verdict` still releases the lease.

## 3. Instrumentation digest and schema.change

- [x] 3.1 Compute a content digest over the rendered `scripts/concertino/*.sh` files in `core/scripts/setup-worktree.sh` and record it on `run.start`; verify a fresh run's `run.start` carries the digest.
- [x] 3.2 Make digest computation non-fatal; verify that with the digest step forced to fail, `run.start` is still emitted without the field and setup still exits 0.
- [x] 3.3 Record the render-time digest baseline from `concertino sync`; verify a synced target directory contains the baseline and that its value matches a digest computed over the same rendered files.
- [x] 3.4 Emit `schema.change` at run start when the live digest disagrees with the baseline, naming the affected scripts; verify by patching one rendered script in a throwaway synced target and confirming the event appears with that script named.
- [x] 3.5 Emit nothing when live and baseline agree; verify a run immediately after a clean sync produces no `schema.change`.
- [x] 3.6 Degrade gracefully with no baseline; verify a run in a target with no recorded baseline records the digest, emits no `schema.change`, and exits 0 (this is helio's state until it is synced after the batch).

## 4. Triage signal capture

- [x] 4.1 Add one machine-readable line with a fixed prefix to `core/scripts/triage-followup.sh` carrying `ac_relevant`, `effort`, computed `overlap`, and `recommendation`; verify it is present and parseable for a successful invocation.
- [x] 4.2 Leave the decision table and the human-readable context block unchanged; verify every existing assertion in `test/scripts/triage-followup.test.sh` still passes unmodified.

## 5. run.cost role normalisation

- [x] 5.1 Normalise an unrecognised stripped `agent_type` onto a role inside the closed set in `core/scripts/report-cost.sh`, preserving the raw value in a separate `agent_type` field; verify with a synthetic `SubagentStop` payload naming a non-Concertino subagent that the event appends with an in-set role and the raw value retained.
- [x] 5.2 Leave the two documented cases untouched; verify `SessionEnd` with no `agent_type` still yields `role=orchestrator` and `agent_type: concertino-executor` still yields `role=executor`.

## 6. Ticket-filing site and provenance mirror

- [x] 6.1 Extend the `standalone` branch of `core/roles/orchestrator.md` to emit `ticket.filed` with every required field, deriving `origin_repo` from the running repository rather than the filed ticket's prefix; verify the rendered role text contains the emission for all three provider variants.
- [x] 6.2 Extend `lib/cli/render.js`'s `standaloneTicket` block so each provider variant also writes `origin_kind` and `origin_ticket` onto the filed ticket; verify via the existing render tests plus an assertion per variant.
- [x] 6.3 Verify the local-provider variant still writes only files and calls no MCP tool it was never granted.

## 7. Rendered-copy parity

- [x] 7.1 Mirror every changed `core/scripts/` file into `scripts/concertino/` byte-identically (constraint C2); verify `bash test/scripts/rendered-scripts-drift.test.sh` exits 0.

## 8. This change's own schema.change record

- [x] 8.1 Emit one `schema.change` event for this delivery recording both ticket ids and the affected kinds (Decision 2); verify the event is present in this run's own log and that the design's stated rationale matches what was emitted.

## 9. Verification

- [x] 9.1 Run the full `npm test` suite with a 600000ms timeout and confirm both the `node --test` summary and every shell suite's pass/fail line, checking exit status via `PIPESTATUS` rather than a piped `$?`.
- [x] 9.2 Confirm the historical corpus still folds: re-read both repositories' existing logs through the reducer and confirm no event is dropped as malformed and no run's derived status changes (constraint C1).
- [x] 9.3 Record the mutation transcript for every new refusal in `files-modified.md`, each showing the rc, the absent event, and the pre-change acceptance (constraint C4).
