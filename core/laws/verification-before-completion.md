---
name: verification-before-completion
description: Iron Law for completion claims — no claim without fresh verification evidence.
applies_to: executor, evaluator, skeptic
inspired_by: superpowers/verification-before-completion (https://github.com/obra/superpowers)
note: Inspired by superpowers; rewritten for Concertino. No runtime dependency.
---

# Verification Before Completion

## The Iron Law

**NO COMPLETION CLAIM WITHOUT FRESH VERIFICATION EVIDENCE.**

You may not state that something passes, builds, works, or is done until you have
**run the verifying command fresh, read its full output and exit code, and the
output matches the claim.** Paste the evidence. Assertion is not evidence.

## The gate function (every claim passes through this)

1. **IDENTIFY** the command that verifies the claim.
2. **RUN** it fresh and in full (not from memory of an earlier run).
3. **READ** the complete output and the exit code.
4. **VERIFY** the output actually matches the claim.
5. **ONLY THEN** state the claim — with the output pasted as evidence.

## Your verification commands

The commands that verify your project's claims are declared in
`concertino.config.json → gates`, each with a `name`, a `when` file-glob (so you
only run the gates for the areas you touched), and the `command` to run. The
rendered version of your agent role lists the concrete gates for this project.

| Claim                   | Required evidence                                                  |
| ----------------------- | ------------------------------------------------------------------ |
| A gate passes           | that gate's command output + exit code, matching the claim         |
| Bug fixed               | the original symptom's test/probe now passing (was failing before) |
| Regression test added   | the test fails before the fix and passes after — show both         |
| Acceptance criteria met | line-by-line checklist against actual observed output              |

Run only the gates whose `when` matches your changed files, enumerated via
the LIVE-resolved review base (CON-152 — never a hand-typed
`main`/`<base>` ref, which never moves for the life of the worktree):

```bash
BASE_SHA="$(scripts/concertino/resolve-review-base.sh "$WORKTREE_PATH" "$REVIEW_BASE_BRANCH" "$REVIEW_BASE_REMOTE")" \
  || { echo "BLOCKER: could not resolve the review diff base — see resolve-review-base.sh's stderr above"; exit 1; }
git diff --name-only "$BASE_SHA"...HEAD
```

(fields from `workflow-state.md`; the script falls back to its own config
defaults when they're absent.) **Check the exit status, always**: the
script prints exactly the SHA on success and nothing on failure — never
pipe through `sed`/`awk` or ignore a non-zero exit, either of which leaves
`BASE_SHA` empty and turns this into a silent no-op diff instead of a loud
error.

## Evidence rules

- Gate results in your return/handoff must be **pasted command output with exit
  codes**, not prose summaries. "Tests pass" is not evidence; the runner's
  summary line is.
- Never rely on a sub-agent's _report_ of success — verify independently. (This is
  why the evaluator re-runs the gates rather than trusting the executor.)

## Banned hedge language (STOP before using)

"should," "should be fine," "probably," "seems to," "I think it works," and
premature celebration ("Done!", "Perfect!", "All set!") **before** the evidence
exists. Run the command, read the output, then claim — never the reverse.
