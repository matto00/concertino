## MODIFIED Requirements

### Requirement: Delivery blocks on missing gate-chain evidence
`assert-phase.sh delivery` SHALL fail (exit non-zero, `FAIL ...`) when `check-gate-chain-change.sh` reports the branch's diff as gate-chain-touching, unless all of the following hold, checked against `.concertino/runs/<TICKET_ID>/evidence/` (the durable directory `persist-evidence.sh` writes into, preserving each source's path relative to its own worktree top-level — see that script's destination-naming contract):
- a persisted `design.md` (at `.concertino/runs/<TICKET_ID>/evidence/openspec/changes/<CHANGE_NAME>/design.md`, i.e. `persist-evidence.sh`'s ordinary worktree-relative destination for that file) containing a `## Gate-Chain Implications Checklist` heading with all required sub-items (what it executes; what environment it inherits and from where; whether it writes outside its own sandbox; linked-worktree vs. main-checkout behavior; first-run behavior) answered with non-empty, non-placeholder content;
- for **every** gate-chain-touching script path `check-gate-chain-change.sh` identified in the diff (not merely one unrelated passing transcript) — a persisted isolation-test transcript at the fixed, predictable destination `test-gate-in-isolation.sh` always writes to for that exact script path (see the Isolation-test helper requirement's destination-naming rule below), recording a pass verdict for that script.

A run that omits either piece of evidence, or that has isolation-test evidence only for some (not all) of the gate-chain-touching scripts actually in the diff, SHALL fail this gate regardless of whether an agent believed it had satisfied the requirement — the check is against the evidence artifacts on disk, keyed to the specific script paths the diff actually touched, not against agent self-report or an unrelated script's passing evidence.

**Answer extent (CON-169).** Each checklist sub-item's answer SHALL be read as the whole span from the end of its `**<prompt>**` marker to the earliest subsequent occurrence of any other known prompt marker, or to the end of the `## Gate-Chain Implications Checklist` section when no such marker follows — NOT merely to the first newline after the marker. An answer MAY therefore begin on the line below its marker, span multiple lines, and contain blank lines and bold spans of its own. Placeholder detection (`tbd`, `n/a`, `na`, `todo`, empty) SHALL be applied to that whole trimmed span, so a prompt that is empty, holds only a placeholder, or holds only markdown list-marker/whitespace residue (e.g. the bare `-` swept in from an immediately following bulleted prompt's own marker — the bulleted style, `- **<prompt>**`, this checklist's own template uses) across its full extent is still reported unanswered.

#### Scenario: Gate-chain diff with no evidence
- **WHEN** the branch's diff is gate-chain-touching and no evidence directory/files exist for the ticket
- **THEN** `assert-phase.sh delivery` fails with a message identifying the missing evidence

#### Scenario: Gate-chain diff with checklist but no isolation-test evidence
- **WHEN** the branch's diff is gate-chain-touching, the persisted `design.md` contains a fully-answered checklist, but no isolation-test transcript exists for any gate-chain-touching script in the diff
- **THEN** `assert-phase.sh delivery` fails with a message identifying the missing isolation-test evidence

#### Scenario: Isolation-test evidence exists but not for the script actually changed
- **WHEN** the branch's diff adds or modifies gate-chain script `scripts/foo.mjs`, and a persisted isolation-test transcript exists only for a different, previously-tested script `scripts/bar.mjs`
- **THEN** `assert-phase.sh delivery` fails, identifying `scripts/foo.mjs` specifically as missing its own isolation-test evidence — a passing transcript for an unrelated script SHALL NOT satisfy this gate

#### Scenario: Gate-chain diff with both evidence pieces present and complete for every touched script
- **WHEN** the branch's diff is gate-chain-touching and both the answered checklist and a passing isolation-test transcript for every gate-chain-touching script in the diff exist under `.concertino/runs/<TICKET_ID>/evidence/`
- **THEN** `assert-phase.sh delivery` proceeds to its other existing checks unaffected

#### Scenario: Non-gate-chain diff
- **WHEN** the branch's diff is not gate-chain-touching
- **THEN** `assert-phase.sh delivery` runs unaffected by this requirement (no evidence required)

#### Scenario: A checklist prompt answered as a multi-line block satisfies the checklist check
- **WHEN** a gate-chain-touching diff's persisted `design.md` answers `What does it execute?` with a multi-line explanation beginning on the line below the prompt marker, leaving the remainder of the marker line empty
- **THEN** `assert-phase.sh delivery` does not report that prompt as unanswered

#### Scenario: A bulleted checklist prompt left empty before another bulleted prompt still fails the delivery gate

- **WHEN** a gate-chain-touching diff's persisted `design.md` writes `- **What does it execute?**` with nothing after it, as its own bullet immediately followed by another bulleted prompt (e.g. `- **What environment does it inherit, and from where?** ...` on the next line)
- **THEN** `assert-phase.sh delivery` fails with a message naming `What does it execute?` as unanswered — the swept-in leading `-` of the next bullet does not count as an answer

#### Scenario: A checklist prompt left empty across its whole extent still fails the delivery gate
- **WHEN** a gate-chain-touching diff's persisted `design.md` has a `What happens on its first run?` marker followed only by blank lines until the end of the section
- **THEN** `assert-phase.sh delivery` fails with a message naming that prompt as unanswered

