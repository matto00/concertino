## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- All four ticket.md acceptance criteria addressed explicitly:
  1. `providers.ollama.baseUrl` + no `gateway` → claude-code offers `local`
     via `P`/`p` and `provider:ollama` routes it — implemented in
     `resolveTicketProvider`/`providerChoices` (`lib/ui/harness.js`),
     covered by `test/harness.test.js`.
  2. Per-role models resolve to Ollama ids on the direct route, hosted
     aliases on the gateway route — implemented via the route-conditional
     `isOllamaRouted` (`lib/config.js`), covered by `test/config.test.js`
     and `test/scripts/resolve-speed.test.sh`.
  3. `doctor` reports which route a project is on — implemented in
     `checkOllamaProvider` (`lib/cli/doctor.js`), covered by
     `test/scripts/doctor-ollama-models.test.sh`.
  4. "measure a real run before declaring it usable" — executor performed
     a real local verification (Claude Code CLI 2.1.222 against Ollama
     0.32.1/`qwen3:8b`), recorded in design.md Decision 4 and
     files-modified.md, including a tool-use round trip, not just a plain
     completion.
- No AC silently reinterpreted — the model-id/route split, the
  `apiKeyEnv`/placeholder-token behavior, and the `doctor` route line all
  match design.md's six decisions exactly.
- All tasks.md items are marked done and match what was actually
  implemented; task 1's finding (`ANTHROPIC_AUTH_TOKEN` is CLI-required, not
  optional) is correctly reflected back into design.md's Decision 4/Open
  Questions and did not require a design change per the finding itself.
- No scope creep of consequence. The one item not literally enumerated in
  proposal.md's Impact section — the `collectConfigIssues` Models-section
  alias-check fix — is explicitly called out in files-modified.md as a
  same-mechanism gap discovered during the plan's own end-to-end
  verification step (task 7.1), not unrelated work. A second minor
  incidental fix (a stale Codex CLI-flag description in the same
  `docs/config-reference.md` paragraph the executor was already rewriting
  for claude-code's two routes) is noted as a non-blocking suggestion below
  — it is a factual correction, not a behavior change, and lives inside a
  paragraph already in scope for editing.
- No regressions to existing behavior: gateway-route, Codex, and OpenCode
  Ollama routing are all re-asserted unchanged by both new and pre-existing
  tests (verified by a full test run, see Phase 2).
- Schema (`config/concertino.schema.json`) and docs
  (`docs/config-reference.md`) updated to match the new `gateway`-optional
  contract.
- Planning artifacts (design.md, tasks.md, files-modified.md) reflect the
  final implemented behavior — cross-checked function-by-function against
  the diff; skeptic-design-3.md's CONFIRM verdict's specific claims
  (four-location doc-comment fix, line/function attribution) were
  independently re-verified against the live file and hold.

### Phase 2: Code Review — PASS

Issues: none.

**Fresh gate run** (this worktree, no `CLEAN_WORKTREE` set at `default`
speed): `npm test` → exit 0, `# tests 1470 / # pass 1470 / # fail 0`, and
every `bash test/scripts/*.test.sh` invocation in the `npm test` chain
reported `N passed, 0 failed` (grepped for `passed, .* failed` excluding
`, 0 failed` — no matches, i.e. no non-zero-failure line anywhere in the
run). `git status --porcelain` is clean.

- **Canonical standards**: none configured for this project — n/a.
- **DRY**: `isOllamaRouted` remains the single source of truth for the
  route decision; every downstream consumer (`resolveModel`, `renderEnv`,
  `renderSpeedsJson`, `resolve-speed.sh`, `doctor`, `harness.js`) reads that
  one function/its rendered `gatewayConfigured` signal rather than
  re-deriving "gateway present?" independently.
- **Readable**: route-conditional branches read clearly (`ollama.gateway`
  vs. `!ollama.gateway && ollama.baseUrl`), consistently applied across all
  seven touched files. Comments were rewritten in place rather than left
  stale.
- **Modular**: change stays within the existing seam boundaries
  (`resolveTicketProvider`/`providerSpawnEnv`/`providerChoices` in
  harness.js, `isOllamaRouted`/`collectConfigIssues` in config.js,
  `renderEnv`/`renderSpeedsJson` in render.js) — no new abstraction layer
  introduced for a two-branch decision.
- **Type safety**: plain JS, matches existing style; no new untyped escape
  hatches.
- **Security**: `ANTHROPIC_AUTH_TOKEN`'s placeholder value (`'ollama-local'`)
  is an inert non-secret; when a real credential is configured via
  `providers.ollama.apiKeyEnv`, only the *name* of the env var is rendered
  (`CONCERTINO_OLLAMA_API_KEY_ENV=...`), never a value — mirrors the
  existing gateway `apiKeyEnv` convention exactly (verified in
  `lib/cli/render.js`'s diff and `test/harness.test.js`'s
  `apiKeyEnv`-present case).
- **Error handling**: the one new failure mode (`gateway` present but
  `baseUrl` missing/empty) fails with an actionable, specific message
  naming `providers.ollama.gateway.baseUrl`; this correctly closes a
  pre-existing silent-pass gap (documented and justified in design.md's
  Risks section) rather than being introduced without cause.
- **Tests meaningful**: new tests exercise both routes at every changed
  call site (`resolveTicketProvider`, `providerChoices`, `providerSpawnEnv`,
  `isOllamaRouted`, `collectConfigIssues`, `resolve-speed.sh`, `doctor`),
  including the incomplete-gateway edge case and the
  both-baseUrl-and-gateway-configured precedence case
  (`providerSpawnEnv prefers the gateway route's ANTHROPIC_BASE_URL when
  both baseUrl and gateway are configured`) — these would catch a
  regression at each of the design's enumerated call sites, not just the
  direct-route happy path.
- **No dead code**: no leftover TODO/FIXME/unused imports found in the diff.
- **No over-engineering**: route selection stays derived from `gateway`
  presence (Decision 1) rather than introducing a new config key, exactly
  as the design settled on after considering and rejecting the alternative.
- **Behavior-preserving where expected**: gateway-route claude-code, Codex,
  and OpenCode Ollama paths are unchanged — confirmed both by reading the
  diff (branches that used to be unconditional are now conditioned on
  exactly the pre-existing gateway-present case) and by the full green test
  run, which includes the pre-existing `codex-ollama-render.test.sh` and
  `opencode-render.test.sh` suites untouched by this diff.
- One repo quirk worth noting for future evaluators, not a code issue: `git
  diff --stat` reports `lib/ui/harness.js` as binary (`Bin 16619 ->
  18651 bytes`) because the file has always contained a literal NUL byte
  inside a regex character class (`[\x00-\x1f\x7f]`, pre-existing on `main`,
  confirmed via `git show main:lib/ui/harness.js`) — not something this
  change introduced. `git diff -a` (or `--text`) is required to see the
  actual text diff for that file; used here to complete the review.

### Phase 3: UI Review — N/A

This change is CLI/library routing logic (config resolution, env rendering,
a bash script, and doctor CLI output) with no rendered UI surface — per the
task framing, Phase 3 is a no-op here and the dev-server steps were
correctly skipped.

### Overall: PASS

### Non-blocking Suggestions

- `docs/config-reference.md`'s per-ticket-provider-routing paragraph edit
  also silently corrected an unrelated, pre-existing stale detail (Codex's
  CLI override description, from `-c model_provider=…` to `--oss
  --local-provider ollama`) while rewriting the same paragraph for
  claude-code's two routes. Harmless and arguably an improvement, but
  worth flagging in the PR description as an incidental fix so it isn't
  mistaken for an intentional Codex-behavior change (the ticket's Non-Goals
  explicitly exclude touching Codex/OpenCode routing).
