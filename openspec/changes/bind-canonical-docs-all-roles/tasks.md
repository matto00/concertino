## 1. Shared role-to-placeholder mapping

- [x] 1.1 Add a pure helper mapping a role name to its docs placeholder name (`auditor` -> `docsAuditor`), exported from `lib/config.js` alongside the existing `ROLES` const (`lib/config.js:122`), and verify a new unit test asserts the mapping for all five roles in `ROLES`. Per design Decision 2 this single helper is consumed by BOTH `render.js` and the validation, so the two cannot disagree; do not duplicate the mapping.
- [x] 1.2 Verify `lib/config.js` still has no `require` of anything under `lib/cli/` (design Context: layering direction is `lib/cli/* -> lib/config`, never the reverse) — check by grep, and state the result.

## 2. Render the two missing bindings

- [x] 2.1 Add `docsAuditor` and `docsOrchestrator` cases to the `docList` switch in `lib/cli/render.js` (currently lines 45-47), driving the placeholder names from task 1.1's helper rather than new literals. Verify by rendering a config bound to all five roles and confirming five hits.
- [x] 2.2 Add `{{block:docsAuditor}}` to `core/roles/auditor.md` immediately after `## Evidence discipline (binding)` and BEFORE `## The four conditions a safe merge requires` (~line 49), following `core/roles/executor.md:50-52`'s lead-in convention. Verify by grepping the rendered auditor file for the doc path AND confirming it appears before the merge-decision section — siting it after `### Merging` re-creates the bug (design Decision 4).
- [x] 2.3 Add `{{block:docsOrchestrator}}` to `core/roles/orchestrator.md` in `## Phase 1: Planning` where planning artifacts are authored, same lead-in convention. Verify by grepping the rendered orchestrator file for the doc path.
- [x] 2.4 Verify a role with NO bound docs renders the existing "(none configured)" marker in its agent file rather than an unsubstituted `{{block:...}}` string — `render.js:229`'s default arm leaks the literal placeholder, so this guards the opposite failure direction (design Risks, final bullet).

## 3. Hard-fail validation (scope part 3 — the durable half)

- [x] 3.1 In `collectConfigIssues` (`lib/config.js`, canonical-docs section ~lines 659-673), add a placeholder-coverage check: for each `canonicalDocs` entry, for each role in its `bindTo`, `fail(...)` naming BOTH the entry and the specific role when that role's template has no docs placeholder. Derive the role set from `ROLES`, not a literal `['auditor','orchestrator']` (design Decision 1). Verify the failing case names entry and role, and that the entry is no longer reported as configured.
- [x] 3.2 Make the check reject a `bindTo` value that is not a supported role at all, naming the entry and the value, rather than ignoring it. Verify with a unit test.
- [x] 3.3 Read role templates from `path.join(REPO, 'core', 'roles', <role>.md)` using the `REPO` const `lib/config.js:22` already uses for `SCHEMA_PATH`. If a template cannot be read, emit NO error for that role (design Decision 3's deliberate fail-silent arm — this is strictly the "cannot tell" case, never the "placeholder missing" case). Verify with a test that points validation at a tree with no readable core and asserts no canonical-docs error is produced.
- [x] 3.4 Verify a fully renderable configuration still passes validation with no new error, and that `concertino validate` on THIS repo's own config (`canonicalDocs: []`) is unchanged.

## 4. Schema

- [x] 4.1 Widen `config/concertino.schema.json`'s `canonicalDocs.bindTo` item enum (line 102) from `["executor","evaluator","skeptic"]` to all five roles (design Decision 5). Verify by asserting the enum admits `auditor` and `orchestrator`; note in the PR that the enum is not runtime-enforced today, so this is correctness/forward-compat, not the fix itself.

## 5. Evidence — mutation proof for every failure arm

- [x] 5.1 Extend `test/scripts/auditor-render.test.sh` (or `test/validate.test.js` / a JS test, whichever is the natural home — check both before adding a new harness) with render-coverage assertions over ALL FIVE roles: a doc bound to all five appears in all five rendered files, and existing executor/evaluator/skeptic-only bindings are unchanged in both directions (present for those three, absent for the other two).
- [x] 5.2 Produce mutation evidence for the missing-placeholder arm (3.1): remove/disable the guard, run the test, paste the RED output, restore, re-run GREEN. A test that can only pass is not evidence (acceptance criteria).
- [x] 5.3 Produce mutation evidence for the unknown-role arm (3.2), same red/green transcript method.
- [x] 5.4 Produce mutation evidence for the render-coverage arm (2.1): revert one `docList` case, show the test goes red, restore.
- [x] 5.5 Run the FULL `npm test` serial chain and paste the summary. Use `timeout: 600000` on the Bash call; if the suite legitimately needs longer than that, say so explicitly rather than letting the call background silently (CON-184). Never `git commit -n`.

## 6. Verification notes for this repo's own tooling

- [x] 6.1 Validate the change with `openspec validate "bind-canonical-docs-all-roles" --type change` — NOT the `--change` form this repo's `specProvider.validateCmd` configures, which openspec 1.10.0 rejects with `unknown option '--change'`. Note also that `openspec validate` exits 0 even when reporting errors, so parse its OUTPUT and do not rely on exit status. Both are pre-existing defects recorded as follow-ups in design.md Open Questions; do not fix them here.
- [x] 6.2 Confirm `scripts/concertino/` is untouched by this change (only `core/roles/` changed, not `core/scripts/`), so `rendered-scripts-drift.test.sh` stays green, and confirm no rendered `/.claude/agents/concertino-*.md` file is committed (gitignored). State both results.
