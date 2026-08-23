## ADDED Requirements

### Requirement: The raise procedure consults TUI liveness before choosing how to resolve
The topology branch (root vs. Claude Code subagent) SHALL be decided first and SHALL never be bypassed by
`TUI_ATTACHED`; `TUI_ATTACHED` only changes what the **root** branch does at its own resolution
step. Immediately after presenting an escalation to the chat transcript (unconditional, per the
existing requirement) and once the orchestrator has determined it is the **root** (no parent
orchestrator spawned it), it SHALL consult `scripts/concertino/tui-attached.sh` (per the
`tui-liveness-detection` capability) before deciding how to *resolve*. When it exits 0 (attached),
the root proceeds completely unmodified (`--await`). When it exits non-zero (not attached), the
root SHALL still call `--raise-only` (non-blocking — writes `escalation.raised` and performs the
existing one-time stale-`answer.json` discard) but SHALL make no `--await`/`--wait-only` blocking
wait for this raise, resolving the escalation directly from the already-presented chat transcript
by writing the answer through `concertino answer` (per `escalation-answer-cli`) once received.
When the orchestrator is instead running as a Claude Code subagent, it SHALL always raise via
`--raise-only` and always persist `PENDING_ESCALATION` / return `ESCALATION-PENDING`, unconditionally
of `TUI_ATTACHED` — a subagent never blocks on resolution and has no human-visible transcript of
its own to resolve against, so `TUI_ATTACHED` is meaningless at its raise step; it is re-checked
fresh, only by the root, at the root's later resolution step (see the resolution-loop requirement
below). This check applies uniformly regardless of who originated the escalation — the
orchestrator's own Planning/circuit-breaker escalations and any sub-agent-originated
`ESCALATION`/`ESCALATION-RAISE` relayed per `subagent-escalation-raise` — since it lives at the one
call site both paths already share.

#### Scenario: No TUI attached, root topology — no blocking wait, but bookkeeping is still written
- **GIVEN** `scripts/concertino/tui-attached.sh` exits non-zero AND the orchestrator is the root
- **WHEN** the orchestrator raises an escalation (its own, or relayed from a sub-agent)
- **THEN** it calls `emit-event.sh escalation --raise-only` (writing `escalation.raised` and discarding any stale prior answer), makes no `--await`/`--wait-only` call, and instead waits for the human's reply directly in chat

#### Scenario: No TUI attached, Claude Code subagent topology — bubble-up is unaffected
- **GIVEN** `scripts/concertino/tui-attached.sh` exits non-zero AND the orchestrator is running as a Claude Code subagent (not root)
- **WHEN** the orchestrator raises an escalation (its own, or relayed from a sub-agent)
- **THEN** it calls `emit-event.sh escalation --raise-only`, persists `PENDING_ESCALATION` to `workflow-state.md`, and returns `ESCALATION-PENDING` to its parent — exactly as it would if `TUI_ATTACHED=1` — because a subagent never blocks on resolution and `TUI_ATTACHED` does not change its raise-time behavior

#### Scenario: A second no-TUI escalation in the same run does not get stuck behind the first's leftover answer
- **GIVEN** a prior escalation in this run was raised and resolved with no TUI attached, leaving no outstanding `answer.json`, because `--raise-only`'s own stale-answer discard already ran at each raise
- **WHEN** a second, later escalation in the same run is raised with no TUI attached
- **THEN** its own `--raise-only` call discards any leftover state from the prior escalation exactly as the TUI-attached path already does, and `concertino answer` for this new escalation succeeds rather than being refused as already-answered

#### Scenario: TUI attached — existing behavior unchanged
- **GIVEN** `scripts/concertino/tui-attached.sh` exits 0
- **WHEN** the orchestrator raises an escalation
- **THEN** it proceeds exactly as before this change: `--await` if root, `--raise-only` if a Claude Code subagent, with all existing contracts (exit codes, `TERM`/`INT` trap, dual-channel delivery, multi-part wizard) unmodified

#### Scenario: A timeout is never an approval, even in the no-TUI branch
- **GIVEN** `scripts/concertino/tui-attached.sh` exits non-zero
- **WHEN** the orchestrator resolves the escalation
- **THEN** it does so only by recording an explicit human-given answer via `concertino answer` — there is no wait with a deadline in this branch, so no elapsed-time condition can ever be mistaken for an approval

### Requirement: The root's resolution loop re-checks TUI liveness before polling
When the root resolves an escalation — whether raised directly or bubbled via `ESCALATION-PENDING` — it SHALL re-check `scripts/concertino/tui-attached.sh` immediately before starting its resolution loop, rather than reusing a liveness result observed earlier in the run. When attached, the existing `--wait-only` polling loop (racing a direct chat reply) proceeds unmodified. When not attached, the root SHALL skip the `--wait-only` polling loop entirely and wait directly for the chat reply, still writing it through `concertino answer` (preserving `concertino answer`'s existing refusal-on-already-answered, first-write-wins guarantee unchanged in both branches).

#### Scenario: TUI attached at resolution time — polling loop unchanged
- **GIVEN** `scripts/concertino/tui-attached.sh` exits 0 at the moment the root begins resolving an escalation
- **WHEN** the root resolves it
- **THEN** it polls via repeated `--wait-only` calls exactly as before this change, remaining able to accept a racing chat reply

#### Scenario: TUI not attached at resolution time — no polling loop
- **GIVEN** `scripts/concertino/tui-attached.sh` exits non-zero at the moment the root begins resolving an escalation
- **WHEN** the root resolves it
- **THEN** it makes no `--wait-only` call, waits directly for the chat reply, and writes it through `concertino answer`

#### Scenario: Liveness is re-checked fresh, not cached from the raise
- **GIVEN** a dashboard attaches (or detaches) between the moment an escalation is raised and the moment the root begins resolving it
- **WHEN** the root checks `scripts/concertino/tui-attached.sh` at resolution time
- **THEN** it uses that fresh result, not whatever `TUI_ATTACHED` value (if any) was observed at raise time

#### Scenario: A dashboard attaching after a no-TUI raise can still poll to resolution
- **GIVEN** an escalation was raised with no TUI attached (so it went through `--raise-only`, per the requirement above, and `escalation.raised` with a real `raised_at` exists for it)
- **WHEN** a dashboard subsequently attaches before the escalation is resolved, and the root re-checks `tui-attached.sh` at resolution time
- **THEN** the root takes the TUI-attached branch and its `--wait-only` polling loop resolves normally against that escalation's real `raised_at`-anchored deadline — it never hangs, because every raise (regardless of which branch performed it) always writes `escalation.raised`

### Requirement: `concertino answer` is the authoritative write path for a no-TUI resolution
The no-TUI branch SHALL record a chat-collected answer only via `concertino answer` (per `escalation-answer-cli`), never via a raw `emit-event.sh escalation.answered` call constructed independently. This is a deliberate write-path choice for this branch — distinct from, and not a reuse of, the root's existing directly-raised `--await`-timeout fallback, which records via a raw `emit-event.sh escalation.answered` call rather than `concertino answer` and is unmodified by this change. `concertino answer`'s existing first-write-wins/refusal-on-already-answered guarantee SHALL apply unweakened in the no-TUI branch.

#### Scenario: The no-TUI branch goes through `concertino answer`, not a raw event write
- **GIVEN** no TUI is attached and the human has replied in chat
- **WHEN** the orchestrator records that answer
- **THEN** it does so via `concertino answer <ticket> <value>` (or the `--sub`/`--total` form for a multi-part escalation) — not via a directly-constructed `emit-event.sh escalation.answered` call

#### Scenario: The existing TUI-attached `--await`-timeout fallback is unmodified
- **GIVEN** a TUI is attached, `--await` is called, and it times out with no dashboard answer
- **WHEN** the orchestrator records the chat-given answer for that timed-out escalation
- **THEN** it does so exactly as before this change — via a direct `emit-event.sh escalation.answered` call, not `concertino answer` — since this requirement and this change apply only to the no-TUI branch
