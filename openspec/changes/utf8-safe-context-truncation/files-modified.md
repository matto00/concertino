# Files modified

- `core/scripts/emit-event.sh` — added the `utf8_safe_prefix` node-backed helper (operates on
  raw bytes, backs off past an incomplete trailing multi-byte sequence); `write_escalation_raised()`
  now calls it instead of `LC_ALL=C cut -b "1-${mid}"`, and the truncation marker now reports
  the actual byte length of the (possibly backed-off) prefix instead of the requested `mid`.
- `core/scripts/assert-phase.sh` — added the `utf8_safe_char_prefix` node-backed helper
  (decodes UTF-8, trims by Unicode code point via `Array.from`/`slice`, re-encodes); `fail()`'s
  `FIRST_ERROR="${msg:0:200}"` now goes through it instead of bash's locale-dependent substring
  indexing.
- `scripts/concertino/emit-event.sh`, `scripts/concertino/assert-phase.sh` — rendered copies
  re-synced by hand (`concertino sync` also pulled in unrelated pre-existing drift from a prior
  change that never re-synced `scripts/concertino/`; that drift was reverted so this change stays
  scoped to the two files it touches — see the spinoff note below) so they stay byte-for-byte
  identical to `core/`.
- `test/scripts/emit-event.test.sh` — added a regression test that calibrates the binary
  search's real truncation boundary via an ASCII-only oversized escalation, then places a
  single 4-byte emoji straddling that exact boundary and asserts the emitted line is valid
  JSON, the decoded `context` has no `U+FFFD` replacement character, and the marker's reported
  byte count matches the actual byte length of the inline prefix.
- `test/scripts/assert-phase.test.sh` — added a regression test that fails a gate with a
  message containing a 4-byte emoji positioned so its bytes straddle byte offset 200 (the old
  code's cut point under a `C`/`POSIX` locale), asserted both under the default locale and
  under `LC_ALL=C`/`LANG=C` explicitly, to prove the fix is locale-independent.
- `openspec/changes/utf8-safe-context-truncation/tasks.md` — checked off all tasks as
  completed.

## Root cause / probe (systematic-debugging.md)

- **Root cause:** `emit-event.sh`'s `write_escalation_raised()` truncated the oversized
  `context=` value with `LC_ALL=C cut -b "1-${mid}"` (a pure byte-count cut with no UTF-8
  awareness), and `assert-phase.sh`'s `fail()` truncated `FIRST_ERROR` with bash's own
  `${msg:0:200}`, which is character-safe only when the calling shell's locale names a
  multibyte encoding and silently becomes byte-oriented under `C`/`POSIX`. Either cut can land
  inside a multi-byte UTF-8 sequence and split it.
- **Probe (assert-phase.sh, pre-fix):** ran the pre-fix `fail()` with a message containing a
  4-byte emoji positioned so its bytes span offsets 197–200, under `LC_ALL=C LANG=C`:
  `first_error` came back 198 code points long and containing `U+FFFD`
  (`expected [200] got [198]` / `expected [clean] got [has-replacement]`) — confirms the
  byte-oriented split predicted by the hypothesis.
- **Probe (emit-event.sh, pre-fix):** ran the pre-fix `write_escalation_raised()` with an
  oversized `context=` containing a 4-byte emoji straddling the calibrated cut boundary
  ([BOUNDARY-2, BOUNDARY+2)): the emitted `escalation.raised` line was **not valid JSON**
  (`JSON.parse` threw) — worse than a replacement character, confirming the ticket's
  "escalation vanishes entirely" failure mode.
- Both probes were re-run after the fix (same construction) and passed: valid JSON, no
  `U+FFFD`, `first_error` exactly 200 code points, marker byte count matches the actual inline
  prefix length. See the two new test-file sections themselves as the permanent regression
  lock.

## Spinoff candidate (out of scope for this ticket)

Running `concertino sync` in this worktree also re-rendered `scripts/concertino/README.md`,
`scripts/concertino/setup-worktree.sh`, and added `scripts/concertino/resolve-speed.sh` /
`scripts/concertino/speeds.json` — pre-existing drift where a prior change (CON-22, delivery
speeds) updated `core/scripts/setup-worktree.sh` but never ran `concertino sync` to update the
rendered copies. That drift is unrelated to this ticket's UTF-8 truncation fix, so it was
reverted here to keep this change scoped; worth its own ticket to re-sync
`scripts/concertino/` project-wide.
