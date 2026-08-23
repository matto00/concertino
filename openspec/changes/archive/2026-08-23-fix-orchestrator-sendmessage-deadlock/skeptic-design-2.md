## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/orchestrator-subagent-result-delivery/spec.md` from the change dir
  (current on-disk state, not round 1's).
- `git status` / `git diff`: working-tree changes remain
  `core/roles/orchestrator.md` (+54/-17) and `lib/cli/render.js` (+1/-1);
  `git log --oneline -1` = `6f5837a` (CON-132). No other files touched — no
  scope creep since round 1.
- Re-confirmed the premise against ground truth:
  `grep -n SendMessage adapters/claude-code/agents.json` → line 26 only
  (`orchestrator.baseTools`). No sub-agent role has it.
- **Re-rendered all three harnesses** from the modified `core/` into a
  throwaway dir, then `git stash`ed the two modified files and rendered the
  same three from the pristine baseline (stash popped; working tree verified
  restored afterward):
  `node bin/concertino sync --config=config/examples/concertino.json --core=./core --harness=claude-code,codex,opencode --out=<tmp>`
  (exit 0 both runs).

- **`SendMessage` occurrence count in the rendered orchestrator doc,
  baseline → modified:**
  - codex: **6 → 6** (round 1: 6 → 10)
  - opencode: **8 → 8** (round 1: 8 → 12)
  - claude-code: 9 → 12

- **CR1 resolved.** Full `diff` of baseline vs modified
  `.codex/roles/concertino-orchestrator.md` and
  `.opencode/agents/concertino-orchestrator.md`: five hunks each, and
  `diff ... | grep -i sendmessage` returns **nothing** — the delta contains
  no `SendMessage` token at all. The "Cycles 2+ — resume" paragraph that
  previously opened on a codex-nonexistent tool now reads "the call you use
  to resume a sub-agent is a blocking call…" and defers to "Harness resume
  model" for the harness-specific mechanics.
- **CR2 resolved.** The new shared paragraph (codex render lines 64–87) now
  carries the explicit carve-out: *"it is not a claim that no dispatched
  worker anywhere can ever call back on its own — see the harness-specific
  notes below for any such exception, e.g. Codex's optional worker-dispatch
  path"*, and its closing claim is scoped ("On this ordinary path…"). Read
  against codex's own `harnessResume` block in the same rendered file
  (line 105, `report_agent_job_result`, unmodified) the two no longer give
  opposing instructions.
- **CR3 resolved.** Final-gate skeptic step now reads "on this ordinary
  spawn path there is no other way the verdict reaches you" — scoped
  consistently with CR1/CR2's chosen qualification.
- **CR4 resolved.** `specs/orchestrator-subagent-result-delivery/spec.md`
  gains a third requirement, "No new SendMessage-shaped instructions leak
  into Codex/OpenCode", with a before/after render scenario — i.e. an
  acceptance signal for AC4 that is exactly the check I just ran.
- **CR5 resolved.** design.md Decision 1 no longer claims the fact is
  "harness-independent regardless of whether a harness has spawn/suspend";
  it now records the round-1 finding and why the wording was changed.
  proposal.md's Codex/OpenCode paragraph likewise now says the shared prose
  *does* render into their docs and is deliberately worded to stay true,
  "rather than merely 'not making things worse' by accident".
- **Non-blocking notes from round 1 also addressed:** tasks.md 2.1 now
  carries the working `--config=config/examples/concertino.json --core=./core`
  invocation (I re-ran it; it works), and tasks.md §3 explicitly records
  AC3's non-coverage.
- **claude-code render still contains the substantive fix** (AC1/AC2/AC5):
  rendered `.claude/agents/concertino-orchestrator.md` line 126 —
  *"the executor/evaluator/skeptic/auditor have no `SendMessage` tool of
  their own and cannot address you… Every `Agent` spawn and every
  `SendMessage` resume is a single blocking call… its return value **is**
  the sub-agent's result"* — plus the CON-134 paragraph at lines 85–108 and
  the three reworded Phase 2 steps.

### Verdict: CONFIRM

All five round-1 change requests are resolved against the rendered output,
not merely asserted in prose. The harness-portability regression is gone by
measurement (codex 6→6, opencode 8→8, zero `SendMessage` tokens anywhere in
either delta), the shared paragraph no longer contradicts codex's own
`harnessResume` block, and the claude-code render retains the full
substantive fix. AC1/AC2/AC4/AC5 each trace to specific rendered text; AC3
is explicitly and honestly recorded as not mechanically verifiable.

### Non-blocking notes

1. **Artifact inconsistency to fix before archive:** `proposal.md`'s
   "Capabilities" section still reads *"### New Capabilities (none — no
   spec-level requirement changes)"* while the change now ships
   `specs/orchestrator-subagent-result-delivery/spec.md` with three ADDED
   Requirements (added in response to round-1 CR4). Not implementation-
   blocking, but the spec-sync/archive step reads the specs dir, so leaving
   the proposal saying "no spec changes" will read as a contradiction later.
   One-line fix: name the new capability there.
2. Residual, mild: the Phase 2 spawn paragraph's parenthetical *"and the
   sub-agent cannot send you one (see 'Harness resume model' above)"* is
   itself unqualified; it is saved only by the cross-reference to the now-
   carved-out paragraph. Acceptable as-is (codex's worker-dispatch path is
   explicitly optional and non-default, and the pointer is adjacent), but if
   a future edit ever separates these two sections, that sentence is the one
   that goes stale first.
3. design.md's "Risks" still flags the two-places-duplication drift risk
   between the shared paragraph and the claude-code `harnessResume` block.
   Round 2's fix deliberately keeps both (the shared one generic, the
   claude-code one tool-named), so that risk is now load-bearing rather than
   incidental — worth a comment in `lib/cli/render.js` pointing at the
   shared section, but not blocking.
4. tasks.md 1.1–1.3 and 2.1–2.2 are already marked `[x]` at the design gate
   because the working-tree edits pre-exist. Only 2.3 (`npm test`) remains —
   that is the executor's to run and the evaluator's to verify.
