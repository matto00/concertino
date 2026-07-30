## 1. Implementation

- [x] 1.1 In `core/scripts/cleanup.sh`, in the retry-exhaustion block (after
      `attempt_fast_forward` is re-run on a `retry` answer), branch the
      logged note on `FF_STATUS`: `fetch-failed`/`no-local-base` produce a
      "could not determine whether local <base> is behind ... — <reason>"
      note; `dirty`/`diverged`/`failed` (or anything else reaching this
      branch) keep today's "remains behind ... resolve manually" wording.
- [x] 1.2 Re-sync `scripts/concertino/cleanup.sh` from `core/scripts/cleanup.sh`
      (`concertino sync`, or the project's normal sync path) so the rendered
      copy matches.

## 2. Tests

- [x] 2.1 In `test/scripts/cleanup.test.sh`, add a retry-exhaustion case where
      the retried attempt's own fetch fails (e.g. point the remote at an
      unreachable path for the retry) and assert the "could not determine"
      wording appears on stderr, "remains behind" does NOT appear, exit
      status is still 0, and `READY cleaned worktree=` still prints.
- [x] 2.2 Confirm the existing dirty/diverged retry-exhaustion coverage (or a
      new equivalent case that reaches retry-exhaustion via a confirmed
      `dirty`/`diverged`/`failed` status rather than success) still asserts
      today's "remains behind" wording unchanged.
- [x] 2.3 Run `test/scripts/cleanup.test.sh` and confirm all cases pass.

## 3. Verification

- [x] 3.1 Run the project's standard verification gates (lint/tests) and
      confirm they pass before committing.
