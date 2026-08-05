## MODIFIED Requirements

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
