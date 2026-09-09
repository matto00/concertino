# Design: premise-validation gate accepts multi-line field answers

## Decision 1 — Fix the parser, do not tighten the template

The ticket names two directions and explicitly leaves the choice to this change.

**Chosen: read each field's answer to the next field marker / section boundary.**

Reasoning, recorded as the ticket requires:

1. **The artifact is the point.** The premise-validation step exists to produce a durable record
   that a human or a later agent can audit. A multi-claim ticket produces several independent
   claims, each with its own CONFIRMED/STALE/UNVERIFIABLE tag and its own evidence. The real
   artifacts written on this repo tonight are long multi-claim documents; collapsing them to one
   line per field would make the record strictly less useful at exactly the moment it matters
   most (a ticket with many decayed premises). Tightening the template optimises the gate's
   implementation at the artifact's expense — the wrong trade for a mechanism whose whole value
   is the artifact.
2. **The template is already the published contract.** `core/roles/orchestrator.md` has instructed
   "one line per claim" since CON-136; four lanes wrote to that contract and were rejected by it.
   Between a prompt that asks for the useful shape and a parser that cannot read it, the parser is
   the defect. Changing the prompt would ratify the parser's limitation as intended behaviour.
3. **The failure is silent-adjacent, not loud.** The message claims the field is *unanswered*,
   which is false and sends the agent looking for missing content rather than a parsing bound.
   Fixing the parser removes the misleading state entirely; tightening the template would leave
   the same misleading message in place for anyone who writes a list anyway.
4. **Cost asymmetry.** Tightening the template is a prompt edit with no mechanical enforcement —
   nothing stops the next agent writing a list, so the friction would recur. The parser fix is
   enforced in code and covered by tests.

**Rejected: demand single-line answers.** Recorded for completeness; it would be cheaper to
implement and is genuinely defensible if one values gate simplicity above artifact quality. It
loses on every point above.

## Decision 2 — Fix both occurrences of the parser, not just the one the ticket names

`core/scripts/assert-phase.sh` contains the same extraction logic twice:

- lines ~168-176, the `setup` gate's premise-validation field check (three fields), and
- lines ~304-313, the Delivery gate's `## Gate-Chain Implications Checklist` check (five prompts).

They are byte-identical in the relevant lines and carry the same `placeholders` set. The ticket
describes only the first; the second was found during premise validation for this change.

**Chosen: fix both, in this change.** Reasoning:

- The checklist's five prompts are full questions ("What environment does it inherit, and from
  where?"). A truthful answer to those is *more* likely to be multi-line than a premise claim, so
  the second site is at least as exposed as the first — it simply has not been hit yet because
  gate-chain diffs are rare in this repo (there is no `.husky/` here at all).
- Leaving a known-identical defect in place, in the same file, one screen away, is how the same
  incident gets rediscovered under a different ticket number. The fix is the same few lines.

**Rejected: fix only the `setup` site and file a follow-up.** It would keep the diff nominally
scoped to the ticket, but at the cost of shipping a file that contradicts itself — one fixed
parser and one broken parser, in the same script.

### How the two sites actually share the logic (design-gate correction)

An earlier draft of this design called for "a single shared JS helper" spanning both sites. That
is not achievable as stated: the two checks are two *separate* single-quoted `node -e` programs,
in two different `case` branches of `assert-phase.sh` (around lines 153 and 289). They are
distinct node processes with no common JS scope, so no in-file function can be shared between
them.

**The sharing mechanism is a file, not a scope.** The extraction logic moves into a new
`core/scripts/lib/field-answers.js` exporting a single function, which both `node -e` programs
`require()` via the `SCRIPT_DIR` the script already computes — the same idiom
`assert-phase.sh:31` already uses for `lib/git-child-env.sh`. The absolute lib path is passed to
each `node -e` as an argv element rather than interpolated into the single-quoted program body,
so no shell quoting is introduced into the JS source.

This is safe with respect to the render pipeline: `lib/cli/shared.js`'s `listFilesRecursive`
enumerates `core/scripts/**` recursively, so a future `concertino sync` renders the new lib file
automatically with no manifest edit — and `scripts/concertino/lib/` already exists as a render
target (`auditor-lease.sh`, `git-child-env.sh`). For *this* delivery the rendered counterpart is
produced by direct `cp`, like the script itself.

Consequence to expect: **the drift gate stays 18/18 green.** Its assertion count does not rise
per rendered file — `run_drift_check` reports the entire real-tree walk as a single assertion
(1.1), and the remaining 17 are scratch-tree mutation checks that never touch `core/scripts`. The
evidence that the gate actually noticed the new render target is therefore not a count change but
a *failure mode*: if task 4.2's `cp` of the lib file were skipped, assertion 1.1 would go RED
naming `lib/field-answers.js` under `never rendered:`. Task 4.2 demonstrates exactly that
transition (red before the `cp`, green after) rather than merely asserting the file was copied.

This is the single, authoritative statement of the drift consequence for this change; see also
the Render obligation section, which defers to it rather than restating it.

## Decision 3 — Answer extent is delimited by field markers, not by blank lines

The ticket offers "next `**<field>:**` marker **or** blank-line-delimited block". These differ:
a blank line between an intro sentence and its bullet list is normal markdown and would truncate
the answer under the blank-line rule. **Chosen: extend to the next *known* field marker, or the
end of the section.**

Specifically, for a field list `F`, the answer for `F[i]` runs from the end of `F[i]`'s marker to
the earliest subsequent occurrence of any marker in `F` (including `**Verdict:**` for the
premise-validation site), or the section end if there is none. The section itself is already
bounded by the next `\n## ` heading, unchanged.

This directly addresses the edge case the driver flagged: **a bold span inside an answer's prose
cannot truncate the answer**, because only the known, enumerated field markers are searched for —
not a generic `\*\*.*?:\*\*` pattern. An answer may contain `**anything else:**` safely. It may
not contain a *literal other field marker* of the same document (e.g. writing the words
`**Verdict:**` inside the Claims-checked prose), which is an acceptable and self-evident
restriction: those strings are structural in this document shape.

Markers are located by scanning positions, and the ordering is derived from the actual text, not
from the declared field order — so a document that lists its fields out of order still parses
correctly rather than yielding a negative-length slice.

## Decision 4 — Placeholder detection over the whole extent

`placeholders` remains `{tbd, n/a, na, todo, ""}` and is applied to the trimmed *whole* answer.
Consequences, all intended:

- A field whose marker is followed by nothing until the next marker trims to `""` and is still
  reported unanswered — the genuinely-empty multi-line case the driver asked to preserve.
- A field answered only with `TBD` — whether on the marker line or alone on the line below it —
  is reported unanswered under both the pre-fix and fixed parsers. This is *not* a tightening: the
  pre-fix parser reaches the same "unanswered" verdict for the below-marker shape by a different,
  coincidental route (its first line after the marker is empty, so it matches the `""` placeholder
  branch without ever reading the word `TBD`); the fixed parser reaches it by actually reading
  `TBD` via the `tbd` branch. Nothing was newly caught and nothing slipped through — this is
  preserved behaviour reached by a sounder route, which is exactly why the covering test
  (`test/scripts/assert-phase.test.sh`'s GUARD 2.8) is labelled a GUARD rather than a PROOF: it is
  not expected to distinguish the two parsers, only to keep working under the fixed one.
- A whitespace-only answer (e.g. spaces or a blank continuation line only) trims to `""` under
  the same `.trim()` applied to every extracted span, so it **is** caught as unanswered — this
  was mis-stated in an earlier draft of this section (corrected during evaluation, CON-169
  cycle 2). A bullet-marker-only answer — an empty field immediately followed by another
  bulleted field, whose leading list-marker character(s) get swept into the empty field's extent
  (e.g. trimming to `"-"` rather than `""`) — **is also caught**: any extracted span consisting
  solely of markdown list markers (`-`, `*`, `+`) and/or whitespace, matched by
  `LIST_RESIDUE_ONLY` (`/^[-*+\s]*$/`), is treated as missing alongside the literal `placeholders`
  set. This was added during the final-gate skeptic's REFUTE (CON-169): an earlier draft of this
  change left the swept-dash case undetected and called it "the one case that is not caught" —
  measurement showed the pre-fix parser DID catch it (via its own first-line coincidence), so
  leaving it undetected here was a genuine regression, not an inherited limitation. It is now
  closed; see `test/scripts/assert-phase.test.sh`'s PROOF-IN-REVERSE 2.9/2.10 for the covering
  tests and their three-way (shipped-buggy / pre-fix / corrected) comparison. `LIST_RESIDUE_ONLY`
  does not false-positive on an answer that merely begins with a literal `-` character followed by
  real content (e.g. `-1 confirmed regression count`), since such an answer contains non-list-marker
  characters and fails the whole-string match.

## Decision 5 — Verdict extraction is left on its own path

`**Verdict:**` is extracted by a separate `match(/\*\*Verdict:\*\*\s*([^\n]*)/)` and validated
against a fixed vocabulary. It is deliberately single-line — a verdict is one of three tokens —
and is left unchanged, so this change cannot regress verdict validation. `**Verdict:**` *is*
added to the marker set used to bound the third field's extent, so a `Sibling collisions:` answer
stops where the verdict begins rather than swallowing it.

## Edge cases and how each is handled

| Edge case | Handling |
| --- | --- |
| Answer begins on the line below the marker | Extent runs to next marker; leading newline is trimmed |
| Answer is a multi-bullet list with internal blank lines | Preserved — blank lines do not delimit (Decision 3) |
| Bold span inside answer prose | Ignored — only enumerated markers are searched (Decision 3) |
| Answer ends at EOF with no trailing newline | Section slice already falls back to the remainder when no `\n## ` follows; extent falls back to section end |
| Field marker absent entirely | Unchanged — reported missing |
| Field present, wholly empty across its extent | Trims to `""` → unanswered (Decision 4) |
| Fields written out of document order | Extent derived from actual positions, never negative |
| Existing single-line artifacts | Extent ends at the next marker, which is on a later line; trimmed answer is the same string as before → no regression |

## Testing strategy

Per the CON-170 finding that a green assertion can be guaranteed by its own precondition, each
new test must be able to *fail*. String-parsing tests are especially prone to tautology, so:

- Every new fixture is run against **the pre-fix `assert-phase.sh`** (retrieved from
  `git show abd71b7:core/scripts/assert-phase.sh`) as well as the fixed one, and the transcript of
  the pre-fix failures is recorded as evidence. A new test that passes under *both* parsers proves
  nothing about this change and must be reclassified as a regression guard and labelled as such.
- The single-line regression test is explicitly a **guard**, not a proof: it is expected to pass
  under both parsers. It is labelled as a guard and its failability is demonstrated by mutation
  (breaking the extent computation must turn it red), not by the pre-fix run.
- Assertions match on the specific `FAIL unanswered: <field>` text and the field name, not merely
  on a non-zero exit, so a fixture failing for an unrelated reason (missing evidence file, bad
  verdict) cannot be mistaken for the behaviour under test.

## Render obligation

`core/scripts/assert-phase.sh` changes, so `scripts/concertino/assert-phase.sh` is refreshed by
direct `cp` in the same commit (never `concertino sync`, which would additionally render
`pricing-table.json` and `report-cost.sh` — untracked and pending owner ruling under CON-173).
For the drift-gate consequence and the red-then-green demonstration that task 4.2 performs, see
Decision 2's "Consequence to expect" paragraph — stated once, there, deliberately not restated
here.
