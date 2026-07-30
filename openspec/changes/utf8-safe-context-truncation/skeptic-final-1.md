## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Ticket ACs re-read from Linear (CON-16) and `ticket.md`** — both match verbatim.

2. **Diff scope** — `git diff main...HEAD --stat`: only `core/scripts/{emit-event,assert-phase}.sh`,
   their rendered `scripts/concertino/` copies, `test/scripts/{emit-event,assert-phase}.test.sh`,
   and this change's own `openspec/` artifacts. No drive-by changes.

3. **AC1 (never split UTF-8, back off to previous char boundary)** — read
   `core/scripts/emit-event.sh:104-140` (`utf8_safe_prefix`, walks backward past continuation
   bytes to find the lead byte, checks whether its full sequence length would run past `end`)
   and `core/scripts/assert-phase.sh:28-47` (`utf8_safe_char_prefix`, decodes UTF-8, slices by
   code point via `Array.from`, re-encodes). Both operate on raw bytes/decoded text, not
   locale-dependent shell semantics.

4. **AC2 (honest byte counts, persist unaffected)** — read
   `core/scripts/emit-event.sh:268-282`: `persist-evidence.sh` is called and `ref` captured
   *before* the binary-search truncation loop even starts, so persist behavior is provably
   untouched by the truncation fix. The marker now uses `actual_bytes` (measured via `wc -c`
   on the possibly-backed-off prefix), not the requested `mid` — confirmed by reading the
   diff hunk directly.

5. **AC3 (regression test with multi-byte chars across the boundary)** — present in both test
   files. I did not just read them; I **reproduced the regression**: reverted
   `core/scripts/{emit-event,assert-phase}.sh` to `git show main:...` (pre-fix), re-ran both
   test files, and got:
   - `emit-event.test.sh`: `FAIL multi-byte context: still valid JSON`, `FAIL ... no
     replacement character`, `FAIL ... marker byte count matches` (3 failures, matching the
     documented pre-fix probe in `files-modified.md` — pre-fix JSON is genuinely invalid).
   - `assert-phase.test.sh`: the *default-locale* multi-byte test still passed pre-fix (this
     dev machine's `en_US.UTF-8` locale already makes `${msg:0:200}` character-safe — expected
     per design.md), but the `LC_ALL=C`-forced variant failed all 3 assertions pre-fix,
     confirming the locale-dependent bug this fix actually targets.
   Then I restored the fixed files (byte-for-byte identical to the diff, confirmed via
   `git diff --stat`) and re-ran both suites: 66/66 and 57/57 passing. This proves the new
   tests are not vacuously green — they demonstrably catch the reverted bug and demonstrably
   pass against the fix.

6. **AC4 (check the same boundary in `msg`/`first_error` truncation)** — grepped
   `core/scripts/emit-event.sh` for `cut -b`/`cut -c`/`${...:0:...}`: no such site exists
   outside the fixed `write_escalation_raised()`; emit-event.sh's own line-length safety net
   drops whole fields rather than slicing a string, so it has no character-split risk. The
   actual `first_error` truncation site is `assert-phase.sh`'s `fail()`, which is fixed.
   `check-merge-readiness.sh`'s `cut -c1-200` (a second byte/char-unaware truncation in the
   codebase) was checked and correctly scoped out: I read its `fail()`
   (`core/scripts/check-merge-readiness.sh:53-57`) and confirmed it only writes to stderr and
   sets a local flag — it never emits telemetry via `emit-event.sh`, so it can never populate
   a `first_error` field. This is a reasoned, verified narrowing, not a silent AC dodge.

7. **Full regression suite** — `npm test` (all 16 test files): exit 0, 447 `ok`, 0 `not ok`.
   Ran independently, not merely trusted from `evaluation-1.md`.

8. **Rendered-copy parity** — `diff core/scripts/emit-event.sh scripts/concertino/emit-event.sh`
   and the `assert-phase.sh` equivalent: byte-identical, confirming the `concertino sync`
   re-render task was done correctly.

9. **`openspec validate utf8-safe-context-truncation --strict`** — "Change
   'utf8-safe-context-truncation' is valid".

10. **Spec deltas** (`specs/escalation-context/spec.md`, `specs/gate-telemetry/spec.md`) — read
    both in full; each new/modified requirement and scenario matches the actual code behavior
    verified above (byte-boundary back-off, honest marker byte count, code-point-safe
    `first_error` trim, locale independence).

11. **Design-gate history** — round 1 was REFUTE (capability misplacement), round 2 CONFIRM
    after the fix was relocated to a `gate-telemetry` capability. Confirmed the resulting
    `specs/gate-telemetry/spec.md` in the diff matches that resolution.

12. **No UI surface** — `git diff main...HEAD --stat` contains no `lib/ui/*` files; this is a
    shell-script telemetry fix. Dev-server/screenshot review is correctly N/A, and no design
    standard is configured for this project.

13. **Git status after all probing** — clean aside from the change's own tracked
    `workflow-state.md`/`evaluation-1.md`; no leftover artifacts from my revert-and-restore
    probe.

### Verdict: CONFIRM

All four acceptance criteria trace to real, independently-reproduced evidence. The regression
tests are not merely present but demonstrably fail against the pre-fix code and pass against
the fix (verified by direct revert-and-rerun, not by trusting the evaluator's narrative). Scope
is contained to the two scripts, their rendered copies, and tests. No UI surface to review.

### Non-blocking notes
- The ticket's own wording locates the AC4 "msg/first_error truncation" inside
  `emit-event.sh`, when the actual site is `assert-phase.sh`. Worth a one-line correction in a
  future ticket-authoring pass so the record doesn't mislead a future reader — does not affect
  correctness here (already noted by the evaluator; I independently confirmed it's accurate).
