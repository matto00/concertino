# Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed SHA: **`b5e4aefd54d0a2aa4be9f9ad591ca48c8e384814`** (was `930f733`; base `9dc1545`).

Every claim below was re-derived by this evaluator. Nothing in the executor's
report or the orchestrator's summary was accepted as fact.

### Phase 1: Spec Review — PASS

Issues: none.

- CR 1 (AC 2 / Decision 1a defeated at the caller) — **fixed and verified**, see
  Phase 2.
- CR 2 (regression guard pinning the auditor's real rendered argument) —
  **delivered and proven failable**, see Phase 2.
- CR 3 (task 4.4's erroring-`git diff` self-test) — **delivered and proven both
  RED-against-pre-fix and failable under a mutation of the guard it targets**,
  see Phase 2. Task 4.4's `[x]` is now earned.
- Decision 1a is now satisfied for *both* provider kinds, not just `openspec`:
  the rendered argument is `openspec` for `kind: openspec` and `spec` for
  `kind: none`, which is exactly the case Decision 1a exists for.
- Decisions 4a, 6 unchanged; no scope creep beyond the two change requests.

### Phase 2: Code Review — PASS

**Gates, re-run by me in `WORKTREE_PATH`:**

- `npm test` — **exit 0**, fully green (the three `FAIL`-matching lines in the
  log are assertion *titles* like "FAIL printed to stderr", not failures).
- `npm run test:selftest` (`concertino sync --dry-run`) — exit 0.
- Rendered-scripts drift gate — green; `cmp`-verified byte-identical for
  `check-merge-readiness.sh`, `emit-event.sh`, `README.md`. No `core/scripts/**`
  file changed this cycle, so no new render obligation arose.
- CON-171 lease symmetry at `b5e4aef`: `lease_acquire` ×1 and `lease_release`
  ×0 in `check-merge-readiness.sh`; `lease_release` ×1 in `emit-event.sh` —
  identical to `9dc1545`. Unchanged.
- Caller sweep for the 4th argument: `core/roles/auditor.md:54`,
  `test/scripts/phase4-teardown-guard.test.sh:73`, and
  `check-merge-readiness.test.sh`'s `run_check` default. All present. No missed
  caller.

**CR 1 — verified adversarially.**

1. *Is the derivation real, or a shortcut that can drift?* Real.
   `test/scripts/derive-auditor-archive-prefix.js` `require`s the actual
   `lib/config.js` `withDefaults` and the actual `lib/cli/render.js`
   `renderBody` (both already exported at `lib/cli/render.js:350` /
   `lib/config.js:893`), reads the actual `core/roles/auditor.md`, and regex-
   extracts the argument from the rendered invocation line. It reimplements
   nothing. If the invocation line ever changes shape the regex misses and the
   script exits 1, which the suite turns into a `FATAL … aborting suite` — fail
   closed, not a silent default.

2. *Does it reproduce the claimed values?* Yes, measured:
   - against the **fixed** `auditor.md`: `openspec`
   - against a **reverted** `auditor.md` (token put back to `<change-dir>`):
     `openspec/changes/<CHANGE_NAME>`

3. *Is test 0.1 capable of going red?* Yes. Under that same revert:
   `FAIL 0.1 auditor renders the change-dir ROOT, not the per-change directory`
   (76 passed, 1 failed). The guard is failable, not precondition-guaranteed.

4. *Does my own cycle-1 refutation now pass?* Yes. I re-ran the identical
   archive-shaped fixture (change dir moved to
   `openspec/changes/archive/2026-09-09-demo/…`, spec delta merged into
   `openspec/specs/cap/spec.md`), feeding it the value the auditor **really**
   renders:

   ```
   --- with the auditor's REAL rendered prefix: [openspec]
   rc=0 out=PASS
   --- control: a genuine late source commit must still refuse
   rc=4  STALE evaluator reviewed=79d8de87… head=e783fbe9… changed=…,src.txt
   ```

   The false refusal is gone, and the check has not been blunted — a real late
   source commit still refuses and still names `src.txt`.

5. *Does the new token break other consumers?* No. `renderBody` is the single
   substitution site; I rendered all four example configs across their harnesses
   and found **zero** files containing an unsubstituted `<change-dir-root>`, with
   the invocation resolving to `openspec` (helio, concertino) and `spec`
   (generic, opencode-ollama). `lib/config.js`'s `changeRoot` derivation is
   in-memory only: the settings controller edits the raw pre-`withDefaults`
   shape (`lib/ui/controllers/settings.js:46`) and `init.js` builds its own
   object literal, so the derived key is never written back to
   `concertino.config.json`. Every render test in the suite (auditor-render,
   codex-role-render, opencode-render, local-provider-render,
   standalone-triage-render, sync-core-resolution) is green.

**CR 2 / fixture 166.11 — verified adversarially.**

- The setup assertions are real and self-checking: `166.11.0b` independently
  confirms a plain `git diff` genuinely errors after the tree object is removed,
  and `166.11.0c` confirms the commit object still resolves — so the fixture
  cannot pass because the corruption silently did nothing, nor because it
  degenerated into 166.4's unresolvable-SHA leg.
- The guard it claims to reach **is** reached. I mutated away exactly that
  guard (dropped the `rc -ne 0` check after
  `paths_r="$(git … diff --name-only "$mb_r" "$reviewed")"`) and
  `166.11.2` went **RED**. Note that `166.11.1` (exit code 4) stayed green under
  that mutation — the run fell through to a later fail-closed guard — which is
  precisely why Decision 7 demands exact-output matching; the exact-string
  assertion is what carries the proof here, and it does.
- Against the true pre-fix script at `9dc1545`, `166.11.1` and `166.11.2` are
  both RED (16 refusal failures total).

**Regression re-check — all cycle-1 evidence re-derived on `b5e4aef`, not
carried forward:**

| Mutation of the fix | Expected red | Observed |
|---|---|---|
| Drop step 3's `':(exclude)${ARCHIVE_PREFIX}/*'` | 166.3 | **RED** 166.3.1/.2 only (75/2) |
| Drop the `-- "${patharr[@]}"` PATHS restriction | 166.8 | **RED** 166.8.1/.2 + 166.10.1/.2 (73/4) |
| Delete the empty-`PATHS` guard (Decision 1c) | 166.12 | **RED** 166.12.1/.2 only (75/2) |
| Neutralise step 0's unconditional `git fetch` | 166.10 | **RED** 166.10.1/.2 only (75/2) |
| Drop `stale_check`'s `paths_r` rc guard | 166.11 | **RED** 166.11.2 (76/1) |

Refusal assertions against the pre-fix `check-merge-readiness.sh` (`9dc1545`):
**16 RED**, covering 166.1, 166.4, 166.5, 166.6, 166.7, 166.9 and 166.11.
Every must-PASS case remains green pre-fix, as Decision 7 predicts, which is
why the mutation table above is the load-bearing evidence for those.

Issues: none blocking.

### Phase 3: UI Review — N/A

Shell/CLI tooling only; no UI-affecting paths in the diff.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

1. **One relayed claim was overstated and should not be recorded as fact.**
   Fixture 166.3 does **not** catch a regression of the auditor's argument. I
   reverted `auditor.md` to `<change-dir>` and 166.3.1/166.3.2 both stayed
   **green** — because the fixture builds its archive content at
   `$AUDITOR_ARCHIVE_PREFIX/changes/demo`, so a change-*directory* prefix still
   covers it. Only test 0.1 catches that regression. The guard is real and
   sufficient; the claim that 166.3 also closes the trap is not. If you want
   166.3 to be a second, independent guard, give it archive-*sibling* content
   (`$PREFIX/specs/…` and `$PREFIX/changes/archive/…`, the shape the real
   archive step produces) rather than a child of the prefix.

2. `config/concertino.schema.json`'s `specProvider` has
   `additionalProperties: false` and does not declare `changeRoot`, while
   `lib/config.js:168` guards with `if (!sp.changeRoot)` — which invites an
   override the schema would reject and the settings screen can never surface.
   Harmless today (no write-back path exists), but either declare it in the
   schema as an optional override or drop the `if (!…)` guard in favour of an
   unconditional assignment, so the code and the schema agree on whether it is
   user-settable.

3. The erroring-`git diff` family now has one proven representative (the
   `paths_r` guard). The sibling `paths_h` and final `diff_out` rc guards
   remain unexercised. Not worth a cycle on its own; worth a line in a
   follow-up if this area is touched again.

4. Still open from cycle 1 (deliberately deferred, restated only so it is not
   lost): `test/scripts/emit-event.test.sh` still carries two
   `echo "$PASS passed, $FAIL failed"` / `[ "$FAIL" -eq 0 ]` terminators
   (lines 610 and 659). Harmless without `set -e`; fold the CON-166 fixtures
   above the single terminator when convenient.
