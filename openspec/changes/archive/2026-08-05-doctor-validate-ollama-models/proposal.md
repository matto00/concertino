## Why

Nothing today validates that a model named in `providers.ollama.models` can
actually run under the harness that will use it. The failure surfaces only
at launch, inside a spawned tmux window, as a raw provider error (e.g. Codex's
`--oss` path rejecting a non-thinking model with `"does not support
thinking"`). The strongest local coding models — `qwen3-coder:30b`,
`devstral:24b`, `qwen2.5-coder:14b` — are exactly the ones missing a
`thinking` capability, so the natural per-role picks are precisely the ones
that fail under Codex, and `concertino doctor` reports a clean bill of health
today regardless.

## What Changes

- Extend `concertino doctor`'s existing `Providers` section
  (`checkOllamaProvider` in `lib/cli/doctor.js`) to, for each role's resolved
  model under `providers.ollama.models`:
  - Confirm the model is actually pulled locally via `GET
    {baseUrl}/api/tags`, warning by role and model name when it is not.
  - Fetch capabilities via `POST {baseUrl}/api/show` (falls back cleanly when
    unreachable) and warn when the model's `capabilities` array lacks
    `tools`, or lacks `thinking` while `codex` appears in
    `providers.ollama.harnesses`.
  - Keep every new check best-effort and non-fatal, exactly like the
    existing reachability check — an unreachable Ollama endpoint must not
    fail `doctor`, and must not throw before the rest of doctor's checks run.
- No new capability directory: this extends the existing `model-providers`
  capability's doctor requirement, not a new one.

Out of scope for this change (left as follow-ups, per the ticket's own
"worth considering" framing): `concertino validate` applying the same check,
and surfacing a capability warning inline in the settings screen.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-providers`: the existing "`concertino doctor` checks Ollama/gateway
  prerequisites without leaking secrets" requirement grows two new checks —
  per-role model-pulled confirmation and per-role capability validation
  (`tools`, and `thinking` when Codex is Ollama-routed) — both best-effort
  and non-fatal like the requirement's existing reachability check.

## Impact

- `lib/cli/doctor.js` (`checkOllamaProvider`): new HTTP calls to
  `{baseUrl}/api/tags` and `{baseUrl}/api/show`, gated behind the existing
  reachability check so an unreachable endpoint skips them cleanly.
- `openspec/specs/model-providers/spec.md`: one requirement's behavior
  extended (delta spec added by this change).
- `test/scripts/`: new shell test(s) covering pulled/missing model, missing
  `tools`, missing `thinking` (only when `codex` is Ollama-routed), and a
  fully-capable configuration producing no new noise.
- No config schema changes — `providers.ollama.models` and
  `providers.ollama.harnesses` already exist and are read as-is.
