## ADDED Requirements

### Requirement: A trailing newline in the rendered text does not produce an extra written row
When the text handed to the frame builder ends in a trailing newline, the dashboard SHALL NOT count or write an extra blank row for the empty string that trailing newline produces when the text is split into lines — the written frame's row count and content SHALL reflect only the actual rendered lines.

#### Scenario: A frame built from newline-terminated text has no phantom trailing row
- **WHEN** the dashboard redraws from text that ends in `'\n'` (the normal case — `draw()` always appends one)
- **THEN** the bytes written to the terminal contain exactly the rendered content's rows, with no additional fully-blank row appended at the bottom
