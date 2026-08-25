# CON-130: `openspec validate` gate demonstration

All commands below were run against a scratch openspec project created
outside the repo (`/tmp/tmp.jt2abfbNtn/demoproj`, deleted after this
demonstration — never committed). Setup: `openspec init --tools none`, then
two hand-authored changes.

## 1. Malformed change — corrected invocation goes RED

`openspec/changes/malformed-demo/specs/demo-cap/spec.md` deliberately
contains no `## ADDED/MODIFIED/... Requirements` delta header.

```
$ openspec validate "malformed-demo" --type change
Change 'malformed-demo' has issues
✗ [ERROR] demo-cap/spec.md: No delta sections found. Add headers such as "## ADDED Requirements" or move non-delta notes outside specs/.
✗ [ERROR] file: Change must have at least one delta. No deltas found. Ensure your change has a specs/ directory with capability folders (e.g. specs/http-server/spec.md) containing .md files that use delta headers (## ADDED/MODIFIED/REMOVED/RENAMED Requirements) and that each requirement includes at least one "#### Scenario:" block. Tip: run "openspec change show <change-id> --json --deltas-only" to inspect parsed deltas.
Next steps:
  - Ensure change has deltas in specs/: use headers ## ADDED/MODIFIED/REMOVED/RENAMED Requirements
  - Each requirement MUST include at least one #### Scenario: block
  - Debug parsed deltas: openspec change show <id> --json --deltas-only
$ echo $?
1
```

**Exit code: 1.** Confirmed red against a deliberately malformed change.

## 2. Well-formed change — corrected invocation goes GREEN

`openspec/changes/wellformed-demo/specs/demo-cap/spec.md` has a proper
`## ADDED Requirements` block with a requirement and a scenario.

```
$ openspec validate "wellformed-demo" --type change
Change 'wellformed-demo' is valid
$ echo $?
0
```

**Exit code: 0.** Confirmed green against a well-formed change.

## 3. OLD broken form — never attempts validation

Same well-formed change, but with the pre-fix invocation
(`openspec validate --change <name>`) that shipped in every source location
before this change:

```
$ openspec validate --change wellformed-demo
error: unknown option '--change'
(Did you mean --changes?)
$ echo $?
1
```

**Exit code: 1**, but note this is a **CLI parse error**, not a validation
verdict — `validate` never ran against the change at all. This is the defect:
the old invocation fails identically regardless of whether the change is
malformed or well-formed (compare to run 2 above, same change, exit 0 with
the corrected form).

## Conclusion

`openspec validate` does **not** share `archive`'s exit-0-on-abort defect —
it reports failure honestly through its exit status (non-zero on a malformed
change, zero on a well-formed one). Asserting on exit status in the role docs
is therefore correct; parsing stdout for a distinct "clean" signal is not
required (design.md Decision 3; AC 3 in `ticket.md` does not trigger).

## 4. Regression test failure demonstration (tasks.md 8.4)

To prove `test/scripts/openspec-validate-cmd.test.sh` actually detects the
regression (not just passes vacuously), one fixed location
(`config/examples/helio.json`'s `validateCmd`) was temporarily reverted to
the broken `--change` form, the test was re-run, and then the file was
restored. `lib/cli/render.js`'s hardcoded fallback is not exercised by this
config since `helio.json` sets `validateCmd` explicitly, so `helio.json`
itself was the file reverted for this demonstration.

Before revert — passing run (non-vacuous: 6/6 assertions, non-zero count):

```
$ bash test/scripts/openspec-validate-cmd.test.sh
openspec validate command surface (CON-130)
  ok   a.1 sync exits zero
  ok   a.2 rendered concertino-orchestrator.md exists and is non-empty
  ok   a.3 rendered orchestrator contains the corrected invocation
  ok   a.4 rendered orchestrator contains no broken 'validate --change' anywhere
  ok   b.1 init.js scaffolds the corrected validateCmd
  ok   b.2 init.js does not scaffold the broken --change form
  6 passed, 0 failed
$ echo $?
0
```

After reverting `config/examples/helio.json`'s `validateCmd` back to
`"openspec validate --change \"<CHANGE_NAME>\""`:

```
$ bash test/scripts/openspec-validate-cmd.test.sh
openspec validate command surface (CON-130)
  ok   a.1 sync exits zero
  ok   a.2 rendered concertino-orchestrator.md exists and is non-empty
  FAIL a.3 rendered orchestrator contains the corrected invocation
       expected to find [openspec validate "<CHANGE_NAME>" --type change] in /tmp/tmp.l9Jng3ZoRK/.claude/agents/concertino-orchestrator.md
  FAIL a.4 rendered orchestrator contains no broken 'validate --change' anywhere
       unexpectedly found [validate --change] in /tmp/tmp.l9Jng3ZoRK/.claude/agents/concertino-orchestrator.md
  ok   b.1 init.js scaffolds the corrected validateCmd
  ok   b.2 init.js does not scaffold the broken --change form
  4 passed, 2 failed
$ echo $?
1
```

**Exit code: 1**, with the two failing assertions named explicitly (`a.3`,
`a.4`). `config/examples/helio.json` was then restored to the corrected
form (verified via `git diff` showing only the intended two-file diff on
`lib/cli/render.js` and `config/examples/helio.json`), and the test was
re-run to confirm it returned to the passing (6/6, exit 0) state shown above.
