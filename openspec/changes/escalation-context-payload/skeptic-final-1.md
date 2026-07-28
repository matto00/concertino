## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Read planning artifacts**: `ticket.md`, `proposal.md`, `design.md`,
  `specs/escalation-context/spec.md`, `files-modified.md`, `evaluation-1.md`, `tasks.md`,
  `workflow-state.md` — all read in full from the worktree.

- **AC1 (`escalation.raised` carries structured `context`)**: read
  `core/scripts/emit-event.sh` end to end (lines 99-274). `context=` is captured separately
  from other fields (`CONTEXT`/`FIELDS` split, lines 128-136) and `write_escalation_raised()`
  builds the candidate line with context inline first. Independently reproduced (not just
  read the tests): ran `gather-escalation-context.sh blocker ...` piped into
  `emit-event.sh escalation --await ... context="$CTX"` against a scratch ticket
  (`SKEPTICTEST2`), answered it, and read back the raw `escalation.raised` JSON line myself.

- **AC2 (orchestrator gathers via script, no new decision point)**: read the diff to
  `core/roles/orchestrator.md` (`git diff main...HEAD -- core/roles/orchestrator.md`). The
  context-gathering step is inserted immediately above the existing
  `emit-event.sh escalation --await` call, correctly distinguishes "no context" (empty
  `CONTEXT`, `context=` key omitted entirely) from "context=''" (which would wrongly show as
  present-but-empty) via `[ -n "$CONTEXT" ] && ARGS+=(context="$CONTEXT")` — this matters
  because the reducer/screen contract is "absent key means no context," and the role doc gets
  this right rather than passing an empty string.

- **AC3 (screen renders above options, degrades honestly)**: read
  `lib/ui/screens/escalation.js` in full. Context renders line-by-line (not through a single
  `f.truncate`, which would eat embedded newlines) between the question (line 66) and the
  options (line 85). The `if (esc.context)` guard (line 75) means no context produces zero
  extra output — confirmed by reading the diff is additive-only and by the
  `escalation.test.js` case that diffs a with-context render against a without-context render.

- **AC4 (4000-byte cap, visible truncation, CON-10 mechanism reuse)** — the two named traps:
  - **Byte cap**: reproduced independently outside the test suite. Built a 6097-byte context
    via `gather-escalation-context.sh blocker ... output=<6000 x's>`, ran
    `emit-event.sh escalation --await` with it, and measured the actual persisted
    `events.jsonl` line: file size 4001 bytes = 4000-byte line + trailing `\n`, i.e. the cap
    lands exactly at the boundary, never over. Confirmed the binary-search truncation in
    `write_escalation_raised()` (`core/scripts/emit-event.sh` lines 225-273) builds-then-measures
    the real candidate line (JSON-escaped, marker included) rather than estimating, which is
    why it can land exactly at the boundary instead of guessing conservatively short or
    violating it.
  - **Visible, not silent**: the truncated `context` field ends with
    `… [truncated, 3409 of 6097 bytes shown — full context: <ref>]` — read directly off the
    JSON I captured, not asserted from a report.
  - **Persistence reuses CON-10's mechanism, not a new one**: read `persist-evidence.sh` in
    full — it is called unmodified (`"${SCRIPT_DIR}/persist-evidence.sh" "$TICKET" "$src"`,
    emit-event.sh line 216), writing to the identical
    `<main checkout>/.concertino/runs/<TICKET>/evidence/` directory CON-10 introduced. No
    second persistence path exists anywhere in the diff.
  - **Durability across `cleanup.sh --phase4`**: read `scripts/concertino/cleanup.sh` — its
    only destructive action is `git -C "$REPO_ROOT" worktree remove "$WORKTREE_PATH" --force`.
    The `context_ref` path I captured
    (`/home/matt/Development/concertino/.concertino/runs/SKEPTICTEST2/evidence/...`) is under
    the main checkout, structurally outside anything `git worktree remove` touches — confirmed
    by path inspection, not merely by the test suite's own claim. (I did not run cleanup.sh
    itself, per this role's guardrails; the mechanism is identical to CON-10's, whose own test
    — `test/scripts/persist-evidence.test.sh`'s "ref still exists/readable after worktree
    removal" — already exercises this destructively and passes.)
  - **Failed-persist path omits the ref rather than dangling one**: read the
    `persist_out="$(...)" ... ref="${persist_out#READY ref=}"` logic — `ref` stays empty
    string unless `persist-evidence.sh` succeeds, and the binary-search loop conditionally
    omits `context_ref` from `fields_try` when `ref` is empty (line 249).
  - **question/options never sacrificed**: `OTHER_FIELDS` (built separately from `context`,
    line 138) is what the truncation loop rebuilds from — `question`/`options` are structurally
    incapable of being touched by the context-truncation logic.

- **AC5 (tests: with / without / oversized context)**: ran `npm test` myself in the worktree —
  exit 0, `node --test` reports `fail 0`, and every bash suite (`emit-event.test.sh` 59/59
  including the new context cases by name — "small context: rides inline unchanged",
  "oversized context: raised line <= 4000 bytes", "failed persist: no context_ref key", etc.;
  `gather-escalation-context.test.sh`, `reducer.test.js`, `escalation.test.js`) passed with
  the counts the evaluator reported. Read the new test bodies in `test/reducer.test.js` and
  `test/escalation.test.js` — they assert ordering (question-then-context-then-options) and
  structural difference (with vs. without context), not tautologies.

- **Mirroring convention**: `diff core/scripts/gather-escalation-context.sh
  scripts/concertino/gather-escalation-context.sh` and the same for `emit-event.sh` and both
  `README.md`s — byte-identical, confirmed myself.

- **`openspec validate escalation-context-payload --strict`** — ran it myself: "Change
  'escalation-context-payload' is valid".

- **tasks.md** — no unchecked `[ ]` items (`grep -n "\[ \]"` empty).

- **UI review**: N/A per the task brief (no design standard configured for this project);
  the escalation screen is a TUI rendered to plain strings, already covered by the
  reducer/screen unit tests I re-ran and by directly reading the render logic (line-by-line
  context, additive guard, no empty frame).

### Cleanup note
My own verification run wrote a scratch ticket directory
(`.concertino/runs/SKEPTICTEST2/...`) and a stray leftover from an earlier failed attempt
(`.concertino/runs/SKEPTIC-TEST-4040892`, `.concertino/runs/answer.json`) into the **main
checkout** (not the worktree, since `emit-event.sh` always targets the main checkout by
design). I deleted all of these before finishing; `git status --short` in the worktree shows
only the evaluator's own `workflow-state.md`/`evaluation-1.md` changes, nothing from my probing.

### Verdict: CONFIRM

All five acceptance criteria trace to real, independently-reproduced evidence rather than
just the evaluator's claims. Both named traps (byte cap, ref durability) hold under direct
reproduction, not just under the test suite's own assertions. No placeholders, no silent
truncation, no second persistence mechanism, no regression in the pre-existing
non-context escalation path (`escalation-loop.test.sh` 12/12 unmodified).

### Non-blocking notes
- Same UTF-8 byte-boundary truncation note the evaluator raised (`cut -b` could split a
  multi-byte character) — not exercised by any ticket AC and not a blocker, but worth a
  follow-up if non-ASCII context text becomes common.
- `gather-escalation-context.sh`'s `blocker` kind does not itself truncate `output=`; the
  ticket's "first lines" phrasing implicitly delegates that to the caller. Already noted by
  the evaluator; stating it explicitly in the script's header or the role doc would close a
  small ambiguity for a future orchestrator run, but is not required by any AC.
