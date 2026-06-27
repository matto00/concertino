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
| `worktree.ports` | Port bases. `DEV_PORT = frontendBase + ticketNumber`, `BACKEND_PORT = backendBase + ticketNumber`, so parallel orchestrators never collide. |
| `worktree.envFiles` | Uncommitted files copied into each worktree (e.g. `backend/.env`). |
| `worktree.hooks` | Commands run inside a fresh worktree (e.g. `npx husky install`, `npm ci`). |
| `devServers.{backend,frontend}` | `cwd` / `start` / `health` / `timeoutSec`. Omit a side that doesn't exist. `start`/`health` may reference `$DEV_PORT` / `$BACKEND_PORT`. |
| `gates` | The verification gates. Each runs only when changed files match its `when` glob (`always` for unconditional). This is what the executor runs and the evaluator/skeptic re-run. |
| `canonicalDocs` | Your standards (code-quality, design-language). `bindTo` picks which agents must read each, `when` gates it to relevant changes. **This is the highest-leverage field** — binding agents to an explicit standard lifts quality more than any prompt tweak. |
| `ui` | `enabled`, `tool` (`playwright`), `triggers` (globs), `breakpoints`. Drives Phase 3 review and whether the evaluator/skeptic get browser tools. |
| `budgets` | Circuit-breaker bounds (execution cycles, skeptic rounds, debug attempts). |
| `commitTrailer` | Trailer appended to commits. |

## 3. Sync

```bash
concertino sync                      # renders all configured harnesses
concertino sync --harness=claude-code
concertino sync --dry-run
```

This regenerates `.concertino.env` and the harness files. **Re-run `sync` after every
config change** — it's the single build step.

What gets written:

- **Claude Code:** `.claude/agents/concertino-{orchestrator,executor,evaluator,skeptic}.md`
  and `.claude/commands/concertino-deliver.md`.
- **Codex:** a `<!-- CONCERTINO:BEGIN -->…<!-- CONCERTINO:END -->` block in `AGENTS.md`
  (replaced in place on re-sync, so your other AGENTS.md content is preserved),
  plus `.codex/agents/*.toml` and `.codex/prompts/concertino-deliver.md`.

## 4. Run

- **Claude Code:** `/concertino-deliver <TICKET_ID>`.
- **Codex:** invoke the `concertino-deliver` prompt (or just ask Codex to deliver the
  ticket — it follows `AGENTS.md`). Note the sequential degradation in
  [`harness-capabilities.md`](harness-capabilities.md).

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
  behavior for *everyone*) the templates in this repo's `core/roles/` and `core/laws/`.
- **Generated — don't hand-edit:** `.claude/agents/concertino-*.md`,
  the `AGENTS.md` Concertino block, `.codex/`, and `scripts/concertino/.concertino.env`.
  Re-run `sync` instead.
