## Skeptic Report — final gate (round 2)

### What I verified (with evidence)

- **Ground truth diff, re-derived from scratch.** `git diff main...HEAD --stat`
  in `WORKTREE_PATH`: identical `lib`/`test` footprint to round 1
  (`lib/ui/prompt.js` +87/-2, `lib/ui/session.js` +11/-6, new
  `lib/ui/shquote.js` +22, `test/prompt.test.js` +124, new
  `test/shquote.test.js` +47). `git show 1d06a57 --stat` (the cycle-3 commit)
  confirms it touched **only** `design.md`, `tasks.md`, `files-modified.md`,
  `evaluation-2.md`, `skeptic-final-1.md`, `workflow-state.md` — zero `lib`/
  `test` drift since round 1. Re-read `lib/ui/prompt.js` and
  `lib/ui/shquote.js` in full myself (not from the round-1 report): the
  `TRAILING_PROMPT_RE`-anchored no-op for operator overrides, the `shQuote`
  single-quote/`'\''` escape, and `inlinePromptIfNeeded()`'s placement as the
  last step before `session.spawn()` are all as previously verified. `git diff
  main...HEAD -- lib/ui/harness.js lib/ui/screens/launchplan.js` is empty —
  `LAUNCH_TEMPLATES` genuinely untouched.

- **Tests, freshly re-run by me.** `npm test` → `# tests 1428`, `# pass
  1428`, `# fail 0`, exit 0. Also ran `node --test test/prompt.test.js
  test/shquote.test.js` directly: `35/35` pass, including the real `sh -c`
  round-trip regression tests.

- **AC #1, #3, #4** (content-delivery, pinned-test coverage, OpenCode parity)
  — re-traced independently to the same code/tests round 1 verified; no
  regression since. Still met.

- **Item 1 — no path-(b) scope-narrowing prose surviving as the operative
  resolution.** `grep -n -i "path-(b)\|scope-narrow\|narrowing"` across
  `design.md`, `tasks.md`, `spec.md`, `files-modified.md`: the only
  occurrences in `design.md`/`tasks.md` are explicitly historical
  ("...that language is superseded and removed here"; "the path-(b)
  scope-narrowing conclusion cycle 2 drew from this evidence was explicitly
  declined by the human... and has been removed from `design.md`") — i.e.
  they document that the narrowing was rejected, they do not restate it as
  current guidance. `files-modified.md` likewise frames it as
  "replaced with." Confirmed: no live path-(b) narrowing language remains as
  the actual resolution anywhere in `design.md`, `tasks.md`, or `spec.md`.

- **Item 3 — does the stub-MCP evidence satisfy AC #2, my judgment call.**
  Read `design.md`'s Goals section and `tasks.md` 3.2's cycle-3 entry in
  full. The mechanism (stub MCP server exposing
  `mcp__linear__get_issue`/`save_issue`, registered via a runtime `-c`
  override, routed through the **real** `createLauncher().launch()` →
  `submitTicket()` → `session.spawn()` production path, against an isolated
  `/tmp` scratch clone) only substitutes for Setup step 1's ticket-fetch —
  an environmental gap (no MCP server configured in this account) that is
  unrelated to CON-79's own bug and does not touch any of the code this
  change modifies. The claimed `run.start` JSON line is internally
  consistent with `lib/ui/reducer.js`'s actual `case 'run.start':` handler,
  which I read directly (lines 82-106): it reads exactly `branch`,
  `worktree`, `dev_port`, `backend_port`, `harness`, `speed`, `provider`,
  `models` — precisely the fields the recorded event carries — and this
  handler is unmodified by this diff and already the path every other
  harness's dashboard rendering goes through. The doc's own phrasing here is
  appropriately hedged ("confirming a dashboard pointed at this project
  *would* render this run correctly" — inferred from code, not claimed as an
  observed screenshot). Given the event capture is genuine (see corroboration
  below) and the rendering path is generic/unmodified/already-proven, I judge
  this a sufficient, honestly-labeled closure of AC #2 — requiring a literal
  live dashboard screenshot on top of this would be disproportionate
  additional machinery for marginal confidence. This satisfies the human's
  "invest in real verification" direction for the `run.start` half; the
  dashboard-rendering half is a reasonable, clearly-labeled inference over
  unmodified, already-verified code.

- **Item 2 — independent check for persisted Codex config changes, per my
  explicit task.** This is where I found a real, verifiable discrepancy:
  `tasks.md`'s cycle-3 entry states "no persisted Codex config file was
  modified anywhere... confirmed... `~/.codex/config.toml` and this
  worktree's own (gitignored) `.codex/config.toml` are unchanged from
  before this cycle." I read `~/.codex/config.toml` directly myself:

  ```toml
  [projects."/tmp/claude-1000/-home-matt-Development-concertino/546a35b8-5ab7-4030-a807-9bf87e03d1a6/scratchpad/con79-scratch/con79-verify-clone"]
  trust_level = "trusted"
  ```

  This entry is real and persisted — `stat ~/.codex/config.toml` shows it
  was last modified `2026-08-04 20:40:20`, 7 minutes before cycle 3's commit
  timestamp (`20:47:33`), and the referenced path is exactly the scratch
  clone `con79-verify-clone` tasks.md describes as having been deleted after
  cleanup — confirmed deleted (`ls` on that path: "No such file or
  directory"). This is a normal Codex CLI side effect (a directory-trust
  prompt gets cached to the user-level config the first time `codex` runs
  somewhere new) — unrelated to the MCP-override mechanism specifically
  (`codex mcp list` does correctly show no persisted MCP servers, so that
  narrower claim holds) — but it directly contradicts the broader, explicit
  written claim that `~/.codex/config.toml` is "unchanged from before this
  cycle." That claim is false as written. (Positive side-effect of this
  finding: the entry's session-ID-prefixed scratchpad path is independent,
  physical corroboration that a real verification session did happen against
  a real scratch clone at roughly the claimed time — it is not fabricated
  prose.)

- **Item 4 — spec.md re-traced.** All five requirements (content-delivery,
  operator-override no-op, shell-safety round-trip, Claude Code untouched,
  OpenCode conditional parity) map 1:1 to code/tests I re-verified above. No
  requirement mentions `run.start`/dashboard — consistent with that being an
  integration-level AC about the (unmodified) event/render pipeline rather
  than new behavior this spec governs.

- **Process note (not a defect, recorded for completeness):** there is no
  `evaluation-3.md` reviewing cycle 3's diff specifically — `workflow-state.md`
  still shows `LAST_EVAL_REPORT: evaluation-2.md` (cycle 2). Since cycle 3's
  diff touches only documentation (`design.md`/`tasks.md`/`files-modified.md`),
  and I independently re-ran the full test suite and re-diffed `lib`/`test`
  myself and found them byte-identical to what evaluation-2.md already
  reviewed, I don't treat the missing evaluation-3.md as a gap in the code
  verification itself — but it does mean the config.toml/dashboard-inference
  issues below were never checked by anyone before reaching this gate.

### Verdict: REFUTE

The code (content-delivery, quoting safety, operator no-op, OpenCode parity,
regression tests) is unchanged from round 1 and remains correct — no
objection to any of it. AC #2's `run.start` closure is, in my judgment,
genuinely and sufficiently demonstrated (not merely argued) this round,
closing round 1's primary gap. The remaining, narrower issue is that
`tasks.md`'s own evidentiary record contains one specific, checkable claim
that is false: `~/.codex/config.toml` was NOT unchanged by this cycle's
verification work. Given this exact ticket's history (two prior rounds
turning on the difference between asserted and demonstrated evidence, and the
human's explicit instruction to invest in real, checkable verification), a
false "confirmed unchanged" claim in the committed record — caught by doing
exactly the independent check my task instructions asked for — is not
something to wave through, even though it does not implicate the shipped
code at all.

### Change Requests

1. Correct `tasks.md`'s cycle-3 evidence entry (the "Cleanup" paragraph) and
   `design.md`'s parallel claim: remove or soften "`~/.codex/config.toml`...
   [is] unchanged from before this cycle." Replace with an accurate
   statement, e.g.: no MCP-server config was persisted (still true — `codex
   mcp list` shows none), but a directory-trust entry
   (`[projects."<scratch-clone-path>"]`, `trust_level = "trusted"`) was
   added to `~/.codex/config.toml` as an incidental, expected side effect of
   opening a new directory with `codex`, referencing the now-deleted scratch
   clone path.
2. Either clean up the stray `~/.codex/config.toml` entry (this is a
   home-directory system file — do not remove it without the human's
   explicit "Approved," per this repo's file-system-permissions rule) or
   explicitly note in the same paragraph that it was left in place as
   harmless residue and why (references a deleted, non-reusable `/tmp` path;
   poses no risk). Either is acceptable — the record just needs to be
   accurate rather than asserting something demonstrably false.

### Non-blocking notes

- The "appears on the dashboard" half of AC #2 remains an inference over
  unmodified, already-proven `reducer.js` code rather than a literally
  observed dashboard render — honestly labeled as such in `design.md`. I
  judge this sufficient (see Item 3 above) and don't require a further live
  dashboard capture; flagging only so a future reader knows this was a
  deliberate proportionality call, not an oversight.
- Everything else about cycle 3's remediation — routing through the real
  production launch path, the stub-MCP mechanism itself, the isolated
  scratch clone removing cycle 2's collision risk, the genuine observed
  `run.start`/`gate.result`/`phase.enter` sequence read directly off disk —
  is exactly the kind of hard evidence round 1 asked for and is good,
  credible work.
