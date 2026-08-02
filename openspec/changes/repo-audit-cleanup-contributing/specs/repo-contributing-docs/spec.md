## ADDED Requirements

### Requirement: CONTRIBUTING.md exists at the repo root
The repository SHALL have a `CONTRIBUTING.md` at its root documenting local
dev setup, how to run and test changes, the code conventions actually
followed in this codebase, and the `core/` → rendered `scripts/concertino/`
(and other rendered adapter output) template relationship.

#### Scenario: New contributor reads CONTRIBUTING.md
- **WHEN** a new contributor (human or agent) opens `CONTRIBUTING.md` at the
  repo root
- **THEN** they find instructions for local dev setup, how to run/test
  changes, the actual code conventions this codebase follows, and an
  explicit explanation of the `core/` → rendered `scripts/concertino/*`
  template relationship

### Requirement: Repo-wide audit findings are documented
The repository SHALL have a written audit doc enumerating files that have
grown too large or mix too many responsibilities, duplicated logic across
screens, dead code, and other repo-wide consistency issues (including
`core/` vs rendered-copy drift beyond the known CON-52 instance).

#### Scenario: Reviewer reads the audit doc
- **WHEN** a reviewer opens the audit findings doc under `docs/`
- **THEN** they find a list of oversized/multi-responsibility files,
  duplicated logic, dead code, and doc-drift findings, each with a
  recommendation (fixed inline vs. proposed as a follow-up ticket)

### Requirement: docs/dashboard.md matches actual UI behavior
`docs/dashboard.md` SHALL accurately describe the dashboard's current
sections and keybindings as implemented in `lib/ui/`.

#### Scenario: Reader checks a keybinding against the doc
- **WHEN** a reader looks up a keybinding or section in `docs/dashboard.md`
- **THEN** the documented behavior matches the current implementation in
  `lib/ui/`
