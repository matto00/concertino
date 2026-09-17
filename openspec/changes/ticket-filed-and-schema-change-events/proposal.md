## Why

Two questions about the delivery loop cannot currently be answered from the event log, and each has already produced a published finding that was wrong.

**Where do tickets come from?** Provenance is recorded nowhere. `createdBy` is useless (every issue in both projects shows one operator, because agents file under the operator's API key), and the obvious proxy — creation time against the run timeline — fails: a 3.00x "autonomous origination" lift was an artifact of scoring each repo's tickets against only that repo's runs. Against the union of runs in both repos the lift collapses to 1.18x, i.e. chance, because agents delivering helio tickets routinely file concertino tickets. Omitting the originating repo is precisely what made that number wrong.

**Was a metric change caused by the world, or by the measuring instrument?** Helio's mechanical escalations went 13, 14, 0, 0, 0 by ISO week. The cliff was attributed to three framework tickets (refuted by dates), then declared unexplained, before the real cause turned out to be CON-128 — a change committed *in the consuming repository*, to a *rendered copy* of a framework script. A change to what gets measured need not appear anywhere in the measuring system's own history, so no longitudinal claim about the loop is currently safe to make.

Both are recorded at the same seam (`core/scripts/emit-event.sh`), which is why they ship together.

## What Changes

- **New `ticket.filed` event.** When a role files a ticket, `emit-event.sh` records `ticket_id`, `origin_ticket`, `origin_repo`, `origin_role`, `origin_phase`, `origin_kind`, `suggested_by` and a `triage` block. The required fields and the `origin_kind`/`suggested_by` enums are validated on emit and refused non-zero with no event appended, following the `verdict`/`category` precedent set by CON-189.
- **Provenance mirrored onto the filed ticket itself**, so it survives independently of the event log and is queryable from the ticket provider.
- **`ticket.filed` emitted at the one real filing site**: the `standalone` triage verdict in `core/roles/orchestrator.md`, across all three `ticketProvider` variants.
- **The `triage` block stops being thrown away.** `triage-followup.sh` already computes file overlap against the run's own diff and prints it; it gains a machine-readable line so the computed `overlap` and `recommendation` can be recorded rather than discarded.
- **New instrumentation digest on `run.start`.** `setup-worktree.sh` hashes the rendered `scripts/concertino/` scripts it is itself running from and records the digest, so two runs can be told apart by whether they were measured by the same instrumentation.
- **New `schema.change` event.** When that live digest disagrees with the digest `concertino sync` recorded at render time, the drift is emitted as a durable event in the consuming repo's own log — the signal that would have caught CON-128.
- **`role` is validated on emit** against a closed set, refusing an unknown value rather than silently recording a typo that splits every grouping by role.
- **No historical event is rewritten, reordered, or backfilled**, and no new event kind is added to the dashboard's telemetry tiers.

## Capabilities

**New Capabilities:**
- `ticket-provenance` — the `ticket.filed` event contract, its required fields and enums, and the provenance written onto the filed ticket.
- `instrumentation-provenance` — the `run.start` instrumentation digest, the sync-time digest manifest, and the `schema.change` drift event, including the graceful degradation required for a consuming repo that has not yet re-synced.
- `emit-role-validation` — the closed `role` set enforced on emit.

**Modified Capabilities:**
- `followup-triage` — the `standalone` verdict must now also emit `ticket.filed` and record provenance onto the filed ticket; `triage-followup.sh` gains a machine-readable output line. Its existing overlap/recommendation decision table is unchanged.
- `run-cost-telemetry` — `report-cost.sh` must normalise a non-Concertino `agent_type` into the closed `role` set and carry the raw agent name in a separate, unvalidated `agent_type` field. Without this, `emit-role-validation` would refuse `run.cost` events for any non-Concertino subagent, silently losing cost telemetry.

## Impact

- `core/scripts/emit-event.sh` — new field validation for `ticket.filed`, and `role` validation for every kind. Both copies change: `core/scripts/` and the self-hosted render at `scripts/concertino/`, which `test/scripts/rendered-scripts-drift.test.sh` holds to byte-identity (the CON-189 commit is the precedent for changing both together).
- `core/scripts/setup-worktree.sh` — computes the digest and emits `schema.change` on drift.
- `core/scripts/triage-followup.sh` — adds a machine-readable line; the decision table is untouched.
- `core/scripts/report-cost.sh` — normalises `role` into the closed set, preserving the raw `agent_type`. This is the ONLY dynamic producer of a `role` value anywhere in the codebase (audited: every other call site passes a literal, and `CONCERTINO_ROLE` defaults to `script`).
- `core/roles/orchestrator.md` — the `standalone` branch emits `ticket.filed`; rendered via `lib/cli/render.js`'s `standaloneTicket` block for all three providers.
- `lib/cli/render.js` / `lib/cli/sync.js` — write the sync-time digest manifest.
- `test/scripts/emit-event.test.sh`, `test/scripts/triage-followup.test.sh`, `test/scripts/harness-identity.test.sh` (or a new sibling) — mutation-provable coverage that each new refusal can actually fail.
- **No change to `lib/ui/`.** The reducer tolerates unknown kinds via `default: break;`, `store.js` filters on shape only, and retention keys off `run.end` at whole-run granularity, so both new kinds are carried without a consumer change. Deliberately not added to `TIER2_KINDS`/`TIER3_KINDS`.
- **Backward compatibility is a hard constraint.** ~2,300 historical corpus events carry no `category` and predate every field added here; committed tests assert they still fold. CON-192 is a declared downstream consumer of exactly this data.
- **A consuming repo that has not re-synced must keep working**, emitting the digest but no drift event, and must never fail a run because a manifest is absent.
