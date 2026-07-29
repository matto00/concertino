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

- **Worktree dependency install.** A fresh worktree isn't fully real until its
  deps exist: `CONCERTINO_WORKTREE_HOOKS` is the seam (e.g. `npm ci`), but
  nothing guides adopters toward it, so worktrees come up missing `node_modules`
  and fail at first run. Consider detecting the project type during `init` and
  proposing the install hook, the way gate auto-detection already does. Origin:
  fleet runs against Helio, whose hooks are `npx husky install` with no install
  step.

## Later

- **Real end-to-end run on Codex** to validate the sequential/degraded flow with
  actual worker spawning where available.
- **`concertino doctor`** — validate a project's config + rendered files against
  the schema and flag drift (rendered files older than the config).
