## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket/spec re-read cold**: read `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/orchestrator-turn-discipline/spec.md` from scratch (not
  the executor's/evaluator's narrative).

- **`core/roles/orchestrator.md` diff** (`git diff main...HEAD -- core/roles/orchestrator.md`):
  read the full resulting file. Confirmed:
  - The "Harness resume model" preamble (lines 13-33) explains, not just
    asserts, the top-level-vs-sub-agent asymmetry with the causal mechanism
    (a suspended sub-agent is never externally resumed; its children die with
    it) and names the CON-10 incident concretely — satisfies "explained, not
    asserted, survives paraphrase."
  - All five spawn/resume points carry a local reminder, read directly in
    context (not summarized): Phase 1 skeptic design-gate spawn (:132-136),
    Phase 2 Cycle-1 executor/evaluator spawns (:181-185), Phase 2 Cycle-2+
    resumes (:196-206), and the final skeptic gate incl. its REFUTE-path
    executor resume (:224-238). Each restates the free-vs-fatal distinction
    and the fallback locally — legible in isolation, not merely
    cross-referencing the preamble.
  - A concrete fallback (poll for the report path / new commit, or escalate)
    is present at every one of those five points — no "undefined" case left.

- **`bin/concertino`'s actual rendered `harnessResume` text** (the trap named
  in the task): read `git diff main...HEAD -- bin/concertino` directly. The
  `claude-code` string literal (the one byte-identical to what a real
  orchestrator's system prompt contains) was edited to add the same
  turn-boundary explanation and fallback — not just the neutral template
  around it. Confirmed by regenerating: ran `node bin/concertino sync` myself
  in the worktree and read the resulting
  `.claude/agents/concertino-orchestrator.md:38-62` — it contains both the
  template's preamble prose (from `core/roles/orchestrator.md`) *and* the
  `harnessResume`-block text (from `bin/concertino`), i.e. the fix landed in
  the file a real orchestrator session actually reads. `git status --short`
  after the sync shows no diff (`.claude/agents/*` is gitignored), so this
  regeneration didn't dirty tracked state.

- **Codex honesty check**: read `adapters/codex/prompt.md` directly — the
  default flow is "sequentially in a single thread, playing each role from
  `AGENTS.md` in turn," with no `Agent`/dispatch call anywhere — confirms
  there is genuinely no spawn/suspend boundary in the default path, so the
  ticket's claim is not overclaimed. Read `adapters/codex/header.md` diff:
  the added note (lines 16-28) states plainly why the default flow is immune
  and separately documents the optional `spawn_agents_on_csv` worker-dispatch
  path as carrying the identical risk if used, cross-referencing
  `docs/harness-capabilities.md` — proportionate, not overclaimed or omitted.
  `bin/concertino`'s `codex` branch was also updated with the same
  distinction (read directly in the diff).

- **`docs/harness-capabilities.md`**: read the full file post-diff. The new
  "Harness-behavior fact" section (lines 76-117) states the constraint
  consistently with the role/adapter files: same top-level-vs-nested
  distinction, same CON-10 reference, and a Codex-finding paragraph that
  agrees word-for-word in substance with `adapters/codex/header.md`'s note.

- **AC-by-AC trace against `specs/orchestrator-turn-discipline/spec.md`**:
  1. Turn-boundary rule stated plainly — `orchestrator.md:15-33`. Met.
  2. Explained not asserted — same lines, causal mechanism + CON-10 example. Met.
  3. Repeated at each of the 5 spawn/resume points — verified directly, listed above. Met.
  4. Explicit fallback (poll artefact / escalate) at every point — verified. Met.
  5. Codex path checked, default flow confirmed boundary-free, optional
     worker-dispatch risk documented — verified in `prompt.md`/`header.md`. Met.
  6. `docs/harness-capabilities.md` records the constraint, consistent with
     role/adapter text — verified. Met.

- **Scope**: `git diff main...HEAD --stat` touches exactly the four files
  named in the proposal's Impact section plus the expected openspec
  change-dir artifacts. `adapters/codex/prompt.md` correctly left untouched
  (matches the design's finding that no gap exists there — confirmed by
  reading the file, not trusting the claim).

- **Tests**: ran `npm test` myself fresh (not trusting the evaluator's pasted
  output). Output ends with `ℹ fail 0` and per-suite `N passed, 0 failed`
  lines across all suites (assert-phase/start-servers/cleanup ticket-id
  pattern, gate rendering, dashboard, escalation loop, `concertino doctor`,
  etc.); exit code 0. Green.

- **UI**: N/A per task instructions — this project has no UI configured
  (`ui.enabled: false`), and this change is prose-only with no runtime
  behavior to screenshot.

- **Planning-artifact honesty**: the design-gate skeptic (`skeptic-design-1.md`)
  CONFIRMed the plan; the evaluator's `evaluation-1.md` PASSed on both spec
  and code review. Both reports' specific claims were independently
  re-verified above rather than taken on trust — they check out.

### Verdict: CONFIRM

### Non-blocking notes
- The design-gate skeptic flagged that task 3.3's target ("`header.md` (or
  the toml template's generated comment, whichever a Codex reader actually
  sees)") is an either/or, and the executor landed the caution only in
  `header.md`, leaving `adapters/codex/agent.toml.tmpl` untouched. This
  satisfies the ticket's AC (the Codex path is checked and the finding
  documented in the reader-facing prompt file), but if the optional
  `spawn_agents_on_csv` worker-dispatch path is ever actually adopted, it
  would be worth adding the same one-line caution to the toml template's
  generated comment too, since a reader who only inspects a rendered
  `.codex/agents/*.toml` in isolation wouldn't see `header.md`'s note.
