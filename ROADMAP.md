# Roadmap

Planned improvements to Concertino. Not commitments — a living list.

## Near-term

- **Ticket-creation command.** Extract a provider-aware `concertino-create-ticket`
  (create one or more well-scoped tickets from a free-form description) so it
  isn't left behind in adopting repos. Origin: Helio's `/linear-create-ticket`,
  which the Helio adoption keeps in-repo for now because Concertino doesn't render
  an equivalent yet. Should support `ticketProvider.kind` = linear/github/manual.

- **Cursor adapter.** Render the orchestra into Cursor's native layout
  (`.cursor/rules/*.mdc`, `.cursor/skills/*`) the way the claude-code and codex
  adapters do, so a third harness is first-class instead of a hand-maintained
  mirror. Origin: Helio carries a bespoke `.cursor/` mirror of the delivery
  workflow that the adoption left untouched.

- **Codex model id.** `adapters/codex/agent.toml.tmpl` renders a placeholder
  model (`gpt-5.1-codex`, via `CODEX_MODEL` in `bin/concertino`). Make it
  config-driven (e.g. `harness.codex.model`) instead of a hardcoded constant.

## Later

- **Real end-to-end run on Codex** to validate the sequential/degraded flow with
  actual worker spawning where available.
- **`concertino doctor`** — validate a project's config + rendered files against
  the schema and flag drift (rendered files older than the config).
