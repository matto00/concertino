# CON-58: Repo-wide audit and cleanup — introduce CONTRIBUTING.md, improve modularity

## Description

Full-sweep audit of the concertino repo for code quality, modularity, and consistency, plus a CONTRIBUTING.md (concertino doesn't have one — confirmed via `find -iname "CONTRIBUTING*"` returning nothing). Model it on `../helio/CONTRIBUTING.md` if that file exists there; if it doesn't, write one from scratch following this repo's own conventions.

Known structural facts to ground the audit (from a recent codebase sweep, not exhaustive):

* Zero runtime dependencies — everything (TUI rendering, ANSI handling, CLI parsing) is hand-rolled. `lib/ui/watch.js` (2380 lines) and `lib/ui/screens/fleet.js` (1314 lines) are both large, single-file, multi-responsibility modules (raw-mode stdin + alt-screen buffer + differential frame writer all in `watch.js`; section-building + rendering + a large hardcoded `handleKey` dispatch all in `fleet.js`).
* No central keybinding registry — every screen (`fleet.js`, `drilldown.js`, `launchpad.js`, `launchplan.js`, `escalation.js`, `docview.js`, `ticketview.js`, `ticketdraft.js`) has its own hardcoded `if (key === '...')` chain.
* `docs/dashboard.md` has already drifted from the actual UI (missing sections/keybindings that exist in code) — documentation-vs-code drift is a live problem, not hypothetical.
* `core/scripts/*` vs rendered `scripts/concertino/*` is a template/render split that has already caused at least one drift bug (CON-52: `core/scripts/cleanup.sh` comment drifted from its rendered copy) — worth checking for other instances during the audit.

## Acceptance Criteria

* `CONTRIBUTING.md` exists at the repo root, covering: local dev setup, how to run/test changes, code style/conventions actually followed in this codebase (not aspirational ones), and the `core/` → rendered `scripts/concertino/` template relationship (since it's a non-obvious repo-specific pattern that's already caused bugs).
* Audit findings are written up (e.g. as a tracking doc or as filed follow-up tickets) covering at minimum: files that have grown too large / mix too many responsibilities, and any other repo-wide consistency issues found (duplicated logic across screens, dead code, drifted docs).
* Any changes made as part of "cleanup" are behavior-preserving (no functional regressions) — this ticket is about code health, not new features; larger structural changes (e.g. extracting a shared keybinding registry) should be scoped as their own follow-up ticket(s) rather than done inline here if they're large enough to need their own review cycle.
* `docs/dashboard.md` is reconciled against actual current UI behavior (sections, keybindings) as part of the sweep, since it's already known to be stale.

## Reference

Linear: https://linear.app/helioapp/issue/CON-58/repo-wide-audit-and-cleanup-introduce-contributingmd-improve
