## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read all planning artifacts from ground truth: `ticket.md`, `proposal.md`,
  `design.md`, `tasks.md`, `specs/orchestrator-turn-discipline/spec.md`, plus
  `skeptic-design-1.md` / `skeptic-design-2.md` (read as claims only).

- **Round-2 CR#1 is genuinely closed.** `cat openspec/specs/orchestrator-turn-discipline/spec.md`
  shows the existing requirement at line 8:
  `### Requirement: The orchestrator role states the top-level-vs-sub-agent turn distinction, explained rather than asserted`,
  whose body (lines 9–17) mandates exactly the offending framing:
  "waiting is free … (it persists and receives the sub-agent's notification whenever it arrives)".
  The delta's `## MODIFIED Requirements` section restates that requirement under a
  **byte-identical header** (so it is a real modification, not an accidental new
  requirement), removes both "receives the sub-agent's notification whenever it
  arrives" and the unqualified "waiting is free", preserves the accurate
  top-level-vs-sub-agent contrast (session-not-destroyed vs. orphaned child), adds
  an explicit "SHALL NOT … imply an automatic wake signal" clause, and updates the
  first scenario's wording so it no longer says "waiting is harmless at the top
  level". `tasks.md` 1.3 applies it. This finding is fixed.

- **The "explicit fallback" compatibility claim in `design.md` checks out.** The
  existing requirement "The role states an explicit fallback when the harness cannot
  wait inline" (spec lines 48–58) prescribes poll-or-escalate and uses none of the
  corrected language. No modification needed — the design's assertion is accurate.

- **No requirement-name collisions** between the delta's five ADDED requirements and
  the nine existing ones (`grep -n "^### Requirement" openspec/specs/orchestrator-turn-discipline/spec.md`).

- **Re-ran the language audit against ground truth**, not against the plan's
  description: `grep -rn "costs nothing\|whenever it arrives\|will receive\|waiting is free\|waiting free\|free at the top level" core/ adapters/ docs/ openspec/specs/`.
  Hits inside `core/roles/orchestrator.md` are lines 42–43 (the targeted
  contradiction), 672 ("free at the top level, fatal as a sub-agent"), and 1200
  ("It costs nothing when you don't own that channel" — an unrelated, legitimate
  use). Tasks 2.1/2.2 cover these, since their term list includes both
  `costs nothing` and `free at the top level`. Fine.

- **A hit the plan does not cover, and it is the root-cause sentence itself.** See
  Change Request 1. Reproduced twice (`grep -rn ... lib/` and a targeted
  `grep -n "waiting is free" lib/cli/render.js`), so this is a stable reading, not a
  flaky one.

### Verdict: REFUTE

Round 2's finding is genuinely closed and the plan is otherwise sound. But an
independent copy of the exact sentence this change exists to delete lives in
`lib/cli/render.js`, is injected into the **rendered** orchestrator agent ~60 lines
after the passage being corrected, and appears nowhere in the proposal's Impact,
the design, the tasks, or the spec delta. Shipping the plan as written leaves the
contradiction in the artifact the orchestrator actually reads.

### Change Requests

1. **`lib/cli/render.js`'s `harnessResume` block re-emits the offending language
   into the rendered agent; the plan never touches it.**
   `core/roles/orchestrator.md:101` is `{{block:harnessResume}}`, the last line of
   the "Harness resume model" section. `lib/cli/render.js:206` (the `case
   'harnessResume':` claude branch — the fallback `return` after the `codex` /
   `opencode` early returns, so it is what a Claude Code render emits) contains:

   > "**Never end your turn while a spawned or resumed sub-agent is still
   > outstanding.** As the top-level `/concertino-deliver` session, **waiting is
   > free — your session persists and receives the sub-agent's result whenever it
   > arrives.** But if you are yourself running as a sub-agent …"

   That is the same "waiting is free" + "whenever it arrives" construction the
   proposal identifies as the root cause, verbatim, and it is rendered into the same
   section as the corrected text. Meanwhile `proposal.md`'s Impact says "No script,
   schema, or runtime behavior changes … the fix lands in `core/roles/orchestrator.md`"
   and "No change to `scripts/concertino/*` or to any rendered adapter file
   directly", and `tasks.md` 2.1 scopes the audit to `core/roles/orchestrator.md`
   alone. Result: task 3.2's before/after render diff would show the corrected
   sentence at ~line 42 **and** the uncorrected one still present below it, and the
   change's own ADDED requirement "The role document contains no language implying
   an automatic completion notification" would be unmet in the rendered artifact.

   Required revisions:
   a. Add `lib/cli/render.js` (the `harnessResume` block, claude branch) to
      `proposal.md`'s Impact and to the "What Changes" list, and drop/qualify the
      "no script changes" wording, which is now inaccurate.
   b. Add a task under section 1 to apply the same correction to that block's
      "waiting is free — your session persists and receives the sub-agent's result
      whenever it arrives" sentence, preserving its accurate contrast, and to
      reconcile it with the corrected prose in `core/roles/orchestrator.md` so the
      rendered section does not state the rule twice in two different framings.
   c. Extend task 2.1's audit target from `core/roles/orchestrator.md` alone to
      "`core/roles/orchestrator.md` **and every template block it interpolates**"
      — concretely, the `block()` strings in `lib/cli/render.js` reachable from the
      orchestrator role for the claude harness. A grep of the source role file
      structurally cannot see them.
   d. Update the ADDED requirement "The role document contains no language implying
      an automatic completion notification" so its subject is the **rendered**
      orchestrator role (source: `core/roles/orchestrator.md` **plus** its
      interpolated `harnessResume` block), not the source file alone. As written,
      its scenario already says "the rendered orchestrator role document (source:
      `core/roles/orchestrator.md`)", which the current plan cannot satisfy.
   e. Scope note: `adapters/codex/header.md:21` ("free at the top level") is the
      Codex branch and stays out of scope per CON-135 — state that explicitly so
      the executor does not treat (c) as licence to edit it.

### Non-blocking notes

- `openspec/specs/orchestrator-turn-discipline/spec.md`'s **Purpose** line still
  reads "why that is harmless at the top level but fatal when the orchestrator
  itself runs as a sub-agent" — the same framing the MODIFIED requirement now
  corrects. Purpose blocks are not requirements and openspec deltas do not normally
  carry them, so this is not blocking, but it will read as stale after archive.
- The existing requirement "`docs/harness-capabilities.md` records the turn-discipline
  constraint as a harness-behavior fact" (spec line ~85) still mandates that the doc
  say the constraint "makes waiting free for a top-level session". Ground truth
  (`docs/harness-capabilities.md:165-166`) is more careful — "receives the
  sub-agent's result whenever **the tool call returns**. Waiting is free." — so the
  notification implication is not present there. Out of this change's stated scope;
  worth a follow-up ticket for consistency of the spec set rather than a revision here.
- Task 3.3 ("confirm no other adapter output silently reverts the change") is the
  step most likely to surface CR#1 at execution time; strengthening it to name the
  render-block mechanism explicitly would make that catch deterministic rather than
  incidental.
