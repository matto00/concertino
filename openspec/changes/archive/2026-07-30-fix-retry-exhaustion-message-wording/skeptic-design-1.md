## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket ACs** (`ticket.md`): read all 4 acceptance criteria — (1) failed-fetch
  retry-exhaustion reports "could not determine" + why, (2) confirmed-behind
  retry-exhaustion keeps current wording, (3) no exit-status/skip-behavior
  change, (4) covered in `test/scripts/cleanup.test.sh`.

- **Ground-truth source code** (`core/scripts/cleanup.sh`, read in full):
  - Confirmed `attempt_fast_forward()` (lines 92–153) sets `FF_STATUS` to
    exactly the seven values the proposal/design claim
    (`fetch-failed`, `no-local-base`, `current`, `updated`, `dirty`,
    `diverged`, `failed`), and that `fetch-failed`/`no-local-base` are the
    only two statuses reached *before* any local-vs-remote comparison
    (lines 97–103) — matches the design's "these two are pre-comparison"
    claim exactly.
  - Confirmed the escalation trigger (line 163) fires only on
    `dirty`/`diverged`/`failed` — matches the design's Non-Goals claim that
    `fetch-failed`/`no-local-base` on the *first* attempt already skip
    silently, unchanged by this proposal.
  - Confirmed the actual bug: after `retry` (line 171 re-calls
    `attempt_fast_forward`), line 172–176 treats *any* non-`updated`/
    non-`current` `FF_STATUS` identically, always emitting "remains behind
    ... after retry" — including when the retry itself returned
    `fetch-failed`/`no-local-base`, which never reached a comparison. This
    is exactly the wording bug the ticket describes; the fix location
    (lines 170–177) matches task 1.1's target precisely.
  - Confirmed `FF_REASON` is never set on the `fetch-failed`/`no-local-base`
    paths (stays `""` from line 94), so the design's hardcoded fallback
    reason text ("fetch failed" / "no local `<base>` branch") is the only
    reason ever surfaced for those two statuses today — consistent with the
    design's own hedged phrasing ("falling back to any `FF_REASON` if the
    retry path ever sets one").

- **Sync claim**: `diff core/scripts/cleanup.sh scripts/concertino/cleanup.sh`
  → no output (files identical), confirming the "canonical + synced copy"
  impact statement and task 1.2's re-sync step are grounded in a real,
  currently-in-sync pair.

- **Test-coverage claim** (`test/scripts/cleanup.test.sh`, read in full, 194
  lines): confirmed there is *no* existing case that reaches
  retry-exhaustion via a still-failing retry (dirty/diverged/failed) — the
  only retry case present (lines 170–191) is the successful-retry path,
  which asserts the *absence* of "remains behind". Task 2.2's hedge
  ("existing coverage... or a new equivalent case") is therefore not
  boilerplate — it correctly identifies a real gap the executor must fill,
  not just the new fetch-failed case in 2.1.
  Task 2.1's proposed mechanism (break the remote — e.g.
  `git remote set-url origin <unreachable>` — between the first escalation
  and the `retry` answer) is directly analogous to the existing successful-
  retry test's pattern (stash the dirty edit between escalation and
  `retry`, lines 181–183), so it is realistic and executable with the
  existing harness (`new_pair`, `write_answer`, `wait_for_escalation`).

- **Spec delta** (`specs/main-fast-forward/spec.md`): the modified
  requirement's prose and the new fourth scenario ("A retry whose own fetch
  fails reports an unknown state, not 'behind'") map 1:1 onto AC1 and AC2;
  the existing three scenarios (retry-succeeds, skip, confirmed-behind
  retry-exhaustion) are preserved unchanged, and the confirmed-behind
  scenario's wording matches AC2 verbatim in intent.

- **Internal consistency**: proposal → design → tasks → spec delta all
  agree on: the two-status split (`fetch-failed`/`no-local-base` vs.
  `dirty`/`diverged`/`failed`), the branch point (`FF_STATUS`, no new
  plumbing), no change to escalation trigger/exit code/skip behavior, and
  the two required test cases. No contradictions found between any pair of
  documents.

- **No placeholders/hand-waving**: no `TODO`/`TBD` in any artifact; the one
  hedge present (design's "falling back to any `FF_REASON` if the retry
  path ever sets one") is a defensive fallback for behavior that doesn't
  currently exist, not a deferred decision — the concrete fallback text is
  fully specified for both statuses.

- **Scope**: change is confined to stderr wording in one retry-exhaustion
  branch plus its test; no API/schema/exit-status changes claimed or
  present in the diff plan. Matches the ticket's "wording only, no
  behavioural defect" framing.

- **`openspec validate fix-retry-exhaustion-message-wording --strict`** →
  `Change 'fix-retry-exhaustion-message-wording' is valid`.

### Verdict: CONFIRM

### Non-blocking notes
- The design specifies symmetric handling for `no-local-base` (reason: "no
  local `<base>` branch"), but neither AC1 nor tasks 2.1/2.2 require a test
  exercising that specific status via retry — only `fetch-failed` is
  test-covered per the ticket's AC wording ("after a failed fetch"). This is
  consistent with the ticket's stated scope, not a gap against the ACs as
  written, but the executor may want to add a `no-local-base` case for
  symmetry if it's cheap (not required to pass this gate).
