## MODIFIED Requirements

### Requirement: `providers.ollama` config block
`concertino.config.json` SHALL accept an optional top-level `providers`
object with an optional `ollama` key: `baseUrl` (string), `apiKeyEnv`
(optional string naming an environment variable holding a credential — never
the credential value itself), `harnesses` (array, subset of the project's
configured `harnesses`, naming which harnesses should route through Ollama),
`models` (an optional per-role fallback model-id map), and `gateway`
(optional object: `baseUrl`, optional `apiKeyEnv`). `gateway` SHALL be
optional for every harness, including `claude-code` — it is no longer
required for `claude-code` to appear in `providers.ollama.harnesses`, since
Claude Code can now reach Ollama's native Anthropic-compatible endpoint
directly. A project with no `providers` key SHALL behave identically to
today — every check this requirement introduces is a no-op when `providers`
is absent.

#### Scenario: providers.ollama accepted
- **WHEN** a project's config has a `providers.ollama` block with `baseUrl`,
  `harnesses: ["codex"]`, and a `models` map
- **THEN** `concertino validate` accepts the configuration with no errors
  attributable to the `providers` block

#### Scenario: absent providers is a no-op
- **WHEN** a project's config has no `providers` key
- **THEN** `concertino validate`, `concertino sync`, and model resolution for
  every role behave exactly as they did before this capability existed

#### Scenario: claude-code accepted with no gateway configured
- **WHEN** a project's config has `providers.ollama.harnesses: ["claude-code"]`
  and `providers.ollama.baseUrl` set, with no `gateway` key at all
- **THEN** `concertino validate` accepts the configuration with no errors
  attributable to `providers.ollama.gateway`

### Requirement: Per-role model resolution falls back to the provider's model map
`resolveModel(config, harness, role)` SHALL, when no explicit
`models.<harness>.<role>` override is set and `harness` appears in
`providers.ollama.harnesses`, resolve the role's model id from
`providers.ollama.models.<role>` before falling through to the existing
tier-based/hardcoded default resolution. An explicit
`models.<harness>.<role>` override SHALL always take precedence over the
provider's model map. This fallback SHALL apply to `claude-code` exactly
like every other harness when `claude-code` is on the **direct** route (no
`providers.ollama.gateway` configured); when `claude-code` is on the
**gateway** route (`providers.ollama.gateway` configured), `claude-code`
SHALL remain excluded from this fallback and its model id SHALL continue to
resolve through the existing tier-based/hardcoded default, unchanged from
today — the gateway is what remaps a hosted-looking alias to the local
Ollama model, so the model id itself must stay a hosted alias on that route.

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

#### Scenario: provider model map used for claude-code on the direct route
- **WHEN** a project's config has `providers.ollama.harnesses: ["claude-code"]`,
  `providers.ollama.baseUrl` set, no `gateway` configured, and
  `providers.ollama.models.executor: "qwen3:8b"`, with no
  `models.claude-code.executor` override
- **THEN** the executor role's resolved claude-code model id is `"qwen3:8b"`

#### Scenario: provider model map NOT used for claude-code on the gateway route
- **WHEN** a project's config has `providers.ollama.harnesses: ["claude-code"]`,
  `providers.ollama.gateway.baseUrl` set, and
  `providers.ollama.models.executor: "qwen3:8b"`, with no
  `models.claude-code.executor` override
- **THEN** the executor role's resolved claude-code model id resolves
  through the existing tier-based/hardcoded default (a hosted-looking
  alias), unchanged from today's behavior — NOT `"qwen3:8b"`

### Requirement: Claude Code can reach Ollama either directly or through a configured gateway
`concertino validate` SHALL accept a config where `"claude-code"` appears in
`providers.ollama.harnesses` and `providers.ollama.gateway` is absent — this
is the **direct** route, valid because Ollama serves a native
Anthropic-compatible endpoint. When `providers.ollama.gateway` IS configured,
that remains the **gateway** route: `concertino sync` SHALL render the
gateway's connection information (base URL and, when set, the credential
environment variable name) into the project's `.concertino.env`, and
Claude Code's per-role agent files' `model:` field SHALL remain an ordinary
hosted-looking model identifier, unmodified by this requirement — exactly as
before this change. On the direct route, `concertino sync` SHALL render
`providers.ollama.baseUrl` (not a gateway URL) as `ANTHROPIC_BASE_URL` into
`.concertino.env`, and Claude Code's per-role agent files' `model:` field
SHALL resolve through `providers.ollama.models.<role>` like any other
Ollama-routed harness (per the "Per-role model resolution" requirement
above). `concertino validate` SHALL still fail with a clear, actionable
error when `providers.ollama.gateway` is configured but its `baseUrl` is
missing or empty — an incomplete gateway declaration remains invalid on
either route.

#### Scenario: validation passes on the direct route (no gateway)
- **WHEN** a project's config has `"claude-code"` in
  `providers.ollama.harnesses`, `providers.ollama.baseUrl` set, and no
  `providers.ollama.gateway` key
- **THEN** `concertino validate` reports no error for
  `providers.ollama.gateway`, and `concertino sync` renders
  `ANTHROPIC_BASE_URL` from `providers.ollama.baseUrl` into
  `.concertino.env`

#### Scenario: validation passes with a gateway configured
- **WHEN** a project's config has `"claude-code"` in
  `providers.ollama.harnesses` and a `providers.ollama.gateway.baseUrl` set
- **THEN** `concertino validate` reports no error for
  `providers.ollama.gateway`, and `concertino sync` renders the gateway's
  base URL (and credential env var name, if set) into `.concertino.env`

#### Scenario: validation fails when gateway is configured but incomplete
- **WHEN** a project's config has `"claude-code"` in
  `providers.ollama.harnesses` and a `providers.ollama.gateway` object with
  no `baseUrl` set (or an empty string)
- **THEN** `concertino validate` reports an error naming
  `providers.ollama.gateway.baseUrl` as missing

### Requirement: `concertino doctor` checks Ollama/gateway prerequisites without leaking secrets
`concertino doctor` SHALL perform a best-effort, non-fatal reachability check
against `providers.ollama.baseUrl` when any harness is listed in
`providers.ollama.harnesses` (and, when `claude-code` is on the gateway
route, `providers.ollama.gateway.baseUrl`), reporting success/failure without
blocking the rest of doctor's checks on a failure. Doctor SHALL never print
the value of any credential referenced by `apiKeyEnv` — at most, it SHALL
name the environment variable and report whether it is set (non-empty),
never its contents. When `"claude-code"` appears in
`providers.ollama.harnesses`, doctor SHALL additionally report which route
(`direct` or `gateway`) claude-code is resolved to.

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

#### Scenario: doctor reports the direct route for claude-code
- **WHEN** `concertino doctor` runs for a project with `"claude-code"` in
  `providers.ollama.harnesses`, `providers.ollama.baseUrl` set, and no
  `providers.ollama.gateway` configured
- **THEN** doctor reports `providers.ollama.route: direct`

#### Scenario: doctor reports the gateway route for claude-code
- **WHEN** `concertino doctor` runs for a project with `"claude-code"` in
  `providers.ollama.harnesses` and `providers.ollama.gateway.baseUrl` set
- **THEN** doctor reports `providers.ollama.route: gateway`

## ADDED Requirements

### Requirement: A claude-code ticket can be routed to Ollama directly via label or launch-plan cycle without a gateway configured
Concertino SHALL treat `ollama` as an available provider for a claude-code ticket's `provider:<value>` label and the launch-plan's per-row provider cycle (`P`/`p`) whenever `providers.ollama.baseUrl` is configured — regardless of whether `providers.ollama.gateway` is configured. A `provider:ollama` label on a claude-code ticket SHALL NOT silently no-op merely because no gateway is configured, as it did before this change.

#### Scenario: provider:ollama label routes a claude-code ticket with no gateway configured
- **WHEN** a project's config has `providers.ollama.baseUrl` set and no
  `providers.ollama.gateway`, and a ticket carries a `provider:ollama` label
  destined for a claude-code launch
- **THEN** the resolved provider for that ticket's spawn is `"ollama"`, and
  the spawned environment points `ANTHROPIC_BASE_URL` at
  `providers.ollama.baseUrl`

#### Scenario: launch plan offers local provider for a claude-code row with no gateway configured
- **WHEN** the launch plan renders a claude-code row for a project with
  `providers.ollama.baseUrl` configured and no `providers.ollama.gateway`
- **THEN** the row's provider choices include `ollama` (offered via the
  `P`/`p` keys), not just `null`
