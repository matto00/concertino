# Contributing to Concertino

Thanks for your interest in contributing. This document covers how to get set up locally, how to run and test changes, the conventions this codebase actually follows, and one repo-specific footgun (the `core/` → rendered-adapter split) worth understanding before you touch generated files.

## Getting Started

Concertino is a Node CLI (`bin/concertino`, `engines.node >= 16`) with **zero runtime dependencies** — the TUI (raw-mode stdin, ANSI rendering/diffing), CLI parsing, and the `core/` → adapter render pipeline are all hand-rolled in `lib/`, `core/`, `adapters/`, and `bin/`. The only `devDependency` is `openspec` (used for this project's own spec-driven change workflow under `openspec/`).

```bash
git clone <repo>
cd concertino
npm install     # installs devDependencies only (openspec); nothing else to build
```

There is no build step — `bin/concertino` and everything under `lib/` run directly on Node.

Before starting anything non-trivial, check `ROADMAP.md` and open issues so effort isn't duplicated.

## Running and testing changes

```bash
npm test              # the full suite: node --test plus every test/scripts/*.test.sh
npm run test:selftest # dry-run `concertino sync` against the bundled helio example config
```

`npm test` runs two kinds of tests, both required to pass before any change lands:

- **`node --test`** — every `test/*.test.js` file (one per `lib/` module: `fleet.test.js`, `watch.test.js`, `config.test.js`, etc.). Pure-function unit tests; several TUI modules (`watch.js`, screen renderers) are deliberately structured so their rendering/diffing logic is exposed as pure functions (`buildFrame`, `render`, `handleKey`, ...) callable without a real TTY — see the header comments in `test/watch.test.js` for the pattern.
- **`test/scripts/*.test.sh`** — bash integration tests for the procedure scripts under `core/scripts/` (rendered into `scripts/concertino/` — see below), exercised through their actual `sh`/`bash` entry points, not reimplemented in JS.

There is no separate lint or format command and no pre-commit hook framework (no `.husky/`, `eslint`, or `prettier` configured in this repo) — `npm test` is the whole verification gate. Don't invent or reference tooling that isn't actually wired up here.

To run a single test file directly:

```bash
node --test test/fleet.test.js
bash test/scripts/cleanup.test.sh
```

## Code conventions actually followed here

- **Zero runtime dependencies.** `package.json`'s `dependencies` is empty on purpose — this is a hand-rolled TUI and CLI parser, not a wrapper around a terminal-UI or argv-parsing library. Don't add a runtime dependency without discussing it first.
- **Pure render/key-handling functions.** Screen modules under `lib/ui/screens/*.js` (and `lib/ui/watch.js` itself) separate pure logic — `render(state, opts) -> string`, `handleKey(key, state) -> action | null` — from the stateful driver (`watch.js`'s poll loop, which owns mutable session state and applies the actions those pure functions return). This is what makes screens testable without a real terminal; follow it for new screens rather than reaching into process/stdin state directly from a renderer.
- **File organization**: `bin/concertino` is the CLI entry point (subcommand dispatch: `init`, `sync`, `validate`, `diff`, `doctor`, `watch`, `prune`, `upgrade`, `gates`, `eject`, `migrate`, `completion`); `lib/config.js` holds shared config loading/validation/defaulting logic used by both `bin/concertino` and the settings screen; `lib/ui/` is the dashboard (`watch.js` drives the poll loop and owns session state, `lib/ui/screens/*.js` are the individual screens, everything else in `lib/ui/` — `layout.js`, `format.js`, `store.js`, `reducer.js`, `cache.js`, ... — are the modules screens share); `core/` is the harness- and project-neutral source of truth (laws, role templates, procedure scripts); `adapters/` holds the per-harness (Claude Code / Codex / OpenCode) rendering templates; `test/` mirrors `lib/` one-to-one for JS unit tests, plus `test/scripts/` for the bash procedure-script tests.
- **No enforced file-size budget.** Unlike some sibling projects, there is currently no lint rule or convention document capping file size — `lib/ui/watch.js` and `lib/ui/screens/fleet.js` have grown past 2,000 and 1,500 lines respectively as a result. That's tracked as audit debt (see `docs/repo-audit-2026-08.md`), not a pattern to imitate in new code: keep new modules focused, and propose a split in the PR description if a file you're editing is growing unreasonably large.
- **Comment-heavy, provenance-tracking style.** Non-obvious decisions are documented inline with the originating ticket id (`// CON-52: ...`) rather than left to commit-message archaeology. Follow this when a change encodes a decision that isn't self-evident from the code alone — it is what makes files like `watch.js` navigable despite their size.
- **Keep changes behavior-preserving unless the change is explicitly about behavior.** Structural/cleanup changes should not also fix unrelated bugs or add features in the same commit; flag anything else you notice as a follow-up instead of folding it in.
- **Never commit secrets, credentials, or `.env` files.** `.concertino/cache/` in particular holds full ticket descriptions and comment threads pulled from your ticket provider and is already gitignored — don't narrow that ignore rule in a way that would expose it.

## The `core/` → rendered `scripts/concertino/*` template relationship

This is the one pattern in this repo that isn't obvious from directory names alone, and it has already caused a real bug — read this before editing anything under `scripts/concertino/`, `.claude/`, `.codex/`, or `.opencode/`.

**`core/` is the single source of truth.** `core/laws/`, `core/roles/`, `core/scripts/`, `core/design/`, and `core/workflow-state.template.md` are harness- and project-neutral templates (roles use `{{placeholder}}` substitution for project-specific config). `core/scripts/*.sh` are plain, already-runnable bash — no templating — copied verbatim.

**`concertino sync`** (`bin/concertino`) renders `core/` + your project's `concertino.config.json` into each configured harness's native layout: `scripts/concertino/*.sh` (copied byte-for-byte from `core/scripts/`), `.claude/agents/*.md` + `.claude-plugin/` (Claude Code), `.codex/` (Codex), `.opencode/` + `opencode.json`'s `provider.ollama` entry (OpenCode), and `.concertino/laws/` + `.concertino/workflow-state.template.md`. There is **no Cursor adapter yet** — `.cursor/` at this repo's own root is OpenSpec's multi-editor skill/command distribution for working on *this* repo's source, unrelated to and sharing no code with this render pipeline; a real Cursor adapter is tracked in `ROADMAP.md`, not yet built.

**Never hand-edit a rendered file.** `scripts/concertino/*.sh`, `.claude/agents/concertino-*.md`, `.concertino/laws/*.md`, etc. are all generated — an edit made directly there is silently discarded (or worse, drifts) the next time someone runs `concertino sync`. If a script or role needs to change, edit its `core/` source and re-run `concertino sync` (or, when working inside this repo itself, note that this repo *is* a Concertino project dogfooding itself — the same rule applies to its own `scripts/concertino/`, `.claude/agents/`, etc.).

**The CON-52 precedent.** `core/scripts/cleanup.sh` had a comment referencing `CONCERTINO_BASE_REMOTE` that drifted out of sync with its rendered copy in `scripts/concertino/cleanup.sh` — the two were supposed to be byte-identical and weren't, because the rendered copy had been edited directly at some point rather than through `core/` + `concertino sync`. CON-52 fixed the drift. `concertino doctor` byte-compares rendered artifacts against `core/` on every run specifically to catch this class of bug going forward — run it after touching anything under `core/` or the rendered directories, and treat a `doctor` drift warning as a real bug, not noise.

## Pull Request Expectations

- Keep PRs reasonably scoped — one concern per PR; don't fold an unrelated refactor into a feature or bugfix PR
- Describe what changed and how you verified it (which gate(s) you ran, and their output)
- `npm test` must pass before a PR is considered ready
- Expect review feedback; address it or push back with reasoning

## AI Collaborators

Concertino is itself built to deliver tickets through an autonomous agent loop (see the README's "The ensemble"), so agent contributions are the norm here, not the exception. The same standards in this document apply to AI agents as to human contributors. Additionally:

- Read this document, along with the project's Iron Laws (`.concertino/laws/`) and canonical docs (`core/design/architecture.md`, `docs/`), before making non-trivial edits
- Never hand-edit a rendered artifact (see "The `core/` → rendered `scripts/concertino/*` template relationship" above) — this is the single most common way an agent introduces silent drift in this repo
- Keep structural/cleanup changes behavior-preserving; flag latent issues as separate follow-up tickets rather than fixing them inline in an unrelated change
- Never skip a failing verification gate (`npm test`) to "get past" a blocker — investigate the root cause (see `.concertino/laws/systematic-debugging.md`) instead
