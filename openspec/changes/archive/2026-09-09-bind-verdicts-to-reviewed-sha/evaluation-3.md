# Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed SHA: **`b4ba7f6250ff8be6c383aabb411e0950edc31784`** — verified myself with
`git rev-parse HEAD`, not taken from the resume message. Post-squash
(`4c7b9d0`) and post-archive (`b4ba7f6`); base `9dc1545`.

Prior verdicts: cycle 1 FAIL @ `930f733`, cycle 2 PASS @ `b5e4aef`. This cycle
exists because the exit-4 `STALE` mechanism this ticket builds fired on this
ticket's own delivery, correctly, against `7c9f63d` — a source change I had
never reviewed. This report reviews that delta and re-binds a verdict to the
current head.

### Phase 1: Spec Review — PASS

Issues: none.

**Scope of the previously-unreviewed range, verified independently.**
`git diff --name-only b5e4aef 7c9f63d`, filtered to non-`openspec/` paths,
returns exactly one file: `test/scripts/check-merge-readiness.test.sh`. The rest
of the range is `evaluation-2.md`, `skeptic-final-1.md`, `files-modified.md` and
`workflow-state.md`. No `lib/`, no `core/`, no `scripts/`. The executor's
characterisation is accurate.

`git diff --name-only 7c9f63d HEAD` returns **nothing** outside `openspec/` —
that range is the squash plus the archive move and the spec-tree sync
(`openspec/specs/verdict-sha-binding/spec.md`) and `skeptic-final-2.md`. So the
entire source-term delta since my cycle-2 PASS is those 25 test lines, and I
have now reviewed them.

The delta is a direct fix to what I filed at cycle 2 as non-blocking suggestion
1, promoted to a real finding by the final-gate skeptic — correctly, since a
fixture that derives both its content path and its exclusion from the same
variable is green for every value that variable takes. That is the second
precondition-guaranteed fixture found on this ticket, and it is the class this
ticket's own design.md Decision 7 was written against. Fixing it rather than
documenting it is the right call. Tasks/spec/artifacts remain consistent with
the implemented behaviour.

### Phase 2: Code Review — PASS

**The unreviewed delta, reviewed.** Fixture 166.3's archive content moves from
`$AUDITOR_ARCHIVE_PREFIX/changes/demo/proposal.md` to the literal
`openspec/changes/archive/2026-01-01-demo/proposal.md`, and the 4th argument
becomes an explicit `"$AUDITOR_ARCHIVE_PREFIX"` rather than `run_check`'s
default. The false comment claiming the fixture caught a regression in that
default is gone. The literal path is a realistic archive location — it matches
what an `openspec`-kind project actually archives to, and I confirmed against
this very repo, whose archive lives at
`openspec/changes/archive/2026-09-09-bind-verdicts-to-reviewed-sha/`. Reading
the fixture at `test/scripts/check-merge-readiness.test.sh:649-682`,
`$AUDITOR_ARCHIVE_PREFIX` now appears only in the comment and in the argument —
never in the constructed path. Genuinely no longer self-derived.

**Verified adversarially, not on claim:**

| Mutation | Expected | Observed |
|---|---|---|
| **G** — revert `auditor.md`'s `<change-dir-root>` to `<change-dir>` | 166.3 red *alongside* 0.1 | **RED** 0.1, 166.3.1, 166.3.2 (74 passed, 3 failed) |
| **H** — force `changeRoot` to `spec` (shapely but wrong for an openspec project) | 166.3 red, 0.1 **green** | **RED** 166.3.1, 166.3.2; 0.1 **ok** (75 passed, 2 failed) |

Mutation G is the decisive one: under cycle 2's fixture, G left 166.3 green and
only 0.1 caught it — I measured that myself last cycle. It is now red. Mutation
H proves the two guards are genuinely complementary rather than redundant: 0.1
checks the *shape* of the rendered value (no `/changes/` segment, no unexpanded
`<CHANGE_NAME>`), and 166.3 checks that the value actually excludes a real
archive tree. Neither subsumes the other, and each catches a failure the other
misses.

**Full gates, re-run by me against the current head:**

- `npm test` — **exit 0**, zero failures across the whole suite (77/77 in
  `check-merge-readiness.test.sh`).
- `npm run test:selftest` (`concertino sync --dry-run`) — exit 0.
- Rendered-scripts drift gate — green; `cmp`-verified byte-identical for
  `core/scripts/{check-merge-readiness.sh,emit-event.sh,README.md}` against
  their `scripts/concertino/**` renders. No `core/scripts/**` change in this
  cycle's delta, so no new render obligation arose.

**Invariants re-derived on the squashed tree (not carried forward from cycle 2):**

- CON-171 lease symmetry — `9dc1545`: acquire=1, release=0 in
  `check-merge-readiness.sh`, release=1 in `emit-event.sh`. `HEAD`: identical.
  Unchanged, as Decision 4a requires.
- Callers of the required 4th argument — `core/roles/auditor.md:54`
  (`<change-dir-root>`), `test/scripts/phase4-teardown-guard.test.sh:73`,
  `check-merge-readiness.test.sh:158`. All present; none missed.
- Must-PASS mutation matrix, all re-run on this head:

  | Mutation of the fix | Expected red | Observed |
  |---|---|---|
  | Drop step 3's `':(exclude)${ARCHIVE_PREFIX}/*'` | 166.3 | **RED** 166.3.1/.2 only (75/2) |
  | Drop the `-- "${patharr[@]}"` PATHS restriction | 166.8 | **RED** 166.8.1/.2 + 166.10.1/.2 (73/4) |
  | Delete the empty-`PATHS` guard (Decision 1c) | 166.12 | **RED** 166.12.1/.2 only (75/2) |
  | Neutralise step 0's unconditional `git fetch` | 166.10 | **RED** 166.10.1/.2 only (75/2) |
  | Drop `stale_check`'s `paths_r` rc guard | 166.11 | **RED** 166.11.2 only (76/1) |

- Refusal assertions against the pre-fix `check-merge-readiness.sh` (`9dc1545`):
  **16 RED**, enumerated — 166.1.1/.2/.3, 166.4.1/.2, 166.5.1/.2, 166.6.1/.2,
  166.7.1/.2/.3, 166.9.1/.2, 166.11.1/.2. Every must-PASS case is green pre-fix,
  as Decision 7 predicts, which is why the mutation matrix above carries their
  proof.

Issues: none.

### Phase 3: UI Review — N/A

Shell/CLI tooling only; no UI-affecting paths in any range reviewed.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

1. Cycle 2's suggestions 2-4 remain open and remain non-blocking: the
   `config/concertino.schema.json` `specProvider` block still does not declare
   `changeRoot` while `lib/config.js` guards with `if (!sp.changeRoot)` (code and
   schema disagree on whether it is user-settable; harmless today because no
   write-back path exists); the `paths_h` and final `diff_out` rc guards in
   `stale_check` remain unexercised (the `paths_r` guard has a proven
   representative); and `test/scripts/emit-event.test.sh` still carries two
   summary/terminator blocks.

2. Worth recording somewhere durable, because it is the strongest evidence this
   ticket produced: this delivery is a live, unstaged instance of the defect the
   ticket describes. A verdict was issued at `b5e4aef`, real source landed at
   `7c9f63d`, the branch was squashed and archived to `b4ba7f6`, and the gate
   refused with exit 4 naming the exact unreviewed file — then cleared by
   re-review rather than by escalation or a permanent block. That is Decisions 4
   and 4a working end-to-end on a real run, not a fixture.
