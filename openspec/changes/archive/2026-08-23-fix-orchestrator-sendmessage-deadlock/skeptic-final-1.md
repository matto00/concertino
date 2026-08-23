## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below derives from the actual diff, the actual
committed content, fresh renders, and a full `npm test` run — not from
`evaluation-1.md` or the prior design-gate skeptic rounds.

### What I verified (with evidence)

- **Diff scope.** `git diff origin/main...HEAD --stat` on `be6eac7`: exactly two
  code files touched — `core/roles/orchestrator.md` (+69/-17 region) and
  `lib/cli/render.js` (1 line). Everything else in the diff is the change dir's
  own artifacts (proposal/design/tasks/ticket/spec delta/skeptic-design-1,2/
  files-modified/workflow-state/.openspec.yaml). No unrelated files, no stray
  debug code, no leftover cruft. `git status --porcelain` shows one untracked
  file, `evaluation-1.md` (the evaluator's own report) — non-blocking.

- **Factual premise of the fix (independently checked).** Parsed
  `adapters/claude-code/agents.json`: `SendMessage` is granted to `orchestrator`
  only; `executor`, `evaluator`, `skeptic`, `auditor` all have neither
  `SendMessage` nor `Agent`. The doc's central assertion — sub-agents cannot
  address the orchestrator — is true against ground truth, not just asserted.

- **AC1 — rendered claude-code doc states the no-inbound-channel fact.** Fresh
  render into a tmpdir:
  `node bin/concertino sync --config=config/examples/concertino.json --core=./core --harness=claude-code,codex,opencode --out=<tmp>` (exit 0).
  `.claude/agents/concertino-orchestrator.md:126` now reads, in the
  `harnessResume` block: "`SendMessage` here is a call **you** make **to** an
  already-spawned sub-agent to resume it, not a channel it can use to reach you
  — the executor/evaluator/skeptic/auditor have no `SendMessage` tool of their
  own and cannot address you… its return value **is** the sub-agent's result —
  there is no further report to wait for after that." AC met.

- **AC2 — phase steps instruct consuming the return value + artifact fallback.**
  Read the rendered doc's Phase 2 spawn block, cycles-2+ resume block, and
  final-gate skeptic spawn. All three were reworded from "wait for it to return"
  to "single blocking call — issue it and consume its return value directly",
  and each now extends the fallback trigger from *harness-cannot-wait-inline*
  only to "**or you otherwise find yourself not holding a result**" → poll the
  commit / read the report file / escalate, with an explicit "never end the turn
  believing one is still on its way". AC met.

- **AC3 — a completed sub-agent whose result isn't held ends in inspection, not
  a silent stop.** Traced to the new "Harness resume model" paragraph
  (`core/roles/orchestrator.md`, rendered at claude-code lines 87–109): the
  not-holding-a-result case (explicitly including re-entry "after a compaction
  or a gap") is directed to "inspect the worktree directly — the sub-agent's
  report file, new commits on the branch, `workflow-state.md` — and report what
  you find." This is a doc-only ticket; that instruction is the deliverable and
  it exists verbatim in the rendered artifact. AC met to the extent a role-doc
  change can be.

- **AC4 — harness portability, no `SendMessage` leak.** I did the baseline-vs-
  modified render myself rather than trusting skeptic-design-2: cloned the repo
  at `6f5837a` (the parent commit / origin/main tip), rendered all three
  harnesses to a second tmpdir, `diff -rq` across the trees. Only the three
  orchestrator files differ; every other rendered file is byte-identical.
  Diffing the codex and opencode orchestrator renders line-by-line: the added
  text is the harness-neutral CON-134 paragraph plus the reworded spawn/resume/
  skeptic paragraphs — **zero occurrences of `SendMessage` added**. `grep -rn
  SendMessage` over `.codex/` and `.opencode/` returns only pre-existing hits
  (the escalation-relay sections and the executor's "warm SendMessage on Claude
  Code" note), all unchanged from baseline. The new paragraph also self-limits
  ("see the harness-specific notes below for any such exception, e.g. Codex's
  optional worker-dispatch path"), so it does not contradict either harness's
  own sequential-single-thread `harnessResume` block. AC met.

- **AC5 — verified against the real rendered file, not just `core/`.** All of
  the above was read out of the freshly rendered
  `.claude/agents/concertino-orchestrator.md` / `.codex/roles/…` / `.opencode/
  agents/…`, never out of `core/roles/orchestrator.md` alone. AC met.

- **Gate: `npm test`.** Ran to completion myself (first attempt hit my own 2-min
  tool timeout — re-ran with a longer timeout rather than concluding anything
  from the truncated run). Exit code 0; the suite's per-file summaries all read
  `N passed, 0 failed`; grepping the full output for failure markers surfaced
  only test *titles* containing the word "FAILED" (dashboard fleet-view state
  tests), each on an `ok` line. No failures.

- **Does it actually fix the CON-134 pattern?** The deadlock was the orchestrator
  ending a turn while reasoning it was "still waiting" for a sub-agent report.
  The change attacks that at all three sites where the old prose was compatible
  with the wrong model: it (a) states the mechanism is a blocking call whose
  return value *is* the result, (b) names the specific faulty reasoning ("if you
  ever catch yourself reasoning that you are 'still waiting' on a sub-agent
  whose spawn/resume call has already returned … that reasoning is the bug"),
  and (c) makes artifact inspection unconditional rather than gated on harness
  inability. I grepped the rendered claude doc for residual message-waiting
  phrasings ("wait for a message", "until it reports back", "its report
  arrives") — none remain. This is a coherent, complete fix for the documented
  failure mode.

- **UI section: N/A.** No frontend surface in this repo change (two files, both
  role-doc/renderer). No servers started, per scope.

### Verdict: CONFIRM

### Non-blocking notes

- `evaluation-1.md` is untracked while `skeptic-design-1.md`/`-2.md` are
  committed. Cosmetic inconsistency in artifact bookkeeping; sweep it in at
  archive.
- On codex/opencode the new generic paragraph speaks of "the call you use to
  spawn or resume", while those harnesses' default path has no such call (they
  switch roles in one thread). The paragraph's own parenthetical and the
  harness-specific block below it resolve the tension, and the baseline prose
  had exactly the same shape — so this is not a regression. CON-135's
  cross-harness parity work is the right place to tighten it.
