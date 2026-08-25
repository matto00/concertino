## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all planning artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/main-fast-forward/spec.md`, `workflow-state.md`.
- **Ground truth, the defect itself:** `core/scripts/cleanup.sh:345` is exactly as the ticket
  describes — `ANSWER="$("${SCRIPT_DIR}/emit-event.sh" escalation --await ... options=retry,skip || true)"`
  with no TUI gate. `SCRIPT_DIR` is defined at `cleanup.sh:123` as the script's own directory,
  so `tui-attached.sh` is a resolvable sibling in both `core/scripts/` and the rendered
  `scripts/concertino/`. Both copies exist (`find . -name tui-attached.sh`).
- **Independent two-direction audit** (the plan asserts this result; I re-derived it myself):
  `grep -rn -- '--await\|--raise-only\|--wait-only' core/scripts/` returns 9 hits — 4 in
  `core/scripts/README.md` (docs), 3 in comments (`triage-followup.sh:52`,
  `gather-escalation-context.sh:23`, `tui-attached.sh:9`), 1 in `emit-event.sh`'s own usage
  header, and exactly one executable call site: `cleanup.sh:345`. Reverse direction
  (`grep -rn 'emit-event.sh escalation'` across `core/` and `adapters/`) adds only
  `core/roles/orchestrator.md` (already gated by CON-126) and
  `adapters/claude-code/command.md:83` (already gated by CON-126). **The design's claim is
  true** — it is simply not yet produced as an artifact (see CR 5).
- **CON-126 pattern, ground truth:** `core/roles/orchestrator.md:1233-1236` (`if
  scripts/concertino/tui-attached.sh; then TUI_ATTACHED=1 ... fi`) and `:1259-1290`. Read
  `core/scripts/tui-attached.sh` in full — exit-code contract (0 = attached, 1 = not attached
  **or ambiguous**) matches what the plan assumes.
- `openspec validate gate-cleanup-fastforward-escalation --strict` → `Change ... is valid`
  (the installed CLI is `/usr/bin/openspec` 1.2.0).
- Compared the delta's requirement header against the live spec:
  `openspec/specs/main-fast-forward/spec.md:56` reads `### Requirement: An unresolvable
  fast-forward escalates with a bounded retry/skip loop`; the delta's header at
  `specs/main-fast-forward/spec.md:3` reads `... retry/skip loop, gated on TUI liveness`.
  Checked archived precedent (`openspec/changes/archive/2026-08-05-doctor-validate-ollama-models/specs/model-providers/spec.md:3`
  vs `openspec/specs/model-providers/spec.md:189`) — MODIFIED deltas there carry a header
  **byte-identical** to the live requirement.

The plan's core shape is right: it reuses `tui-attached.sh` rather than inventing a second
liveness mechanism, defaults no-TUI to `skip`, keeps the TUI-attached contract untouched, and
covers the wall-clock-measurement AC (task 4.1) and the both-directions audit AC (task 1.1).
The items below are the gaps.

### Verdict: REFUTE

### Change Requests

1. **Spec delta renames the requirement it modifies — will not match on archive.**
   `specs/main-fast-forward/spec.md:3` uses a header (`..., gated on TUI liveness`) that does
   not exist in `openspec/specs/main-fast-forward/spec.md:56`. OpenSpec matches MODIFIED
   requirements by header text (every archived precedent in this repo uses an identical
   header), so `openspec archive` would very likely **append a second requirement and leave
   the original ungated one in place** rather than replacing it. `--strict` validate does not
   catch this. Fix: keep the header byte-identical to the live one, or, if the rename is
   genuinely wanted, use OpenSpec's rename mechanism and prove the archive result.

2. **The gate's invocation path is specified two contradictory ways, one of which is broken.**
   `design.md` Decision 1 says `if "${SCRIPT_DIR}/tui-attached.sh"; then ... fi`, but
   `tasks.md:2.1` and `specs/main-fast-forward/spec.md` both name
   `scripts/concertino/tui-attached.sh` — a **cwd-relative** path copied out of
   `orchestrator.md`, where it is correct only because the orchestrator runs from the repo
   root. `cleanup.sh` runs with an arbitrary cwd (the orchestrator invokes it against a
   worktree path), so the relative form would fail, `tui-attached.sh` would exit non-zero for
   the wrong reason, and the bug would *appear* fixed while the gate is actually broken —
   and the fail-safe direction would hide it. Make `"${SCRIPT_DIR}/tui-attached.sh"`
   normative in `tasks.md:2.1`, and reword the spec to name the *signal*
   (`tui-attached.sh`, CON-126's authority) without a cwd-relative path.

3. **Undocumented deviation from the CON-126 pattern the design claims to mirror.**
   `orchestrator.md:1272-1285` shows CON-126's no-TUI branch does **not** simply skip: it
   still calls `emit-event.sh escalation --raise-only` (non-blocking) "so the run's
   bookkeeping stays consistent with the TUI-attached path and a dashboard that attaches
   later finds a real, timestamped escalation to poll against." This plan drops that half
   entirely, substituting `gate.warning`. That may well be the right call here (the ticket
   lists CON-121 — an unresolved escalation poisoning `other_runs_live()` forever — which
   `--raise-only` would arguably reintroduce), but Decision 1 currently claims to mirror
   CON-126's shape while silently omitting half of its no-TUI branch, and `design.md`'s own
   risk mitigation leans on "a fleet dashboard that attaches later still sees it" — which is
   precisely the property `--raise-only` provides and `gate.warning` does not. Add an
   explicit decision recording `--raise-only` as considered-and-rejected (with the CON-121
   rationale), or include it.

4. **Missing contract update: `core/roles/orchestrator.md` documents the behavior being
   changed.** `orchestrator.md:1060-1067` instructs the orchestrator that `cleanup.sh` "may
   itself block on an `emit-event.sh escalation --await` call exactly like the ones described
   below. **Give this Bash call the same long, explicit timeout guidance** ... it may now
   block for as long as a human takes to answer." After this change that is false on the
   no-TUI path. No task and no line in `proposal.md`'s Impact section covers this file. Add
   a task to update that passage (and re-render), or state explicitly in the design why it
   should be left as-is.

5. **The audit AC has no deliverable, and `design.md` states its result as already-established
   fact.** Ticket AC 7 requires the enumeration be **documented** and verified in both
   directions. `design.md` Context and Non-Goals both assert "confirmed by a two-direction
   grep audit — see this change's Delivery report", but that report does not exist and
   `tasks.md:1.1` still lists the audit as to-do — an executor can reasonably read the design
   as "already done, skip 1.1". Fix: (a) reword `design.md` to stop asserting a completed
   audit, and (b) make `tasks.md:1.1` name the concrete artifact and location where the
   enumeration (both directions, with the wrongly-included/omitted check) will be written.

### Non-blocking notes

- `tasks.md:4.4` prescribes `openspec validate --change gate-cleanup-fastforward-escalation`;
  the installed CLI (1.2.0) rejects `--change` (`error: unknown option '--change'`). The
  working form is `openspec validate gate-cleanup-fastforward-escalation --strict`.
- `design.md`'s third Risks/Trade-offs bullet is garbled mid-sentence ("now literally identical
  in wall-clock cost between ... only in the second case being instant") — worth a rewrite for
  legibility; the intent is clear enough not to block.
- Independently confirmed for the executor's benefit: `tui-attached.sh` treats *ambiguous* as
  not-attached (exit 1), so the no-TUI branch is the fail-safe default; no extra defensive
  handling of a non-0/1 exit is needed.
