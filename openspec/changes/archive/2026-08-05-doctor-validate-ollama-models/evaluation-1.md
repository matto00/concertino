## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All four ticket acceptance criteria trace to concrete implementation:
  - "warns ... when a configured Ollama model lacks tools, or lacks
    thinking while codex is (or can be) Ollama-routed" → `lib/cli/doctor.js`
    `checkOllamaModels` lines 174-183; codex-gating via
    `(ollama.harnesses || []).includes('codex')` at line 158.
  - "warns when a configured model is not pulled locally" → lines 144-153
    (`/api/tags` fetch, `localTags.includes(model)` check).
  - "Both are non-fatal, and skipped cleanly when the endpoint is
    unreachable" → `checkOllamaModels` is only invoked when
    `baseReachable` is true (line 224); `fetchJson` returns `null` on any
    curl failure rather than throwing.
  - "A fully-capable configuration produces no new noise" → confirmed by
    test scenario 4 in `test/scripts/doctor-ollama-models.test.sh`.
- No AC silently reinterpreted — the "malformed but reachable" edge case
  (missing `capabilities` field) is handled exactly per design.md's
  documented decision (treated as empty array → warn for both), not
  silently skipped.
- All tasks.md items (1.1–4.2) are marked done and match what's actually
  implemented — verified against the diff line-by-line.
- No scope creep: diff touches only `lib/cli/doctor.js`,
  `package.json` (test wiring for the new test file), and the new
  `test/scripts/doctor-ollama-models.test.sh`, matching
  `files-modified.md` and the proposal's stated Impact exactly. The
  ticket's "worth considering" items (`concertino validate`, settings-screen
  surfacing) are correctly left out of scope, documented as Non-Goals in
  design.md.
- No regressions: `checkOllamaProvider`'s existing reachability/gateway/
  apiKeyEnv checks are structurally unchanged aside from `reachable()` now
  returning a boolean (needed to gate the new checks) — verified this
  doesn't change any existing test's expected output (`doctor-base-branch`,
  `codex-ollama-render`, `opencode-render` suites all still pass).
- No API/schema changes needed or made — `providers.ollama.models` and
  `providers.ollama.harnesses` already existed and are read as-is, per
  proposal.md.
- Spec delta (`specs/model-providers/spec.md`) matches the implemented
  behavior exactly, including all five new/modified scenarios; confirmed
  the requirement name matches the existing requirement verbatim
  (`openspec/specs/model-providers/spec.md:137`), so this is genuinely a
  MODIFIED requirement, not an accidental new capability.

### Phase 2: Code Review — PASS
Issues: none.

- Ran `npm test` fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` gate for this
  run): full suite green, including the new
  `test/scripts/doctor-ollama-models.test.sh` (19/19 passed) and all other
  suites (node --test + all `test/scripts/*.sh`), no `not ok` lines, exit
  code 0.
- Ran `openspec validate doctor-validate-ollama-models --strict` →
  "Change 'doctor-validate-ollama-models' is valid".
- No canonical code-quality standard is configured for this project beyond
  `npm test` (per the evaluator brief, "(none configured)") — no separate
  lint/build gates exist in `package.json`.
- DRY: reuses the existing `try/catch-returns-null` pattern from `shell()`
  (renamed `fetchJson` for the two new HTTP calls) rather than introducing
  a new abstraction; dedups `/api/show` calls by distinct model id
  (`new Set(Object.values(models))`) exactly as design.md specifies, so a
  model shared across roles is fetched once.
- Readable: clear naming (`localTags`, `capsByModel`, `codexRouted`), no
  magic values, warning messages self-explanatory and name role + model +
  missing capability as required.
- Modular: `checkOllamaModels` is a separate function from
  `checkOllamaProvider`, single responsibility, called only when the base
  reachability check succeeds.
- Type safety: N/A (plain JS, matches existing file's conventions; no new
  untyped escape hatches beyond what the file already does).
- Security: `execFileSync` with argument arrays (not shell string
  interpolation) is used for both new `curl` calls — model ids and JSON
  body are passed as discrete array elements, so a model id containing
  shell metacharacters cannot break out of the intended curl invocation.
  This is explicitly called out in `files-modified.md` and verified in the
  diff (lines 128-136, 160-167).
- Error handling: every new network call is wrapped so a failure degrades
  to "skip this check", never a thrown exception — verified by test
  scenario 3 (unreachable endpoint: no crash, other doctor sections still
  run).
- Tests meaningful: the new test file exercises exactly the branches the
  diff adds — unpulled model, missing `tools`, missing `thinking` with/without
  codex Ollama-routed, unreachable endpoint (checks skip cleanly), and a
  fully-capable config (no new noise) — using a stubbed `curl` on `PATH` so
  no real Ollama endpoint is touched. These would catch a real regression
  (e.g. reversing the `codexRouted` gate, or reporting per-model-id instead
  of per-role).
- No dead code: no unused imports, no leftover TODO/FIXME in the diff.
- No over-engineering: two small, targeted functions bolted onto the
  existing check; no new dependency introduced for the two HTTP calls
  (reuses `curl` via `execFileSync`, consistent with the file's existing
  `execSync`-based `curl` reachability check).
- Behavior-preserving: `reachable()`'s only behavioral change is now
  returning `true`/`false` instead of `undefined` (used only internally to
  gate `checkOllamaModels`); all of its existing console output
  (`r.ok`/`r.warn` calls, messages) is byte-identical to before, confirmed
  by the unchanged doctor-base-branch/codex-ollama-render test suites
  still passing.

### Phase 3: UI Review — N/A
This is a CLI-only change (`concertino doctor` terminal output); no UI
surface is touched. Per the evaluator brief for this project, Phase 3 is
marked N/A and the dev-server steps were skipped.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- None of note — implementation is a clean, tightly-scoped extension of an
  existing check with solid test coverage of every documented edge case.
