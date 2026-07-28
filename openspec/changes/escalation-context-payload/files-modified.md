# Files modified — escalation-context-payload (CON-11)

- `core/scripts/gather-escalation-context.sh` (new) — pure formatter for the five escalation
  kinds (`dependency`, `api-change`, `budget`, `blocker`, `contradiction`); validates required
  fields per kind, `FAIL`s on stderr + exits non-zero + prints nothing on stdout for a missing
  field or an unrecognized kind.
- `scripts/concertino/gather-escalation-context.sh` (new) — byte-for-byte mirror of the above,
  per this repo's `core/scripts/*.sh` ↔ `scripts/concertino/*.sh` convention.
- `core/scripts/emit-event.sh` — the `escalation --await` path now captures an optional
  `context=` field: rides inline unchanged when the full line fits `MAX_LINE`; when it doesn't,
  persists the full text via a sibling call to `persist-evidence.sh` (named
  `escalation-context-<epoch_ms>.txt`, cleaned up from `/tmp` after the persist attempt either
  way), truncates the inline `context` to a binary-searched byte budget with a visible marker,
  and sets `context_truncated=true` / `context_ref=<path>` (omitting `context_ref` if the
  persist itself fails). Calls without `context=` are unaffected — no `context` key at all.
  Every pre-existing code path (non-escalation kinds, escalations without context, the
  question/options-too-big last resort) is untouched.
- `scripts/concertino/emit-event.sh` — byte-for-byte mirror of the above.
- `core/scripts/README.md` / `scripts/concertino/README.md` (kept byte-identical) — added
  `gather-escalation-context.sh` to the script table and its contract to the bullet list.
- `core/roles/orchestrator.md` — "How to raise one" gains a context-gathering step (run
  `gather-escalation-context.sh <kind>` for whichever of the five kinds applies, capture its
  output as `CONTEXT`) immediately before the existing `emit-event.sh escalation --await` call,
  with the documented fallback (context doesn't apply, or the script fails → raise without
  `context=` rather than skip raising). Deliberately does not claim the five kinds map 1:1 onto
  "Always reaches the human"'s four bullets (per skeptic-design-1.md non-blocking note 1) — it
  says only that identifying which kind applies, when one does, is not a new decision.
- `lib/ui/reducer.js` — `escalation.raised` case gains `context`, `contextTruncated`,
  `contextRef` on `run.escalation` (all additive/optional; absent events produce `null`/`false`).
- `lib/ui/screens/escalation.js` — renders `esc.context` (line-by-line, since
  `gather-escalation-context.sh`'s blocks are multi-line and a single `f.truncate` call drops
  embedded newlines outright) between the question and the options, with a dim ref note when
  `contextTruncated`. No context → no block, label, or empty frame, identical to pre-change
  output. `handleKey`/`optionKeys` untouched — context is display-only.
- `package.json` — added `test/scripts/gather-escalation-context.test.sh` to the `test` script's
  literal list of shell test files.
- `test/scripts/gather-escalation-context.test.sh` (new) — happy path per kind (including the
  `alternative` default vs. explicit-value case), missing-required-field failure, unknown-kind
  failure.
- `test/scripts/emit-event.test.sh` — added: small context rides inline with no truncation
  keys; oversized context is truncated with a resolvable `context_ref` whose file holds the
  full text and whose `question`/`options` are unaffected; a failed persist (unwritable
  evidence dir) yields truncated context with no `context_ref`; no `context=` yields no
  `context` key at all. All pre-existing cases in this file pass unmodified.
- `test/reducer.test.js` — added: `context`/`context_truncated`/`context_ref` populate
  `run.escalation` correctly; no `context` yields `context: null` and `contextTruncated: false`.
- `test/escalation.test.js` — added: context renders between question and options (including a
  multi-line case); a truncated context's note names the ref; no context renders with no
  context-related text at all.

## Deviations from tasks.md (flagged, not absorbed silently)

1. **Task 4.3** (mirror the rendered role file, e.g.
   `.claude/agents/concertino-orchestrator.md`): confirmed this file is gitignored
   (`.gitignore` line 8, `/.claude/agents/concertino-*.md`) and does not exist in this worktree
   at all. `bin/concertino`'s own doctor-drift comment states these files are rendered
   build artifacts with no committed baseline, and the cited precedent (CON-15, commit
   `aa89d43`) only ever touched `core/roles/orchestrator.md` + `bin/concertino`, never a
   rendered agent file. There is nothing to hand-mirror that git tracks — edited
   `core/roles/orchestrator.md` only.
2. **Task 6.1**'s literal command (`openspec validate --change "escalation-context-payload"`)
   does not match the installed CLI (`error: unknown option '--change'`), confirmed already by
   skeptic-design-1.md non-blocking note 3. Ran `openspec validate escalation-context-payload
   --strict` instead, per that note.
3. Added task 2.8 (not in the original numbered plan): clean up the temp file holding the full
   context after handing it to `persist-evidence.sh`, per skeptic-design-1.md non-blocking
   note 4.
