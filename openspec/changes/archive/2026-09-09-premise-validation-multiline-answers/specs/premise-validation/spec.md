## MODIFIED Requirements

### Requirement: assert-phase.sh fails the setup gate when the premise-validation evidence is missing or incomplete

`core/scripts/assert-phase.sh setup` SHALL fail closed — printing `FAIL` and a non-zero exit —
when `.concertino/runs/<TICKET_ID>/evidence/premise-validation.md` (resolved against the main
checkout, the same way the Delivery gate's own gate-chain evidence check resolves it) is
absent, does not contain a `## Premise Validation` heading, has any of the three required
fields absent or holding only a placeholder value (`tbd`, `n/a`, `na`, `todo`, or empty), or
has a `**Verdict:**` line whose value is not one of `no-drift`, `minor-staleness`,
`material-drift`. This check applies to every `setup` invocation — it is not conditional on
any diff classification the way the Delivery gate-chain check is.

A field's answer SHALL be read as the whole span from the end of its `**<field>:**` marker to
the earliest subsequent occurrence of any other known field marker (the three required fields
plus `**Verdict:**`), or to the end of the `## Premise Validation` section when no such marker
follows — NOT merely to the first newline after the marker. An answer MAY therefore begin on the
line below its marker, span multiple lines, and contain blank lines and bold spans of its own.
Placeholder detection SHALL be applied to that whole trimmed span, so a field that is empty,
holds only a placeholder token, or holds only markdown list-marker/whitespace residue (e.g. the
bare `-` swept in from an immediately following bulleted field's own marker) across its full
extent is still reported unanswered.

#### Scenario: A run that skips the premise-validation step fails the setup gate

- **WHEN** `assert-phase.sh setup <worktree> <ticket>` is run and no
  `premise-validation.md` evidence file exists for that ticket
- **THEN** it prints `FAIL` naming the missing premise-validation evidence and exits non-zero

#### Scenario: A premise-validation artifact with an unanswered field fails the setup gate

- **WHEN** `premise-validation.md` exists but its `**Sibling collisions:**` field is empty or
  `tbd`
- **THEN** `assert-phase.sh setup` prints `FAIL` naming the unanswered field and exits non-zero

#### Scenario: A complete premise-validation artifact with a valid verdict passes the setup gate

- **WHEN** `premise-validation.md` exists with all three fields substantively answered and
  `**Verdict:** no-drift`
- **THEN** `assert-phase.sh setup` does not fail on account of premise-validation (other
  existing setup checks still apply independently)

#### Scenario: A field answered as a bullet list beneath its marker passes the setup gate

- **WHEN** `premise-validation.md` leaves the remainder of the `**Claims checked:**` marker line
  empty and answers it with a multi-bullet list on the following lines, including a blank line
  between bullets
- **THEN** `assert-phase.sh setup` does not report `Claims checked:` as unanswered

#### Scenario: A field that is empty across its whole multi-line extent is still unanswered

- **WHEN** `**Already-done scope:**` is followed only by blank lines until the next field marker
- **THEN** `assert-phase.sh setup` prints `FAIL unanswered:` naming `Already-done scope:` and
  exits non-zero

#### Scenario: A field written as an empty bullet immediately before another bulleted field is still unanswered

- **WHEN** `**Claims checked:**` is written as its own markdown bullet with nothing after it, and
  is immediately followed by another bulleted field marker (e.g. `- **Claims checked:**` directly
  above `- **Already-done scope:** none`)
- **THEN** `assert-phase.sh setup` prints `FAIL unanswered:` naming `Claims checked:` and exits
  non-zero — the swept-in leading `-` of the next bullet does not count as an answer

#### Scenario: A bold span inside an answer does not truncate that answer

- **WHEN** a field's multi-line answer contains its own bold span such as `**CONFIRMED:**` in
  prose, and the field would otherwise be substantively answered
- **THEN** that field is not reported unanswered, because only the known field markers delimit an
  answer's extent

#### Scenario: The last field's multi-line answer ends at end-of-file

- **WHEN** the last field marker in the section is followed by a substantive multi-line answer
  that ends at end-of-file, with no trailing newline and no following `##` heading or further
  field marker
- **THEN** the answer is read to the end of the section and the gate does not report it
  unanswered
