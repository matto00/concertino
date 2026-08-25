## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-derived everything from the files, not from the plan's self-description.

- **CR#1 (false premise) — ADDRESSED.** `proposal.md` "Why" and `design.md` "Context"
  now both state that the prohibition already exists in bold and is *contradicted by
  adjacent text*. Verified against source: `core/roles/orchestrator.md:40` —
  "**Never end your turn while a sub-agent you spawned or resumed is still
  outstanding.**"; `:41-43` — "waiting costs nothing: your session persists and will
  receive the sub-agent's result whenever it arrives, however long that takes."; `:96`
  — "Ending a turn for any other reason ... remains exactly as forbidden as before."
  The revised premise is accurate.

- **CR#2 (don't just add a fifth restatement) — ADDRESSED.** `design.md` Non-Goals now
  explicitly rejects "Adding a fifth/sixth restatement of the existing prohibition with
  no other change", and Decisions makes the contradiction rewrite the load-bearing
  change with the enumeration as adjacent reinforcement. The intervention class changed.

- **CR#3 (the top-level license is the real root cause) — ADDRESSED.** It is now the
  primary target (proposal bullet 1, design Decisions "Rewritten framing", tasks 1.1).
  The second instance I flagged, `core/roles/orchestrator.md:672` ("free at the top
  level, fatal as a sub-agent"), is covered by the broadened audit term list.

- **CR#4 (audit grep list) — ADDRESSED.** `design.md` Decisions and `tasks.md` 2.1 now
  list `wait`/`waiting` (bare stem), `whenever it arrives`, `will receive`,
  `costs nothing`, `free at the top level`, `persists` alongside the originals, and the
  stated target is `core/roles/orchestrator.md` (the source), not a rendered copy.
  Spot-checked the terms against the file: `grep -n "costs nothing\|whenever it
  arrives\|will receive\|free at the top level\|persists\|notif"` returns lines 42, 43,
  50, 65, 632, 636, 672, 673, 1200, 1409 — a tractable manual-review set that includes
  both real hits and the expected legitimate ones, matching the design's stated
  false-positive risk and manual-review mitigation.

- **CR#5 (demonstration bar) — ADDRESSED.** `tasks.md` 4.1 no longer has the undefined
  get-out clause; artifact-alone establishment (report path, `git log` SHA,
  `workflow-state.md`) is now the required action, with return-value consumption
  explicitly excluded as sufficient, mirrored in the spec delta.

- **CR#6 (ownership) — SUBSTANTIALLY ADDRESSED.** 4.1 now says "**The orchestrator**
  (not the executor) performs this task, during this same delivery run". Residual
  looseness on the artifact location — see non-blocking note 1.

- **CR#7 ("what was NOT verified" as a binding output) — ADDRESSED.** `tasks.md` 4.3
  plus a dedicated spec requirement now mandate a separately-headed
  "What was verified / what was not verified" section in both the executor's and the
  evaluator's reports, with parts (a) and (b) specified and a REFUTE consequence.

- Round-1 non-blocking notes both picked up: `tasks.md` 3.1 captures a before-copy of
  the rendered agent file; the placement ambiguity around `{{block:harnessResume}}`
  (`core/roles/orchestrator.md:100`) is dissolved because the new text is now placed
  *beside the corrected sentence at ~40-43*, not after the section.

- Checked the delta for requirement-name collisions against
  `openspec/specs/orchestrator-turn-discipline/spec.md` (`grep -n "^### Requirement"`,
  9 existing requirements) — no name collisions. `openspec validate` could not be run
  (`npx --no openspec` → "could not determine executable to run"); this is a tooling
  gap, not a finding, and task 5.1 still owns it at execution time.

### Verdict: REFUTE

Six of seven change requests are genuinely fixed and the plan is much stronger. But
reading the **existing spec** as ground truth surfaces a defect the revision missed,
and it is exactly the same defect class the change exists to remove.

### Change Requests

1. **The spec delta is `## ADDED Requirements` only, but the root-cause language is
   mandated by an existing requirement that the change never modifies — so the change
   as planned would ship a spec that contradicts itself and still requires the bug.**
   `openspec/specs/orchestrator-turn-discipline/spec.md:6-14`, "The orchestrator role
   states the top-level-vs-sub-agent turn distinction, explained rather than asserted",
   currently reads:

   > `core/roles/orchestrator.md`'s harness-resume guidance SHALL explain ... **waiting
   > is free when the orchestrator is the top-level `/concertino-deliver` session (it
   > persists and receives the sub-agent's notification whenever it arrives)**, but
   > fatal when the orchestrator role is itself dispatched as a sub-agent ...

   That is the offending sentence, promoted to a binding requirement — including the
   word "notification" and the "whenever it arrives" framing. Its scenario
   (`:19-23`) further requires a reader to be able to state "why waiting is harmless at
   the top level". The change's new requirement ("SHALL NOT state or imply ... that a
   sub-agent's result 'will arrive' independent of that call returning") directly
   contradicts it, and the archived capability would carry both. Required revision: add
   a `## MODIFIED Requirements` section to
   `openspec/changes/orchestrator-no-wait-anti-pattern/specs/orchestrator-turn-discipline/spec.md`
   restating requirement "The orchestrator role states the top-level-vs-sub-agent turn
   distinction, explained rather than asserted" in full with the corrected framing —
   preserving the genuinely accurate top-level-vs-sub-agent contrast (session survives
   a long blocking call vs. suspended sub-agent is never resumed) while removing
   "receives the sub-agent's notification whenever it arrives" and the unqualified
   "waiting is free" — and amend its scenario so it no longer asks the reader to
   justify top-level waiting as harmless. Add a corresponding task under section 1 of
   `tasks.md`. Also re-check requirement 3 at `:42-52` ("explicit fallback when the
   harness cannot wait inline") for consistency with the new framing and state in
   `design.md` whether it needs modifying too — it appears compatible (it already
   prescribes polling), but the plan should say so rather than leave it unexamined.

   This matters beyond bookkeeping: the spec is the durable artifact. Fixing the prose
   in `core/roles/orchestrator.md` while leaving a requirement that mandates the prose
   is how the sentence comes back on the next doc-consistency pass.

### Non-blocking notes

- **CR#6 residual:** `tasks.md` 4.2 says the observations go in "this run's own
  delivery notes / final report". CR#6 asked for a *named* file path so the final gate
  has a fixed target. Recommend naming one concretely (e.g. append a
  `POLLING DEMONSTRATION:` block to
  `openspec/changes/orchestrator-no-wait-anti-pattern/workflow-state.md` NOTES, or a
  dedicated `polling-demonstration.md` in the change dir). Not blocking — the change
  dir is small enough that the final-gate skeptic can locate it either way.
- The escalation scope-out for the mechanical phase-script assertion (CON-141) is
  recorded only in `workflow-state.md` NOTES and the change docs; no escalation event
  ref is cited. Worth citing one during execution so the final gate can verify the
  human confirmation rather than take the plan's word for it (carried over from
  round 1).
- `core/roles/orchestrator.md:1200` ("It costs nothing when you don't own that ...")
  and `:1409` are almost certainly legitimate hits for the broadened audit terms; the
  design already anticipates this with manual review, so no action — just don't let
  hit-count volume turn the audit into a skim.
