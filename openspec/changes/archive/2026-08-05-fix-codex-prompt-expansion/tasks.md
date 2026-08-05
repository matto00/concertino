## 1. Shared quoting helper

- [x] 1.1 Add a `shQuote(str)` helper (single-quote wrap, `'` escaped as
      `'\''`) — either exported from `lib/ui/session.js` (mirroring its
      existing inline env-quoting) and reused, or placed in a small shared
      location both `session.js` and `prompt.js` can require, so there is
      exactly one implementation of this safety-critical escape, not two.
      Done: new `lib/ui/shquote.js` exports `shQuote`; `lib/ui/session.js`'s
      `spawn()` now calls it instead of its own inline expression (identical
      escape, single implementation). Covered by `test/shquote.test.js`,
      including a real `sh -c` round-trip.

## 2. Content-inlining in `submitTicket`

- [x] 2.1 In `lib/ui/prompt.js`, after the existing short-form `{{TICKET}}`
      substitution, detect the resolved harness of the constructed command
      via `harnessOfCommand()` (already exported from `lib/ui/harness.js`).
- [x] 2.2 Define `PROMPT_INLINE_HARNESSES` starting with `{'codex'}`
      (extend to include `'opencode'` per task 5 below, once verified).
      Done: ships as `{'codex', 'opencode'}` — task 5's investigation (below)
      confirmed OpenCode shares the gap before this was finalized.
- [x] 2.3 For a harness in that set, load the static content of
      `adapters/<harness>/prompt.md` (via `ADAPTERS`/`read` from
      `lib/cli/shared.js`) once (module-load time or lazily-memoized — avoid
      re-reading the file on every spawn).
      Done: `inlinedPromptBody()` in `lib/ui/prompt.js`, memoized in a
      module-level `Map`. For `opencode`, the YAML frontmatter (OpenCode's
      own command-file metadata, never sent to the model) is stripped before
      caching — see 2.3's note in task 5.2 below for the one deliberate
      deviation from Codex's byte-for-byte case.
- [x] 2.4 Extract the trailing request text (`<ticket>[ <flag-or-speed>]`)
      from the short command's `"/concertino-deliver ..."` quoted argument
      via a targeted regex matched against the command's final quoted
      segment, and build the final inlined text as
      `<prompt.md content>\n\n<request text>`.
      Done: `TRAILING_PROMPT_RE = /"\/concertino-deliver ([^"]*)"$/`,
      anchored at the end of the command string per the skeptic's round-2
      non-blocking note (matching precision is load-bearing for 4a).
- [x] 2.5 Replace the short command's trailing quoted argument with
      `shQuote(<inlined text>)`, preserving everything before it (binary
      name, any `--oss --local-provider ...` provider flags already inserted
      upstream). **If the regex does not match** (the command is a
      recognized-harness but non-default `dashboard.launchCommand` operator
      override — see design.md Decision 4a), the inlining step MUST be a
      no-op: return the command byte-for-byte unchanged, mirroring
      `withSpeedFlag`'s existing "no `{{TICKET}}` match → no-op" convention
      in `lib/ui/screens/launchplan.js`. Never let a non-match throw or
      corrupt the operator's custom command.
      Done: `inlinePromptIfNeeded()`. Verified both with a targeted no-op
      override case and with a provider-flag-decorated command (flags stay
      before the quoted body) — see `test/prompt.test.js`.
- [x] 2.6 Confirm this runs AFTER `looksLikeTicket` validation and the
      existing injection-safety checks in `submitTicket` — do not move or
      weaken that validation.
      Confirmed: `inlinePromptIfNeeded()` is called after the existing
      `parseTicketInput`/`{{TICKET}}` substitution and immediately before
      `session.spawn()`; all pre-existing injection-regression tests in
      `test/prompt.test.js` still pass unmodified.

## 3. Verify the fix against real Codex behavior

- [x] 3.1 Run the ticket's own confirmatory test (or an equivalent
      real/scripted invocation) and inspect the scrollback: the model should
      reference the prompt's own wording (e.g. "sequentially in a single
      thread", `setup-worktree.sh`) rather than trying to resolve the text
      as a shell command.
- [x] 3.2 Record the evidence (a short scrollback excerpt or description) in
      this change's notes / PR description per the acceptance criteria.

      **Evidence (real run, executor cycle 1):** built the actual production
      command via `launchSpecForTicket(['provider:ollama'], LAUNCH_TEMPLATES.codex,
      <ollama config>)` → `submitTicket('CON-1', spec.command, session)`
      (`codex --oss --local-provider ollama -m gpt-oss:latest '<inlined
      prompt.md body>\n\nCON-1'`), then ran it for real in a scratch tmux
      window inside this worktree (mirroring `session.spawn`'s own
      `respawn-window` mechanics). Captured scrollback (`tmux capture-pane
      -S -`):

      ```
      › # concertino-deliver — sequential ticket delivery (Codex)

        Run the Concertino ticket-delivery workflow for the ticket id in the request.
        ...full adapters/codex/prompt.md body, verbatim, as the model's first message...

        CON-1

      ⚠ Model metadata for `gpt-oss:latest` not found. Defaulting to fallback metadata...

      • Explored
        └ List ls -R
          Read concertino-orchestrator.md, orchestrator.md
          Search setup-worktree in ..
          Read setup-worktree.sh
          Search CON- in core
          Read workflow-state.template.md
          Search CON-1 in ..
      ```

      This is the decisive signature the ticket's Evidence section says was
      MISSING before the fix: the model opened `.codex/roles/concertino-orchestrator.md`
      and `setup-worktree.sh` (quoting its real `FAIL speed resolution failed`
      / `assert-phase.sh prints FAIL` error strings verbatim in its own
      follow-up explanation, proving it actually read the file's content, not
      guessed) and `workflow-state.template.md` — instead of CON-75's failure
      mode (treating `/concertino-deliver CON-75` as a shell/CLI command,
      never opening `AGENTS.md` or any role file). `gpt-oss:latest` (a weak
      local model, the same one CON-75 used) then wrote a "here's what you'd
      run" explanation instead of actually invoking `setup-worktree.sh` as a
      tool call — the ticket's own confirmatory-test section explicitly
      anticipates this as a separate, known model-capability limitation
      ("a weak model ignoring instructions it did receive would look
      similar... distinguish with: if the reasoning references the prompt's
      own wording... it was expanded"), distinct from the bug this change
      fixes (the instructions never reaching the model's context at all).
      This run's own shell round-trip test (`test/prompt.test.js`) also
      confirms no backtick-triggered corruption occurred en route.

      **Evidence (real run, executor cycle 2 — evaluator change request
      remediation, real production path):** re-ran through the ACTUAL
      `lib/ui/launcher.js` `createLauncher({root, session, cfg, config}).launch()`
      entry point (not a manually-built command string) → `submitTicket()` →
      the real `lib/ui/session.js` `session.spawn()` → `tmux respawn-window`,
      using this worktree synced with the project's real
      `concertino.config.json` (`node bin/concertino sync --config=... --out=.`,
      gitignored generated output — not committed) so `.codex/roles/`,
      `scripts/concertino/setup-worktree.sh`, and `.concertino.env` were
      genuinely present, and the DEFAULT `codex "/concertino-deliver
      {{TICKET}}"` template (no `--oss` — the real ChatGPT-subscription
      model, confirmed logged in via `codex login status` → "Logged in using
      ChatGPT"), in an isolated tmux session name
      (`concertino-con79-verify`, distinct from the live dashboard's
      `concertino` session) for `CON-1`. Result: `launch()` returned
      `{"spawned":true,"error":null}`; the spawned session
      (`gpt-5.6-luna`) immediately began genuinely agentic tool use —
      real `Bash` calls reading the actual synced
      `.codex/roles/concertino-orchestrator.md`, its own OpenSpec apply-change
      skill file, and (correctly, since this worktree IS a live Concertino
      checkout) `workflow-state.md` and the ticket to decide fresh-vs-resume
      — a qualitatively different trajectory than cycle 1's narration.
      **Deliberately stopped (`tmux kill-window`) before it reached
      `setup-worktree.sh`**, once it became clear it had correctly detected
      it was running inside this SAME live `con-79` worktree (mid-delivery,
      with this very change's own uncommitted evaluation artifact visible)
      — continuing risked the spawned session acting on this delivery's own
      files concurrently with the executor session still using them.
      Verified no side effects: `git status --short` in the worktree shows
      only the pre-existing `evaluation-1.md`; no new `.concertino/runs/`
      directory, no new git worktree/branch, `git worktree list` unchanged.
      (Superseded by cycle 3's full `run.start` capture below — recorded
      here for the trajectory-comparison value; the path-(b) scope-narrowing
      conclusion cycle 2 drew from this evidence was explicitly declined by
      the human at the final skeptic gate and has been removed from
      `design.md`.)

      **Evidence (real run, executor cycle 3 — skeptic final-gate change
      request 1(a), full `run.start` capture, human explicitly declined
      path (b)):** closed the one open link — does a real Codex model,
      given this fix's inlined prompt, actually invoke `setup-worktree.sh`
      and produce a real `run.start` — directly, using the mechanism the
      skeptic named as untried.

      *Stub MCP server:* a ~120-line Node stdio JSON-RPC server
      (`get_issue`/`save_issue`, canned synthetic-ticket response) was
      registered for a single `codex` invocation via a **runtime override
      only** — `-c mcp_servers.mcp__linear.command='"node"' -c
      'mcp_servers.mcp__linear.args=["<path-to-stub>"]'` — no persisted
      config file was touched anywhere (confirmed: a project-local
      `.codex/config.toml` `[mcp_servers.*]` block is silently ignored by
      Codex — `mcp_servers` is user-level-only — so this had to be, and
      was, a per-invocation runtime override, never `~/.codex/config.toml`
      or any repo file). Naming the server `mcp__linear` exploits Codex's
      own `mcp__<server>__<tool>` exposure convention (confirmed via
      `codex exec ... "List the exact names of every tool available to
      you"` before the real run) to expose the tools as EXACTLY
      `mcp__linear__get_issue`/`mcp__linear__save_issue` — the literal
      strings `core/roles/orchestrator.md` Setup step 1 instructs the model
      to call. A `codex exec` smoke test confirmed `get_issue` round-trips
      the canned payload correctly before spending a real interactive run
      on it. A shell round-trip (stub `codex` binary echoing `argv`, same
      pattern as `test/prompt.test.js`'s injection tests) confirmed the
      `-c` flags survive the actual `sh -c` hand-off intact alongside the
      inlined prompt body.

      *Isolation:* `git clone` of this repo into a throwaway `/tmp`
      directory (`con79-verify-clone`), synced there via `node
      bin/concertino sync --config=<real concertino.config.json> --out=.`
      — no relationship to this delivery's own `con-79` worktree, removing
      the exact collision risk that stopped cycle 2 short.

      *Real path:* `createLauncher({root: <clone>, session, cfg: {}, config}).launch('CON-STUB-1', baseCommand)`
      with `baseCommand` = the default codex template prefixed with the two
      `-c` MCP-override flags (inserted before `{{TICKET}}`, same
      position/mechanism as provider-flag decoration) → `submitTicket()` →
      real `session.spawn()`, in an isolated tmux session
      (`concertino-con79-verify3`) with the Node process's cwd chdir'd into
      the clone first (so the tmux window's default path — and therefore
      `setup-worktree.sh`'s `git rev-parse --show-toplevel` — resolved to
      the clone, not `con-79`).

      *Observed (not inferred):* the real ChatGPT-subscription model
      (`gpt-5.6-luna`) —

      ```
      • Calling mcp__linear.get_issue({"id":"CON-STUB-1"})
      • Called mcp__linear.get_issue(...) → {canned ticket, verbatim}
      • Calling mcp__linear.save_issue({"id":"CON-STUB-1","state":"In Progress"})
      • Called mcp__linear.save_issue(...) → {"ok": true, "stub": true}
      • Ran scripts/concertino/setup-worktree.sh "CON-STUB-1" \
            "task/stub-mcp-verification/CON-STUB-1" "default"
        └ fatal: cannot lock ref '...': unable to create directory for
          .git/refs/heads/... (sandbox permission — retried, see below)
      • [diagnosed the sandbox restriction correctly, retried with elevated
         approval — "the canonical script itself is sound, so I'm retrying
         ... with the required elevated filesystem permission rather than
         bypassing it"]
      • Ran scripts/concertino/setup-worktree.sh "CON-STUB-1" \
            "task/stub-mcp-verification/CON-STUB-1" "default"
        └ Preparing worktree (new branch 'task/stub-mcp-verification/CON-STUB-1')
          ...
          READY provider=default
          READY harness_source=runtime-detected
      • Ran scripts/concertino/assert-phase.sh setup ...
        └ PASS setup
      ```

      — actually invoked `setup-worktree.sh` as a real tool call (not a
      description) and it succeeded on retry (the first failure was a
      sandbox git-ref-lock permission prompt — an environment/approval-flow
      detail, not a defect in this fix or evidence the fix doesn't work).
      The clone's own `.concertino/runs/CON-STUB-1/events.jsonl` — read
      directly off disk, not inferred — contains:

      ```json
      {"kind":"run.start","project":"con79-verify-clone","ticket":"CON-STUB-1",
       "branch":"task/stub-mcp-verification/CON-STUB-1",
       "worktree":".../con79-verify-clone/.concertino/worktrees/task/stub-mcp-verification/CON-STUB-1",
       "dev_port":5211,"backend_port":8118,"harness":"codex","speed":"default",
       "provider":"default","models":"{\"orchestrator\":\"codex-mini-latest\",...}"}
      {"kind":"gate.result","gate":"phase:setup","status":"pass","duration_ms":1}
      {"kind":"phase.enter","role":"orchestrator","phase":"Planning","cycle":0}
      ```

      — a genuine `run.start`, immediately followed by a passing
      `phase:setup` gate and the model continuing, unprompted, into a real
      `phase.enter` (Planning) — the run proceeded past Setup on its own.
      `lib/ui/reducer.js`'s `applyEvent()` `case 'run.start':` reads exactly
      the fields present here (confirmed by reading the function directly),
      so a dashboard pointed at this project renders this run through the
      identical fold path every other harness's `run.start` already uses.

      *Cleanup:* the tmux window/session was killed immediately after
      evidence capture; the scratch clone (`rm -rf`, entirely outside this
      repo, in `/tmp`) was deleted afterward. Verified no residue on the
      claim that actually matters: the stub server never touched the real
      Linear API (the model's `save_issue` call landed on the stub,
      confirmed by its `"stub": true` response); no MCP-server config was
      persisted anywhere (`-c` overrides are per-process, in-memory only —
      confirmed via `codex mcp list` showing no configured servers, both
      right after the run and again on re-check below). **Correction (skeptic
      final-gate round 2):** `~/.codex/config.toml` is NOT byte-for-byte
      unchanged, however — the skeptic read it directly and found a
      `[projects."<scratch-clone-path>"] trust_level = "trusted"` entry,
      confirmed on independent re-check. This is a distinct, incidental
      Codex CLI behavior (recording a trust entry per directory it is
      opened in) unrelated to the MCP-override mechanism — it would have
      been added by running plain `codex` in that directory with no MCP
      involved at all. It was left in place: it references a now-deleted,
      non-reusable `/tmp` path, is not an MCP-server registration, and per
      this repo's file-system-permissions rule, this worktree's own
      instructions require the human's explicit "Approved" before editing a
      home-directory system file — not given for this — rather than
      cleaning it up unilaterally.

## 4. Test coverage (regression-proofing)

- [x] 4.1 Add tests (in `test/prompt.test.js` and/or `test/harness.test.js`)
      pinning: the constructed Codex command's initial-prompt argument
      contains recognizable content from `adapters/codex/prompt.md` (not the
      bare slash string); it is single-quoted; it ends with the correct
      trailing ticket/flag/speed text.
- [x] 4.2 Add a shell round-trip test (mirroring the existing injection
      regression tests' `execSync(cmd, {shell: '/bin/sh', ...})` pattern,
      stubbing the `codex` binary with a script that echoes its received
      argv) proving the backtick/`$`/quote-laden content survives the actual
      `sh -c` hand-off byte-for-byte, not just a string-equality assertion
      on the pre-shell command text.
- [x] 4.3 Add/keep a test proving Claude Code's launch command is
      byte-identical to today (unaffected by this change).
- [x] 4.4 Add a test proving a recognized-but-non-default codex
      `dashboard.launchCommand` operator override (e.g. `codex -c foo "some
      other prompt entirely"`) passes through `submitTicket` byte-for-byte
      unchanged — the inlining step must be a no-op, never throw or corrupt
      the command, per design.md Decision 4a.
- [x] 4.5 Confirm every existing test in `test/harness.test.js` and
      `test/prompt.test.js` still passes unmodified except where this
      change's new behavior requires an intentional, documented update.
      Confirmed: no pre-existing test in either file was modified; all pass
      unmodified (`npm test` → 1428/1428, 0 failures).

## 5. OpenCode investigation and matching fix (conditional)

- [x] 5.1 Determine whether `opencode --prompt "/concertino-deliver <ticket>"`
      expands the slash command from a non-interactive spawn (see design.md
      Open Questions for the verification approach).

      **Evidence:** `opencode --help`'s `--prompt` is documented only as
      "prompt to use" (no expansion semantics) on the default `opencode
      [project]` TUI-launch subcommand, in contrast to the separate `opencode
      run --command` flag's explicit "the command to run, use message for
      args" — confirming design.md's Context section's reasoning was correct.
      Execution-confirmed directly: ran `opencode --prompt
      "/concertino-deliver CON-1" -m ollama/gpt-oss:latest` inside a real
      tmux window (same mechanism `session.spawn()` uses) with `argv`
      independently verified via `/proc/<pid>/cmdline` (the flag's value
      reached the process as a single, correctly-quoted argument). The
      session's own `opencode export <sessionID>` showed `"messages": []` —
      `--prompt` did not even populate the input box, let alone submit or
      expand it. This is an even more definitive gap than Codex's (which at
      least received the literal text): OpenCode's `--prompt` flag has no
      effect at all on this CLI version (1.18.13) for the plain TUI launch.
- [x] 5.2 If it does NOT expand (shares Codex's gap): extend
      `PROMPT_INLINE_HARNESSES` to include `'opencode'`, verify
      `adapters/opencode/prompt.md` inlines and quotes correctly through the
      same `submitTicket` path, and add the equivalent tests from Task 4 for
      OpenCode.

      Done, with one deliberate deviation from Codex's byte-for-byte case,
      noted here for visibility since design.md's Decision 2 did not
      anticipate it: unlike `adapters/codex/prompt.md`, `adapters/opencode/prompt.md`
      (a) carries YAML frontmatter — OpenCode's own command-file metadata
      (`description`/`agent`), never part of the message sent to the model
      when the command runs — stripped before inlining
      (`/^---\n[\s\S]*?\n---\n\n?/`); and (b) contains `{{project}}`/`{{idExample}}`
      tokens `concertino sync`'s `emitOpencode()` normally resolves from
      project config, which `submitTicket()` has no access to (the same
      "keep it a pure function of its existing arguments" reasoning
      design.md Decision 2 already applies to rejecting the target project's
      *rendered* file as a content source). Left un-substituted: the only
      user-visible effect is the body's own illustrative aside — "(e.g.
      `{{idExample}}`)" — rendering literally instead of a concrete example
      ticket id; the ACTUAL ticket id is still appended, concrete, right
      after the body, exactly as for Codex, so this does not degrade the
      model's ability to act on the instructions. Judged low-severity enough
      to proceed without a design round-trip; flagged explicitly here per the
      executor's own guardrails as a spinoff candidate if a future change
      wants project-aware inlining.
- [x] 5.3 If it DOES expand correctly: leave OpenCode's launch command
      unchanged, and record the verification evidence in the change notes /
      PR description.
      N/A — 5.1/5.2 apply (OpenCode shares the gap).

## 6. Verification gates

- [x] 6.1 Run the full test suite and confirm it is green.
      `npm test` → `# tests 1428`, `# pass 1428`, `# fail 0`, exit code 0.
- [x] 6.2 Run any lint/typecheck gates this repo defines.
      N/A — `package.json` defines no `lint`/`typecheck` script, and no
      `.eslintrc*`/`tsconfig.json` exists in this repo; `npm test` (task 6.1)
      is the only defined verification gate.
- [x] 6.3 Manually sanity-check `lib/ui/screens/launchplan.js`'s launch-plan
      preview / example-command rendering still shows the short,
      human-readable `{{TICKET}}` form for codex (and opencode) — confirming
      Decision 1's "UI stays short, spawn is long" split actually holds.
      Confirmed by inspection: the preview's `exampleCmd` (launchplan.js
      ~line 425) is built directly from `plan.launchCommand.split('{{TICKET}}')...`
      — it never calls `submitTicket`/`inlinePromptIfNeeded`, so it is
      structurally impossible for the preview to show the long inlined form;
      it stays exactly as short as before this change.
