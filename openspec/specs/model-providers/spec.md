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

#### Scenario: unreachable Ollama does not fail doctor
- **WHEN** `concertino doctor` runs for a project with
  `providers.ollama.harnesses` non-empty and `providers.ollama.baseUrl`
  unreachable
- **THEN** doctor reports a warning for the Ollama reachability check and
  continues to run and report every other check

#### Scenario: credential values never printed
- **WHEN** `concertino doctor` runs for a project with
  `providers.ollama.apiKeyEnv` set to the name of an environment variable
  that holds a non-empty value
- **THEN** doctor's output names the environment variable and reports it as
  set, but does not print the variable's value anywhere in its output

