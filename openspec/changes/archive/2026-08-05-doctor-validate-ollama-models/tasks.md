## 1. Model-pulled check

- [x] 1.1 In `lib/cli/doctor.js`'s `checkOllamaProvider`, after the existing
      `baseUrl` reachability check succeeds, fetch `GET
      {baseUrl}/api/tags` (best-effort, 3s timeout, same try/catch-returns-null
      pattern as the file's `shell()` helper) and parse the local tag list.
- [x] 1.2 For each role in `providers.ollama.models`, warn (naming the role
      and the configured model id) when the model id is absent from the
      fetched tag list. Skip this check entirely (no warning, no crash) when
      the `/api/tags` fetch itself fails or returns an unparseable body.

## 2. Capability check

- [x] 2.1 Dedup `providers.ollama.models`' values to distinct model ids
      before issuing capability calls.
- [x] 2.2 For each distinct model id, fetch `POST {baseUrl}/api/show` with
      `{"model": "<id>"}` (best-effort, 3s timeout) and read its
      `capabilities` array (treat a missing/malformed `capabilities` field
      the same as an empty array, per design.md).
- [x] 2.3 For each role using a model missing `tools`, warn naming the role,
      the model id, and `tools` as the missing capability.
- [x] 2.4 For each role using a model missing `thinking`, warn naming the
      role, the model id, and `thinking` as the missing capability — but
      only when `codex` is present in `providers.ollama.harnesses`; name
      Codex as the requirement in the warning text.
- [x] 2.5 Skip the capability check entirely (no warning, no crash) when the
      `/api/show` fetch itself fails for a given model id.

## 3. Tests

- [x] 3.1 New `test/scripts/doctor-ollama-models.test.sh` covering: a pulled
      vs. unpulled model, a model missing `tools`, a model missing
      `thinking` when `codex` is Ollama-routed, a model missing `thinking`
      when `codex` is NOT Ollama-routed (no warning), an unreachable
      endpoint (checks skip cleanly, doctor still runs its other sections),
      and a fully-capable configuration producing no new warnings.
- [x] 3.2 Confirm existing doctor tests
      (`test/scripts/doctor-base-branch.test.sh`,
      `test/scripts/doctor-artifacts.test.sh`) still pass unmodified.

## 4. Validation

- [x] 4.1 `openspec validate --change doctor-validate-ollama-models` passes
      clean.
- [x] 4.2 Run the full test suite (or at minimum every `test/scripts/doctor-*`
      and `test/scripts/codex-ollama-render.test.sh`) and confirm green.
