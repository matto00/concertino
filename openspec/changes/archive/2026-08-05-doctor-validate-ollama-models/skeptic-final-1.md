## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Ground truth re-established cold**: read `ticket.md`, `design.md`,
  `tasks.md`, `proposal.md`, the spec delta
  (`openspec/changes/doctor-validate-ollama-models/specs/model-providers/spec.md`),
  and `git diff main...HEAD -- lib/cli/doctor.js` directly (not summarized
  from the evaluator's report).

- **AC 1** ("doctor warns, with the model name and the specific missing
  capability, when a configured Ollama model lacks `tools`, or lacks
  `thinking` while codex is (or can be) Ollama-routed") → traced to
  `checkOllamaModels` in `lib/cli/doctor.js` (lines ~139-183):
  `caps.includes('tools')` check unconditional, `codexRouted &&
  !caps.includes('thinking')` check gated on `(ollama.harnesses ||
  []).includes('codex')`. Warning text names role, model id, and the
  specific capability (`"tools"` / `"thinking"` capability strings appear
  verbatim in the code).

- **AC 2** ("doctor warns when a configured model is not pulled locally") →
  traced to the `/api/tags` fetch and `!localTags.includes(model)` check,
  warning text `"<model>" is not pulled locally`.

- **AC 3** ("Both are non-fatal, and skipped cleanly when the endpoint is
  unreachable") → `checkOllamaModels` is only invoked when `baseReachable`
  is `true` (line 224, `if (baseReachable) checkOllamaModels(ollama, r);`);
  `fetchJson` wraps `execFileSync` in try/catch, returning `null` on any
  curl failure rather than throwing, and both check loops (`localTags` /
  per-model `capsByModel` entries) are guarded to skip cleanly when
  `fetchJson` returned `null`.

- **AC 4** ("A fully-capable configuration produces no new noise") →
  confirmed by re-running the new test suite myself (not trusting the
  evaluator's paste) — see below.

- **Re-ran the full test suite myself, fresh, in the worktree**:
  `npm test` → exit code 0, zero `not ok` / `FAIL` lines anywhere in the
  full output (`grep -c "^not ok"` → 0). The new
  `test/scripts/doctor-ollama-models.test.sh` block specifically:
  19 passed, 0 failed, covering every scenario in tasks.md 3.1 (unpulled
  model, missing `tools`, missing `thinking` with/without codex
  Ollama-routed, unreachable endpoint skips cleanly + other sections still
  run, fully-capable config produces no new noise). Confirmed the mock
  `curl` stub on `PATH` means no real Ollama endpoint is touched (verified
  by reading the test file's `MOCKBIN/curl` fake directly).

- **Re-ran `openspec validate doctor-validate-ollama-models --strict`**
  myself → `Change 'doctor-validate-ollama-models' is valid`, matching the
  evaluator's claim.

- **Scope check**: `git diff main...HEAD --stat` shows only
  `lib/cli/doctor.js`, `package.json` (test wiring), the new test file, and
  the `openspec/changes/...` planning artifacts — matches
  `files-modified.md` exactly, no scope creep. `providers.ollama.models` and
  `providers.ollama.harnesses` already existed in `lib/config.js`
  (confirmed via `grep`), so no schema change was needed or made, consistent
  with the design's stated scope boundary (only `providers.ollama.models`,
  not `models.<harness>.<role>` overrides).

- **Security**: confirmed via diff read that both new `curl` calls use
  `execFileSync` with argument arrays, not string interpolation — a
  config-supplied model id containing shell metacharacters cannot break out
  of the intended invocation.

- **Design-gate follow-through**: the skeptic-design-1.md round raised a
  non-blocking concern that the new test needs its own isolated fake
  endpoint rather than depending on a real local Ollama instance. Verified
  this was addressed: the executor stubbed `curl` itself on `PATH` (a
  stronger isolation than a fake HTTP server would have been, since it
  guarantees zero real network calls regardless of what's running on
  `localhost:11434`).

- **UI review**: N/A — this is a CLI-only change (`concertino doctor`
  terminal output), no dev server or UI surface exists to check. No design
  standard is configured for this project. Confirmed there is nothing in
  the diff touching any rendered UI/template file.

### Verdict: CONFIRM

### Non-blocking notes

- None beyond what's already in evaluation-1.md — the change is a small,
  well-scoped, well-tested extension of an existing best-effort check, and
  every acceptance criterion traces to real, independently-verified
  evidence (not just the evaluator's assertions).
