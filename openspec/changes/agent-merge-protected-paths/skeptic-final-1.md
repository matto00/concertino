## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/agent-merge-protected-paths/CON-193`.
- **Ground truth diff**: `git log --oneline` confirms `b4a124f` is the sole commit on `main..HEAD`, base `8a96bd1`. Reviewed `ticket.md`, `design.md`, `tasks.md`, `files-modified.md` in full.
- **AC1 (schema-validated, defaults `[]`)**: `test/config.test.js` lines 457-505 has real assertions for defaulting, order-preservation, non-array rejection, non-string-entry rejection (naming index), empty-string rejection (naming index), and acceptance of a well-formed array. `lib/config.js:840-857` implements exactly this.
- **AC2/AC3/mutation discipline (P43 no-op spy)**: I independently reproduced the mutation the executor/evaluator both claim. Ran `bash test/scripts/check-merge-readiness.test.sh` clean against `core/scripts/check-merge-readiness.sh`: **112 passed, 0 failed**. Then mutated the core copy (removed the `if [ "${#PROTECTED_PATTERNS[@]}" -gt 0 ]` empty-list guard by replacing it with `if true; then`, i.e. mutation (d) from tasks.md 3.3) and re-ran: **111 passed, 1 failed — exactly `P43.1`**, confirming the spy's baseline of 4 `git merge-base` calls is real, not assumed. Restored the file, re-ran clean (112/0) to confirm no residue.
- **AC4 (no assertion surface)**: Confirmed `.concertino.env`, `concertino.config.json`, `speeds.json`, `AGENTS.md` are genuinely absent from this worktree (`ls` fails on all four; `.gitignore` lines 5/10/18 cover them). Read `main_checkout()` (lines 242-250 of `core/scripts/check-merge-readiness.sh`) — resolves via `git rev-parse --git-common-dir` from `$WORKTREE_PATH`, no env-var override, no argument. `ARCHIVE_PREFIX` is the 4th and only positional arg; grepped the whole condition-4 block for `$4`/env-var reads of the glob list — none exist. The glob list can only be changed by editing the main checkout's tracked `concertino.config.json`, which is exactly the deterrent AC4 asks for.
- **Fail-closed behavior — Decision 3's own two probes**: verified via raw `git diff --name-only <base> <head> -- ':(glob)record/[unclosed'` — exit 0, empty output (matches design.md's claim), and the script's `[[ "$pat" =~ \[[^]]*$ ]]` check does refuse this before ever calling git (confirmed via fixture P10 and my own manual read of lines 620-630).
- **Rendered-copy parity**: `cmp core/scripts/check-merge-readiness.sh scripts/concertino/check-merge-readiness.sh` — byte-identical. `bash test/scripts/rendered-scripts-drift.test.sh` — 19 passed, 0 failed.
- **openspec archive (C1)**: copied the worktree to `/tmp/openspec-archive-check` (disposable) and ran `openspec archive "agent-merge-protected-paths" -y --json` there — exited 0, `specsUpdated: true`, `added: 5, modified: 2, renamed: 2`, matching design.md Decision 6's recorded evidence exactly. Live worktree untouched.
- **Scenario-header staleness (Decision 6)**: confirmed `specs/agent-merge/spec.md` still carries `#### Scenario: All three conditions pass` / `#### Scenario: All four conditions hold` verbatim — not flagging, per binding instruction.
- **CON-207 scope discipline**: `git diff 8a96bd1..HEAD -- core/scripts/check-merge-readiness.sh` has zero hits for `statusCheckRollup` — condition 1's empty-rollup logic is untouched by this change.
- **Docs honesty**: `docs/config-reference.md` lines 468-472 states plainly "This path is unexercised in this repository today... do not describe it as battle-tested" — matches the binding constraint.
- **Auditor prose (exit 5 routing)**: `core/roles/auditor.md` correctly documents exit 5 → `ESCALATE`, names matched paths, states "not anything you can do" / never retried, and the precedence `1 > 5 > 4` is stated (lines 148-156, 204-205).

### Attack I pursued per the brief — malformed-pattern shapes beyond the unclosed `[`

Design.md Decision 3 states two measured git pathspec defects (unclosed `[`
matches empty silently; empty pattern matches everything) and claims these are
"layered so no single layer is the only defense." The implementation only
detects the unclosed-`[` shape. I tested a third shape: git's `:(exclude)`/`!`
pathspec magic.

**Reproduced against the real script** (not just raw git), using a from-scratch
fixture mirroring the test file's own `new_repo`/`write_events`/`merge_json`
helpers:

- Repo where `record/foo.md` is genuinely touched in the diff.
- `concertino.config.json` at the main checkout: `{"agentMerge":{"protectedPaths":["!record/**"]}}`.
- Result: **`RC=0`, `OUT=PASS`, no stderr** — the guard is silently disarmed.
- Positive control, same fixture, pattern `record/**` (no `!`): **`RC=5`,
  `ERR="PROTECTED record/foo.md"`** — proves the diff genuinely touches the
  path and the guard normally catches it.

Root cause: `core/scripts/check-merge-readiness.sh`'s malformed-pattern check
(around line 627) is `[[ "$pat" =~ \[[^]]*$ ]]` — it only detects an unclosed
`[`. A pattern beginning `!` (or using `:(exclude)` magic explicitly) is a
legal, non-empty string that passes `collectConfigIssues` cleanly (`lib/config.js:848-858`
only checks array-ness, string-ness, and non-emptiness), reaches
`git diff --name-only "$PP_MB" "$VERIFIED_HEAD" -- ":(glob)${pat}"` unmodified,
and git's exclude-only pathspec (no positive pathspec to combine with)
matches **nothing**, exiting 0 — indistinguishable in shape from a
legitimately non-matching glob. `PP_MATCH_OUT` is empty, `PROTECTED_MATCH`
stays 0, the run reports `PASS`.

This is exactly the failure class the ticket's "Verification constraints"
section and design.md's own risk register call out by name: "a guard that
cannot fail is worse than no guard," and Decision 3's stated goal is
"distinguish a typo from a legitimate non-match." A repo operator who writes
`"!scripts/check-*.sh"` — plausible as a copy/paste of a `.gitignore`-style
negation, or a fat-fingered leading character — gets a config that validates
cleanly, a test suite that stays green (nothing in `test/scripts/check-merge-readiness.test.sh`
exercises a `!`-prefixed pattern), and a guard that will never once fire for
that path, silently. This is the exact shape of instance-15 the batch has
been trying to avoid: verification machinery (here, the fail-closed layer)
that looks like it closes the gap but only closes one specific shape of it.

### Other checks

- Mutation-proof transcript (tasks.md 3.3/3.4) is plausible and I reproduced
  arm (d) myself with a matching result; I did not re-run arms (a)/(b)/(c)
  given the reproduction of (d) already establishes the spy/baseline is real
  and the fixture suite is not vacuous in the dimension asked.
- `npm test` (full serial chain, 600s timeout) was still running in the
  background when I reached a definitive verdict from the finding above; I am
  not relying on its outcome for this REFUTE, and it does not bear on the
  defect found (which is exercised by shell fixtures, not the JS suite).

### Verdict: REFUTE

### Change Requests

1. **[blocker]** `core/scripts/check-merge-readiness.sh`'s malformed-pattern
   detection (~line 627, the `[[ "$pat" =~ \[[^]]*$ ]]` check) must also
   reject a pattern using git's exclude/negation pathspec magic — at minimum
   a leading `!`, and ideally any explicit `:(exclude)`/`:(top,exclude)`-style
   magic — as "malformed (exclude-only pathspec matches nothing on its own)",
   refusing per Decision 3's fail-closed branch rather than silently passing.
   Apply the identical fix to `scripts/concertino/check-merge-readiness.sh`
   (byte-for-byte, per the drift test) in the same commit.
2. **[blocker]** Add a fixture to `test/scripts/check-merge-readiness.test.sh`
   proving this arm: a diff that genuinely touches a path, `protectedPaths`
   configured with a `!`-prefixed (or otherwise exclude-magic) version of that
   same glob, asserting the run refuses (does NOT print `PASS`/exit 0) rather
   than silently merging. Mutation-prove it the same way task 3.3 mutation-proved
   the unclosed-`[` arm (remove the new detection, confirm the new fixture
   reddens, restore, confirm green) and record the transcript.
3. **[preference]** Once (1)/(2) land, consider whether design.md Decision 3's
   prose ("git pathspec on malformed input" bullet list) should be updated to
   record this third measured shape alongside the unclosed-`[` and
   empty-pattern cases, so a future reader auditing "is Decision 3's list
   exhaustive" does not have to re-derive it. Non-blocking — the code fix in
   (1) is what matters for AC2/AC4, not the design doc's completeness.

### Non-blocking notes

- Everything else traced cleanly: AC1/AC3, rendered-copy parity, archive
  behavior, docs honesty, auditor-prose routing, and CON-207 scope discipline
  all hold up under independent re-verification. This is a narrow, specific
  gap in the fail-closed layer, not a systemic problem with the change.
