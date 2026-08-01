## 1. New Iron Law: ticket-drafting-escalation

- [x] 1.1 Create `core/laws/ticket-drafting-escalation.md` with frontmatter matching the existing
      two laws' format (`name`, `description`, `applies_to`), defining the Iron Law: an enumerated
      banned-hedge-phrase list for ticket-drafting text, and the structural rule that a ticket
      referencing an open question/fork/scope boundary with no stated resolution must not be
      finalized as-is — end with an instruction to raise a `ticket-ambiguity` escalation (per
      `core/roles/orchestrator.md`'s "How to raise one") instead of continuing.
- [x] 1.2 Add a row for `ticket-drafting-escalation.md` to the laws table in
      `core/laws/README.md`, matching the existing table's columns (File / Iron Law / Bound to).

## 2. New escalation-context kind: ticket-ambiguity

- [x] 2.1 Add a `ticket-ambiguity` case to `core/scripts/gather-escalation-context.sh`'s
      `VALID_KINDS` list and `case` block, requiring `signal` (`design-fork` | `scope-boundary` |
      `hedge-phrase`), `detail`, and `draft_excerpt`, printing a structured block matching the
      style of the five existing kinds.
- [x] 2.2 Update `core/scripts/README.md`'s `gather-escalation-context.sh` row to list the sixth
      kind alongside the existing five.

## 3. Orchestrator wiring (Phase 4 step 4)

- [x] 3.1 Amend `core/roles/orchestrator.md` Phase 4 step 4: state that composing that step's
      `question=` text (the one-shot follow-up-ticket suggestion — the only ticket-adjacent text
      this step produces; there is no downstream drafting/`mcp__linear__save_issue` step to gate)
      is governed by `WORKTREE_PATH/.concertino/laws/ticket-drafting-escalation.md`. A trigger hit
      while wording it means surfacing the fork within that same one-shot escalation (using the
      multi-part `sub_questions=` form documented in "How to raise one" when more than one fork
      applies) instead of silently collapsing it into one confidently-worded suggestion. This adds
      no new escalation call and does not grow, or count separately against, the existing one-shot
      cap on that step.
- [x] 3.2 Update the "How to raise one" section's "five kinds" language (and its bash comment
      enumerating them) to "six kinds," listing `ticket-ambiguity` alongside the existing five,
      consistent with `core/scripts/gather-escalation-context.sh`'s new `VALID_KINDS`.
- [x] 3.3 Introduce `core/laws/ticket-drafting-escalation.md` as `core/roles/orchestrator.md`'s
      *first* law reference (the file has none today — confirm via a case-insensitive grep for
      `law` before editing). Add a single inline pointer to
      `WORKTREE_PATH/.concertino/laws/ticket-drafting-escalation.md` at Phase 4 step 4 itself
      (where task 3.1's instruction lives) — do not fabricate a repo-wide "Iron Laws" section
      mirroring `executor.md`'s unrelated one; this law's binding is scoped to that one step.

## 4. Verification

- [x] 4.1 Run this project's test suite / relevant gates (per `concertino.config.json → gates`,
      filtered to files actually touched) and confirm they pass.
- [x] 4.2 Manually invoke `gather-escalation-context.sh ticket-ambiguity ...` with all required
      fields and confirm a structured block prints and exit code is 0; invoke it missing a
      required field and confirm `FAIL` on stderr, non-zero exit, empty stdout.
- [x] 4.3 Re-read the rendered `core/roles/orchestrator.md` Phase 4 section end-to-end and confirm
      the new instruction reads unambiguously as part of the existing one-shot-suggestion flow,
      not a new unbounded loop.
