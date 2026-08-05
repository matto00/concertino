# CON-75: Claude Code can reach Ollama directly — the `providers.ollama.gateway` requirement is obsolete

## Description

Concertino currently treats Claude Code as unable to speak to Ollama without a separate Anthropic-compatible proxy (LiteLLM or similar). That was true when CON-63 was designed; it isn't any more.

**Ollama now serves an Anthropic-compatible endpoint natively.** Verified against the local server (ollama with `/v1/messages`):

```
$ curl -s http://127.0.0.1:11434/v1/messages \
    -H 'anthropic-version: 2023-06-01' \
    -d '{"model":"qwen3:8b","max_tokens":16,"messages":[{"role":"user","content":"Reply with exactly: OK"}]}'
HTTP 200
{"id":"msg_d485777b3b33838da6422095","type":"message","role":"assistant",
 "model":"qwen3:8b","content":[{"type":"thinking",...}],"stop_reason":"max_tokens",
 "usage":{"input_tokens":15,"output_tokens":16}}
```

Ollama also ships a first-class launcher for it — `ollama launch claude [--model <model>]`, alongside `codex`, `opencode` and others — so this is a supported integration, not a hack.

## What is wrong today

1. `resolveTicketProvider` (`lib/ui/harness.js`) returns `null` for claude-code unless `providers.ollama.gateway.baseUrl` is set, so `provider:ollama` and the launch plan's `P`/`p` keys silently do nothing on a claude-code row even when Ollama is running and reachable.
2. `isOllamaRouted` (`lib/config.js`) hard-excludes claude-code from provider model substitution, on the reasoning that "an Anthropic-compatible gateway sits in between and remaps a hosted-looking model id". Pointing Claude Code straight at Ollama removes the remapper, so its `model:` frontmatter would need to be a real Ollama model id — the opposite of the current rule.
3. `renderEnv` only emits `ANTHROPIC_BASE_URL` when `ollama.gateway` exists.

## Scope

* Treat `providers.ollama.baseUrl` as sufficient for claude-code; keep `gateway` as an optional override for people who genuinely front Ollama with LiteLLM (different endpoint, credentials, model remapping).
* Decide the model-id rule per route: **direct** → claude-code uses `providers.ollama.models.<role>` like every other harness; **via gateway** → keep today's hosted-alias behaviour, since the proxy does the remapping. `isOllamaRouted`'s claude-code exclusion becomes conditional on which of the two is configured.
* `providerSpawnEnv` should point `ANTHROPIC_BASE_URL` at `ollama.baseUrl` on the direct route, and set a placeholder `ANTHROPIC_AUTH_TOKEN` if Claude Code requires one against an unauthenticated endpoint (verify).
* Verify the wire format end to end — tool use in particular, since the whole workflow depends on it, and the probe above only exercised a plain completion.

## Acceptance criteria

* With `providers.ollama` configured and no `gateway`, a claude-code row on the launch plan offers `local` via `P`/`p`, and a `provider:ollama` ticket launches Claude Code against Ollama.
* Per-role models resolve to Ollama ids on the direct route, and to hosted aliases on the gateway route.
* `doctor` reports which of the two routes a project is on.
* CON-74's context findings apply here too: measure a real run before declaring it usable.
