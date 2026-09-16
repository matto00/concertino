# canonical-docs-binding Specification

## Purpose
Guarantees that every role a `canonicalDocs` entry can be bound to actually receives that document in its rendered agent file, and that a binding which cannot be rendered fails configuration validation loudly instead of being silently discarded.

## ADDED Requirements

### Requirement: A canonical doc binds to every supported role
`concertino sync` SHALL render each `canonicalDocs` entry into the rendered agent file of every role named in that entry's `bindTo`, for all five roles (`orchestrator`, `executor`, `evaluator`, `skeptic`, `auditor`). No supported role may accept a binding and omit the document.

#### Scenario: a doc bound to the auditor reaches the auditor
- **WHEN** a `canonicalDocs` entry whose `bindTo` includes `auditor` is configured and `concertino sync` is run
- **THEN** the rendered auditor agent file contains that entry's path
- **AND** the document appears before the auditor's merge decision, so it is read while the merge is still undecided rather than after

#### Scenario: a doc bound to the orchestrator reaches the orchestrator
- **WHEN** a `canonicalDocs` entry whose `bindTo` includes `orchestrator` is configured and `concertino sync` is run
- **THEN** the rendered orchestrator agent file contains that entry's path

#### Scenario: a doc bound to all five roles reaches all five
- **WHEN** a `canonicalDocs` entry whose `bindTo` names all five roles is configured and `concertino sync` is run
- **THEN** every one of the five rendered agent files contains that entry's path

#### Scenario: existing three-role bindings are unchanged
- **WHEN** a `canonicalDocs` entry binds only to `executor`, `evaluator`, and `skeptic`
- **THEN** those three rendered agent files contain the entry's path exactly as they did before this capability existed
- **AND** the orchestrator and auditor agent files do not contain it

#### Scenario: a role with no bound docs renders the empty marker
- **WHEN** no `canonicalDocs` entry binds to a given supported role
- **THEN** that role's rendered agent file renders the same "none configured" marker the already-supported roles render, rather than an unsubstituted placeholder or an empty section

### Requirement: An unrenderable binding fails validation
Configuration validation SHALL fail, naming both the offending entry and the specific role, when a `canonicalDocs` entry's `bindTo` names a role that has no docs placeholder to receive it. Validation MUST NOT report such a binding as successfully configured.

#### Scenario: a bindTo target with no placeholder is a hard error
- **WHEN** a `canonicalDocs` entry names a role whose role template contains no docs placeholder
- **AND** `concertino validate` is run
- **THEN** validation fails rather than passing
- **AND** the failure message names the offending entry and the role that cannot receive it
- **AND** the binding is not reported as configured

#### Scenario: a fully renderable configuration still passes
- **WHEN** every role named across all `canonicalDocs` entries has a docs placeholder
- **THEN** validation reports no error for those entries

#### Scenario: an unknown role name is rejected rather than ignored
- **WHEN** a `canonicalDocs` entry's `bindTo` names a value that is not a supported role at all
- **THEN** validation fails naming that entry and that value, rather than silently dropping it

### Requirement: The configuration schema admits every supported role
The published configuration schema SHALL accept all five supported roles as `canonicalDocs.bindTo` values, so a binding that renders correctly is never simultaneously schema-invalid.

#### Scenario: schema accepts an auditor binding
- **WHEN** the schema's `canonicalDocs.bindTo` value set is consulted for the value `auditor` or `orchestrator`
- **THEN** that value is admitted as valid
