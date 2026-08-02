## Why

Concertino has no `CONTRIBUTING.md`, so there is no written record of local dev
setup, how to run/test changes, or the actual code conventions this codebase
follows — new contributors (human or agent) have to reverse-engineer them from
`package.json` and existing code. Separately, a recent codebase sweep found
several large, multi-responsibility files (`lib/ui/watch.js`,
`lib/ui/screens/fleet.js`), a `core/` → rendered `scripts/concertino/`
template split that has already caused one drift bug (CON-52), and a
`docs/dashboard.md` that has already drifted from actual UI behavior. This
change closes the missing-CONTRIBUTING.md gap, performs the audit sweep the
ticket calls for, and reconciles `docs/dashboard.md` — while keeping any code
edits behavior-preserving and pushing larger structural changes (e.g. a shared
keybinding registry) out to their own follow-up tickets rather than doing them
inline.

## What Changes

- Add `CONTRIBUTING.md` at the repo root: local dev setup, how to run/test
  changes, the code conventions actually followed in this codebase (not
  aspirational ones), and the `core/` → rendered `scripts/concertino/`
  template relationship, called out explicitly since it's non-obvious and has
  already caused a drift bug (CON-52).
- Perform a repo-wide audit and write up findings (a tracking doc under
  `docs/`) covering: files that have grown too large / mix too many
  responsibilities, duplicated logic across screens, dead code, and any other
  `core/scripts/*` vs `scripts/concertino/*` drift beyond the already-known
  CON-52 instance.
- Reconcile `docs/dashboard.md` against actual current UI behavior (sections,
  keybindings) — the known drift called out in the ticket.
- Apply only small, behavior-preserving cleanup found during the audit
  directly in this change (e.g. dead code removal, stale comments,
  doc-drift fixes). Any structural change large enough to need its own
  review cycle (e.g. extracting a shared keybinding registry, splitting
  `watch.js`/`fleet.js`) is written up as a follow-up recommendation in the
  audit doc, not implemented here.

## Capabilities

### New Capabilities

- `repo-contributing-docs`: the repo has a `CONTRIBUTING.md` documenting
  local dev setup, run/test commands, actual code conventions, and the
  `core/` → rendered template relationship; plus a written repo-audit doc
  and a `docs/dashboard.md` that's reconciled with current UI behavior.

### Modified Capabilities

(none — behavior-preserving cleanup only; no existing capability's
requirements change.)

## Impact

- New file: `CONTRIBUTING.md` (repo root).
- New file: an audit findings doc under `docs/` (e.g.
  `docs/repo-audit-2026-08.md`).
- Modified: `docs/dashboard.md` (reconciled with current UI behavior).
- Possibly small, behavior-preserving edits to files identified during the
  audit (drifted comments, dead code, stale docs) — no functional changes.
- No API, schema, or runtime-behavior changes.
