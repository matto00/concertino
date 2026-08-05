## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth diff.** `git diff main...HEAD --stat` in
  `WORKTREE_PATH`: code changes are exactly `lib/ui/prompt.js` (+87/-2),
  `lib/ui/session.js` (+11/-6 — swaps its inline quoting for the extracted
  helper), and new `lib/ui/shquote.js` (+22), plus `test/prompt.test.js`
  (+124) and new `test/shquote.test.js` (+47). `lib/ui/harness.js`
  (`LAUNCH_TEMPLATES`, `harnessOfCommand`) and
  `lib/ui/screens/launchplan.js` are untouched — matches design.md's and
  files-modified.md's claims. Read the full diff, not just the stat.

- **Tests, freshly re-run by me** (not trusted from evaluation-2.md):
  `npm test` → `# tests 1428`, `# pass 1428`, `# fail 0`, exit 0. Matches
  evaluator's claim.

- **Implementation correctness, read directly:**
  - `inlinePromptIfNeeded()`/`TRAILING_PROMPT_RE` in `lib/ui/prompt.js`
    correctly anchor at the command's end, correctly no-op for a
    non-matching (operator-override) trailing argument, and call the new
    `shQuote` (single-quote escape, `'` → `'\''`) before splicing the
    inlined body back into the command — matches design.md Decisions 1–4a.
  - `adapters/codex/prompt.md` (4196 bytes) and `adapters/opencode/prompt.md`
    (2166 bytes) both exist and are read via `ADAPTERS`/`read` from
    `lib/cli/shared.js`, exactly as claimed.
  - Ran the frontmatter-stripping regex
    (`/^---\n[\s\S]*?\n---\n\n?/`) against the real
    `adapters/opencode/prompt.md` file myself in `node -e`: it correctly
    strips the YAML block and the stripped body starts with `"Run the
    Concertino..."` — the claimed OpenCode deviation (5.2) is real and
    correctly implemented, not just asserted.
  - `lib/ui/harness.js`'s `LAUNCH_TEMPLATES` is byte-identical to before
    (confirmed by inspection — not present in the diff at all).

- **AC #1** ("delivery instructions in first message, verified from a real
  run's scrollback... run `setup-worktree.sh` before anything else"):
  traced to `tasks.md` 3.2's cycle-1 real-run scrollback (the model reads
  `.codex/roles/concertino-orchestrator.md`, `setup-worktree.sh`,
  `workflow-state.template.md`, quoting real error strings from
  `setup-worktree.sh` back — decisive proof of content, not guessed) plus
  `test/prompt.test.js`'s pinned-content assertions I read directly. Met.

- **AC #3** ("Covered by a test that pins whatever the launch string
  becomes"): `test/prompt.test.js` (codex/opencode content+quoting
  assertions, provider-flag-decorated variant, operator-override no-op,
  real `sh -c` round-trip) and `test/shquote.test.js`. Met, and I ran them.

- **AC #4** ("Re-check the same assumption for OpenCode"): `tasks.md` 5.1
  records execution-confirmed evidence (`opencode --prompt` verified via
  `/proc/<pid>/cmdline` and `opencode export` showing `"messages": []` —
  the flag has *no effect at all*, an even more definitive gap than
  Codex's). 5.2 extends `PROMPT_INLINE_HARNESSES` to include `opencode`
  and I confirmed the code does this (`new Set(['codex', 'opencode'])` in
  `lib/ui/prompt.js`). Met.

- **AC #2** ("A run reaches `run.start` and appears on the dashboard") —
  independently investigated per the human's explicit flag, not taken on
  either the executor's or evaluator's word:
  - Confirmed the underlying infra claim myself: `codex mcp list` in this
    environment prints "No MCP servers configured yet"; `codex login
    status` confirms a real logged-in ChatGPT session is available. Both
    match tasks.md's cycle-2 account exactly.
  - Confirmed `core/roles/orchestrator.md`'s actual Setup section (read
    directly, lines 112–156): step 1 is "Fetch the ticket... Linear's
    `get_issue`/`mcp__linear__get_issue`", step 3 is
    `setup-worktree.sh`. So a standalone `codex` spawn with no MCP
    configured genuinely cannot complete Setup step 1 today, and
    `setup-worktree.sh` (step 3, which is what fires `run.start`) is
    unreachable through the *documented* Setup sequence without it. This
    part of the executor's/evaluator's reasoning is factually accurate,
    not hand-waved.
  - However: `codex mcp list`'s own message ("Try `codex mcp add my-tool
    -- my-command`") shows `codex mcp add` is available in this exact
    environment. A minimal stub MCP server exposing a `get_issue`-shaped
    tool that returns a canned ticket, wired via `codex mcp add`, run
    against an *isolated scratch clone* (which would also remove the
    live-worktree-collision risk that is the specific, sound reason
    cycle 2 was stopped) was not attempted. Design.md dismisses "a
    genuinely isolated target (a scratch git clone...)" as "more
    machinery than this verification gap warrants" — but does not
    mention or rule out the stub-MCP route, which is the piece that
    actually unblocks Setup step 1, not just the worktree-collision
    concern. This is a real, present gap in what was tried, not merely a
    documented impossibility.
  - Net: AC #2 is *argued for* (unmodified `run.start` call site + cycle
    2's qualitatively-more-agentic real-model trajectory + a real,
    verified infra constraint) but not demonstrated. No
    `.concertino/runs/<TICKET>/` directory, no `events.jsonl` `run.start`
    entry, no dashboard screenshot/listing exists anywhere in this change
    for a Codex or OpenCode launch produced by this fix. I looked for one
    (`find` under `.concertino/runs`, `git status`) and found none tied to
    this change.

### Verdict: REFUTE

The code itself (content-delivery, quoting safety, operator-override
no-op, OpenCode parity, regression tests) is correct, well-reasoned, and
independently re-verified above — I have no objection to any of it. The
sole issue is AC #2, which the ticket lists as a separate, required,
observable bullet ("a run reaches `run.start` and appears on the
dashboard") — not a restatement of AC #1. Per this role's own charter, an
AC that cannot be traced to real evidence is not met. Documentation of
*why* it wasn't verified, however thorough and honest (and this is
unusually thorough and honest — cycle 2's evidence is real, not
fabricated, and the evaluator was right to credit it as genuine
remediation effort), is not itself evidence the AC holds. A materially
less machinery-heavy path than the one design.md rejected (stub MCP
server + scratch clone, addressing the actual blocker — Setup step 1's
ticket fetch — rather than only the worktree-collision risk) was not
attempted, and this specific ticket exists precisely because a prior,
plausible-sounding belief ("Claude Code's slash form works, so codex's
probably does too") turned out to be wrong under real execution. Closing
AC #2 by inference from a different, if analogous, mechanism repeats the
same shape of risk this ticket was opened to correct — self-consistent
reasoning that has not yet been tested against the one thing (a Codex
process actually reaching `setup-worktree.sh` and firing `run.start`)
CON-77 originally observed as broken for this harness.

### Change Requests

1. Close AC #2 with real evidence before delivery, via one of:
   (a) Configure a minimal stub MCP server for `codex`
       (`codex mcp add`, confirmed available in this environment) that
       serves a canned `get_issue`-shaped response, and re-run the cycle-2
       verification against an *isolated scratch clone* (not this live
       `con-79` worktree, removing the collision risk that stopped cycle
       2) all the way through an actual `setup-worktree.sh` invocation and
       a `run.start` line in that clone's `.concertino/runs/<TICKET>/`
       (or equivalent `events.jsonl` entry) plus a dashboard listing. This
       directly answers the one open link in the current reasoning chain
       (does a real Codex model, given the correctly-inlined prompt,
       actually invoke `setup-worktree.sh` as a tool call) without the
       risk the executor correctly avoided.
   (b) If (a) is judged disproportionate for this ticket's size, obtain
       the human's explicit, on-record approval narrowing AC #2's scope
       for CON-79 specifically (e.g., "trust the unmodified `run.start`
       call site plus cycle-2's evidence; do not require a demonstrated
       run for this ticket") — recorded as a decision in `ticket.md` or
       the change's own record, not authored unilaterally by the
       executor/evaluator inside `design.md` prose. The current
       resolution effectively performs this narrowing without asking.

### Non-blocking notes

- `specs/delivery-prompt-expansion/spec.md`'s five requirements cover
  content-delivery, the operator-override no-op, shell-safety, and
  Claude Code's unaffected shape — none of them assert anything about
  `run.start`/dashboard-visibility. That is consistent with the
  content-delivery-only scope design.md settles on, but is itself a
  visible trace of the AC #2 narrowing worth having a human eyes-on for
  (see Change Request 1(b)).
- Everything else in this change — the `shQuote` extraction/reuse, the
  quoting-safety reasoning (Decision 3), the Decision 4a
  operator-override no-op, the real `sh -c` round-trip tests, the honest
  and unusually rigorous documentation of the AC #2 gap itself — is
  genuinely good work and does not need to change.
