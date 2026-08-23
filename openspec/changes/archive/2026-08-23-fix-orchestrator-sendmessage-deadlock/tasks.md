## 1. Role document

- [x] 1.1 Add explicit no-inbound-channel / return-value-only statement to
      `core/roles/orchestrator.md`'s "Harness resume model" section, worded
      without naming `SendMessage` and without an unconditional
      "no inbound channel, ever" claim (round-1 REFUTE finding: an earlier
      draft leaked a SendMessage-named, universally-false claim into
      codex/opencode renders).
- [x] 1.2 Extend the claude-code branch of the `harnessResume` block in
      `lib/cli/render.js` with the same clarification at the SendMessage
      mention — this is the one place naming the tool is correct, since it
      renders only into the claude-code file.
- [x] 1.3 Reword Phase 2 spawn/resume/final-gate steps to treat
      artifact-inspection as the mandatory fallback whenever a result is not
      already in hand, not only on harness limitation — reworded without
      naming `SendMessage` in the shared prose.

## 2. Verification

- [x] 2.1 Render `core/roles/orchestrator.md` for `claude-code` into a
      throwaway directory and grep the rendered
      `.claude/agents/concertino-orchestrator.md` for the new text. Working
      invocation in this repo (root has no `concertino.config.json`; `--core`
      defaults to the worktree root and 404s on `/laws`):
      `node bin/concertino sync --config=config/examples/concertino.json --core=./core --harness=claude-code --out=<tmpdir>`
- [x] 2.2 Render `codex` and `opencode` from both the pre-change baseline and
      the modified `core/`, and diff/count `SendMessage` occurrences in each
      rendered orchestrator doc — confirm no new occurrence is introduced
      into shared (non-harness-specific) prose, and no contradiction with
      either harness's own `harnessResume` block.
- [x] 2.3 Run the project's gate (`npm test`).

## 3. Known verification limit

- AC3 ("a run in which a sub-agent completes without the orchestrator
  holding its result ends with the orchestrator inspecting the worktree and
  reporting, not with a silent stop") describes LLM behavior at runtime and
  is not mechanically testable by a unit/render check. It is addressed by
  the prose changes in section 1 and is not independently verified beyond
  that — noted explicitly here per skeptic-design-1's non-blocking finding,
  rather than left silently uncovered.
