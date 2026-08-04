# Adapting Concertino to your project

Concertino is project-agnostic: the agent roles, laws, and scripts are neutral, and
everything specific to your repo lives in **`concertino.config.json`**. You edit the
config, run `concertino sync`, and the four-agent orchestra is rendered into your
harness's native layout.

## 1. Install

```bash
npm install -g concertino     # then `concertino ...`
# or run without installing:  npx concertino <command>
```

Then, from your project root (or with `--out=DIR`):

```bash
concertino init                    # interactive TUI (recommended)
concertino init --example=helio    # or start from an example profile
concertino init --yes              # or non-interactive generic defaults
```

`init`:

- writes `concertino.config.json` (from your answers, or the chosen example),
- copies the procedure scripts to `scripts/concertino/`,
- copies the Iron Laws + workflow-state template to `.concertino/`,
- writes `scripts/concertino/.concertino.env`,
- scaffolds the spec provider: with `openspec` it offers to `npm i -D openspec`
  and run `openspec init`; with `none` it creates a `spec/` dir at the repo root.
  (Skip with `--no-spec-setup`; force openspec non-interactively with `--openspec-init`.)

## 2. Configure

Edit `concertino.config.json`. The schema is `config/concertino.schema.json`
(point your editor's JSON schema at it for completion). The fields that matter most:

| Field | What it controls |
| ----- | ---------------- |
| `project.name` / `project.baseBranch` | Labels in agent prose; the branch PRs target and diffs compare against. |
| `ticketProvider.kind` | `linear` \| `github` \| `manual` — how the orchestrator fetches the ticket and sets status. Sets the MCP/CLI tools the agents get. |
| `specProvider.kind` | `openspec` \| `none`. With `openspec`, planning/apply/archive use its commands; with `none`, the orchestrator writes plain proposal/design/tasks files in `specProvider.changeDir`. |
| `worktree.ports` | Port bases. `DEV_PORT = frontendBase + teamOffset + ticketNumber`, `BACKEND_PORT = backendBase + teamOffset + ticketNumber` (teamOffset is a small bounded hash of the ticket's team prefix, 0–259), so parallel orchestrators never collide — even across teams with the same ticket number. |
| `worktree.envFiles` | Uncommitted files copied into each worktree (e.g. `backend/.env`). |
| `worktree.hooks` | Commands run inside a fresh worktree (e.g. `npx husky install`, `npm ci`). |
| `devServers.{backend,frontend}` | `cwd` / `start` / `health` / `timeoutSec`. Omit a side that doesn't exist. `start`/`health` may reference `$DEV_PORT` / `$BACKEND_PORT`. |
| `gates` | The verification gates. Each runs only when changed files match its `when` glob (`always` for unconditional). This is what the executor runs and the evaluator/skeptic re-run. |
| `canonicalDocs` | Your standards (code-quality, design-language). `bindTo` picks which agents must read each, `when` gates it to relevant changes. **This is the highest-leverage field** — binding agents to an explicit standard lifts quality more than any prompt tweak. |
| `ui` | `enabled`, `tool` (`playwright`), `triggers` (globs), `breakpoints`. Drives Phase 3 review and whether the evaluator/skeptic get browser tools. |
| `budgets` | Circuit-breaker bounds (execution cycles, skeptic rounds, debug attempts). |
| `providers.ollama` | Route some or all configured harnesses' roles through a locally-hosted Ollama model. See `config-reference.md`'s `providers` section. |
| `commitTrailer` | Trailer appended to commits. |

## 3. Sync

```bash
concertino sync                      # renders all configured harnesses
concertino sync --harness=claude-code
concertino sync --harness=opencode
concertino sync --dry-run
```

This regenerates `.concertino.env` and the harness files. **Re-run `sync` after every
config change** — it's the single build step.

What gets written:

- **Claude Code:** `.claude/agents/concertino-{orchestrator,executor,evaluator,skeptic,auditor}.md`
  and `.claude/commands/concertino-deliver.md`.
- **Codex:** a `<!-- CONCERTINO:BEGIN -->…<!-- CONCERTINO:END -->` block in `AGENTS.md`
  (replaced in place on re-sync, so your other AGENTS.md content is preserved),
  plus `.codex/agents/*.toml` and `.codex/prompts/concertino-deliver.md` — and,
  when `"codex"` is in `providers.ollama.harnesses`, a merge-marker-guarded
  `[model_providers.ollama]` block in `.codex/config.toml`.
- **OpenCode:** `.opencode/agents/concertino-{orchestrator,executor,evaluator,skeptic,auditor}.md`
  and `.opencode/commands/concertino-deliver.md` — and, when `"opencode"` is in
  `providers.ollama.harnesses`, a `provider.ollama` entry merged into `opencode.json`.

## 4. Run

- **Claude Code:** `/concertino-deliver <TICKET_ID>`.
- **Codex:** invoke the `concertino-deliver` prompt (or just ask Codex to deliver the
  ticket — it follows `AGENTS.md`). Note the sequential degradation in
  [`harness-capabilities.md`](harness-capabilities.md).
- **OpenCode:** run `/concertino-deliver <TICKET_ID>`, which selects the
  `concertino-orchestrator` primary agent. Same sequential degradation as
  Codex — see [`harness-capabilities.md`](harness-capabilities.md).

## Authoring your canonical docs

Concertino enforces *your* standards; it doesn't ship them. Write a code-quality doc
and (if you have a UI) a design-language doc, then tag rules:

- **[mechanical]** — greppable / lint-checkable. The evaluator enforces these strictly
  with `file:line` citations; promote them to real lint rules over time.
- **[judgment]** — true visual/architectural judgment. The cold skeptic owns these.

Seed the design doc by having an agent survey your *current good* UI and codify the
de-facto language (spacing scale, type scale, theme tokens, component-reuse rules),
then curate. Binding the reviewer to read it is the lever.

## What stays editable vs generated

- **Edit:** `concertino.config.json`, your canonical docs, and (to change agent
  behavior for *everyone*) the templates in this repo's `core/roles/`, `core/laws/`
  and `core/scripts/`.
- **Generated — don't hand-edit:** `.claude/agents/concertino-*.md`,
  the `AGENTS.md` Concertino block, `.codex/`, `.opencode/`, `scripts/concertino/*.sh` and
  `scripts/concertino/.concertino.env`. `sync` overwrites all of these on every
  run, silently — a hand-edit here is discarded, not merged. Re-run `sync` instead.
  `opencode.json` is the one partial exception: only its `provider.ollama` key
  is Concertino-managed (structurally merged); everything else in that file is
  yours, same as `AGENTS.md`'s content outside its marked region.

`scripts/concertino/*.sh` in particular looks editable (they're plain, readable
shell), but `init` only *copies* them from `core/scripts/`; `sync` re-copies them
every time. If you need different behavior from a procedure script, prefer the
seams it already reads: `gates` / `devServers` / `worktree.ports` in
`concertino.config.json`, `worktree.hooks` (rendered into `.concertino.env` as
`CONCERTINO_WORKTREE_HOOKS`), or — for a change that should apply to every
project — edit the template in this repo's `core/scripts/`. `concertino doctor`'s
"Rendered artifacts" check exists to catch exactly this drift and points you at
`sync`, which will overwrite a fork without asking.
