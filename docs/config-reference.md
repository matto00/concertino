# Config reference — `concertino.config.json`

Every field that parameterizes the orchestra. The JSON Schema at
[`config/concertino.schema.json`](../config/concertino.schema.json) is the
machine-readable source of truth — point your editor's `$schema` at it for
inline completion. This page is the human (and agent) explainer.

After any edit, run `concertino sync` to re-render.

> **Filling this in as an agent?** The required spine is
> `project` → `ticketProvider` → `specProvider` → `worktree.ports` → `gates`.
> Everything else has a working default. Start from `--example=helio` or
> `--example=generic` and change what differs.

---

## Top level

| Field | Type | Default | Purpose |
| ----- | ---- | ------- | ------- |
| `harnesses` | `string[]` | `["claude-code","codex"]` | Which adapters `sync` renders — `"claude-code"`, `"codex"`, and/or `"opencode"`. Also drives the static `CONCERTINO_HARNESS` default in `.concertino.env` — see below. |
| `project` | object | — (required) | Identity + base branch. |
| `ticketProvider` | object | — (required) | Where tickets come from and how status is set. |
| `specProvider` | object | — (required) | How planning artifacts are scaffolded/archived. |
| `worktree` | object | — (required) | Worktree base, port derivation, env files, hooks. |
| `devServers` | object | omit | Backend/frontend run commands for UI review. |
| `gates` | array | — (required) | The verification commands executor runs / reviewers re-run. |
| `canonicalDocs` | array | `[]` | Your standards, bound to specific agents. **Highest-leverage field.** |
| `ui` | object | `{enabled:false}` | Browser-review config (Playwright). |
| `budgets` | object | see below | Circuit-breaker bounds. |
| `providers` | object | `{}` | Provider-aware model configuration (currently just `ollama`) — see below. |
| `commitTrailer` | string | `""` | Trailer appended to commits. |

`harnesses` also drives the `CONCERTINO_HARNESS` value `sync` writes into
`scripts/concertino/.concertino.env`: when exactly one harness is configured,
that harness is written as the static default (it can never be wrong — there's
nothing else it could be). When more than one is configured, `sync` cannot know
at render time which one a given run will use, so it writes an empty string
rather than guessing. `setup-worktree.sh` then overrides that static default at
runtime with a harness-set environment variable when one is present
(`CLAUDECODE` → `claude-code`, `CODEX_SANDBOX`/`CODEX_SANDBOX_NETWORK_DISABLED`
→ `codex`, `OPENCODE` → `opencode`, checked in that order), falling back to the
static default and then to the literal `unknown` if none resolves.
`concertino validate` reports which mode (static vs. runtime-detected) a
project's configured `harnesses` will use.

### Per-ticket harness override (`harness:<value>` label)

A single ticket can override the harness used for its own run, independent
of the project's `harnesses` config above. Add a label matching
`harness:<value>` (e.g. `harness:codex`) to the ticket — the orchestrator
reads it alongside the ticket's other fields at Setup (Linear's
`get_issue`/`mcp__linear__get_issue` already returns `labels`, so no extra
API call is needed).

**This is a different, higher-priority precedence than the runtime-detection
chain described just above:** a ticket-declared override wins over BOTH the
static `CONCERTINO_HARNESS` default AND runtime env-based detection
(`CLAUDECODE`/`CODEX_SANDBOX*`) — not merely over the static default. Do not
assume it slots into the same order as an ordinary runtime signal; it is
checked first, ahead of everything else.

The value must be one of the currently implemented harnesses — see
[`docs/harness-capabilities.md`](harness-capabilities.md) for the current
list. A ticket labeled with an unimplemented harness (e.g. `harness:local-llm`)
fails loudly, before any worktree is created — it never silently falls back
to the project default. A ticket carrying more than one `harness:` label is
treated the same way (ambiguous override), never silently picking one.

**When the run is launched from the dashboard** (`concertino watch` — the
queue, quick start, the `n` prompt, or a restart), the label also picks the
CLI that actually runs: the dashboard resolves it at spawn time
(`lib/ui/harness.js`) and starts that harness's own binary for just that
ticket, while the rest of the batch keeps the batch's command. Two
conditions apply, both falling back to the batch command when unmet: the
labeled harness must be in this project's own `harnesses` config (its
adapters must actually be rendered), and a custom `dashboard.launchCommand`
override pins the command for every ticket (there is no per-harness variant
of an operator-supplied command to safely swap to).

Inside the run itself, the override affects the run's **identity/telemetry**
— which harness `run.start` and `READY harness=` report. It does **not**
change which per-role model ids get resolved: those always reflect the
harness actually executing the process (`resolve-speed.sh`'s
`MODEL_TIER_HARNESS`), regardless of what any ticket declares — a
contradicting override (e.g. a ticket labeled `harness:codex` started by
hand inside a live Claude Code session) still gets valid Claude Code model
ids, never Codex ones fed into a Claude Code `Agent(...)` call. When the
dashboard did the launching, the two agree by construction — the labeled
harness IS the one executing.

Check a specific ticket's declared override (if any) ahead of a run with:

```bash
concertino validate --ticket <ID>
```

This live-fetches the named ticket (`ticketProvider.kind: "linear"` only
today) and reports, in the Integrations section: no override present, a
valid override (and that it will take precedence), or an unsupported/
ambiguous override as a validation error (non-zero exit). Omitting `--ticket`
leaves `concertino validate`'s output unchanged from today.

---

## `project`

```json
"project": { "name": "helio", "baseBranch": "main", "baseRemote": "origin" }
```

| Field | Type | Default | Purpose |
| ----- | ---- | ------- | ------- |
| `name` | string | — (required) | Human label used throughout agent prose. |
| `baseBranch` | string | `"main"` | Branch PRs target and diffs compare against. |
| `baseRemote` | string | `"origin"` | Remote PRs target and diffs/fast-forward compare against. |

## `ticketProvider`

```json
"ticketProvider": { "kind": "linear", "idExample": "HEL-26" }
```

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `kind` | `"linear"` \| `"github"` \| `"manual"` | Selects how the orchestrator fetches the ticket and sets status, and which tools the agents are granted. `linear` → Linear MCP tools; `github` → `gh` CLI; `manual` → ticket text is inline / in `ticket.md`, no status updates. |
| `idExample` | string | Sample id shown in rendered examples (e.g. `HEL-26`, `#123`). |

## `specProvider`

```json
"specProvider": {
  "kind": "openspec",
  "changeDir": "openspec/changes/<CHANGE_NAME>",
  "scaffoldCmd": "openspec new change \"<CHANGE_NAME>\"",
  "applyCmd":   "openspec instructions apply --change \"<CHANGE_NAME>\" --json",
  "validateCmd":"openspec validate --change \"<CHANGE_NAME>\"",
  "archiveCmd": "openspec archive \"<CHANGE_NAME>\" --yes"
}
```

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `kind` | `"openspec"` \| `"none"` | `openspec` renders the full status/instructions build loop, validate, and archive-with-Purpose-fill procedure. `none` renders generic "write proposal/design/tasks" guidance and archives by moving the change dir. |
| `changeDir` | string | Change-directory template; `<CHANGE_NAME>` is filled at runtime. Defaults: `openspec/changes/<CHANGE_NAME>` (openspec) or `spec/changes/<CHANGE_NAME>` (none). |
| `scaffoldCmd` | string | (openspec) command to create an empty change. |
| `applyCmd` | string | (openspec) command returning apply instructions + `contextFiles`. |
| `validateCmd` | string | (openspec) validation command run before handoff. |
| `archiveCmd` | string | (openspec) archive command run at delivery. |

`concertino init` scaffolds this provider: `openspec` → optional `npm i -D openspec`
+ `openspec init`; `none` → creates `spec/changes/` and `spec/archive/`.

## `worktree`

```json
"worktree": {
  "base": ".concertino/worktrees",
  "ports": { "frontendBase": 5173, "backendBase": 8080 },
  "envFiles": ["backend/.env"],
  "hooks": ["npx husky install"]
}
```

| Field | Type | Default | Purpose |
| ----- | ---- | ------- | ------- |
| `base` | string | `.concertino/worktrees` | Where per-ticket worktrees are created. |
| `ports.frontendBase` | int | — (required) | `DEV_PORT = frontendBase + teamOffset + ticketNumber` (teamOffset: small bounded hash of the ticket's team prefix, 0–259). |
| `ports.backendBase` | int | — (required) | `BACKEND_PORT = backendBase + teamOffset + ticketNumber`. Distinct bases (plus the team offset) let parallel orchestrators never collide, even across teams. |
| `envFiles` | string[] | `[]` | Uncommitted files copied into each fresh worktree (e.g. `backend/.env`). |
| `hooks` | string[] | `[]` | Commands run inside a fresh worktree (e.g. `npm ci`, `npx husky install`). |

## `devServers`

```json
"devServers": {
  "backend":  { "cwd": "backend",  "start": "PORT=$BACKEND_PORT sbt run", "health": "http://localhost:$BACKEND_PORT/health", "timeoutSec": 300 },
  "frontend": { "cwd": "frontend", "start": "PORT=$DEV_PORT npm run dev",  "health": "http://localhost:$DEV_PORT",          "timeoutSec": 60  }
}
```

Omit a side that doesn't exist (frontend-only and backend-only are both fine).
`start`/`health` may reference `$DEV_PORT` / `$BACKEND_PORT`. Don't add
`nohup`/redirects — the script manages process lifecycle.

| Field | Type | Default | Purpose |
| ----- | ---- | ------- | ------- |
| `cwd` | string | `"."` | Worktree-relative working dir. |
| `start` | string | — (required) | Start command. |
| `health` | string | — (required) | Health URL polled until ready. |
| `timeoutSec` | int | `120` | How long to wait for health before declaring a `BLOCKER`. |

## `gates`

```json
"gates": [
  { "name": "lint",  "when": "frontend/**", "command": "npm run lint" },
  { "name": "test",  "when": "always",      "command": "npm test" }
]
```

The verification gates the executor runs and the evaluator/skeptic re-run. Each
runs **only when changed files match its `when` glob** (`"always"` for
unconditional). This is the contract for "done."

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `name` | string | Label in reports. |
| `when` | string | Glob matched against changed files, or `"always"`. |
| `command` | string | Shell command; non-zero exit = gate failure. |

## `canonicalDocs`

```json
"canonicalDocs": [
  { "path": "CONTRIBUTING.md", "summary": "code-quality standard", "bindTo": ["executor","evaluator"], "when": "always" },
  { "path": "DESIGN.md", "summary": "design-language standard", "bindTo": ["executor","evaluator","skeptic"], "when": "frontend/**" }
]
```

Your standards, which bound agents must read just-in-time. **Binding a reviewer to
an explicit standard lifts quality more than any prompt tweak** — this is the
highest-leverage field.

| Field | Type | Default | Purpose |
| ----- | ---- | ------- | ------- |
| `path` | string | — (required) | Doc path in your repo. |
| `summary` | string | — | One line describing what it governs (shown to the agent). |
| `bindTo` | array of `executor`/`evaluator`/`skeptic` | — (required) | Which agents must read it. |
| `when` | string | `"always"` | `"always"` or a glob — binding applies only when changed files match. |

Tag rules inside the docs: **[mechanical]** (greppable/lint-checkable — the
evaluator enforces with `file:line` citations) vs **[judgment]** (visual/
architectural — the cold skeptic owns these).

## `ui`

```json
"ui": { "enabled": true, "tool": "playwright", "triggers": ["frontend/**"], "breakpoints": [1440,1100,768,0] }
```

| Field | Type | Default | Purpose |
| ----- | ---- | ------- | ------- |
| `enabled` | bool | `false` | Turns on Phase-3 browser review and grants the evaluator/skeptic browser tools. |
| `tool` | `"playwright"` \| `"none"` | `"playwright"` | Browser-automation tool. |
| `triggers` | string[] | — | Globs that make a change UI-affecting (otherwise Phase 3 is N/A). |
| `breakpoints` | int[] | — | Viewport widths the skeptic resizes to when judging responsive layout. |

## `budgets`

```json
"budgets": { "executionCycles": 3, "skepticDesignRounds": 3, "skepticFinalRounds": 2, "debugAttempts": 2 }
```

Circuit-breaker bounds — when a counter hits its bound, the loop escalates to the
human instead of thrashing.

| Field | Default | Bounds |
| ----- | ------- | ------ |
| `executionCycles` | `3` | Execution ↔ Evaluation loop. |
| `skepticDesignRounds` | `3` | Design-gate REFUTE rounds. |
| `skepticFinalRounds` | `2` | Final-gate REFUTE rounds. |
| `debugAttempts` | `2` | Executor root-cause attempts per symptom. |

## `providers`

```json
"providers": {
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "apiKeyEnv": "OLLAMA_API_KEY",
    "harnesses": ["codex", "opencode"],
    "models": { "executor": "llama3.1:70b", "evaluator": "llama3.1:70b" },
    "gateway": { "baseUrl": "http://localhost:4000", "apiKeyEnv": "LITELLM_API_KEY" }
  }
}
```

Provider-aware model configuration — distinct from `harnesses` (the three tools
that render). Scoped today to a single named provider, `ollama`, which points a
subset of this project's configured `harnesses` at a locally-hosted Ollama
instance. Omit `providers` entirely (the default) to leave every harness on its
existing hosted-model behavior — nothing here is inferred from a model-id
string that merely *looks* like an Ollama tag.

| Field | Type | Default | Purpose |
| ----- | ---- | ------- | ------- |
| `ollama.baseUrl` | string | `http://localhost:11434` | Ollama's own API root (not the OpenAI-compatible `/v1` suffix — each harness's adapter appends what it needs). |
| `ollama.apiKeyEnv` | string | — | Name of the environment variable holding a credential for `baseUrl`, if Ollama is behind auth. Never the credential value itself — mirrors `worktree.envFiles`'s path-not-secret convention. |
| `ollama.harnesses` | `string[]` | — | Subset of this project's configured `harnesses` that should route through Ollama. The load-bearing field: `concertino sync`/`doctor`/`validate` read this directly rather than guessing from a model-id string. |
| `ollama.models` | object | — | Per-role fallback model id (`orchestrator`/`executor`/`evaluator`/`skeptic`/`auditor`), used when a harness in `ollama.harnesses` has no explicit `models.<harness>.<role>` override for that role. An explicit override always wins. `sync` folds these resolved ids into `scripts/concertino/speeds.json` for every Ollama-routed (harness, role) pair, so `resolve-speed.sh` — and through it a run's `READY models=`, `workflow-state.md` `MODELS`, and the orchestrator's call-time model overrides — reports the local model, matching the rendered agent files. |
| `ollama.gateway` | object | — | Anthropic-compatible proxy (e.g. [LiteLLM](https://docs.litellm.ai/)) Claude Code requires to reach Ollama — **required** when `"claude-code"` appears in `ollama.harnesses`; `concertino validate` fails with an actionable error otherwise. |
| `ollama.gateway.baseUrl` | string | — | The gateway's Anthropic-compatible base URL. Rendered into `.concertino.env` as `ANTHROPIC_BASE_URL` when set. |
| `ollama.gateway.apiKeyEnv` | string | — | Name of the environment variable holding the gateway credential. Rendered into `.concertino.env` as `CONCERTINO_OLLAMA_GATEWAY_API_KEY_ENV` (the *name*, never the value) — the operator's own shell/secrets manager sets `ANTHROPIC_AUTH_TOKEN` from it before launching `claude`. |

**Per harness:**

- **Codex** — routed with Codex's own first-class local flags:
  `codex --oss --local-provider ollama -m <ollama.models.orchestrator>`.
  Concertino does **not** write a `[model_providers.ollama]` block, because
  Codex ignores `model_providers` in a *project-local* `config.toml` (it is a
  user-level key) and warns about it on every launch; pairing that with a
  `-c model_provider=ollama` override made runs fail outright with
  `unknown input item type: "additional_tools"`. `sync` writes only a
  documentation block into `.codex/config.toml` (merge-marker guarded, so
  hand-authored content outside it survives a re-sync), and each
  Ollama-routed role's `.codex/agents/concertino-<role>.toml` gets a
  `model_provider = "ollama"` line. A role is Ollama-routed iff its harness is
  in `ollama.harnesses` **and** it has no explicit `models.codex.<role>`
  override — an override always keeps that one role on its hosted provider.

  **Codex's `--oss` path requires a THINKING-capable model.** It refuses
  anything else with `"<model>" does not support thinking`, so a strong coding
  model without a reasoning mode (e.g. `qwen3-coder`, `devstral`,
  `qwen2.5-coder`) cannot drive Codex locally. Check before configuring:

  ```bash
  ollama show <model> | grep -A5 Capabilities   # needs: tools, thinking
  ```
- **OpenCode** — when `"opencode"` is in `ollama.harnesses`, `sync` merges a
  `provider.ollama` entry (OpenAI-compatible, pointed at `ollama.baseUrl` +
  `/v1`) into `opencode.json`, exposing any explicit `ollama.models` ids.
- **Claude Code** — never speaks to Ollama directly, even when `"claude-code"`
  appears in `ollama.harnesses`: an Anthropic-compatible gateway remaps the
  model id, so `.claude/agents/*.md`'s `model:` frontmatter stays an ordinary
  hosted alias/string. `ollama.models`'s per-role fallback tier also does not
  apply to Claude Code for the same reason — only the gateway env vars above
  are rendered.

`concertino doctor` performs a best-effort, non-fatal reachability check
against `ollama.baseUrl` (and `ollama.gateway.baseUrl`, when Claude Code is
Ollama-routed), and reports whether `apiKeyEnv`/`gateway.apiKeyEnv` are set —
never their values.

**Per-ticket provider routing (`provider:<value>` ticket label).** With
`providers.ollama` configured, an individual ticket can flip between the
local provider and the subscription default — per run, while other tickets
stay on theirs — by carrying a `provider:<value>` label (mirroring the
`harness:<value>` convention): `provider:ollama` (alias `local`) routes that
run's models through the Ollama map; `provider:default` (aliases
`subscription`, `cloud`) pins a run back to hosted models on a project whose
default routing is Ollama. The dashboard injects the choice into that
ticket's tmux window at spawn time (`CONCERTINO_PROVIDER`, which
`resolve-speed.sh` honors over the project default; plus, for claude-code,
the per-window `ANTHROPIC_BASE_URL` gateway flip — so `provider:ollama` on
claude-code requires `ollama.gateway`, and codex rides a
`-c model_provider=…` CLI override). Labels that can't actually route —
no `providers.ollama` at all, claude-code without a gateway, ambiguous
double labels — are ignored rather than half-applied, exactly like the
harness label's own invalid cases. The launch plan annotates re-routed rows
with `⇒ ollama` before anything starts.

**Switching providers/models while other tickets are in flight.** A run
resolves its models exactly once, at setup (`setup-worktree.sh` →
`resolve-speed.sh` against the rendered `speeds.json`), and carries them in
`workflow-state.md` for the rest of the run — so editing
`concertino.config.json` and re-running `concertino sync` changes what the
*next* launch resolves, not what live runs snapshotted. Live codex/opencode
processes read `.codex/config.toml`/`opencode.json` at process start, so
provider rewiring lands on the next launch there too. Two caveats: the
rendered agent files (`.claude/agents/*.md`, role bodies) are re-read each
time a live orchestrator spawns its next sub-agent, so a mid-flight sync can
refresh their *contents* under a live run (models stay pinned — the
orchestrator passes its snapshotted per-role model into each call); and
`cleanup.sh` re-runs `concertino sync` at the end of every successful run,
so a pending config edit takes effect at the next cleanup or manual sync,
whichever comes first.

## `commitTrailer`

```json
"commitTrailer": "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Trailer appended to the squashed commit and the archive commit. Leave `""` for none.
