## ADDED Requirements

### Requirement: Priority is fetched from Linear
The Linear GraphQL query (`lib/ui/linear.js`) SHALL request each issue's `priority` field alongside the fields it already fetches.

#### Scenario: Query includes priority
- **WHEN** `fetchTickets` issues its GraphQL request
- **THEN** the query text includes `priority` in the `issues.nodes` selection set

### Requirement: Priority is normalised defensively, with 0 preserved as a real value
The normaliser (`normaliseTicket`) SHALL set a ticket's `priority` field using the same defensive-typing pattern as its neighbouring fields: `typeof node.priority === 'number' ? node.priority : null`. A `priority` of `0` (Linear's "None") SHALL be preserved as `0`, never coerced to `null` or any other falsy-triggered fallback (no `||` on the raw value).

#### Scenario: Numeric priority, including 0, passes through unchanged
- **WHEN** a fetched issue node has `priority: 0`
- **THEN** the normalised ticket's `priority` is `0`, not `null` and not any other value

#### Scenario: Non-numeric or missing priority normalises to null
- **WHEN** a fetched issue node has a missing or non-numeric `priority` field
- **THEN** the normalised ticket's `priority` is `null`

### Requirement: A pre-priority cache is detected and invalidated, never silently misread
The on-disk ticket cache SHALL carry a schema version. A cache file whose schema version is missing or does not match the current version SHALL be treated as cold (equivalent to no cache), never read as if its tickets have a real `priority` value.

#### Scenario: Cache written by the current code round-trips
- **WHEN** `cache.write()` writes a payload and it is immediately read back with `cache.read()`
- **THEN** the read result's tickets carry whatever `priority` values were written, unaltered

#### Scenario: A cache file predating the priority field is treated as cold
- **WHEN** `cache.read()` is called against a cache file with no `schemaVersion` field (or one older than the current version), such as a file written before this change shipped
- **THEN** `cache.read()` returns the same result as an unreadable/malformed cache (`empty()`), not a result whose tickets are missing only `priority`

#### Scenario: A stale cache is never rendered as priority None
- **WHEN** the launch pad opens against a cache invalidated by a schema-version mismatch
- **THEN** no ticket is rendered with priority `0`/None as a consequence of the stale cache — the launch pad shows its existing cold-cache state ("no tickets cached yet — press r to fetch") instead

### Requirement: Priority renders as a distinct column in the tickets pane
`ticketRow` SHALL render each ticket's priority as its own fixed-width column, re-deriving the row's fixed-width budget (`TICKET_ROW_FIXED`) rather than appending the column on top of the existing budget. The identifier+title column SHALL absorb the width lost to the new column. A `priority` of `null` or `undefined` SHALL render as a visibly distinct "unknown" indicator, never as the same rendering used for `0`/None.

#### Scenario: Known priority values render distinct labels
- **WHEN** a ticket's `priority` is `0`, `1`, `2`, `3`, or `4`
- **THEN** `ticketRow` renders a label distinguishing None/Urgent/High/Medium/Low, and no two different priority values render identical labels

#### Scenario: Unknown priority is visibly distinct from None
- **WHEN** a ticket's `priority` is `null` or `undefined`
- **THEN** `ticketRow` renders a label that is visibly distinct from the label used for `priority: 0` (None)

#### Scenario: Adding the priority column does not corrupt the status column
- **WHEN** `ticketRow` is called with a `width` that exactly fits marker, checkbox, priority column, identifier+title, and status
- **THEN** the rendered line's status column is not truncated as a result of the priority column's addition (re-deriving `TICKET_ROW_FIXED` accounts for the new column's width)

### Requirement: Tickets can be sorted by priority
The tickets pane SHALL support sorting by priority, in addition to its existing default order, selectable by a key binding. Priority sort order SHALL rank by urgency (Urgent, High, Medium, Low, None, then unknown last), not by Linear's raw integer encoding (where `0` is None, not the lowest urgency).

#### Scenario: Toggling priority sort reorders the tickets pane
- **WHEN** the priority-sort key is pressed while the tickets pane is focused
- **THEN** the tickets pane's rendered order changes to rank by priority urgency (Urgent first, None before unknown, unknown last) instead of the previous order

#### Scenario: Priority sort does not misrank None ahead of real priorities
- **WHEN** the tickets pane is sorted by priority and includes tickets with priority `0` (None) and priority `1` (Urgent)
- **THEN** the priority-`1` (Urgent) ticket is ranked ahead of the priority-`0` (None) ticket
