## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/agent-merge/spec.md`, and `skeptic-design-1.md` fresh, in full.
- **Round-1 Change Request 1 (main-checkout resolution) — verified fixed
  against the actual codebase:**
  - `scripts/concertino/check-merge-readiness.sh` (lines 74-87) really does
    carry the exact `main_checkout()` helper design.md Decision 2 cites:
    `git rev-parse --git-common-dir` from `$WORKTREE_PATH`, with a comment
    explicitly noting it is "Duplicated from emit-event.sh's main_checkout()
    rather than sourced — every procedure script in this suite stays
    standalone." Decision 2's revised text describes this helper verbatim
    and correctly.
  - `lib/cli/doctor.js:238` (`const out = path.resolve(args.out || '.')`)
    confirms Decision 2's claim that doctor's call site already passes the
    main checkout (cwd), so `main_checkout()` resolves trivially there — not
    an unverified assumption.
  - design.md, tasks.md (1.2, 1.4), and `specs/agent-merge/spec.md` are now
    mutually consistent: all three say the script resolves the main checkout
    from `$WORKTREE_PATH` and reads `<main_checkout>/.claude/settings.json`,
    never `$WORKTREE_PATH/.claude/settings.json` directly. This is a
    substantive fix, not a narrative one — the previous version's mechanism
    would have `FAIL`ed on every run; this version's mechanism, checked
    against the actual helper it borrows, works from a worktree.
- **Round-1 Change Request 2 (harness gate) — verified fixed against the
  actual codebase:**
  - `lib/cli/render.js:32` really has a `block(name, c, harness)` function
    with a `switch (name)` dispatch, and a real `case 'harnessResume':`
    (line 145) that returns different prose per `harness` value
    (`'codex'`, `'opencode'`, default `claude-code`) — exactly the pattern
    design.md Decision 3's revision claims to follow, verified by reading
    the actual case body, not just its existence.
  - `renderBody()` (line 160) replaces `{{block:([a-zA-Z]+)\}\}` — a
    hypothetical `{{block:agentMergePermissionCheck}}` placeholder matches
    this regex (all-letters name), so the mechanism tasks.md 4.1 describes
    (adding a new `case 'agentMergePermissionCheck':` alongside
    `harnessResume`) is mechanically valid against the real function.
  - Re-confirmed the underlying problem the round-1 REFUTE found is real:
    `core/workflow-state.template.md` (read in full, 47 lines) has no
    `HARNESS`/`harness` field, and `core/roles/orchestrator.md`'s Setup step
    6 (line 180-186) — which explicitly enumerates every field carried into
    the initial `workflow-state.md` write — still does not include
    `harness`/`harness_source`, even though step 3 (line 161-168) does parse
    `harness=`/`harness_source=` from `setup-worktree.sh`'s `READY` output.
    So the round-2 fix (sync-time block, not a runtime field) is solving a
    genuine gap, not a strawman, and does so without inventing new persisted
    state.
  - Aside (not a defect in the artifacts under review): this worktree's own
    live `workflow-state.md` for this very CON-88 delivery run happens to
    carry a `HARNESS: claude-code` line that isn't part of
    `core/workflow-state.template.md` or written by any Setup-step-6 write
    list in this worktree's `orchestrator.md`/the main checkout's rendered
    `.claude/agents/concertino-orchestrator.md`. This is external to the
    planning artifacts (some other invocation wrote it) and doesn't affect
    the design under review either way — noting it only so it isn't
    mistaken for evidence that a `HARNESS` field already exists in the
    template; it doesn't.
- Cross-checked other load-bearing design claims against ground truth:
  - `lib/config.js:171-174` — `c.agentMerge = Object.assign({enabled: false,
    mergeMethod: 'squash'}, ...)` confirms `cfg.agentMerge.enabled` is a real
    config key with the default Decision assumes.
  - `lib/config.js:546-570` — "Providers" section (`sec('Providers')`) and
    the `ok/warn/fail` helper shapes are real and match what Decision 5
    assumes for the new "Agent-merge" section placed after it.
  - `lib/cli/doctor.js:88` (`checkBaseBranch`) and `:194`
    (`checkOllamaProvider`) — real functions matching the `execSync`-based
    shell-out pattern and degrade-safely-on-failure posture Decision 2/4
    cite as precedent.
  - `docs/config-reference.md` — `## budgets` (line 249) immediately
    followed by `## providers` (line 265) — confirms Decision 6's placement
    instruction ("after `## budgets`, before `## providers`") is a real,
    unambiguous slot.
  - `README.md:33` — the existing one-line agent-merge description quoted in
    Decision 6 ("opt-in toggle... that replaces the fourth checkpoint")
    matches verbatim.
  - `core/roles/orchestrator.md`'s "How to raise one" section (line 728+)
    confirms the generic `question=`/`options=` escalation mechanism design.md
    Decision 3 relies on is real, and that non-binary option sets
    (`options=fold-in,standalone,discard` at line 467) are already precedent
    for a custom `options=retry,fallback` pair.
  - `core/workflow-state.template.md:47` confirms `PENDING_ESCALATION.kind`
    is a closed enum including `blocker`, matching Decision 3's explicit
    resolution of the round-1 non-blocking note about which `kind` to use.
  - `test/scripts/check-merge-readiness.test.sh` confirms the `ok/bad/check/has`
    helper shape and `new_repo`-style isolation tasks.md 1.4 says to mirror
    are real, not invented.
- Ran `openspec validate agent-merge-permission-preflight --strict` fresh:
  `Change 'agent-merge-permission-preflight' is valid`.
- Grepped the whole change dir for `TODO|TBD|FIXME|figure out later`: no
  matches — no placeholders or deferred decisions.
- Traced all four ticket ACs to concrete design/tasks/spec coverage:
  AC1 (doctor/validate warning) → Decision 5, tasks 3.1-3.3, spec.md
  "doctor and validate warn..."; AC2 (ask before spawn) → Decision 3/4,
  tasks 4.1-4.4, spec.md orchestrator requirement; AC3 (docs) → Decision 6,
  tasks 5.2/5.3; AC4 (fallback unchanged) → spec.md's "MODIFIED
  Requirements" section, explicitly including the new fallback-from-missing-
  grant path landing on the identical flow. No AC left uncovered, no task
  without a corresponding AC/decision.

### Verdict: CONFIRM

Both round-1 required revisions are genuinely fixed, not just narrated as
fixed — I re-derived each one independently against the actual files in this
worktree (the real `main_checkout()` helper body, the real `block()`
function and its `harnessResume` case, the real absence of a `harness` field
in the template) rather than trusting design.md's own "Correction after
design-gate round 1 REFUTE" prose. The design is internally consistent
across proposal/design/tasks/spec, traces cleanly to every acceptance
criterion, discloses its one genuinely unverifiable risk (the exact
`Task(concertino-auditor)` permission-rule syntax) honestly with a sound
degrade-safely fallback, and `openspec validate` passes. Sound enough to
implement.

### Non-blocking notes

- The `Task(concertino-auditor)`/`Bash(gh pr merge:*)` rule-string risk
  (Decision 1) remains genuinely unverifiable in this environment, as
  design.md itself says. Nothing to change here now — the design's own
  Non-Goals section already scopes this correctly and the orchestrator's
  pre-check degrades safely if the syntax turns out to be wrong — but this
  is the one part of the change execution should watch for and be ready to
  correct in a fast follow-up if live Claude Code behavior disagrees.
- Consider (not required) folding a brief mention of the stray `HARNESS:
  claude-code` line observed in this run's own `workflow-state.md` into a
  future ticket if it turns out some other code path is already writing a
  field this template doesn't define — outside this change's scope, just a
  loose thread worth a mental bookmark.
