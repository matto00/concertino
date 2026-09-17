# followup-survival-report Specification

## Purpose
Gives Concertino an on-demand, read-only report scoring whether filed follow-ups were worth making — the fraction of `origin_kind=followup` tickets that reach a completed state, segmented by origin and bucketed over time — so the revealed judgment that a suggestion mattered becomes measurable instead of assumed.

## Requirements

### Requirement: An on-demand, read-only follow-up survival report

The CLI SHALL provide a `concertino report followup-survival` subcommand that computes and prints follow-up survival on demand. The subcommand SHALL be read-only: it SHALL NOT write, mutate, or delete any event log, ticket, answer file, or rendered artifact, and SHALL NOT emit any event.

The subcommand SHALL accept `--help`/`-h` and print its own usage block, exiting 0, taking precedence over any other argument validation.

#### Scenario: Report runs on demand and prints a survival figure
- **WHEN** `concertino report followup-survival` is run in a project with at least one `ticket.filed` event whose `origin_kind` is `followup`
- **THEN** it prints an overall survival figure expressed as a surviving count, a total count, and a percentage, and exits 0

#### Scenario: The report writes nothing
- **WHEN** `concertino report followup-survival` is run
- **THEN** no file under `.concertino/runs/` is created, modified, or deleted, and no event is appended to any `events.jsonl`

#### Scenario: Help flag takes precedence
- **WHEN** `concertino report followup-survival --help` is run, even in a directory with no config and no event store
- **THEN** it prints the subcommand's usage block and exits 0

### Requirement: Survival is segmented by originating role, suggested_by, and triage overlap

The report SHALL present survival segmented by the `ticket.filed` event's `origin_role`, by its `suggested_by` value, and by the `overlap` bucket of its persisted `triage` payload (`high`, `partial`, `none`, `unknown`).

Because the only code path that emits `ticket.filed` records `origin_role=orchestrator` unconditionally, the report SHALL label the `origin_role` segmentation as single-valued whenever every observed row carries the same role, stating that the axis cannot currently resolve the five roles the ticket's acceptance criteria name. The report SHALL NOT present a single-valued role axis as though it were a resolved comparison between roles.

#### Scenario: Segmentation by all three axes is present
- **WHEN** the report runs over `ticket.filed` rows carrying differing `suggested_by` and `triage.overlap` values
- **THEN** it prints a survival figure per `origin_role` value, per `suggested_by` value, and per `triage.overlap` bucket

#### Scenario: A single-valued role axis is labelled as such
- **WHEN** every `ticket.filed` row observed carries `origin_role=orchestrator`
- **THEN** the role segmentation is annotated as single-valued, naming that the emitting path hardcodes the role, rather than being presented as a five-role comparison

#### Scenario: A malformed or absent triage payload becomes an explicit unknown bucket
- **WHEN** a `ticket.filed` row's `triage` field is absent, or is present but not parseable as an object carrying an `overlap` value
- **THEN** that row is counted in an `unknown` overlap bucket and is never silently dropped from the overall total

### Requirement: Survival is computed over time

The report SHALL bucket follow-ups by the period in which they were filed and present survival per bucket in chronological order, so that a trend in survival across the corpus period is readable from the output.

A bucket containing no follow-ups SHALL be reported as empty rather than as zero survival.

#### Scenario: Survival is reported per filing period
- **WHEN** the report runs over follow-ups filed across more than one period
- **THEN** it prints one survival figure per period, in chronological order

#### Scenario: Distinguishing exhaustion from suppression is possible from the output
- **WHEN** survival per period is printed
- **THEN** the output states, for each period, both the number of follow-ups filed and the fraction surviving, so that falling volume with flat survival is distinguishable from falling volume with falling survival

#### Scenario: An empty period is not reported as zero survival
- **WHEN** a period in the reported range contains no filed follow-ups
- **THEN** that period is reported as having no data, and is not reported as 0% survival

### Requirement: Provenance sources are attributed and never merged

The report SHALL draw on two independent sources and SHALL keep them separate in its output:

- a **provenance** tier, derived from `ticket.filed` events, which is authoritative; and
- a **recovered-heuristic** tier, derived from matching ticket text against a stated textual marker, which is indicative only.

The report SHALL state, for every figure it prints, which tier produced it. The report SHALL NOT combine counts from the two tiers into a single survival figure, and SHALL NOT present a heuristic-derived figure without naming the marker used to recover it.

#### Scenario: Each figure names its tier
- **WHEN** the report prints any survival figure
- **THEN** that figure is labelled as either provenance-derived or heuristic-recovered

#### Scenario: The heuristic marker is disclosed
- **WHEN** the report prints a heuristic-recovered figure
- **THEN** it also prints the textual marker used to recover those rows, so a reader can judge the recall and precision of the recovery

#### Scenario: Tiers are not summed
- **WHEN** both tiers contain rows
- **THEN** the report prints a separate total per tier and prints no combined total that sums them

### Requirement: The recovered tier excludes rows the provenance tier already counted

The recovered tier SHALL mean strictly what the provenance tier missed. Any ticket already present in the provenance tier SHALL be excluded from the recovered tier, matched on ticket identity, so the two tiers describe disjoint sets of tickets. The report SHALL disclose how many rows were excluded for this reason, so the exclusion is visible rather than inferred.

This is required because the filing convention writes the provenance markers into a ticket's description text unconditionally, independently of whether a provenance event was also recorded — so without exclusion a ticket carrying both would be counted in both tiers.

#### Scenario: A ticket with both a provenance event and matching description text is counted once
- **WHEN** a ticket has a recorded provenance entry AND its description matches the convention marker
- **THEN** it is counted in the provenance tier only, and is absent from the recovered tier

#### Scenario: The number of excluded rows is disclosed
- **WHEN** one or more recovered rows are excluded for already having provenance
- **THEN** the report states how many rows were excluded and why

#### Scenario: Tiers describe disjoint ticket sets
- **WHEN** both tiers are printed
- **THEN** no ticket identity appears in both tiers' populations

#### Scenario: Exclusion applies to breakdowns, not only to the overall total
- **WHEN** a ticket with recorded provenance would fall into a particular period bucket and segment of the recovered tier
- **THEN** it is absent from that period's and that segment's recovered counts, not merely from the recovered overall total

#### Scenario: The migration effect is disclosed to the reader
- **WHEN** both tiers have at least one period containing data
- **THEN** the report states that a declining recovered-tier volume over time must be read alongside provenance-tier growth, because rows move from the recovered tier into the provenance tier as provenance coverage accrues

### Requirement: An empty corpus produces an explicitly empty result

When no `ticket.filed` event with `origin_kind=followup` exists, the report SHALL print a well-formed result stating that the provenance tier is empty and why, and SHALL exit 0. It SHALL NOT print `0%` survival for the provenance tier, SHALL NOT fail, and SHALL NOT substitute the heuristic tier's figure as though it were the provenance figure.

#### Scenario: Zero provenance rows is reported as empty, not as zero percent
- **WHEN** the report runs against an event store containing no `ticket.filed` events
- **THEN** it states that no follow-up provenance has been recorded yet, prints no provenance survival percentage, and exits 0

#### Scenario: The heuristic tier does not stand in for the provenance tier
- **WHEN** the provenance tier is empty and the heuristic tier has recovered rows
- **THEN** the heuristic figure is printed under its own tier label and the provenance tier is still reported as empty

### Requirement: A survival percentage over a small denominator is suppressed

The report SHALL NOT present a survival percentage computed over a denominator below a stated minimum. Where the denominator is below that minimum, the report SHALL print the surviving and total counts and SHALL mark the percentage as withheld for small sample size, naming the minimum. This SHALL apply to the overall figure and to every segment and period bucket independently.

#### Scenario: A single-row population does not yield a percentage
- **WHEN** exactly one follow-up is known and it has not reached a completed state
- **THEN** the report prints the counts and a small-sample marker, and does not print `0%`

#### Scenario: A denominator at or above the minimum does yield a percentage
- **WHEN** a population's denominator reaches the stated minimum
- **THEN** a percentage is printed for that population

#### Scenario: Suppression is applied per segment, not only overall
- **WHEN** the overall denominator is above the minimum but one segment's denominator is below it
- **THEN** that segment's percentage is withheld while the overall percentage is printed

### Requirement: Recovered rows are attributed to the specific marker that matched

Recovery from ticket text SHALL distinguish the provenance-convention marker from any weaker prose heuristic, SHALL record for each recovered row which marker matched, and SHALL print every marker used. Convention matching SHALL tolerate surrounding markdown formatting, so that a key rendered with emphasis or code formatting before its colon still matches.

Where a field is not present in recoverable form, the row's value for that field SHALL be `unknown`; it SHALL NOT be inferred from an adjacent link or from the ticket's identifier.

#### Scenario: A formatted convention marker still matches
- **WHEN** a ticket description renders the convention key with code formatting immediately before its colon
- **THEN** that ticket is recovered as a convention row, not missed

#### Scenario: Marker attribution is visible per row
- **WHEN** both a convention row and a prose-heuristic row are recovered
- **THEN** each is labelled with the marker that matched it, and the two are not pooled into one figure

#### Scenario: An unrecoverable field is unknown, not guessed
- **WHEN** a recovered ticket carries no triage payload and no plain-text origin ticket reference
- **THEN** its overlap bucket and origin ticket are reported as `unknown` rather than inferred

### Requirement: Unrecoverable provenance is reported as unknown rather than guessed

For tickets filed before provenance emission existed, the report SHALL classify rows it cannot attribute as `unknown` and SHALL report the unknown count alongside every aggregate it affects. The report SHALL NOT infer an `origin_role`, `suggested_by`, `origin_kind`, or `triage.overlap` value that was never recorded.

#### Scenario: Unknown rows are counted, not dropped or invented
- **WHEN** the report encounters tickets that carry no recorded provenance
- **THEN** it reports them in an `unknown` count and does not assign them a role, a suggester, or an overlap bucket

### Requirement: Completion state and age are read from real ticket state

Survival SHALL be determined by the ticket provider's completion state, using the provider's state *type* rather than a display name, so that a renamed workflow state does not silently change the result. For follow-ups that have not reached a completed state, the report SHALL present the median age of those tickets.

When ticket-provider credentials are unavailable, the report SHALL say so explicitly and SHALL NOT report a survival figure computed as though every ticket were incomplete.

#### Scenario: Completion is keyed on state type
- **WHEN** a follow-up ticket is in a state whose type is `completed` but whose display name is not `Done`
- **THEN** that ticket is counted as surviving

#### Scenario: Median age of non-survivors is reported
- **WHEN** one or more follow-ups have not reached a completed state
- **THEN** the report prints the median age of those non-surviving follow-ups

#### Scenario: Completion state is read from a source that actually carries it
- **WHEN** the report resolves ticket completion state and description text
- **THEN** it uses a query that selects those fields, and never a single-issue lookup that returns only identifiers and labels, so an absent description is never mistaken for a non-matching one

#### Scenario: Missing credentials are an explicit refusal, not a zero
- **WHEN** the report is run without ticket-provider credentials available
- **THEN** it states that completion state could not be read and exits non-zero, rather than reporting 0% survival

### Requirement: Escalation-derived figures are segmented at the instrumentation boundary

If the report presents any figure derived from escalation events, it SHALL segment that figure at the point reliable escalation identity was introduced, reporting pre-boundary and post-boundary populations separately, and SHALL NOT present a single figure averaged across the boundary.

#### Scenario: Escalation figures are split at the boundary
- **WHEN** the report includes any escalation-derived count or rate
- **THEN** it reports the pre-boundary and post-boundary populations separately and states that pre-boundary escalation pairing is unreliable
