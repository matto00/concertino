## 1. UTF-8 safe truncation helper

- [x] 1.1 In `core/scripts/emit-event.sh`, add a node-backed helper (`utf8_safe_prefix`) that,
      given raw bytes and a byte budget, returns the largest prefix that (a) is at most that
      many bytes and (b) never ends inside a multi-byte UTF-8 sequence — backing off to the
      last whole character when the budget lands mid-sequence.
- [x] 1.2 Replace `write_escalation_raised()`'s `LC_ALL=C cut -b "1-${mid}"` call with this
      helper, and change the marker text to report the *actual* byte length of the resulting
      (possibly backed-off) prefix rather than the requested `mid`.
- [x] 1.3 In `core/scripts/assert-phase.sh`'s `fail()`, replace the locale-dependent
      `FIRST_ERROR="${msg:0:200}"` with a call to a character-boundary-safe 200-character trim
      (code-point aware, reusing the same never-split-a-multi-byte-character principle), so
      behavior no longer depends on the calling shell's `LC_CTYPE`/`LC_ALL`.
- [x] 1.4 Re-render the project's own rendered copies (`scripts/concertino/emit-event.sh`,
      `scripts/concertino/assert-phase.sh`) via `concertino sync` (or by hand if `concertino`
      isn't runnable in this worktree) so the two stay byte-for-byte identical to `core/`, as
      they are today.

## 2. Tests

- [x] 2.1 Add a case to `test/scripts/emit-event.test.sh` that raises an oversized escalation
      whose `context=` places a multi-byte character (e.g. a 4-byte emoji) exactly across the
      binary search's truncation boundary, and assert: the emitted line is valid JSON, the
      decoded `context` field ends on a whole character (round-trips through
      `Buffer.from(str, 'utf8')` without a replacement character), and the marker's reported
      byte count equals the actual byte length of the inline `context` value.
- [x] 2.2 Add a case to `test/scripts/assert-phase.test.sh` that fails a gate with a message
      containing a multi-byte character positioned at/across the 200-character trim boundary,
      and assert `first_error` is valid UTF-8 ending on a whole character — run once under the
      default locale and, if feasible in this environment, once with `LC_ALL=C` to prove the
      fix is locale-independent.
- [x] 2.3 Confirm the two pre-existing ASCII-only assertions ("oversized context: raised line
      <= 4000 bytes" / "first_error trimmed to 200 chars") still pass unchanged — the fix must
      be a no-op whenever the original cut already lands on a character boundary.

## 3. Verification

- [x] 3.1 Run the full project test suite (`npm test`) and confirm it passes, including the
      two new/updated test files.
- [x] 3.2 Run `openspec validate --change "utf8-safe-context-truncation"` and confirm no
      errors.
