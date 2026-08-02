# CON-63: Support local Ollama models across Codex, Claude Code, and OpenCode

## Description

Concertino currently renders only Claude Code and Codex adapters, and its model configuration assumes hosted Claude/OpenAI model identifiers. Add first-class local-LLM setup so a project can run configured Ollama models through the Codex, Claude Code, or OpenCode harnesses.

## Scope

* Add OpenCode as a supported harness and render its native project configuration, agents, and delivery command.
* Add provider-aware model configuration for Ollama, including base URL, credentials/environment variables, model IDs, and per-role model selection.
* Extend the Codex adapter to render the required Ollama provider/profile configuration.
* Configure OpenCode against Ollama's OpenAI-compatible API and support explicit local model entries.
* Support Claude Code through an Anthropic-compatible gateway such as LiteLLM; direct Ollama-to-Claude-Code compatibility is not assumed.
* Update config schema/defaults/validation, init/sync/diff/doctor/completions, documentation, examples, and focused tests.
* Preserve existing Claude Code/Codex behavior for projects that do not opt into local LLMs.

## Acceptance Criteria

* A project can select codex, claude-code, and/or opencode in harnesses and concertino validate accepts the configuration.
* concertino sync renders valid native configuration for every selected harness.
* A configured Ollama model can be selected per role without editing generated files by hand.
* Codex can connect to Ollama using its supported local provider configuration.
* OpenCode can connect to Ollama at a configurable endpoint and expose configured models.
* Claude Code setup documents and renders the required Anthropic-compatible gateway environment/configuration, with a clear validation error when direct Ollama mode is requested without a gateway.
* concertino doctor checks the selected harness CLIs and Ollama/gateway prerequisites without leaking secrets.
* Existing harnesses and generated artifacts remain backward compatible.
* Unit/script tests cover config validation, rendering, model resolution, and generated artifact drift.

## Notes

The implementation should treat Ollama as a model provider and the three tools as harnesses. Avoid conflating provider IDs with harness IDs. The implementation worktree is feature/local-llm-harnesses at .concertino/worktrees/feature/local-llm-harnesses.
