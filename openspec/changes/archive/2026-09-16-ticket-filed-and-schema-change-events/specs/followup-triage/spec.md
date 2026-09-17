## ADDED Requirements

### Requirement: A standalone verdict records the filed ticket's provenance

When the human selects `standalone` and the orchestrator files a follow-up ticket, it SHALL additionally emit a `ticket.filed` event for that newly filed ticket (per the `ticket-provenance` capability) and SHALL write `origin_kind` and `origin_ticket` onto the filed ticket itself. The provenance SHALL record `origin_kind: followup`, `suggested_by` reflecting whether the suggestion came from an agent or the human, the filing role and phase, the repository the orchestrator was running in, and the triage signal that produced the recommendation.

A filed follow-up ticket with no corresponding `ticket.filed` event SHALL NOT satisfy this requirement, and neither SHALL a `ticket.filed` event for a ticket that was never actually filed.

This SHALL hold for every `ticketProvider.kind` variant the standalone verdict supports, so provenance does not depend on which provider a project configures.

#### Scenario: A standalone follow-up emits provenance alongside the filed ticket
- **WHEN** the human selects `standalone` and the orchestrator files the follow-up ticket
- **THEN** a `ticket.filed` event is emitted for the new ticket recording `origin_kind: followup` and the origin ticket, and the filed ticket itself carries `origin_kind` and `origin_ticket`

#### Scenario: Provenance is recorded under every provider variant
- **WHEN** the standalone verdict files a ticket under a remote provider, and under the local provider
- **THEN** a `ticket.filed` event is emitted in both cases, carrying the same provenance fields

#### Scenario: A filed ticket with no event does not satisfy the requirement
- **GIVEN** a follow-up ticket was filed for a `standalone` verdict
- **AND** no `ticket.filed` event was emitted for it
- **THEN** this state does not satisfy this requirement

## MODIFIED Requirements

### Requirement: triage-followup.sh computes file overlap and a deterministic recommendation
`core/scripts/triage-followup.sh` SHALL accept `description=`, `files=`
(comma-separated, or the literal `unknown`), `ac_relevant=` (`yes`/`no`),
`effort=` (`small`/`large`), `worktree=` (a path), and an optional `base=`
(defaulting to `${CONCERTINO_BASE_BRANCH:-main}` when omitted, matching
`core/scripts/cleanup.sh`/`core/scripts/assert-phase.sh`'s existing
base-branch convention), and SHALL:
- compute the current change's already-modified files via
  `git -C <worktree> diff --name-only <base>...HEAD`;
- classify overlap between `files=` and that list as `high` (>=50% of
  `files=`'s entries appear in the diff), `partial` (some but <50%), `none`
  (no overlap), or `unknown` (when `files=unknown` was given, never treated
  as overlap);
- apply this fixed decision table to produce a `recommendation` of `fold-in`
  or `standalone`: `ac_relevant=yes` always recommends `fold-in` regardless
  of effort/overlap; `ac_relevant=no` with `effort=small` and `overlap=high`
  recommends `fold-in`; `ac_relevant=no` with `effort=small` and
  `overlap=partial|none|unknown` recommends `standalone`; `ac_relevant=no`
  with `effort=large` recommends `standalone` regardless of overlap;
- print a plain-text block to stdout stating all four inputs, the computed
  overlap, the resulting recommendation, and the one rule that produced it,
  and note explicitly that `discard` is always a valid human choice
  regardless of the recommendation (the script never recommends `discard`
  itself — it has no signal for "not worth doing");
- additionally print one machine-readable line carrying the four values a
  `ticket.filed` event's `triage` field requires (`ac_relevant`, `effort`,
  the computed `overlap`, and the `recommendation`), distinguishable from
  the human-readable block by a fixed prefix, so the computed signal can be
  recorded rather than discarded. The human-readable block SHALL remain
  present and unchanged in meaning, since it is what the escalation passes
  through as `context=`;
- exit 0 on success.

A missing required field, an `ac_relevant`/`effort` value outside the
allowed set, or a `worktree=` that is not a git repository SHALL print
`FAIL <reason>` to stderr, print nothing to stdout, and exit non-zero —
mirroring `gather-escalation-context.sh`'s existing failure contract.

#### Scenario: High overlap and small effort recommends fold-in
- **WHEN** `triage-followup.sh description="tighten the icon set" files=lib/ui/icons.js ac_relevant=no effort=small worktree=<a worktree where lib/ui/icons.js is already in the diff> base=main` is run
- **THEN** it exits 0 and its stdout states overlap `high` and recommendation `fold-in`, naming the rule that produced it

#### Scenario: Acceptance-criteria-relevant work always recommends fold-in
- **WHEN** `triage-followup.sh description="add the missing validation the AC requires" files=unknown ac_relevant=yes effort=large worktree=<any valid worktree>` is run
- **THEN** it exits 0 and its stdout recommends `fold-in`, regardless of the `unknown` files/`large` effort

#### Scenario: Large effort or low overlap recommends standalone
- **WHEN** `triage-followup.sh description="add a new dashboard screen" files=lib/ui/screens/new-screen.js ac_relevant=no effort=large worktree=<a worktree where that file is not in the diff> base=main` is run
- **THEN** it exits 0 and its stdout states recommendation `standalone`

#### Scenario: A missing required field fails without printing partial output
- **WHEN** `triage-followup.sh description="x" ac_relevant=no worktree=<path>` is run (missing `files` and `effort`)
- **THEN** it prints `FAIL` and a message naming the missing field(s) to stderr, exits non-zero, and prints nothing to stdout

#### Scenario: The recommendation text always notes discard remains a valid choice
- **WHEN** `triage-followup.sh` succeeds with any combination of valid inputs
- **THEN** its stdout includes a statement that `discard` is a valid choice regardless of the computed recommendation

#### Scenario: The machine-readable line carries the recorded triage signal
- **WHEN** `triage-followup.sh` succeeds
- **THEN** its stdout includes one machine-readable line, identified by a fixed prefix, carrying `ac_relevant`, `effort`, the computed `overlap`, and the `recommendation`

#### Scenario: The human-readable context block is preserved
- **WHEN** `triage-followup.sh` succeeds
- **THEN** the human-readable block passed through as an escalation's `context=` is still printed, unchanged in meaning
