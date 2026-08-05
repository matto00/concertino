## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL

Issues:

1. **AC #2 ("A run reaches `run.start` and appears on the dashboard") is not verified by any evidence, and AC #1's own parenthetical ("it should run `setup-worktree.sh` before anything else") is only partially demonstrated.** The real-run evidence recorded in `tasks.md` (task 3.2, lines 70-116) proves the model's first message now contains the actual `adapters/codex/prompt.md` body (the model opened `.codex/roles/concertino-orchestrator.md`, `setup-worktree.sh`, and `workflow-state.template.md` via `Read` tool calls, quoting real error strings back — decisive proof the content reached it). That is solid evidence for the *content-delivery* half of the bug.

   However, the same evidence explicitly states the model "then wrote a 'here's what you'd run' explanation instead of actually invoking `setup-worktree.sh` as a tool call." That means, in the executor's own recorded run: `setup-worktree.sh` was never actually executed, `run.start` (emitted by `setup-worktree.sh` itself per `scripts/concertino/setup-worktree.sh:361`) was never fired, and no run ever reached the dashboard. There is no other evidence file, scrollback excerpt, or events.jsonl capture anywhere in the change directory (checked `openspec/changes/fix-codex-prompt-expansion/` — no artifacts beyond the planning docs) showing `run.start` firing or a run appearing on the dashboard for a Codex (or OpenCode) launch after this fix.

   `design.md`'s own Goals section (lines 49-63) quietly narrows scope to "every non-interactive Codex launch carries the actual delivery instructions in its first message" — it never states a goal or explicit rationale for why AC #2 is not independently verified/verifiable, which is exactly the "AC silently reinterpreted" case this checklist flags. The ticket's own "Confirmatory test" section anticipates a weak model *not* proceeding to invoke the tool, and calls that a separate, model-capability concern — but that concession lets you correctly attribute the *reasoning* failure to something else; it does not substitute for the actual AC #2 evidence the ticket explicitly lists as a required, separate bullet.

   **Requested action:** either (a) capture real `run.start` + dashboard-appearance evidence — via a model capable of actually invoking `setup-worktree.sh` as a tool call (not just reading it), through the real `launcher.launch()`/`session.spawn()` path rather than the scratch-tmux mirror — or (b) if no such model/credentials are available in this environment, add an explicit note to `design.md`/`tasks.md` recording that constraint and the substitute reasoning for why the fix should be trusted to satisfy AC #2 once a capable model is used (e.g., "setup-worktree.sh's `run.start` emission is pre-existing, unmodified code, identical to the call site Claude Code's already-working launches drive today; this change only alters what content reaches the model's first message, which is now verified byte-identical in shape to Claude Code's own working path"). Silently dropping the bullet from the design doc's Goals list without either is the issue, not the underlying difficulty of the AC itself.

All other Phase 1 items pass:
- [x] AC #1 (content-delivery), #3 (test coverage), #4 (OpenCode re-check) are all explicitly, thoroughly addressed with real evidence (tasks.md 3.1-3.2, 5.1-5.2) and tests (`test/prompt.test.js`, `test/shquote.test.js`).
- [x] Tasks.md: all items marked `[x]`, and each marked item's description matches what's actually in the diff (verified `shQuote` extraction, `PROMPT_INLINE_HARNESSES`, `TRAILING_PROMPT_RE`, `inlinedPromptBody`/`inlinePromptIfNeeded`, frontmatter-stripping deviation for OpenCode — all present in `lib/ui/prompt.js`).
- [x] No scope creep: `git diff main...HEAD --stat` touches exactly the 5 non-openspec files listed in `files-modified.md` (`lib/ui/prompt.js`, `lib/ui/session.js`, `lib/ui/shquote.js`, `test/prompt.test.js`, `test/shquote.test.js`) — nothing else.
- [x] No regressions: `lib/ui/harness.js`, `lib/ui/screens/launchplan.js`, `test/harness.test.js` are untouched (confirmed via diff), matching design.md's explicit claim that those call sites don't need to change; all 1428 pre-existing tests still pass unmodified.
- [x] No schema/API-contract changes needed or made (`config/concertino.schema.json` untouched — correct, since `dashboard.launchCommand`'s shape is unaffected).
- [x] Planning artifacts (proposal/design/tasks/spec.md) accurately reflect the implemented behavior for everything they do cover — `spec.md`'s 5 requirements all match the code precisely, including the Decision 4a no-op/override behavior and OpenCode's frontmatter deviation.

### Phase 2: Code Review — PASS

Gates (freshly re-run in `WORKTREE_PATH`, not trusting the executor's report):
```
npm test → # tests 1428, # pass 1428, # fail 0, exit code 0
```

No canonical code-quality standard is configured for this project (per task instructions), so no [mechanical] standard-citation checks apply.

- [x] DRY: `shQuote` extracted from `session.js`'s pre-existing inline expression into `lib/ui/shquote.js` and reused by both `session.js` and `prompt.js` — exactly what design.md Decision 3/task 1.1 called for; no duplicate escape implementation.
- [x] Readable: clear naming (`inlinedPromptBody`, `inlinePromptIfNeeded`, `PROMPT_INLINE_HARNESSES`, `TRAILING_PROMPT_RE`), no magic values, extensive comments tying code back to the specific design.md decision it implements.
- [x] Modular: `shQuote` is a small, single-purpose, independently-testable unit; `inlinedPromptBody`/`inlinePromptIfNeeded` are cleanly separated concerns (content-loading+caching vs. command-string transformation).
- [x] Type safety: plain JS, consistent with the rest of the codebase; `shQuote` explicitly coerces via `String(str)`, documented.
- [x] Security: this *is* the security-relevant change (Decision 3) — single-quote escaping is correctly implemented, and both `test/shquote.test.js` and `test/prompt.test.js` include real `sh -c` round-trip tests (not just string equality) proving backticks/`$`/embedded quotes survive without triggering command substitution. Pre-existing shell-injection regression tests in `test/prompt.test.js` (lines 15-64) still pass unmodified, confirming validation order (Decision 1's "after `looksLikeTicket`, before `session.spawn`") was preserved.
- [x] Error handling: `inlinePromptIfNeeded` never throws — returns the command unchanged on any non-match (harness not in the set, or regex miss for an operator override), per Decision 4a; verified by tests (`test/prompt.test.js` lines 241-255).
- [x] Tests meaningful: cover the happy path (bare ticket, `--agent-merge`, speed token), provider-flag-decorated commands, Claude Code's unaffected path, the operator-override no-op (both with and without a `{{TICKET}}` placeholder at all), OpenCode's frontmatter-stripping, and a real shell round-trip. These would catch a real regression (e.g., reverting to the double-quoted form, or losing the anchor on `TRAILING_PROMPT_RE`).
- [x] No dead code: no unused imports, no leftover TODO/FIXME.
- [x] No over-engineering: solution stays within Decision 1's chosen scope (transform inside `submitTicket`'s existing choke point); no unnecessary abstraction layers.
- [x] Behavior-preserving where expected: `session.js`'s `spawn()` env-quoting is byte-identical after the `shQuote` extraction (confirmed by inspection — same escape expression, just factored out); `LAUNCH_TEMPLATES`, `harnessOfCommand`, and every launch-plan-preview code path are untouched, matching task 6.3's own confirmation that the UI preview still shows the short `{{TICKET}}` form.

### Phase 3: UI Review — N/A
No UI review configured for this project.

### Overall: FAIL

### Change Requests
1. Provide real evidence that a Codex (and OpenCode) launch actually reaches `run.start` and appears on the dashboard post-fix — not just that the model's first message now contains the correct content — or explicitly document in `design.md`/`tasks.md` why that specific AC bullet cannot be independently verified in this environment and what reasoning substitutes for it. See Phase 1 issue #1 above for the specific gap and two acceptable remediation paths.

### Non-blocking Suggestions
- None — the code itself (Phase 2) is clean and well-tested; the single issue above is a verification/documentation gap, not a defect in the shipped fix.
