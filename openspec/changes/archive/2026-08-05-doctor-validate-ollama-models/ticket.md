# CON-73: doctor: validate configured Ollama models against what the harness actually requires

## Description

Nothing validates that a model named in `providers.ollama.models` can actually run under the harness that will be asked to run it. The failure surfaces only at launch, inside a spawned tmux window, as a provider error.

Concrete case hit on 2026-08-05: Codex's `--oss` path requires a **thinking-capable** model and refuses anything else with

```
{"error":{"message":"\"llama3.2:1b\" does not support thinking","type":"invalid_request_error"}}
```

Ollama reports this per model, cheaply and locally:

```
$ ollama show qwen3-coder:30b | grep -A5 Capabilities
Capabilities
  completion
  tools
```

The trap is that the strongest local *coding* models are exactly the ones without a reasoning mode — `qwen3-coder:30b`, `devstral:24b`, `qwen2.5-coder:14b` all report only `completion tools`, while `gpt-oss:latest`, `qwen3.5:27b`, `qwen3:8b` and `gemma4:e4b` report `thinking`. So the natural picks for `executor`/`evaluator` are precisely the ones that will fail under Codex, and the config that produces this validates clean today.

## Scope

Extend `concertino doctor`'s existing Providers section (which already does a best-effort reachability check against `ollama.baseUrl`) to also, per configured `providers.ollama.models.<role>`:

1. Confirm the model is actually **pulled** locally — `GET {baseUrl}/api/tags`, or `/v1/models`. A typo'd or unpulled tag currently fails only at launch.
2. Fetch its capabilities — `POST {baseUrl}/api/show` returns a `capabilities` array — and warn when:
   * `tools` is absent (every concertino role uses tool calls), or
   * `thinking` is absent **and** `codex` is in `ollama.harnesses` (or could be selected per-ticket), naming Codex as the requirement.
3. Keep it non-fatal and best-effort, exactly like the existing reachability check — an unreachable Ollama must not fail `doctor`.

Worth considering in the same pass: `concertino validate` could apply the same check when it can reach the endpoint, since that is where a user looks after editing config.

Also worth surfacing in the settings screen — editing `providers.ollama.models.executor` is now possible in-TUI (CON-72: https://linear.app/helioapp/issue/CON-72/settings-screen-cant-edit-arrays-or-objects-harnesses-and), and that is the moment a capability warning is most useful.

## Acceptance Criteria

* `doctor` warns, with the model name and the specific missing capability, when a configured Ollama model lacks `tools`, or lacks `thinking` while codex is (or can be) Ollama-routed.
* `doctor` warns when a configured model is not pulled locally.
* Both are non-fatal, and skipped cleanly when the endpoint is unreachable.
* A fully-capable configuration produces no new noise.
