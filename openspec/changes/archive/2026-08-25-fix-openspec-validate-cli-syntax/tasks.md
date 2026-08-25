## 1. Re-verify the CLI surface (do not trust the plan's transcript)

- [x] 1.1 Record `openspec --version` and the resolved binary path.
- [x] 1.2 Capture `openspec validate --help`, `openspec instructions --help`, `openspec archive --help` verbatim.
- [x] 1.3 Confirm `validate` has no `--change` flag and takes a positional `[item-name]` plus `--type <type>`.
- [x] 1.4 Confirm `instructions` **does** accept `--change <id>` — this invocation is correct as written and must NOT be changed.

## 2. Re-verify the enumeration (accuracy here is an explicit acceptance criterion)

- [x] 2.1 `grep -rn 'openspec ' core/roles/` — enumerate every invocation with flags; classify each as broken or correct-as-written. Include non-invocation prose mentions (e.g. `core/roles/orchestrator.md:904`, which discusses `openspec validate` without invoking it) so the audit table is complete; mark them as needing no change.
- [x] 2.2 `grep -rn 'openspec' core/scripts/` — confirm every hit is a path comment/example, not a CLI invocation.
- [x] 2.3 `grep -rn 'validate --change\|validateCmd' --include='*.js' --include='*.json' --include='*.md' --include='*.sh' .` excluding `node_modules`, `.concertino/worktrees`, `openspec/changes/archive` — confirm exactly the seven tracked locations in design.md Decision 4 and no others. Cross-check each with `git ls-files` so no gitignored path is queued for edit.
- [x] 2.4 Confirm `concertino.config.json` is absent/gitignored here and is NOT edited or created.
- [x] 2.5 Write the audit table into `openspec-cli-audit.md` in the change dir: every invocation found, its verdict, and for the correct-as-written ones the `--help` line that proves it.

## 3. Fix the tracked source locations

- [x] 3.1 `lib/cli/render.js` — the hardcoded `validateCmd` fallback in the `specArtifacts` case.
- [x] 3.2 `lib/cli/init.js` — the scaffolded `specProvider.validateCmd` for new projects.
- [x] 3.3 `config/examples/concertino.json` — `specProvider.validateCmd`.
- [x] 3.4 `config/examples/helio.json` — `specProvider.validateCmd`.
- [x] 3.5 `docs/config-reference.md` — the example JSON block (and the table row, if it quotes the command).
- [x] 3.6 `core/roles/orchestrator.md` — the two prose occurrences (Design-ticket Planning step 4; the fold-in "Re-validate" sub-procedure step). Edit around CON-140's turn-discipline content; do not disturb it.
- [x] 3.7 `openspec/specs/followup-triage/spec.md` — correct the command string inside the existing requirement. Amend the string only; do not add, remove, or restructure requirements.
- [x] 3.8 Leave every `openspec archive` and `openspec instructions --change` invocation untouched.
- [x] 3.9 Leave `openspec/changes/archive/**` untouched — historical report text records what past runs really ran.
- [x] 3.10 Confirm no edit touched `core/scripts/cleanup.sh`. If one is required, STOP and escalate.

## 4. Name exit status as the success criterion (design.md Decision 7)

- [x] 4.1 `lib/cli/render.js` — change the rendered lead-in "Validate before handoff (fix any errors first)" to state the command must exit zero before handoff.
- [x] 4.2 `core/roles/orchestrator.md` — both prose sites: "re-run ... clean" becomes an explicit exit-zero criterion.
- [x] 4.3 Keep it terse; this is a criterion, not a new procedure.

## 5. Add the stated-version note

- [x] 5.1 Add a short note to `core/roles/orchestrator.md`, placed where `openspec` is first invoked (Phase 1 Planning), recording: the documented command surface targets `@fission-ai/openspec` v1.2.0; npm `latest` has since moved to 1.10.0; and if `openspec <cmd> --help` disagrees with this doc, trust `--help`, do not guess, and file a follow-up ticket.
- [x] 5.2 Keep it to a few lines — no version-detection machinery, no dependency pin.

## 6. Demonstrate the gate goes red (first-class AC, not polish)

- [x] 6.1 In a throwaway scratch location **outside** the repo (e.g. under `/tmp`), stand up an openspec project and create a deliberately malformed change — a spec delta missing its `## ADDED Requirements` delta header.
- [x] 6.2 Run the corrected invocation `openspec validate "<name>" --type change` against it; capture stdout/stderr and `$?`. **Expected: exit 1**, reporting `No delta sections found` (or equivalent). Report the numeric exit code, never "it went red" inferred from stdout.
- [x] 6.3 Run the same corrected invocation against a well-formed change; capture output and `$?`. **Expected: exit 0**, `Change '<name>' is valid`.
- [x] 6.4 Run the OLD broken form `openspec validate --change <name>` against the same well-formed change; capture the `unknown option '--change'` error and its exit code, showing it never attempts validation.
- [x] 6.5 Write all three transcripts verbatim, with numeric exit codes, into `validate-gate-demonstration.md` in the change dir, and state the conclusion: `validate` does NOT share `archive`'s exit-0-on-abort defect, so asserting on exit status is correct and stdout parsing is not required.
- [x] 6.6 Do not commit the scratch project into the repo.

## 7. Verify the render path (rendered outputs are gitignored — verify, don't commit)

- [x] 7.1 Render a **real** sync into a throwaway directory outside the checkout: `OUT="$(mktemp -d)"; node bin/concertino sync --out="$OUT" --config=config/examples/helio.json`. Use **this repo's own `node bin/concertino` entrypoint**, never a globally-installed `concertino` (CON-128); record which binary ran. Do **NOT** pass `--dry-run` — it writes zero files, and every assertion against the empty dir would pass vacuously.
- [x] 7.2 Assert `"$OUT/.claude/agents/concertino-orchestrator.md"` **exists and is non-empty** before asserting anything about its contents. Then assert it contains `--type change`, and that `grep -c 'validate --change'` over the whole file is **0** (base has 4 occurrences — two injected, two prose — so assert total absence, not a single-site match).
- [x] 7.3 Confirm no gitignored rendered path (`.claude/agents/`, `.codex/roles/`, `.opencode/agents/`, `AGENTS.md`, `scripts/concertino/.concertino.env`) is staged for commit, and that the checkout's own directories were never rendered into.

## 8. Regression guard (design.md Decision 6)

- [x] 8.1 Add `test/scripts/openspec-validate-cmd.test.sh`, modelled on `test/scripts/auditor-render.test.sh` (reuse its `ok`/`bad`/`check`/`has`/`hasnt` helper shape and its throwaway-`--out` safety comment).
- [x] 8.2 It must, in order: (a) render a real sync into `$(mktemp -d)` — not `--dry-run`; (b) assert the rendered `concertino-orchestrator.md` exists (a `hasnt` assertion against a missing file returns ok, so absence-only assertions are vacuous without this); (c) assert the file contains `openspec validate "<CHANGE_NAME>" --type change`; (d) assert `validate --change` appears **nowhere** in it; (e) assert `lib/cli/init.js`'s scaffolded `validateCmd` is the corrected form.
- [x] 8.3 Wire it into the `test` script chain in `package.json` (a literal `&& bash test/scripts/...` append).
- [x] 8.4 Prove it can fail: temporarily revert one fixed location, confirm the test exits non-zero and names the failing assertion, then restore. Record that transcript with its numeric exit code in `validate-gate-demonstration.md`.
- [x] 8.5 Sanity-check the test is not vacuous: confirm it reports a non-zero assertion count on the passing run.

## 9. Verify

- [x] 9.1 `grep -rn 'openspec validate --change' .` (excluding `node_modules`, `.concertino/worktrees`, `openspec/changes/archive`) returns nothing.
- [x] 9.2 `openspec validate "fix-openspec-validate-cli-syntax" --type change` exits 0 on this very change — the corrected command validating its own delivery.
- [x] 9.3 `openspec validate --specs` still passes after the canonical-spec edit in 3.7.
- [x] 9.4 `npm test` passes.
- [x] 9.5 Confirm the three untracked non-ours paths (`.claude/skills/concertino-fleet-driver/`, `scripts/concertino/pricing-table.json`, `scripts/concertino/report-cost.sh`) are neither staged nor modified, and the stray `CON-87` worktree is untouched.
- [x] 9.6 Write `files-modified.md` in the change dir declaring every file this change touches.
