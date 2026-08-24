## ADDED Requirements

### Requirement: gather-escalation-context.sh formats structured context for a seventh kind, ticket-drift

`core/scripts/gather-escalation-context.sh` SHALL accept a seventh kind, `ticket-drift`,
alongside the existing six (`dependency`, `api-change`, `budget`, `blocker`, `contradiction`,
`ticket-ambiguity`), requiring the fields `claimed` (what the ticket states — the premise,
root cause, or enumerated fact), `actual` (what the live tree/base branch actually shows), and
`options` (a short enumeration of how the human may resolve it — normally
`proceed-as-written`, `proceed-with-restated-scope`, `halt`), and SHALL print a structured,
human-readable plain-text context block to stdout, exiting 0. Because `escalation.raised`
events carry no caller-settable `kind` field (`emit-event.sh` structurally drops it), this
kind's output SHALL begin with the literal first line `TICKET-DRIFT-ESCALATION`, before the
claimed/actual/options content, so a consumer (the `premise-validation` capability's
`assert-phase.sh setup` check) can identify a `ticket-drift` escalation from the `context`
field alone, via a prefix match. A missing required field SHALL fail exactly as the six
existing kinds already do — `FAIL <reason>` to stderr, non-zero exit, nothing printed to
stdout.

#### Scenario: A ticket-drift escalation's context opens with the fixed marker and includes every field

- **WHEN** `gather-escalation-context.sh ticket-drift claimed="a stale global install
  downgrades rendered files" actual="the global is an npm-link symlink to the dev checkout,
  same inode, predating the incident" options="proceed-as-written,proceed-with-restated-scope,halt"`
  is run
- **THEN** it exits 0, its stdout's first line is exactly `TICKET-DRIFT-ESCALATION`, and the
  remainder mentions the claimed premise, the actual finding, and the options verbatim

#### Scenario: A missing required field fails without printing partial context

- **WHEN** `gather-escalation-context.sh ticket-drift claimed="X"` is run (missing `actual` and
  `options`)
- **THEN** it prints `FAIL` and a message naming the missing fields to stderr, exits non-zero,
  and prints nothing to stdout

#### Scenario: The six existing kinds are unaffected

- **WHEN** any of the six pre-existing kinds (`dependency`, `api-change`, `budget`, `blocker`,
  `contradiction`, `ticket-ambiguity`) is invoked exactly as before this change
- **THEN** its behavior, required fields, and output format are unchanged
