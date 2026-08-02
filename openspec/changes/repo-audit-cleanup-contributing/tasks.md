## 1. Research existing conventions

- [x] 1.1 Read `package.json`, `README.md`, `ROADMAP.md`, and `openspec/config.yaml` to identify actual scripts/commands (`npm test`, `npm run test:selftest`), the `core/` → adapter render pipeline (`concertino sync`), and any existing style conventions.
- [x] 1.2 Confirm whether there is any lint/format/pre-commit tooling actually configured in this repo (search for `.husky/`, `eslint`, `prettier`, `lint-staged` in `package.json` and repo root) — do not describe tooling that doesn't exist.
- [x] 1.3 Skim `../helio/CONTRIBUTING.md` (already read) for section structure to model, without copying helio-specific content.

## 2. Write CONTRIBUTING.md

- [x] 2.1 Draft `CONTRIBUTING.md` at the repo root covering: local dev setup, how to run/test changes (`npm test`, `npm run test:selftest`), code conventions actually followed (file organization under `lib/`, `core/`, `adapters/`, `scripts/`, zero-runtime-dependency policy, existing file-size norms if any pattern is evident), and PR expectations.
- [x] 2.2 Add an explicit subsection on the `core/` → rendered `scripts/concertino/*` (and `.claude/`, `.codex/`, etc.) template relationship: what `concertino sync` does, why editing rendered output directly is wrong, and the CON-52 drift bug as a cautionary example.
- [x] 2.3 Verify every command and tool named in the doc actually exists in this repo (re-run each command referenced, where feasible).

## 3. Audit sweep

- [x] 3.1 Identify large/multi-responsibility files beyond the two already named in the ticket (`lib/ui/watch.js`, `lib/ui/screens/fleet.js`) — survey `lib/ui/`, `lib/ui/screens/`, `scripts/concertino/`, `core/` for file size and responsibility mixing.
- [x] 3.2 Identify duplicated keybinding-dispatch logic across `fleet.js`, `drilldown.js`, `launchpad.js`, `launchplan.js`, `escalation.js`, `docview.js`, `ticketview.js`, `ticketdraft.js` (grep each for its `key ===` chain) and note the absence of a shared registry as a follow-up candidate.
- [x] 3.3 Grep for other `core/scripts/*` vs `scripts/concertino/*` (and other rendered adapter output) drift beyond the known CON-52 instance — compare comments/logic between template source and rendered copy for a sample of scripts.
- [x] 3.4 Search for dead code (unused exports, unreachable branches, stale TODOs referencing already-resolved tickets).
- [x] 3.5 Write findings to `docs/repo-audit-2026-08.md`: one section per area above, each finding with a concrete recommendation (fix inline in this change vs. propose as its own follow-up ticket), following design.md Decision 3's inline-fix criteria.

## 4. Reconcile docs/dashboard.md

- [x] 4.1 Enumerate current dashboard sections and keybindings by reading the actual `handleKey`-style dispatch in each `lib/ui/screens/*.js` file.
- [x] 4.2 Diff that enumeration against `docs/dashboard.md`'s current content; update the doc to match (add missing sections/keybindings, remove stale ones, fix inaccurate descriptions).

## 5. Apply zero-risk inline fixes

- [x] 5.1 Apply only the audit findings classified as zero-risk/mechanically-verifiable in `docs/repo-audit-2026-08.md` (per design.md Decision 3) — e.g. stale comments, dead code, other doc-drift instances found in 3.3.
- [x] 5.2 Leave every finding requiring a judgment call about intended behavior as a written recommendation only — do not implement it in this change.

## 6. Verification

- [x] 6.1 Run `npm test` and confirm it passes unchanged (behavior-preservation check).
- [x] 6.2 Confirm `CONTRIBUTING.md`, `docs/repo-audit-2026-08.md`, and the updated `docs/dashboard.md` all exist and are internally consistent with each other and with actual repo state.
- [x] 6.3 Record modified/added files for the executor's handoff (`files-modified.md`).
