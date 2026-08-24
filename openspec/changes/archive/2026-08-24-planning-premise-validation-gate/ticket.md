# CON-136: Planning must validate the ticket's premise against the tree and escalate on scope drift

## Description

Planning takes the ticket's description as given. `core/roles/orchestrator.md` step 1 fetches the ticket, checks for `harness:*` and `type:design` labels, and proceeds to derive a branch name. Nothing tests whether the ticket is still true.

"Scope drift" appears in the role doc exactly once (line ~1054), and only as an example of an escalation that doesn't fit `gather-escalation-context.sh`'s six kinds. It is acknowledged as a thing that can be raised, but there is no step that would ever cause an orchestrator to notice it.

### Why it matters now

The helio backlog is 800+ tickets. Many were filed weeks or months before they run, and several are filed during incidents on partial information. A ticket's premise decays silently: files move, fixes land elsewhere, root causes get refuted, sibling tickets subsume scope.

The failure is expensive in the wrong direction. An agent that trusts a stale ticket does not fail loudly — it builds correct, well-tested machinery for a problem that no longer exists, and every downstream gate passes, because the gates check the work against the ticket, not the ticket against reality.

### Observed — six instances in one session (2026-08-22/23)

- CON-128: root cause refuted (npm-link symlink, not a stale global install).
- CON-131: filed claiming the repo root "is a bare checkout"; the flag was set mid-session by an unrelated incident.
- CON-127: framing wrong — sub-agents can reach the orchestrator via return value; the real gap is speaking without terminating.
- HEL-805: two of four scope bullets already done on main by the time it ran.
- HEL-633/HEL-634: file enumerations stale by execution time.
- HEL-637: predates ~50 READMEs a sibling ticket created.

## What to add

A Planning step, before branch derivation, that checks the ticket against current reality and escalates when they disagree:

1. Verify the premise. For a bug/incident ticket, confirm the stated cause still holds. For a ticket citing files/paths/symbols/counts, confirm they exist as described.
2. Check for already-done scope — acceptance criteria already satisfied on the base branch.
3. Check for collisions with recently-merged siblings, especially within an epic where an earlier leaf invalidates a later leaf's enumeration.
4. Escalate rather than self-correct when drift is material. A `ticket-drift` escalation kind, presenting: what the ticket claims, what is actually true, and options (proceed as written / proceed with a stated re-scope / halt for re-scoping). Minor staleness (a moved path, an off-by-one count) is re-derived silently and reported, not escalated — the bar is material drift that changes what gets built.

## Design constraints

- Do not make this pure agent recall (CON-132 precedent): the *prompt* must be mandatory and mechanically enforced (a Planning artifact section `assert-phase.sh` refuses to pass without), even though the *answer* is judgment. Do not fake a mechanical check that cannot exist.
- Keep cost proportionate: this runs on every ticket. State explicitly what it costs on a ticket with no drift.
- Do not weaken `core/laws/ticket-drafting-escalation.md` — that law covers ambiguity at drafting time; this is a well-drafted ticket that has since become untrue.

## Acceptance Criteria

- [ ] Planning includes a premise-validation step that runs before branch derivation and worktree creation.
- [ ] A run whose ticket cites files, paths or counts that no longer match the tree surfaces that, rather than proceeding on the stale enumeration.
- [ ] Material drift raises an escalation with what-was-claimed vs. what-is-true and explicit options; minor staleness is re-derived and reported without escalating.
- [ ] The check is enforced by the workflow, not by agent recall — a run that skips it fails a phase assertion.
- [ ] The step is demonstrated on a real stale ticket (CON-128's or CON-131's original text, preserved verbatim in their correction comments) and shown to detect the drift.
- [ ] Cost is bounded: a ticket with no drift adds negligible Planning time.

## Related

- CON-132 — "enforced by workflow, not agent recall" precedent and checklist mechanism.
- `core/laws/ticket-drafting-escalation.md` — adjacent, ambiguity-at-drafting-time vs decay-after.
- CON-128, CON-131, CON-127 — corrected tickets; their correction comments document what drift looked like in practice.
