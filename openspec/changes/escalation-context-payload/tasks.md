## 1. gather-escalation-context.sh

- [x] 1.1 Create `core/scripts/gather-escalation-context.sh`: `<KIND> [k=v ...]` interface,
      one formatting branch per kind (`dependency`, `api-change`, `budget`, `blocker`,
      `contradiction`), each validating its required fields (see design.md's table) and
      printing a structured plain-text block to stdout on success.
- [x] 1.2 Missing required field → `FAIL <reason>` on stderr naming the field, exit non-zero,
      nothing on stdout. Unknown kind → `FAIL <reason>` naming the kind and listing valid
      kinds, exit non-zero, nothing on stdout.
- [x] 1.3 `dependency`'s optional `alternative` defaults to "none identified" when omitted.
- [x] 1.4 Mirror the new script byte-for-byte to `scripts/concertino/gather-escalation-context.sh`
      (the existing convention for `core/scripts/*.sh` — see how `emit-event.sh` /
      `persist-evidence.sh` are duplicated) and `chmod +x` it.
- [x] 1.5 Add it to `scripts/concertino/README.md`'s and `core/scripts/README.md`'s script
      table.

## 2. emit-event.sh context handling

- [x] 2.1 In the `escalation --await` path, capture a `context` field specially (alongside the
      existing `ticket`/`role`/`project` special-casing) while still including it in the
      normal `FIELDS` for the first candidate line.
- [x] 2.2 Build the candidate `escalation.raised` line with `context` inline; if it is within
      `MAX_LINE`, write it as-is — no `context_truncated`, no `context_ref`.
- [x] 2.3 If it doesn't fit: write the full context to a temp file; call
      `persist-evidence.sh "$TICKET" <tmpfile>` (invoked as a sibling script — `SCRIPT_DIR`
      resolved the same way `start-servers.sh` locates `emit-event.sh` — naming the temp file
      so the persisted destination is `escalation-context-<epoch_ms>.txt`); on success
      truncate the inline `context` to the remaining byte budget, append a visible marker
      (state bytes shown/total and the ref path), and set `context_truncated=true` and
      `context_ref=<persisted path>`.
- [x] 2.4 If `persist-evidence.sh` fails, keep the truncated `context` and
      `context_truncated=true` but omit `context_ref`.
- [x] 2.5 Preserve the existing last-resort fallback (drop all fields, whole-line
      `truncated:true`) for the case where even an empty `context` still doesn't fit.
- [x] 2.6 Calls with no `context=` field must be byte-for-byte unaffected — no `context` key
      emitted at all.
- [x] 2.7 Mirror the change to `scripts/concertino/emit-event.sh`.
- [x] 2.8 (added during execution, not in the original plan) Clean up the temporary file
      holding the full context after handing it to `persist-evidence.sh`, so an oversized
      escalation never leaks a file into `/tmp` — per skeptic-design-1.md non-blocking note 4.

## 3. Dashboard: reducer + escalation screen

- [x] 3.1 `lib/ui/reducer.js`'s `escalation.raised` case: add
      `context: ev.context != null ? ev.context : null`,
      `contextTruncated: !!ev.context_truncated`,
      `contextRef: ev.context_ref != null ? ev.context_ref : null` to `run.escalation`.
- [x] 3.2 `lib/ui/screens/escalation.js`: render the context block between the question and
      the options when `esc.context` is present; when `esc.contextTruncated`, add a dim note
      naming `esc.contextRef`. No block, no label, no empty frame when there is no context.
      (Renders context line-by-line rather than through a single `f.truncate` call, since
      `gather-escalation-context.sh`'s blocks are multi-line and `f.truncate`/`stripUnsafeControls`
      drop embedded newlines outright rather than preserving them as line breaks.)
- [x] 3.3 Confirmed `handleKey`/`optionKeys` and the reply-typing flow are unaffected (context is
      display-only, no new keybindings) — read through `handleKey`; it only inspects
      `esc.options`/reply state, never `esc.context`.

## 4. Orchestrator role doc

- [x] 4.1 In `core/roles/orchestrator.md`'s "How to raise one", add the context-gathering step
      immediately before the existing `emit-event.sh escalation --await` call, showing
      `gather-escalation-context.sh <kind> ...` piped into `context="$CONTEXT"` on that call.
- [x] 4.2 State the documented fallback: if gathering context doesn't apply or fails, raise the
      escalation without `context=` rather than skip raising it.
- [x] 4.3 Re-render/mirror the corresponding rendered role file(s) this repo commits — **deviation**:
      confirmed `.claude/agents/concertino-orchestrator.md` is gitignored (`.gitignore` line 8,
      `/.claude/agents/concertino-*.md`) and not present in this worktree at all (`git worktree`
      doesn't materialize gitignored local artifacts). `bin/concertino`'s own doctor comment
      states these files are rendered-and-gitignored with no committed baseline, and CON-15 (the
      cited precedent) only touched `core/roles/orchestrator.md` + `bin/concertino`, never a
      rendered agent file, confirming there is nothing to hand-mirror in a way git will track.
      Edited `core/roles/orchestrator.md` only, consistent with actual (not assumed) precedent.

## 5. Tests

- [x] 5.1 New `test/scripts/gather-escalation-context.test.sh`: one happy-path case per kind,
      a missing-required-field failure case, and an unknown-kind failure case. Added it to
      `package.json`'s `test` script alongside the other `test/scripts/*.test.sh` entries.
- [x] 5.2 Extended `test/scripts/emit-event.test.sh`: a `context=` value that fits inline rides
      unchanged; a `context=` value too large is truncated with a visible marker,
      `context_truncated=true`, and a `context_ref` that resolves to a file containing the
      full text; a failed persist (e.g. unwritable evidence dir) yields truncated context with
      no `context_ref`; an escalation without `context=` is unaffected (no `context` key at
      all).
- [x] 5.3 Extended `test/reducer.test.js`: an `escalation.raised` event with `context` /
      `context_truncated` / `context_ref` populates `run.escalation` correctly; one without
      `context` yields `context: null` and no truncation flag.
- [x] 5.4 Extended `test/escalation.test.js`: rendering with context shows it above the options
      (including a multi-line context case); rendering with a truncated context shows the ref
      note; rendering with no context matches today's output exactly (no empty frame).

## 6. Validation

- [x] 6.1 `openspec validate escalation-context-payload --strict` passes (the literal command in
      this file, `openspec validate --change "..."`, is a typo confirmed non-working during the
      design gate — skeptic-design-1.md non-blocking note 3 — corrected here to the syntax the
      installed CLI actually accepts).
- [x] 6.2 Full test suite (`npm test`) passes, including the new/extended cases and the
      untouched `test/scripts/escalation-loop.test.sh` end-to-end path.
- [x] 6.3 Recorded which planning artifacts and code files changed for the evaluator/skeptic in
      `files-modified.md`.
