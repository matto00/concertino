## MODIFIED Requirements

### Requirement: Ticket text is resolved from the persisted snapshot first, the launch pad cache second
Ticket text (title and description) for a run SHALL be resolved by first checking for a file
named `ticket.md` located anywhere under `.concertino/runs/<TICKET_ID>/evidence/` in the main
checkout, and — only if no such file is found, is unreadable, or its parsed title is blank once
trimmed of whitespace — falling back to the launch pad cache (`.concertino/cache/linear.json`),
matched by ticket identifier. If neither source yields text, resolution SHALL return an absent
result (rendered per the fallback requirements above), never a thrown error.

`persist-evidence.sh`'s destination-naming preserves each artifact's path relative to its own
source worktree's top-level (fix-persist-evidence-path-collision), so a persisted `ticket.md`'s
exact location under `evidence/` varies by project (e.g. `evidence/openspec/changes/<change>/
ticket.md` for a project using the `openspec` spec provider) rather than always landing at the
flat `evidence/ticket.md` path. Resolution SHALL locate it by searching the evidence directory
rather than assuming a fixed relative path, so it keeps working regardless of the project's spec
provider convention. `ticket.md` is persisted at most once per run, so this search never has more
than one candidate to find.

#### Scenario: The persisted ticket.md is preferred when present
- **WHEN** both a persisted `ticket.md` (at any location under the run's `evidence/` directory)
  and a matching launch pad cache entry exist for a ticket
- **THEN** the drill-down shows the title and description from the persisted `ticket.md`

#### Scenario: A persisted ticket.md nested under a subdirectory of evidence/ is still found
- **WHEN** a run's `ticket.md` was persisted at a path nested under a subdirectory of its
  `evidence/` directory (rather than directly at `evidence/ticket.md`), as `persist-evidence.sh`'s
  worktree-relative destination naming produces for a real `ticket.md` source
- **THEN** the drill-down still shows the title and description from that persisted `ticket.md`

#### Scenario: The launch pad cache is used when no persisted copy exists
- **WHEN** no persisted `ticket.md` exists anywhere under a run's `evidence/` directory but the
  launch pad cache has a matching entry
- **THEN** the drill-down shows the title and description from the cache entry

#### Scenario: Resolution degrades honestly when neither source has the ticket
- **WHEN** neither a persisted `ticket.md` nor a matching cache entry exists for a ticket
- **THEN** ticket text resolution returns an absent result, and the drill-down renders the
  `ticket text unavailable` fallback in both the header and the TICKET panel
