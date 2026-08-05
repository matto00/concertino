- `lib/ui/shquote.js` — new module: the one implementation of POSIX
  single-quote escaping (`shQuote`), shared by `session.js`'s env-injection
  and `prompt.js`'s new codex/opencode prompt inlining (design.md Decision 3,
  tasks.md 1.1).
- `lib/ui/session.js` — `spawn()`'s env-quoting now calls the shared
  `shQuote` instead of its own inline expression; behavior unchanged
  (byte-identical escape), single implementation instead of a would-be
  second one.
- `lib/ui/prompt.js` — `submitTicket()`'s new final step: for `codex`/`opencode`,
  replaces the short, unexpandable `"/concertino-deliver <request text>"`
  quoted argument with the harness's full `adapters/<harness>/prompt.md`
  content plus that same request text, single-quoted via `shQuote`. A
  recognized-but-non-default operator `dashboard.launchCommand` override (no
  matching trailing quoted segment) is a no-op — passed through byte-for-byte
  unchanged (design.md Decisions 1-4a). `LAUNCH_TEMPLATES` and every other
  function in `lib/ui/harness.js`/`lib/ui/screens/launchplan.js` are
  untouched — this is purely a final-step transform inside `submitTicket`.
- `test/prompt.test.js` — new tests pinning: the codex/opencode inlined
  command shape (prompt body + trailing ticket/flag/speed text,
  single-quoted); Claude Code's launch command is byte-identical to before;
  a non-default codex operator override passes through unchanged; a
  provider-flag-decorated codex command still inlines correctly; and a real
  `sh -c` shell round-trip proving the backtick/`$`/quote-laden prompt body
  survives the shell hand-off byte-for-byte.
- `test/shquote.test.js` — new unit tests for the extracted `shQuote` helper,
  including a real `sh -c` round-trip for backticks/`$`/embedded quotes.
- `openspec/changes/fix-codex-prompt-expansion/tasks.md` — all tasks marked
  complete with inline evidence notes (real-run Codex scrollback per task
  3.2, OpenCode investigation evidence per task 5.1, and the one deliberate
  deviation from design.md's byte-for-byte assumption for OpenCode's
  frontmatter/`{{project}}`/`{{idExample}}` handling, per task 5.2). Cycle 3
  adds the definitive task 3.2 evidence entry: a real, observed `run.start`
  event (and the model continuing unprompted into `phase.enter Planning`),
  captured via a stub MCP server (runtime `-c` override, no persisted
  config touched) plus an isolated scratch clone, driven through the real
  `createLauncher().launch()`/`submitTicket()`/`session.spawn()` production
  path with the real ChatGPT-subscription model — closing ticket AC #2 with
  direct evidence per the skeptic's final-gate change request and the
  human's explicit decision to invest in real verification rather than
  scope-narrowing.
- `openspec/changes/fix-codex-prompt-expansion/design.md` — cycle 3: the
  cycle-2 "Explicitly scoped out of this change's own verification"
  (path-(b) scope-narrowing) note is replaced with an "AC #2 ... closed
  with real, observed evidence" note recording the stub-MCP-server +
  isolated-scratch-clone mechanism and the observed `run.start`/
  `gate.result`/`phase.enter` events, per the human's explicit decision at
  the final skeptic gate.
