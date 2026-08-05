# model-providers Specification

## Purpose
Defines provider-aware model configuration — today, a single `providers.ollama`
block — so any role on Codex or OpenCode can be routed to a locally-hosted
Ollama model per-role through config alone, with Claude Code supported only
via a validated, documented Anthropic-compatible gateway.
## Requirements
### Requirement: `providers.ollama` config block
`concertino.config.json` SHALL accept an optional top-level `providers`
object with an optional `ollama` key: `baseUrl` (string), `apiKeyEnv`
(optional string naming an environment variable holding a credential — never
the credential value itself), `harnesses` (array, subset of the project's
configured `harnesses`, naming which harnesses should route through Ollama),
`models` (an optional per-role fallback model-id map), and `gateway`
(optional object: `baseUrl`, optional `apiKeyEnv`, required only when
`claude-code` appears in `providers.ollama.harnesses`). A project with no
`providers` key SHALL behave identically to today — every check this
requirement introduces is a no-op when `providers` is absent.

#### Scenario: providers.ollama accepted
- **WHEN** a project's config has a `providers.ollama` block with `baseUrl`,
  `harnesses: ["codex"]`, and a `models` map
- **THEN** `concertino validate` accepts the configuration with no errors
  attributable to the `providers` block

#### Scenario: absent providers is a no-op
- **WHEN** a project's config has no `providers` key
- **THEN** `concertino validate`, `concertino sync`, and model resolution for
  every role behave exactly as they did before this capability existed

### Requirement: Per-role model resolution falls back to the provider's model map
`resolveModel(config, harness, role)` SHALL, when no explicit
`models.<harness>.<role>` override is set and `harness` appears in
`providers.ollama.harnesses`, resolve the role's model id from
`providers.ollama.models.<role>` before falling through to the existing
tier-based/hardcoded default resolution. An explicit
`models.<harness>.<role>` override SHALL always take precedence over the
provider's model map.

#### Scenario: provider model map used when no explicit override
- **WHEN** a project's config has `providers.ollama.harnesses: ["codex"]`,
  `providers.ollama.models.executor: "llama3.1:70b"`, and no
  `models.codex.executor` override
- **THEN** the executor role's resolved Codex model id is `"llama3.1:70b"`

#### Scenario: explicit override takes precedence over provider model map
- **WHEN** a project's config has `providers.ollama.harnesses: ["codex"]`,
  `providers.ollama.models.executor: "llama3.1:70b"`, and also
  `models.codex.executor: "codex-mini-latest"`
- **THEN** the executor role's resolved Codex model id is
  `"codex-mini-latest"` — the explicit override wins

### Requirement: Codex renders Ollama provider configuration
`concertino sync` SHALL render Codex's local-model provider configuration
when `"codex"` appears in `providers.ollama.harnesses` (a
`model_provider`-style reference pointed at `providers.ollama.baseUrl`, plus
any configured `apiKeyEnv`) into the project's rendered Codex configuration,
using a merge-marker convention so any hand-authored content in the same file
outside the marked region is preserved. When `"codex"` does not appear in
`providers.ollama.harnesses` (including when `providers` is absent
entirely), no Ollama provider configuration SHALL be rendered for Codex, and
Codex's rendered agent files SHALL be byte-identical to their
pre-this-capability form.

#### Scenario: codex ollama provider rendered when opted in
- **WHEN** `concertino sync` runs for a project with `"codex"` in
  `harnesses` and `"codex"` in `providers.ollama.harnesses`
- **THEN** the rendered Codex configuration includes a provider entry
  pointed at `providers.ollama.baseUrl`

#### Scenario: codex rendering unaffected when not opted in
- **WHEN** `concertino sync` runs for a project with `"codex"` in
  `harnesses` and no `providers` block at all
- **THEN** the rendered Codex agent files contain no Ollama provider
  configuration and match today's existing rendered output

#### Scenario: a role with an explicit hosted-model override is not Ollama-routed
- **WHEN** `concertino sync` runs for a project with `"codex"` in
  `providers.ollama.harnesses` and an explicit
  `models.codex.executor: "gpt-5.1-codex"` override set
- **THEN** the `[model_providers.ollama]` block is still rendered into the
  project's Codex configuration (other Codex roles without an explicit
  override remain Ollama-routed), but the executor role's own rendered
  per-role file has no `model_provider = "ollama"` reference and uses
  `"gpt-5.1-codex"` as its model id, unmodified from today's behavior for an
  explicit override

### Requirement: OpenCode renders Ollama provider configuration
`concertino sync` SHALL render an OpenCode provider entry for Ollama's
OpenAI-compatible API when `"opencode"` appears in
`providers.ollama.harnesses`, using `providers.ollama.baseUrl` and any
explicit model ids from `providers.ollama.models`, into OpenCode's native
project configuration. When `"opencode"` does not appear in
`providers.ollama.harnesses`, no Ollama provider entry SHALL be rendered into
OpenCode's configuration.

#### Scenario: opencode ollama provider rendered when opted in
- **WHEN** `concertino sync` runs for a project with `"opencode"` in
  `harnesses` and `"opencode"` in `providers.ollama.harnesses`
- **THEN** OpenCode's rendered native configuration includes a provider
  entry for Ollama pointed at `providers.ollama.baseUrl`, exposing the
  configured model ids

#### Scenario: opencode ollama provider absent when not opted in
- **WHEN** `concertino sync` runs for a project with `"opencode"` in
  `harnesses` and no `providers.ollama` block
- **THEN** OpenCode's rendered native configuration contains no Ollama
  provider entry

### Requirement: Claude Code requires a configured gateway to use Ollama
`concertino validate` SHALL fail with a clear, actionable error when
`"claude-code"` appears in `providers.ollama.harnesses` but
`providers.ollama.gateway` is not configured. When `providers.ollama.gateway`
is configured, `concertino sync` SHALL render the gateway's connection
information (base URL and, when set, the credential environment variable
name) into the project's `.concertino.env`, so Claude Code's
Anthropic-compatible client can be pointed at the gateway; Claude Code's
per-role agent files' `model:` field SHALL remain an ordinary model
identifier, unmodified by this requirement.

#### Scenario: validation fails without a gateway
- **WHEN** a project's config has `"claude-code"` in
  `providers.ollama.harnesses` and no `providers.ollama.gateway` block
- **THEN** `concertino validate` reports an error naming
  `providers.ollama.gateway` and explaining that Claude Code cannot reach
  Ollama directly without a configured Anthropic-compatible gateway

#### Scenario: validation passes with a gateway configured
- **WHEN** a project's config has `"claude-code"` in
  `providers.ollama.harnesses` and a `providers.ollama.gateway.baseUrl` set
- **THEN** `concertino validate` reports no error for
  `providers.ollama.gateway`, and `concertino sync` renders the gateway's
  base URL (and credential env var name, if set) into `.concertino.env`

### Requirement: `concertino doctor` checks Ollama/gateway prerequisites without leaking secrets
`concertino doctor` SHALL perform a best-effort, non-fatal reachability check
against `providers.ollama.baseUrl` when any harness is listed in
`providers.ollama.harnesses` (and, when `claude-code` is Ollama-routed,
`providers.ollama.gateway.baseUrl`), reporting success/failure without
blocking the rest of doctor's checks on a failure. Doctor SHALL never print
the value of any credential referenced by `apiKeyEnv` — at most, it SHALL
name the environment variable and report whether it is set (non-empty),
never its contents.

When `providers.ollama.baseUrl` is reachable and `providers.ollama.models`
names one or more per-role models, doctor SHALL additionally, for each named
role/model pair:
- Confirm the model is pulled locally (present in the endpoint's local tag
  list) and warn, naming the role and the model id, when it is not.
- Fetch the model's capabilities and warn, naming the role, the model id,
  and the specific missing capability, when its capabilities lack `tools`,
  or lack `thinking` while `codex` is present in
  `providers.ollama.harnesses`.

Both new checks SHALL be best-effort and non-fatal exactly like the existing
reachability check: any network failure, timeout, or unexpected response
shape SHALL degrade to skipping that check (or, for a malformed-but-reached
response, treating the model as lacking every capability rather than
crashing) — never a thrown exception, never a `doctor` failure, and never a
block on any other check running. A fully-capable configuration (every
configured model pulled, with `tools` and, when required, `thinking`) SHALL
produce no new warnings beyond today's output.

#### Scenario: unreachable Ollama does not fail doctor
- **WHEN** `concertino doctor` runs for a project with
  `providers.ollama.harnesses` non-empty and `providers.ollama.baseUrl`
  unreachable
- **THEN** doctor reports a warning for the Ollama reachability check and
  continues to run and report every other check, including skipping the
  per-model pulled/capability checks cleanly

#### Scenario: credential values never printed
- **WHEN** `concertino doctor` runs for a project with
  `providers.ollama.apiKeyEnv` set to the name of an environment variable
  that holds a non-empty value
- **THEN** doctor's output names the environment variable and reports it as
  set, but does not print the variable's value anywhere in its output

#### Scenario: doctor warns when a configured model is not pulled
- **WHEN** `concertino doctor` runs for a project with
  `providers.ollama.baseUrl` reachable and
  `providers.ollama.models.executor` set to a model id absent from the
  endpoint's local tag list
- **THEN** doctor reports a warning naming the `executor` role and the
  configured model id as not pulled locally

#### Scenario: doctor warns when a configured model lacks tools
- **WHEN** `concertino doctor` runs for a project with
  `providers.ollama.baseUrl` reachable and a configured role's model
  reporting a `capabilities` array that does not include `tools`
- **THEN** doctor reports a warning naming that role, the model id, and
  `tools` as the missing capability

#### Scenario: doctor warns when a configured model lacks thinking and codex is Ollama-routed
- **WHEN** `concertino doctor` runs for a project with `codex` present in
  `providers.ollama.harnesses`, `providers.ollama.baseUrl` reachable, and a
  configured role's model reporting a `capabilities` array that includes
  `tools` but not `thinking`
- **THEN** doctor reports a warning naming that role, the model id, and
  `thinking` as the missing capability, and names Codex as the requirement

#### Scenario: missing thinking is not warned when codex is not Ollama-routed
- **WHEN** `concertino doctor` runs for a project with `providers.ollama`
  configured, `codex` absent from `providers.ollama.harnesses`, and a
  configured role's model reporting `capabilities` that include `tools` but
  not `thinking`
- **THEN** doctor reports no warning about that model's missing `thinking`
  capability

#### Scenario: fully-capable configuration produces no new noise
- **WHEN** `concertino doctor` runs for a project with
  `providers.ollama.baseUrl` reachable and every configured role's model
  both pulled locally and reporting `capabilities` covering `tools` (and
  `thinking`, when `codex` is Ollama-routed)
- **THEN** doctor reports no new warnings for the per-model pulled or
  capability checks

