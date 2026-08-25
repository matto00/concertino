## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Enumeration re-derived from scratch** (not read off the revised table). On base `fb914c4`:
`grep -rn "validate --change\|validateCmd" --include='*.js' --include='*.json' --include='*.md' --include='*.sh' .`
(excluding `node_modules`, `.concertino/worktrees`, `openspec/changes/archive`) yields exactly the
seven locations design.md Decision 4 lists and no others: `lib/cli/render.js:75`,
`lib/cli/init.js:132`, `config/examples/concertino.json:19`, `config/examples/helio.json:11`,
`docs/config-reference.md:258`, `core/roles/orchestrator.md:582` + `:868`,
`openspec/specs/followup-triage/spec.md:101`. `git ls-files --error-unmatch` on all seven → all
tracked. `lib/config.js:531` and `config/concertino.schema.json:45` are key-name mentions, not the
broken string — correctly excluded. `docs/config-reference.md:269` is a table row that does not
quote the command; task 3.5's "(and the table row, if it quotes the command)" hedge handles it.

**Round-1 CR disposition (each checked against the artifacts, not the summary):**
1. `concertino.config.json` — `git check-ignore` confirms `.gitignore:5`; `ls` confirms absent. It is
   gone from Decision 4's table, is called out negatively in Decision 4, is a Non-Goal, and task 2.4
   asserts it is neither edited nor created. Addressed.
2. `config/examples/concertino.json`, `config/examples/helio.json`,
   `openspec/specs/followup-triage/spec.md` are all in Decision 4's table with tasks 3.3 / 3.4 / 3.7.
   Decision 4 also gives the reasoning for including the canonical spec rather than deferring it.
   Addressed.
3. "Commit rendered outputs" is gone; `.gitignore` exclusion is documented and task 7.3 asserts no
   gitignored rendered path is staged. **The replacement verification is not executable as written —
   see Change Request 1.**
5. Task 6.2 states "**Expected: exit 1**" and forbids inferring redness from stdout. Addressed.
6. Decision 7 exists and task 4 amends all three prose sites (`render.js:81` lead-in, both
   `orchestrator.md` occurrences). I confirmed the current wording is indeed
   `'   Validate before handoff (fix any errors first):'` at `lib/cli/render.js:81` and
   "re-run ... clean" at `orchestrator.md:582-583` / `:868`. Addressed.
4/8. Task 8 adds `test/scripts/openspec-validate-cmd.test.sh` with a prove-it-fails step (8.4) and
   `package.json` wiring (8.3). I confirmed `npm test`'s chain is a literal `&& bash test/scripts/...`
   sequence, so 8.3 is a real one-line edit. **Its assertion mechanism inherits the same defect —
   see Change Request 1.**

**Reproduced measurement (run twice, same result both times):**
```
$ D=$(mktemp -d); node bin/concertino sync --out="$D" --config=config/examples/helio.json --dry-run; echo $?
0
$ find "$D" -type f
(no output — zero files)

$ D2=$(mktemp -d); node bin/concertino sync --out="$D2" --config=config/examples/helio.json
$ ls "$D2/.claude/agents/"
concertino-auditor.md  concertino-evaluator.md  concertino-executor.md
concertino-orchestrator.md  concertino-skeptic.md
$ grep -n "openspec validate" "$D2/.claude/agents/concertino-orchestrator.md"
510:   openspec validate --change "<CHANGE_NAME>"
627:   openspec validate --change "<CHANGE_NAME>"
629:   ran step 3 above — re-run `openspec validate --change <CHANGE_NAME>`
918:     3. **Re-validate.** Re-run `openspec validate --change <CHANGE_NAME>`
```
`--dry-run` "prints filenames only — no writes" (`lib/cli/help.js:34`, `lib/cli/sync.js:31-41`).

### Verdict: REFUTE

One blocking defect. Everything else in the revision holds.

### Change Requests

1. **Tasks 7.1/7.2 and 8.1/8.2 are unexecutable: `concertino sync --dry-run` writes no files, so
   there is nothing in `<tmpdir>` to grep.** Task 7.2 says "Assert the rendered orchestrator in
   `<tmpdir>` contains `--type change`"; task 8.2 says the test "must assert: the dry-run–rendered
   orchestrator emits `openspec validate "<CHANGE_NAME>" --type change`". Measured above: a dry-run
   sync into a fresh `mktemp -d` leaves the directory empty. Design Decision 4's command block and
   Decision 6's test description carry the same `--dry-run`. As specified, the executor either
   greps an empty directory (a vacuously-green regression test — precisely the "evidence-shaped
   non-evidence" this test exists to prevent) or silently improvises.

   The repo's own render tests already show the correct shape: `test/scripts/auditor-render.test.sh`
   runs a **real** `node "$ROOT/bin/concertino" sync --out="$OUT" --config=...` into a throwaway
   `mktemp -d` (never the checkout's own `.claude/`), then greps
   `"$OUT/.claude/agents/concertino-<role>.md"`. That is safe here for the same reason it is safe
   there, and it is the only form that produces content to assert on.

   Required revisions:
   - `design.md` Decision 4: replace the `--dry-run` command block with a real sync into a throwaway
     `--out` dir, and drop/reword the surrounding claim that the dry-run is what verifies the render.
   - `design.md` Decision 6: same correction to the test description.
   - `tasks.md` 7.1: drop `--dry-run`; render into a throwaway `--out=$(mktemp -d)` outside the
     checkout. Keep the "use `node bin/concertino`, record which binary ran" requirement (CON-128).
   - `tasks.md` 7.2: add an explicit precondition that
     `<tmpdir>/.claude/agents/concertino-orchestrator.md` exists before the greps run — a `hasnt`
     assertion against a missing file passes trivially.
   - `tasks.md` 8.2: same — assert file-exists first, then assert `--type change` present and
     `validate --change` absent. (`auditor-render.test.sh`'s `has`/`hasnt`/`check` helpers already
     encode this: `hasnt` on a nonexistent file returns `ok`.)
   - Note while revising: the real render emits the injected block **twice** (lines 510 and 627
     above) plus two prose occurrences. The test should assert on total absence of
     `validate --change` in the rendered file rather than a single-site match, so a partial fix
     cannot pass.

### Non-blocking notes

- `proposal.md` says "The broken string lives in five source locations" in the Why section, then
  "all six tracked source locations" plus the spec file in What Changes; `tasks.md` 2.3 says
  "seven". All three are reconcilable (files vs. occurrences vs. rows) but the "five" is simply
  stale. Worth normalising to one count.
- `core/roles/orchestrator.md:904` mentions `openspec validate` in prose about the fold-in archive
  abort. It is not an invocation and needs no fix, but task 2.1's audit should record it so the
  audit table is complete.
