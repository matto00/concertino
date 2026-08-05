## Context

`lib/cli/doctor.js`'s `checkOllamaProvider` already does a best-effort
reachability check against `providers.ollama.baseUrl` (and, when
`claude-code` is Ollama-routed, `providers.ollama.gateway.baseUrl`) using a
`curl -sf -m 3` subprocess — the same pattern `checkBaseBranch` uses for its
own best-effort `git fetch`. This change adds two more checks in the same
function, gated behind that same reachability probe, for each role's
resolved Ollama model in `providers.ollama.models`.

## Goals / Non-Goals

**Goals:**
- Warn, per configured role/model, when the model is not pulled locally.
- Warn, per configured role/model, when its capabilities are missing `tools`,
  or missing `thinking` while `codex` is (or could be) Ollama-routed.
- Stay best-effort and non-fatal, exactly like the existing reachability
  check — never throw, never fail `doctor`, never block other checks.

**Non-Goals:**
- `concertino validate` applying the same check (left as a documented
  follow-up per the ticket).
- Settings-screen surfacing of a capability warning (left as a documented
  follow-up per the ticket; depends on CON-72 landing first).
- Validating models named in `models.<harness>.<role>` overrides that are
  *not* Ollama-routed (out of scope — this checks only
  `providers.ollama.models`, the map this ticket's report is about).

## Decisions

### Reuse `curl` subprocess calls, not a new HTTP client dependency
`checkOllamaProvider` already shells out to `curl` for reachability. Two more
`curl` calls (`/api/tags`, `/api/show`) keep the same dependency-free
approach rather than introducing `node-fetch`/`undici` for two call sites.
Each call gets its own `-m 3` timeout and is wrapped in the same
try/catch-returns-null pattern `doctor.js`'s `shell()` helper already uses
elsewhere in this file, so a slow or malformed response degrades to "skip
this check" rather than a hang or a thrown exception.

Alternative considered: use Ollama's OpenAI-compatible `/v1/models` endpoint
instead of `/api/tags` for the pulled-model check. Rejected — `/api/tags`
returns Ollama's native tag list including exact `:tag` suffixes
(`qwen3-coder:30b`), matching the exact strings `providers.ollama.models`
uses, whereas `/v1/models` output shape is less directly guaranteed to
round-trip the same tag strings.

### One `/api/show` call per distinct model, not per role
`providers.ollama.models` maps roles (`executor`, `evaluator`, `skeptic`,
`auditor`) to model ids; the same model id is frequently reused across
multiple roles (e.g. `executor` and `evaluator` both on `qwen3.5:27b`).
Dedup by model id before issuing `/api/show` calls, then report once per
*role* that uses an uncapable model (so the warning names the role the user
would actually go fix in config), reusing the one fetched capability result
per distinct model id.

### `thinking` requirement is conditioned on `codex` being Ollama-routed
Per the ticket's acceptance criteria, `thinking` is only required when
`codex` is (or could be) Ollama-routed — i.e. `codex` is a member of
`providers.ollama.harnesses`. When `codex` is not in that list, a model
missing `thinking` produces no warning (Claude Code's gateway path and
OpenCode do not have this constraint per the ticket). `tools` is always
required regardless of which harnesses are Ollama-routed, since every
concertino role uses tool calls.

### Missing/absent `capabilities` array is treated as "both missing"
If `/api/show`'s response has no `capabilities` field at all (unexpected
shape, very old Ollama version), treat it the same as an empty array —
warn for both `tools` and (conditionally) `thinking` — rather than silently
skipping the check. This mirrors "unreachable → skip" only for the
network-level failure case; a reachable-but-malformed response is a real
signal worth surfacing, not silence.

## Risks / Trade-offs

- [Extra `curl` calls add doctor runtime] → each capped at 3s exactly like
  the existing reachability check; total added worst-case latency is
  bounded by (1 `/api/tags` + N distinct models × 1 `/api/show`), all
  skipped entirely when the base reachability check already failed.
- [Ollama's `/api/show` response shape could change across versions] →
  treat any JSON-parse failure or missing `capabilities` field the same as
  "both capabilities missing" (see Decision above) rather than crashing;
  worst case is a slightly noisier warning, never a doctor failure.
- [A role's model resolves through `models.<harness>.<role>` override rather
  than `providers.ollama.models`] → out of scope per Non-Goals; doctor's
  existing behavior for that path is unchanged.

## Migration Plan

No migration — additive, non-fatal checks in an existing doctor section.
Rollback is a plain revert; no config or persisted-state shape changes.

## Open Questions

None outstanding — the ticket's own "worth considering" items are captured
as explicit Non-Goals above rather than left ambiguous.
