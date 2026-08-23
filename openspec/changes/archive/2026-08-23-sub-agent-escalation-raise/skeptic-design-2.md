## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Scope of this round: verify the four round-1 change requests are really fixed, complete, and
internally consistent across `design.md`, `tasks.md`, and all three spec deltas (including the two
round 1 did not flag). Derived from the artifacts and from repo ground truth, not from round 1's
narrative.

### What I verified (with evidence)

**CR1 — `ESCALATION` vs. "a verdict must always be emitted" — FIXED, and fixed the right way.**
- `design.md` Decision 2 now carries an explicit "Revised per design-gate round-1 REFUTE (CR1)"
  paragraph: `ESCALATION`/`ESCALATION-RAISE` is *an ordinary member* of each role's `verdict=`
  vocabulary, written + `persist-evidence.sh`-persisted + emitted via the normal
  `emit-event.sh verdict` call; the existing rule is "preserved unweakened, not carved out."
- `tasks.md` 2.5 matches exactly: "do **NOT** alter or carve exceptions into the existing 'a
  verdict must always be emitted' sentence", with the executor's no-verdict-enumeration case
  handled separately. I confirmed that carve-out is warranted: `grep -n "emit-event" core/roles/executor.md`
  returns **nothing** — the executor genuinely emits no verdict events today, so 2.5's split
  treatment is accurate, not hand-waving.
- `specs/subagent-escalation-raise/spec.md:180-212` encodes it normatively, with three scenarios
  including "The orchestrator's human-facing relay is additional, not a substitute". This is the
  *additionally, not instead of* shape CR1 asked for. No artifact now requires suppressing a
  `verdict=` event.
- Mechanically implementable? Yes — `scripts/concertino/emit-event.sh:228-244`: `verdict` is not a
  reserved/structural key and falls through the `*)` payload case; there is no allowlist of
  verdict *values*. `verdict=ESCALATION` will be written verbatim.
- Downstream safety check I ran that round 1 did not: `scripts/concertino/check-merge-readiness.sh:252-269`
  takes the **last** `role=evaluator` / `role=skeptic` verdict event and requires `PASS`/`CONFIRM`.
  An interposed `verdict=ESCALATION` therefore neither breaks merge-readiness (a later PASS/CONFIRM
  supersedes it) nor silently permits a merge on an unresolved raise (an ESCALATION as the latest
  verdict fails the check). The design composes correctly with existing tooling.

**CR2 — `kind=subagent` — FIXED, no residue.**
- `grep -rn "kind=subagent" openspec/changes/... core/ lib/` returns exactly one hit:
  `design.md:112`, and it is the *striking* sentence ("the round-1 draft's `kind=subagent` clause
  is struck"), not a live instruction.
- `tasks.md` 3.2 now says "no new event kind, no new `emit-event.sh` mode, no `kind=` parameter
  (struck per … CR2 …; `role=<raiser>` alone carries the distinction)" — consistent with
  `specs/escalation-bubble-up/spec.md:8-9,25-29` ("distinguished only by their `role=` field").
- Ground truth reconfirmed: `emit-event.sh:237-244` explicitly drops caller-supplied `t`/`kind`.
  The revised artifacts now agree with the script.

**CR3 — `orchestrator.md` shared-prose leak — FIXED, on all three surfaces.**
- `design.md` Decision 4 gains an explicit "Revised per … CR3" paragraph requiring the
  resume-warm sentence and the `ORCHESTRATOR_AGENT_REF` note be routed through the harness-guarded
  `{{block:...}}` mechanism "identically to the four sub-agent role docs", and states the 6.1
  criterion is a **delta** of zero, not an absolute zero.
- `tasks.md` 3.3 ("route it through the harness-guarded block … do not write it as bare shared
  prose") and 3.4 ("**This entire note — including task 3.3's resume-mechanism sentence — MUST be
  written inside a harness-guarded `{{block:...}}` placeholder**") both carry the constraint now.
- A new normative requirement exists: `specs/subagent-escalation-raise/spec.md:95-114`, with a
  scenario that spells out the delta-vs-absolute distinction. Consistent with
  `specs/orchestrator-subagent-result-delivery/spec.md:29-38`, whose scenario is also phrased as
  "count … is unchanged" (delta), so the two deltas do not contradict each other.
- Ground truth: `core/roles/orchestrator.md:101` is `{{block:harnessResume}}` — the sanctioned
  guarded site the tasks point at is real, and `lib/cli/render.js`'s `block()`/`{{block:…}}`
  substitution (verified round 1, re-confirmed by the placeholder's presence in the live file)
  makes the approach implementable as written.

**CR4 — `ESCALATE` / `ESCALATION` collision — FIXED for the auditor.**
- `design.md` Decision 2 bullet 4 and Decision 3 both rename the auditor's raise to
  `ESCALATION-RAISE`, with the rationale stated (the two route to materially different
  orchestrator behavior) and an instruction to keep the Signal Types table readable despite the
  now-three `ESCALAT*` rows.
- `tasks.md` 2.4 ("**NOT** named bare `ESCALATION`"), 3.1 (two table rows, grouping instruction)
  match. `specs/subagent-escalation-raise/spec.md:157-178` encodes it normatively including a
  Signal-Types-table scenario.
- Ground truth for the anchors: `core/roles/orchestrator.md:107-116` is the real Signal Types
  table containing both the Planning `ESCALATION` row and the Auditor `ESCALATE` row; `:1368-1393`
  carries the "1 attempt, no retry … `ESCALATE`/`BLOCKER`" circuit-breaker entry the design
  claims `ESCALATION-RAISE` does not consume. Both claims land on real, correctly-described text.
- I checked the adjacent collision the rename could have created: `ESCALATION-PENDING` already
  exists (`core/roles/orchestrator.md:1148,1225,1228,1239,1291`) as the *bubble-up payload header*,
  not a sub-agent verdict value, and lives in a different slot (an orchestrator's return to its
  parent). `ESCALATION-RAISE` vs. `ESCALATION-PENDING` share a prefix but never occupy the same
  slot for the same reader, and `escalation-bubble-up/spec.md:22` uses them together coherently
  (a sub-agent's `ESCALATION` → the orchestrator returns `ESCALATION-PENDING` upward). No new
  collision introduced.

**Round-1 non-blocking notes: addressed.** `design.md` Decision 1 now contains the explicit
paragraph reconciling `ticket.md`'s literal "Raising must NOT end the raiser's turn" scope bullet
with AC2's "without the sub-agent's turn ending **destructively**", stating plainly that the
literal bullet is unsatisfiable in this harness and why AC2 is the operative signal. That is the
honest treatment I asked for.

**Things I tried to refute this round and could not:**
- *Did the CR1 fix quietly break AC4 (BLOCKER/ESCALATION distinguishable in telemetry)?* No —
  distinguishability is now carried by two values of the same `verdict=` field, which is exactly
  how `PASS`/`FAIL`/`BLOCKER` are already distinguished today, and `check-merge-readiness.sh`
  reads that field structurally.
- *Did the CR3 fix create an impossible task pairing?* No — 3.3 and 3.4 are explicitly written as
  one guarded block, not two edits in different places.
- *Any new placeholders/TODOs from the revision?* None; "Open Questions: None outstanding" still
  holds, and no task defers a decision to implementation time.
- *`openspec validate`* is reported passing and the artifact structure (ADDED/MODIFIED headers,
  `#### Scenario:` under every requirement) is well-formed on inspection of all three deltas.

### Verdict: CONFIRM

All four round-1 change requests are genuinely and completely fixed, in the three places each
needed fixing (design rationale, task instruction, normative spec), and each fix is consistent
with repo ground truth I re-derived myself rather than with round 1's account of it. The residual
items below are single-word/single-sentence wording alignments that fall squarely inside existing
task 4.1 ("confirm the delta specs accurately describe the final wording … adjust wording only if
it drifted"), so they do not force an undocumented judgment call and do not warrant burning
another design round.

### Non-blocking notes

- **`specs/escalation-bubble-up/spec.md:4`** is the one place the CR4 rename did not propagate:
  "The orchestrator SHALL raise an `ESCALATION` verdict from executor/evaluator/skeptic/**auditor**"
  names a verdict *value* the auditor will never return (it returns `ESCALATION-RAISE`). Fix under
  task 4.1 by writing "an `ESCALATION` verdict from executor/evaluator/skeptic, or an
  `ESCALATION-RAISE` verdict from auditor" — matching the phrasing already used correctly at
  `specs/subagent-escalation-raise/spec.md:78-80`. Not blocking (the authoritative capability spec,
  design, and tasks are all unambiguous, and 4.1 names this exact file), but it is the archived
  contract, so it should not ship stale.
- Relatedly, `design.md` Decision 2 establishes a convention — `ESCALATION` is the *procedure*
  family name, `ESCALATION-RAISE` the auditor's *verdict value* ("same procedure, distinct name") —
  which makes the generic "the `ESCALATION` raise procedure in …/`auditor.md`" phrasing at
  `specs/subagent-escalation-raise/spec.md:117` and `:217` correct. But that convention is stated
  only in `design.md`, which is not archived as spec. One sentence stating it inside
  `specs/subagent-escalation-raise/spec.md` would make the spec self-contained for a later reader
  who has only the archived specs.
- `tasks.md:92` (task 3.7) cross-references "see task 2.6 below" for the unchanged
  verdict-emission mechanism; the task that actually establishes that is **2.5** (2.6 is the
  no-bare-`SendMessage` constraint), and it is above, not below. Harmless typo, but 3.7 is one of
  the CR1 fix's load-bearing tasks and a wrong pointer there is worth correcting.
- Task 6.1's red-before-green mutate-then-revert on the *real* source file, and 6.2's rendered-
  frontmatter assertion (never the source `agents.json` alone), remain the strongest part of the
  verification plan. Flagging approvingly so a later reviewer does not mistake 6.5's explicit
  refusal to invent a runtime check for AC5 as a verification gap — it is correctly reasoned.
