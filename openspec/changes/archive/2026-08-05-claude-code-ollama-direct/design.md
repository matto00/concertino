## Context

`providers.ollama` routing (CON-63/CON-65) currently treats Claude Code as a
special case among the three harnesses: Codex and OpenCode route straight to
Ollama's own OpenAI-compatible endpoints, but Claude Code is hard-required to
go through an Anthropic-compatible gateway (`providers.ollama.gateway`,
typically LiteLLM), because at CON-63 design time nothing else spoke Claude
Code's wire protocol. That assumption no longer holds: Ollama (verified
locally, v0.32.1) now serves `/v1/messages` natively, accepts an Anthropic
`tools`/`tool_use` payload correctly (verified against `qwen3:8b` — a
`get_weather` tool call round-tripped with a correct `tool_use` block, no
`x-api-key`/`Authorization` header sent), and needs no credential of its own.

This change makes the gateway optional for Claude Code and adds a second,
direct route, while leaving every other harness's Ollama routing (Codex,
OpenCode) completely untouched.

## Goals / Non-Goals

**Goals:**
- `providers.ollama.baseUrl` (+ `claude-code` in `providers.ollama.harnesses`)
  alone is sufficient for a claude-code row to route to Ollama — no
  `gateway` required.
- Per-role models resolve to real Ollama ids on the direct route (same
  `providers.ollama.models.<role>` map every other harness already uses),
  and continue to resolve to hosted-looking aliases on the gateway route
  (unchanged — the gateway does the remapping).
- `concertino doctor` names which route (direct/gateway/none) a project is
  on for claude-code.
- The wire format is verified end-to-end, including tool use, with the
  evidence captured durably (not just asserted).

**Non-Goals:**
- Changing anything about Codex's or OpenCode's existing Ollama routing.
- Removing the gateway route — it remains fully supported for operators who
  need real proxy features (auth, multi-model remapping, request logging)
  that a bare Ollama endpoint doesn't offer.
- Auto-detecting which route to use from network probing at config-validate
  time — the route is still an explicit config choice
  (`gateway` present or absent), exactly like today's routing is explicit.

## Decisions

### Decision 1: Route selection is `gateway` presence, not a new config key

A project's claude-code Ollama route is derived, not separately configured:
`claude-code` in `providers.ollama.harnesses` AND `providers.ollama.gateway`
configured → **gateway** route (unchanged behavior); `claude-code` in
`providers.ollama.harnesses` AND no `gateway` → **direct** route (new).

**Alternative considered:** an explicit `providers.ollama.route: "direct" |
"gateway"` enum. Rejected — it would let a project configure `gateway` and
`route: "direct"` simultaneously, a contradictory state with no sane
resolution, and the schema already has a discriminating value (`gateway`'s
presence) that needs no new key.

### Decision 2: `isOllamaRouted`'s claude-code exclusion becomes route-conditional, not removed

Today: `if (harness === 'claude-code') return false;` unconditionally.
New: return `false` only when claude-code is on the **gateway** route (where
the model id must stay a hosted alias for the proxy to remap); on the
**direct** route, claude-code falls through to the same
explicit-override-then-provider-map-then-tier resolution every other
Ollama-routed harness already gets.

```js
function isOllamaRouted(c, harness, role) {
  const ollama = c.providers && c.providers.ollama;
  if (!ollama) return false;
  if (harness === 'claude-code' && ollama.gateway) return false; // gateway remaps
  const explicit = c.models && c.models[harness] && c.models[harness][role];
  if (explicit) return false;
  return !!(ollama.harnesses || []).includes(harness);
}
```

This is the one function every downstream consumer (`resolveModel`,
`resolve-speed.sh`'s mirrored jq logic, `renderSpeedsJson`'s comment,
`collectConfigIssues`) already treats as the single source of truth for "is
this harness+role's model id an Ollama id" — changing it here, in one place,
is what makes the direct route's model resolution correct everywhere else
without touching those call sites' own logic.

### Decision 3: `resolveTicketProvider`/`providerChoices` treat `baseUrl` (no gateway) as reachable for claude-code

Today `resolveTicketProvider` returns `null` for `provider:ollama` on
claude-code unless `ollama.gateway && ollama.gateway.baseUrl`. New: also
returns `'ollama'` when no gateway is configured at all (the direct route) —
only a project with `providers.ollama` entirely absent, or with `gateway`
configured but no `baseUrl` on it, still returns `null`. `providerChoices`
gets the identical relaxation (its `h !== 'claude-code' || (gateway &&
gateway.baseUrl)` guard becomes `h !== 'claude-code' ||
!(ollama.gateway) || (ollama.gateway && ollama.gateway.baseUrl)` — i.e.
"no gateway configured" now also qualifies, alongside "gateway configured
and reachable").

### Decision 4: `providerSpawnEnv`/`renderEnv` emit `ANTHROPIC_BASE_URL` for both routes, but only the direct route also needs a placeholder `ANTHROPIC_AUTH_TOKEN`

For the gateway route, `ANTHROPIC_AUTH_TOKEN` is the operator's real gateway
credential (`ollama.gateway.apiKeyEnv`, unchanged). For the direct route,
Ollama's endpoint itself needs no credential (verified: the tool-use probe
above sent no auth header and got a valid response) — but Claude Code's own
CLI is documented elsewhere (LiteLLM's "Configure Claude Code" guide,
referenced in the existing `docs/config-reference.md` entry) to require
`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` to be *non-empty* before it skips
its interactive OAuth login flow, regardless of whether the endpoint behind
`ANTHROPIC_BASE_URL` checks it.

**Verified (executor, CON-75, local Claude Code CLI 2.1.222 against Ollama
0.32.1, `qwen3:8b`):** confirmed. With `ANTHROPIC_BASE_URL` set and no
`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`, `claude -p` does **not** proceed
against the local Ollama endpoint — in normal mode it hangs past a 20-30s
timeout printing only `Execution error` with no further output (falling
back toward its interactive-login path rather than talking to
`ANTHROPIC_BASE_URL`); in `--bare` mode it fails fast with exit code 1 and
`Not logged in · Please run /login`. With a placeholder non-empty
`ANTHROPIC_AUTH_TOKEN` (e.g. `ollama-local`) set alongside
`ANTHROPIC_BASE_URL`, `claude -p` proceeds immediately (exit 0): a plain
completion round-trips correctly (`-p "Reply with exactly: OK"` → `OK`), and
a tool-use turn round-trips correctly end-to-end — a `Read` tool call against
a local file was correctly emitted as an Anthropic `tool_use` block, Ollama
returned it, Claude Code executed the `Read` tool, sent back a correct
`tool_result`, and the model's final answer accurately reported the file's
contents. This confirms the working assumption below without qualification:
a non-empty placeholder `ANTHROPIC_AUTH_TOKEN` is required by the Claude Code
CLI itself (not by Ollama) and must be emitted by default on the direct
route. Tasks 3.x proceed unchanged.

The placeholder value (e.g. `ollama-local`) is required and should be
emitted by default on the direct route, overridable via a
`providers.ollama.apiKeyEnv` (already-existing top-level key, distinct from
`gateway.apiKeyEnv`) for a project that fronts its own local Ollama with a
real credential.

### Decision 5: `resolve-speed.sh` mirrors Decision 2's route check, not a redundant re-derivation

The script's existing `[ "$HARNESS" != "claude-code" ]` guard around
`OLLAMA_ROUTED` becomes conditioned on whether `speeds.json`'s own
`providers.ollama` block indicates a gateway is configured — but
`renderSpeedsJson` does not currently emit `gateway` into `speeds.json` at
all (it only emits `harnesses`/`models`). This change adds `gatewayConfigured:
bool` to the `providers.ollama` block `renderSpeedsJson` writes, so the bash
script can make the same route decision Decision 2's JS makes, from data
that is already sync-time-rendered rather than re-implementing the
"does this project have a gateway" check against raw config (which the
script does not have access to — it only ever reads the already-defaulted
`speeds.json` snapshot, per this script's own header comment on staying a
pure lookup).

### Decision 6: `concertino doctor` reports the resolved route, not just reachability

`checkOllamaProvider` gains one new `ok()` line, printed once per run when
`providers.ollama` is configured and `claude-code` is one of its harnesses:
`providers.ollama.route: direct | gateway`. This is purely additive to the
existing reachability/model checks (Decision 3's config change already makes
the gateway-required `fail()` in `collectConfigIssues` conditional — that
fail only fires when `gateway` is configured but has no `baseUrl`, or,
kept as a fallback safety net, never fires for the new direct route since
absence of `gateway` is no longer an error state for claude-code).

## Risks / Trade-offs

- **[Risk] Claude Code CLI behavior against `ANTHROPIC_BASE_URL` with no/placeholder token is unverified beyond the raw HTTP probe.** → Decision 4 makes this an explicit executor verification step, not an assumption baked in unverified; if verification shows Claude Code needs something else entirely (e.g. rejects a non-hosted-looking model id at the CLI layer before ever sending a request), design.md gets revised and this proposal's scope is re-evaluated before delivery, per CON-74's "measure a real run before declaring it usable" precedent this ticket explicitly cites.
- **[Risk] A project could configure `gateway` with no `baseUrl` on it, an ambiguous half-state.** → Verified against current code: `collectConfigIssues` does **not** fail this today — `lib/config.js`'s `else if (ollama.gateway)` branch calls `ok()` with a dim `"(no baseUrl set)"` note, i.e. this half-state currently passes validation silently. This change must **add** a new failure for it (already scoped as new behavior in tasks.md 2.3 and spec.md's "validation fails when gateway is configured but incomplete" scenario) — it is not preserving an existing check, it is closing a gap that exists today and would otherwise get worse once "no gateway" stops being an error on its own (a project could otherwise land in a state where an incomplete gateway silently falls through to no route at all).
- **[Trade-off] `isOllamaRouted`'s signature/behavior change is a shared function with several call sites (`resolveModel`, doctor, render, resolve-speed.sh's mirrored jq).** → Every call site is enumerated in proposal.md's Impact section; test coverage must exercise both routes at each one, not just the direct-route happy path, to catch a call site that assumed the old unconditional exclusion.

## Migration Plan

No data migration — this is a config-interpretation change only. A project
already on the gateway route sees zero behavior change (gateway still
present → still excluded from provider-model substitution, still gets the
hosted-alias model resolution). A project with `providers.ollama.harnesses`
including `claude-code` and no `gateway`, which previously failed
`concertino validate`, now validates and routes directly instead — this is
the change's entire externally-visible effect. No rollback concerns beyond
reverting the code change itself.

## Open Questions

- ~~Whether `ANTHROPIC_AUTH_TOKEN` is strictly required by the Claude Code
  CLI against a self-hosted `ANTHROPIC_BASE_URL` with no auth~~ — **Resolved**
  (see Decision 4): yes, it is strictly required by the CLI itself. Without
  it, `claude -p` either hangs (falls toward interactive login, no useful
  output) or, in `--bare` mode, fails fast with `Not logged in`. With a
  non-empty placeholder value, both plain completions and tool-use turns
  round-trip correctly against Ollama's native `/v1/messages` endpoint. No
  further design change required; a placeholder `ANTHROPIC_AUTH_TOKEN` is
  emitted by default on the direct route per the working assumption above.
