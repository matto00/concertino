## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/repo-contributing-docs/spec.md` in full.
- Confirmed `~/Development/helio/CONTRIBUTING.md` actually exists (`ls
  ~/Development/helio/CONTRIBUTING.md`), grounding design.md Decision 1's
  claim that the ticket's "model on helio's file if it exists" branch
  applies.
- Confirmed no `CONTRIBUTING.md` currently exists in the concertino repo
  (`find . -iname "CONTRIBUTING*"` → empty), matching the ticket's stated
  premise.
- Confirmed `package.json` scripts: `npm test` (runs `node --test` plus a
  long chain of `test/scripts/*.test.sh`) and `npm run test:selftest`
  (`concertino sync --dry-run`) both exist as named in design.md/tasks.md —
  the plan does not invent commands.
- Confirmed no lint/format/pre-commit tooling is configured (`grep -i
  "eslint|prettier|lint-staged|husky" package.json` → no matches; no
  `.husky/` dir) — validates the plan's explicit risk mitigation to not
  describe tooling that doesn't exist.
- Confirmed `docs/dashboard.md` exists as the reconciliation target for AC4.
- Spot-checked `lib/ui/watch.js` (2669 lines) and `lib/ui/screens/fleet.js`
  (1506 lines) — larger than the ticket's cited 2380/1314, but the ticket
  itself flags those figures as "not exhaustive," and tasks.md 3.1 correctly
  re-surveys file sizes rather than trusting the ticket's stale numbers, so
  this is not a plan defect.
- Traced all four ticket acceptance criteria to specific tasks:
  - AC1 (CONTRIBUTING.md, incl. `core/`→rendered template relationship) →
    tasks 2.1–2.3.
  - AC2 (written audit findings) → tasks 3.1–3.5.
  - AC3 (behavior-preserving cleanup; larger structural changes scoped to
    follow-up tickets) → design.md Non-Goals explicitly excludes keybinding-
    registry extraction and splitting `watch.js`/`fleet.js`, citing "per the
    ticket's own acceptance criteria"; Decision 3 gives a concrete,
    non-hand-wavy line for what's inline-fixable ("zero-risk and
    mechanically verifiable") vs. what goes to the audit doc as a
    recommendation; tasks 5.1–5.2 implement that split; task 6.1 runs
    `npm test` unchanged as the behavior-preservation gate.
  - AC4 (`docs/dashboard.md` reconciliation) → tasks 4.1–4.2, with a
    concrete method (grep each screen's `key ===` dispatch) called out in
    design.md's Risks section to avoid missing a keybinding.
- Checked for placeholders/hand-waving (`TODO`, `TBD`, deferred decisions)
  in proposal.md/design.md/tasks.md — none found.
- Checked for internal contradictions between proposal → design → tasks —
  none found; each decision in design.md is reflected in a corresponding
  task.
- Checked scope: design.md's Risks section explicitly bounds the audit to
  the four areas the ticket names, guarding against open-ended scope creep;
  Non-Goals explicitly defers the two named larger refactors (keybinding
  registry, `watch.js`/`fleet.js` splitting) to follow-up tickets rather
  than doing them inline, exactly as the ticket's own AC3 requires.
- Contract/spec check: no API, schema, or runtime-behavior change is in
  scope (proposal.md Impact section confirms), so no missing spec delta;
  the one new capability (`repo-contributing-docs`) has a spec.md with
  requirements/scenarios that map 1:1 onto ACs 1, 2, and 4.

### Verdict: CONFIRM

### Non-blocking notes

- The ticket's cited line counts for `watch.js`/`fleet.js` are already
  stale relative to the current repo state; not a plan defect since the
  plan re-surveys rather than trusting the stale numbers, but worth the
  executor being aware the audit doc should report actual current counts.
