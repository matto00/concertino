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
| `harnesses` | `string[]` | `["claude-code","codex"]` | Which adapters `sync` renders. Drop `"codex"` if you only target Claude Code. |
| `project` | object | — (required) | Identity + base branch. |
| `ticketProvider` | object | — (required) | Where tickets come from and how status is set. |
| `specProvider` | object | — (required) | How planning artifacts are scaffolded/archived. |
| `worktree` | object | — (required) | Worktree base, port derivation, env files, hooks. |
| `devServers` | object | omit | Backend/frontend run commands for UI review. |
| `gates` | array | — (required) | The verification commands executor runs / reviewers re-run. |
| `canonicalDocs` | array | `[]` | Your standards, bound to specific agents. **Highest-leverage field.** |
| `ui` | object | `{enabled:false}` | Browser-review config (Playwright). |
| `budgets` | object | see below | Circuit-breaker bounds. |
| `commitTrailer` | string | `""` | Trailer appended to commits. |

---

## `project`

```json
"project": { "name": "helio", "baseBranch": "main" }
```

| Field | Type | Default | Purpose |
| ----- | ---- | ------- | ------- |
| `name` | string | — (required) | Human label used throughout agent prose. |
| `baseBranch` | string | `"main"` | Branch PRs target and diffs compare against. |

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
| `ports.frontendBase` | int | — (required) | `DEV_PORT = frontendBase + ticketNumber`. |
| `ports.backendBase` | int | — (required) | `BACKEND_PORT = backendBase + ticketNumber`. Distinct bases let parallel orchestrators never collide. |
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

## `commitTrailer`

```json
"commitTrailer": "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Trailer appended to the squashed commit and the archive commit. Leave `""` for none.
