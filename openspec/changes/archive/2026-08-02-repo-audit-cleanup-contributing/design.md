## Context

Concertino is a harness-agnostic agent-orchestration tool with zero runtime
dependencies — the TUI (raw-mode stdin, ANSI rendering, diffing), CLI parsing,
and the `core/` → rendered adapter template pipeline are all hand-rolled. The
repo has grown to the point that a few files carry multiple responsibilities
(`lib/ui/watch.js` at ~2380 lines mixes raw-mode input handling, alt-screen
buffer management, and a differential frame writer; `lib/ui/screens/fleet.js`
at ~1314 lines mixes section-building, rendering, and a large hardcoded
`handleKey` dispatch), there is no shared keybinding registry (each screen —
`fleet.js`, `drilldown.js`, `launchpad.js`, `launchplan.js`, `escalation.js`,
`docview.js`, `ticketview.js`, `ticketdraft.js` — hardcodes its own
`if (key === '...')` chain), `docs/dashboard.md` has already drifted from
actual UI behavior, and the `core/scripts/*` → rendered `scripts/concertino/*`
template split has already caused one drift bug (CON-52, a comment drifted
from its rendered copy). There is no `CONTRIBUTING.md` documenting any of
this for a new contributor.

## Goals / Non-Goals

**Goals:**
- Ship a `CONTRIBUTING.md` that documents actual practice: local dev setup,
  how to run/test changes (`npm test`, `npm run test:selftest`), the file-size
  and modularity conventions this codebase already leans on, and the
  `core/` → rendered `scripts/concertino/*` (and `.claude/`, `.codex/`, etc.)
  template relationship, called out explicitly as a repo-specific footgun.
- Produce a written audit (`docs/repo-audit-2026-08.md`) enumerating
  oversized/multi-responsibility files, duplicated logic across screens, dead
  code, and any further `core/` vs rendered drift beyond CON-52, each with a
  concrete recommendation (fix now vs. spin off as a follow-up ticket).
- Reconcile `docs/dashboard.md` so its sections and keybindings match actual
  current UI behavior in `lib/ui/`.
- Apply only small, behavior-preserving cleanup identified during the audit.

**Non-Goals:**
- Extracting a shared keybinding registry, splitting `watch.js`/`fleet.js`
  into smaller modules, or any other structural refactor large enough to need
  its own review cycle. These are written up as recommended follow-up tickets
  in the audit doc, not implemented here — per the ticket's own acceptance
  criteria.
- Any new feature or behavior change. Every code edit in this change must be
  behavior-preserving; this is verified by running `npm test` (which already
  covers script/UI-adjacent behavior via `test/scripts/*.test.sh` and
  `node --test`) unchanged before and after.

## Decisions

1. **Model `CONTRIBUTING.md` on `../helio/CONTRIBUTING.md`'s structure**
   (Getting Started / Workflow / Code Standards / Pre-Commit Policy / PR
   Expectations / AI Collaborators), but rewrite every section's content
   for concertino's actual stack and conventions — zero runtime deps, Node
   `--test` + bash `test/scripts/*.test.sh`, no Husky/lint config present in
   this repo (verify during execution; do not describe hooks that don't
   exist), and the `core/` → rendered template relationship as its own
   called-out subsection since helio has no equivalent pattern to model that
   on.
   - *Alternative considered*: write from scratch with no reference structure.
     Rejected — the ticket explicitly asks to model on helio's file if it
     exists, and it does; reusing its proven section structure keeps the two
     sibling repos' contributor docs recognizable to the same audience.
2. **Audit findings go in a new dated doc under `docs/`
   (`docs/repo-audit-2026-08.md`), not filed as individual Linear tickets
   inline in this change.** The ticket's acceptance criteria accept either
   form ("e.g. as a tracking doc or as filed follow-up tickets"); a single
   doc keeps the full audit reviewable in one PR diff, and any item the human
   wants turned into a tracked ticket can be filed from the doc afterward
   without blocking this change's delivery.
   - *Alternative considered*: file a Linear ticket per finding directly.
     Rejected for this change — ticket-filing from within the workflow is
     reserved for the follow-up-triage escalation path, not bulk-authored by
     the executor; a doc is the lower-ceremony artifact for "here is
     everything we found."
3. **Only fix drift/dead-code/comment issues that are truly zero-risk and
   mechanically verifiable (e.g. a stale comment, an obviously unreachable
   branch, a `docs/dashboard.md` section that's missing a keybinding that
   demonstrably exists in code) inline in this change.** Anything requiring a
   judgment call about intended behavior is written up in the audit doc
   instead.
   - *Alternative considered*: fix everything found. Rejected — the ticket's
     acceptance criteria explicitly require behavior-preservation and explicit
     scoping of larger changes to their own follow-up tickets; attempting more
     than mechanically-safe fixes here risks exactly the kind of undetected
     regression the acceptance criteria are guarding against.

## Risks / Trade-offs

- [Risk] The audit could balloon into an open-ended exploration of the whole
  codebase. → Mitigation: bound the audit to the four areas the ticket
  itself names (file size/responsibility, keybinding duplication, doc drift,
  core/rendered drift) plus anything else surfaced incidentally while
  reviewing those; do not go looking for unrelated issues.
- [Risk] `CONTRIBUTING.md` describing tooling that doesn't actually exist yet
  (e.g. lint/format hooks) would itself be exactly the kind of
  aspirational-vs-actual drift this ticket is trying to eliminate. →
  Mitigation: verify every command/tool named in `CONTRIBUTING.md` actually
  exists in `package.json`/the repo before writing it down.
- [Risk] Reconciling `docs/dashboard.md` against "actual current UI behavior"
  requires reading the real keybinding dispatch in each screen file, which is
  exactly the kind of file this ticket calls out as large — risk of missing
  a keybinding. → Mitigation: grep each screen file's `handleKey`-style
  dispatch systematically (e.g. `key ===` occurrences) rather than reading
  top-to-bottom only.

## Migration Plan

Not applicable — documentation and behavior-preserving cleanup only, no
deployment or data migration involved.
