## Context

`core/roles/orchestrator.md` (rendered by `concertino sync`) already has a full topology-aware
escalation raise/relay/resolve procedure ("Escalation & Circuit Breakers" → "How to raise one" /
"Receiving a bubbled escalation, and the root's resolution loop") for the orchestrator↔root hop
(CON-76). The `Agent`/`SendMessage` tool topology in this Claude Code harness is: the orchestrator
spawns executor/evaluator/skeptic/auditor via a **blocking** `Agent()` call (or resumes
executor/evaluator warm via `SendMessage`) — that call does not return until the sub-agent's own
turn has fully ended, and its return value **is** the sub-agent's entire result
(`orchestrator-subagent-result-delivery`, shipped by CON-134/CON-133). Today, none of
executor/evaluator/skeptic/auditor has a `SendMessage` tool, and none has any raise procedure for
a non-environmental decision — `BLOCKER` is explicitly environmental-only in every role doc.

## Goals / Non-Goals

**Goals:**
- A documented, non-`BLOCKER` raise procedure for executor/evaluator/skeptic, usable for any
  genuine decision outside the role's authority.
- A reconciliation of `auditor`'s existing `ESCALATE` return-value verdict with the new procedure.
- The orchestrator relays a sub-agent's raise upward without deciding it (extends CON-76's
  existing rule to this hop), through the exact same already-existing topology-aware machinery —
  no new escalation plumbing, no new `emit-event.sh` mode.
- A concretely defined, CON-15-safe yield/resume shape for the raiser.
- `BLOCKER` and the new `ESCALATION` signal stay distinguishable in reports/telemetry.
- Claude-Code-only scope; adapter-safe prose (nothing harness-specific leaks into `core/roles/
  *.md` shared text — CON-134's lesson).
- Compose correctly with CON-126 (TUI detection, not yet built) — state assumptions explicitly.

**Non-Goals:**
- Building CON-126 (TUI detection) — out of scope.
- Cross-harness (Codex/OpenCode) parity for this new procedure — CON-135.
- A true mid-flight, non-terminating communication channel. The harness's `Agent()` spawn is a
  single blocking call (restated below); no tool grant changes that fact. "Escalation without
  death" is achieved via warm/cold resume semantics, not by avoiding a turn boundary that this
  harness does not allow avoiding.
- Any change to `BLOCKER`'s existing meaning or budget/circuit-breaker behavior.
- Planning-premise validation (CON-136) or cleanup.sh defects (CON-119/121) — unrelated.

## Decisions

### Decision 1 — What "raise" actually is, given the harness's blocking `Agent()` call

The orchestrator's blocking `Agent()` call cannot return early — the sub-agent's turn must end for
the orchestrator to see anything, mid-flight or not. Granting `SendMessage` to sub-agents therefore
does **not** create a new inbound channel the orchestrator can observe *while still blocked* in
that call (this is restated, not contradicted, from `orchestrator-subagent-result-delivery`'s
core finding). What it *does* add: the sub-agent, as the very last action before its turn ends, can
`SendMessage` the orchestrator (its spawner, whose agent name/ref it is given at spawn time — a
new required Input field, `ORCHESTRATOR_AGENT_REF`) with a durable, structured copy of the raise —
`summary`/`message` carrying the same question/options/context the return value carries. This adds
a genuine benefit distinguishable from "hope the prose in the return value gets parsed correctly":
a structured, independently-timestamped, cross-agent-log event that exists the moment the raise
happens, not dependent on how faithfully the return value's prose is read. It is a *belt*, not a
replacement for the *suspenders* (the return value remains authoritative and is what the
orchestrator actually acts on — see Decision 2).

**On the ticket's "Raising must NOT end the raiser's turn" scope bullet** (non-blocking note from
design-gate round 1): this bullet, read literally, is not satisfiable given the harness's blocking
`Agent()` model (nothing this change can do makes the sub-agent's own turn *not* end when it
returns an `ESCALATION`). The ticket's CORRECTED FRAMING comment supersedes the "no way to raise"
framing but does not itself relax this bullet. This design satisfies the ticket's actual acceptance
criteria — AC2's "without the sub-agent's turn ending **destructively**" (not "without ending at
all") — deliberately, not by oversight: "destructively" is the operative word, and this design's
warm/cold-with-context resume contract (Decision 5) is precisely what makes an `ESCALATION` return
non-destructive. The scope bullet's stronger literal wording is not achievable within this harness's
tool topology and is treated as aspirational/approximate, superseded in practice by AC2's precise
wording.

Alternative considered: skip `SendMessage` entirely, rely on return value only. Rejected — the
ticket's scope explicitly requires granting the tool, and the structured self-notify has real
value (a durable pre-return record of the raise, independent of the eventual `Agent()` return
being read/parsed correctly downstream, e.g. by telemetry tooling that inspects agent messages
rather than orchestrator prose).

### Decision 2 — The `ESCALATION` verdict: a new signal, distinct from `BLOCKER`, `PASS`/`FAIL`,
`CONFIRM`/`REFUTE`, `MERGE`/`ESCALATE`

Each of executor/evaluator/skeptic gains a new terminal-for-this-turn return shape:

```
Verdict: ESCALATION
Question: <one sentence, the decision needed>
Options: <comma-separated, or "free-form">
Context: <what's known, why this is genuinely ambiguous/contradictory/out-of-authority>
```

- **executor** has no existing verdict vocabulary (it returns a prose summary) — `ESCALATION` is
  a new, explicit alternative to "flag it and stop" (today's only, undocumented mechanism), given
  the same structured shape as the other roles so the orchestrator's relay handling is uniform.
- **evaluator**: `Overall: ESCALATION` alongside existing `PASS | FAIL | BLOCKER`.
- **skeptic**: `Verdict: ESCALATION` alongside existing `CONFIRM | REFUTE | BLOCKER`.
- **auditor**: gains a *distinctly named* raise, not a bare `ESCALATION` — see Decision 3 (the
  design-gate round-1 REFUTE found `ESCALATE`/`ESCALATION` a one-token-apart, LLM-unsafe pair in
  the same role doc; the auditor's raise is renamed `ESCALATION-RAISE` to fix this).

`ESCALATION` (or, for the auditor, `ESCALATION-RAISE` — same procedure, distinct name) is **never**
used for an environmental failure (that stays `BLOCKER`, unchanged meaning, unchanged
budget/circuit-breaker table entry) and never for a code-quality finding already expressible as a
Change Request (FAIL) or a design objection already expressible as `REFUTE`. It is reserved for: a
genuine requirements contradiction, an ambiguity the ticket/spec doesn't settle, or a decision
outside the role's authority (e.g. "the ticket says X but the spec says Y — which wins?", "should
this touch file Z, which the ticket doesn't mention?").

**Revised per design-gate round-1 REFUTE (CR1):** every role's existing "a verdict must always be
emitted" rule (`evaluator.md`, `skeptic.md`, `auditor.md`) is preserved unweakened, not carved out.
`ESCALATION`/`ESCALATION-RAISE` **is** an ordinary member of each role's `verdict=` vocabulary,
written and `persist-evidence.sh`-persisted as a (short) report exactly like any other verdict, and
emitted via the role's normal `emit-event.sh verdict verdict=<ESCALATION|ESCALATION-RAISE>` call —
nothing about the existing verdict-emission mechanism changes. Distinguishability from `BLOCKER`
(AC4) is satisfied trivially: they are simply two different values of the same `verdict=` field,
exactly as `PASS`/`FAIL`/`BLOCKER` are already three distinguishable values today — no new event
kind, no dropped-field `kind=` parameter (the round-1 draft's `kind=subagent` clause is struck: it
both contradicted the `escalation-bubble-up` delta's "no new event kind" requirement and was
silently discarded by `emit-event.sh`'s existing caller-supplied-field allowlist — verified against
`scripts/concertino/emit-event.sh:237-244`). The *orchestrator's own, separate* relay-to-human step
(Decision 4) — raising `escalation.raised`/`.answered` tagged `role=<raiser>` — happens **in
addition to**, not instead of, this normal verdict emission: the orchestrator reads the returned
`ESCALATION`/`ESCALATION-RAISE` verdict, then itself raises the human-facing escalation exactly as
it already does for its own Planning escalations. Two events, two purposes: the `verdict=` event is
the role's own accounting (unweakened rule), the `escalation.*` event is the human-facing relay.

Alternative considered: reuse `BLOCKER` for everything and let the orchestrator infer intent from
prose. Rejected outright — this is the exact ambiguity the ticket exists to close (AC4 requires
distinguishability, and `BLOCKER`'s environmental-only meaning is load-bearing elsewhere: the
circuit-breaker table's "Server start / 1 attempt" and "environmental (never retried as a code
change)" language depend on `BLOCKER` never carrying a code/design/decision meaning).

### Decision 3 — Reconciling `auditor`'s `ESCALATE`

`ESCALATE` keeps its exact current meaning: a **completed** check (one of the four merge
conditions, or an untraceable AC) found a real, expected, unmergeable/unmet fact — a post-hoc
finding returned after the auditor has finished evaluating, per its existing "you get exactly one
pass" design (no retry budget). This is unchanged.

The new raise is for a narrower, different situation: the auditor hits a genuine ambiguity
**before** it can even complete its checklist and reach one of `MERGE`/`ESCALATE`/`BLOCKER` — e.g.
the acceptance criteria themselves are worded ambiguously enough that the auditor cannot judge
condition 4 at all without a human call on what "satisfies AC N" even means here (as opposed to "I
checked and it's not traceable," which is already `ESCALATE`). This is expected to be rare (the
auditor's checklist is largely mechanical/scripted), but the same raise/relay/resume machinery
applies uniformly rather than inventing an unrelated fifth auditor verdict.

**Revised per design-gate round-1 REFUTE (CR4):** the round-1 draft named this raise bare
`ESCALATION`, one token apart from the auditor's own existing `ESCALATE` in the same `Verdict:`
slot — an unsafe pair for a value parsed from LLM-generated prose, given the two route to
materially different orchestrator behavior (`ESCALATE` → no-retry fallback to wait-for-"merged";
the raise → relay-then-fresh-cold-respawn, consuming no retry budget). The auditor's raise is
therefore named **`ESCALATION-RAISE`** — unmistakably distinct from `ESCALATE` at a glance, while
still using the shared `ESCALATION`-prefixed convention the other three roles use bare. The
orchestrator's Signal Types table (Decision 4) carries both entries side by side with an explicit
one-line note distinguishing them, so the table stays readable despite three `ESCALAT*`-prefixed
rows (Planning `ESCALATION`, auditor `ESCALATE`, auditor `ESCALATION-RAISE`, other-roles
`ESCALATION`).

Because the auditor is always spawned cold, once-only, no-retry, an `ESCALATION-RAISE` from the
auditor is answered via a **fresh cold re-spawn carrying the resolved answer forward as an
additional input** (same as skeptic, Decision 5) — this does **not** consume or interact with the
auditor's "one attempt, no retry" circuit-breaker entry (that entry governs `ESCALATE`/`BLOCKER`
outcomes reached after a completed pass, not a raise that occurs before one was ever reached).

### Decision 4 — Orchestrator relay: extend the existing procedure, add no new plumbing

`core/roles/orchestrator.md`'s "Escalation & Circuit Breakers" section gains two new rows in its
signal table (`ESCALATION | executor/evaluator/skeptic | Relay to human via the existing raise
procedure; do not decide it yourself` and `ESCALATION-RAISE | auditor | same, before the auditor
has reached MERGE/ESCALATE/BLOCKER — distinct from ESCALATE, see Decision 3`) and one new
paragraph immediately after "How to raise one"'s topology branch, stating: a sub-agent
`ESCALATION`/`ESCALATION-RAISE` verdict is raised through the *exact same* `--await` (root)/
`--raise-only` (subagent-of-something-else) procedure already defined, substituting the
sub-agent's `question`/`options`/`context` for the orchestrator's own, and tagging `role=<raiser>`
instead of `role=orchestrator`. This is the literal mechanism that satisfies "the answer must be
the same at every depth" and "compose with the TUI signal the same way at every depth" (ticket's
composition constraint): the TUI/topology decision already lives entirely inside this one
procedure, so extending its *input* (who raised it) rather than duplicating its *logic* means
CON-126, whenever it lands, only has to change this one place for every depth to inherit the
correct behavior uniformly. **Explicit assumption, stated per the ticket's request:** this design
assumes CON-126 will gate the *existing* `--await` vs. chat-transcript-first behavior at exactly
this one call site (already true today for the orchestrator's own escalations) and does not
introduce a second gating point for sub-agent-originated escalations — if CON-126 turns out to
need a different signal per originating role, that is a CON-126-time revision, not one this change
anticipates further than stating the assumption.

**Revised per design-gate round-1 REFUTE (CR3):** these new sentences in `core/roles/
orchestrator.md` (the resume-warm-via-`SendMessage` statement, and the new `ORCHESTRATOR_AGENT_REF`
spawn-input note that names `SendMessage` as its purpose) are **Claude-Code-only content and MUST
be routed through the same harness-guarded `{{block:...}}` mechanism as the four sub-agent role
docs** (task 2.5's constraint, extended here to `orchestrator.md` itself) — either folded into the
existing `{{block:harnessResume}}` claude-code branch (already the sanctioned place `SendMessage`
is named in this file) or a new sibling block, never written as bare shared prose. This closes the
gap the round-1 draft left open: `orchestrator.md` renders to codex/opencode exactly like the other
four role files, and task 6.1's zero-`SendMessage`-occurrence-**delta** criterion for codex/opencode
applies to it identically (it is a *delta* criterion, not "zero occurrences absolute" —
`orchestrator.md` already contains 6 pre-existing bare `SendMessage` occurrences today, all
correctly gated by the existing `{{block:harnessResume}}` mechanism; this change must add zero
more that leak through to codex/opencode).

### Decision 5 — Resume shape (CON-15-safe): warm for executor/evaluator, cold-with-context for
skeptic/auditor

- **executor, evaluator**: already warm-resumable across cycles via `SendMessage` today
  (unchanged mechanism). An `ESCALATION` verdict is a **legitimate reason to warm-resume**, exactly
  like a `FAIL` verdict already is — the orchestrator, once it has the human's answer, resumes the
  *same* agent (not a fresh spawn) with the answer as new input, preserving its accumulated
  context. This is the concrete "escalation without death" the ticket asks for: no discarded
  context, no cold re-spawn, for the two roles that carry state.
- **skeptic**: always spawned fresh/cold by design (never resumed, even across ordinary REFUTE
  rounds) — nothing changes about that design, and nothing is lost by it, since skeptic is
  designed to re-derive ground truth from scratch every time regardless. An `ESCALATION` from the
  skeptic is answered by a **fresh cold spawn** that receives the resolved answer as an explicit
  additional input (alongside its usual `GATE`/`WORKTREE_PATH`/etc.), so it does not have to
  re-ask or re-derive the same ambiguity.
- **auditor**: same cold-with-context treatment as skeptic (Decision 3) — its "one attempt, no
  retry" property is about `ESCALATE`/`BLOCKER` outcomes after a completed pass, not about this
  raise, so re-spawning it once, carrying the answer forward, does not weaken that property.

**CON-15 safety, restated explicitly:** the orchestrator never ends its own turn while a spawned
or resumed sub-agent (including an `ESCALATION`-raising one) is outstanding — it waits inline for
the `Agent()`/`SendMessage` call to return (already covered by the existing "Harness resume model"
guardrail; the mirror-image failure the ticket warns against — a *sub-agent* deadlocking waiting
for an inbound reply it can never receive mid-turn — is foreclosed by Decision 1: the raiser's
`ESCALATION` return is exactly its ordinary way of ending its turn to hand control back, not a
wait-for-inbound-message loop. The sub-agent never blocks on `SendMessage`'s delivery or on any
reply; it sends (fire-and-forget, a durable self-notify per Decision 1) and then returns.

### Decision 6 — No sub-agent ever calls `emit-event.sh` or reasons about TUI state

Sub-agents' role docs are never given `emit-event.sh` instructions for the raise. This is
deliberate, not an oversight: it is what keeps the composition-with-CON-126 promise (see Decision
4) — the TUI/topology decision is made in exactly one place (the orchestrator's existing
procedure), regardless of which role originated the question.

### Decision 7 — `orchestrator-subagent-result-delivery` spec correction

Its "no `SendMessage` tool... cannot address the orchestrator" requirement becomes false on Claude
Code once this change ships. The delta spec `MODIFIES` that requirement to state the precise, still
-true remainder: sub-agents may now call `SendMessage` to self-notify the orchestrator of a raise,
but (a) this cannot be observed by the orchestrator before its blocking `Agent()`/`SendMessage`
call returns (an architectural fact restated, not contradicted), and (b) a sub-agent's
authoritative result remains the return value of that call — the `ESCALATION` verdict travels
inside it, exactly like every other verdict. The render-diff and rendered-frontmatter mechanical
checks CON-134 established stay in force, extended to also assert the new tool grant appears.

## Risks / Trade-offs

- [Risk] A future reader assumes `SendMessage` gives sub-agents a live, mid-turn back-channel →
  Mitigation: Decision 1/7 state the architectural constraint explicitly in both the role docs and
  the corrected spec; the rendered orchestrator doc's `harnessResume` block (claude-code branch,
  `lib/cli/render.js`) is updated in the same change to say precisely this, so it can't drift from
  the sub-agent-facing docs.
- [Risk] `core/roles/*.md` prose naming `SendMessage` leaks into Codex/OpenCode renders (CON-134's
  exact failure) → Mitigation: shared prose in `executor.md`/`evaluator.md`/`skeptic.md`/
  `auditor.md` describes the *procedure* (raise, resolve, resume) without naming the Claude-Code
  tool; the tool name itself lives only in `lib/cli/render.js`'s `claude-code` `harnessResume`
  branch (extended) and the adapter's own `agents.json`. Verified mechanically via CON-134's
  render-diff proxy (baseline vs. modified occurrence counts for `SendMessage`, per harness).
- [Risk] Granting `SendMessage` without an actual reachable target name breaks at runtime (the
  sub-agent doesn't know the orchestrator's agent ref) → Mitigation: `ORCHESTRATOR_AGENT_REF` is
  added as a new orchestrator-supplied Input field on every executor/evaluator/skeptic/auditor
  spawn (Claude Code only), alongside `WORKTREE_PATH`/`TICKET_ID`/etc.
- [Risk] LLM runtime behavior (does the agent actually use `ESCALATION` correctly instead of
  guessing, does it correctly avoid calling `emit-event.sh`) is not mechanically testable →
  documented explicitly in `tasks.md` as such, per this delivery's verification standard, rather
  than inventing a vacuous check.

## Migration Plan

Additive only — no existing verdict, tool, or script is removed or renamed. `BLOCKER`'s meaning
and every existing circuit-breaker/budget entry is unchanged. Rollback = revert the commit; no
data migration, no schema change.

## Open Questions

None outstanding — the ticket's own "compose with TUI signal" requirement is addressed via
Decision 4/6's explicit assumption rather than left open, per the ticket's own instruction to
state assumptions rather than build CON-126 here.
