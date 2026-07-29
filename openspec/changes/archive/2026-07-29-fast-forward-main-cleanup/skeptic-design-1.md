## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/main-fast-forward/spec.md`, `specs/cross-screen-escalation/spec.md`) in full.
- Cross-checked every AC in the Linear ticket (CON-25, fetched live) against the design/tasks —
  all seven are addressed by some task/requirement (fast-forward in Phase 4; silent-clean/escalate
  split; never touch dirty/diverged; cross-screen banner + reply + auto-clear; post-ff re-render or
  note; `doctor` behind-remote check; multi-worktree safety via refs-only operation).
- `core/scripts/cleanup.sh` (58 lines, read in full): confirmed current Phase-4 opt-in guard,
  `REPO_ROOT="$(git rev-parse --show-toplevel)"`, worktree removal, then an unconditional
  `run.end` emission, then the `READY cleaned worktree=...` line — confirms the design's claim
  that `run.end` currently fires immediately after worktree removal and must move later for the
  "run stays needs-you while blocked" reasoning to hold.
- `core/scripts/setup-worktree.sh`: confirmed the `.concertino.env` sourcing pattern
  (`[ -f "${SCRIPT_DIR}/.concertino.env" ] && source ...`) and `BASE_REMOTE=${CONCERTINO_BASE_REMOTE:-origin}` default match what task 1.1 proposes.
- `core/scripts/emit-event.sh` (374 lines, read the `--await`/answer-polling section in full):
  confirmed `O_EXCL`-atomic answer write is read here, `escalation.answered`/`escalation.timeout`
  are logged as design claims, and the "MAIN checkout, never the worktree" comment matches
  `main_checkout()`'s `git rev-parse --git-common-dir` resolution.
- `lib/ui/store.js`: confirmed `writeAnswer`'s `wx`-flag atomicity and error/reason shape
  (`{ok:false, reason:'answered'|'error', error}`) matches design's claims.
- `lib/ui/reducer.js` (full file): confirmed `escalation.raised`/`answered`/`timeout` handling,
  `deriveStatus`, and `escalationStale` — matches proposal's claim that no reducer change is
  needed for the fast-forward escalation to read as "needs-you" while blocked and clear afterward.
- `lib/ui/screens/escalation.js` (full file) and `lib/ui/watch.js` (read in full, esp. lines
  212–228 `currentState()`/`backToFleet()`, 490–606 `answerEscalation()` and `applyAction()`'s
  case blocks, 857 `router.handleKey` dispatch) and `lib/ui/router.js` (full file): traced the
  actual action-verb wiring the design proposes to reuse.
- `bin/concertino`: read `resolveCore`/`gitTopLevel`/`gitCommonDir` (lines ~100–230),
  `checkArtifacts`/`cmdDoctor` (lines 840–965), and `renderEnv` (lines ~455–486, confirms
  `CONCERTINO_BASE_REMOTE` is *not* written into `.concertino.env`, only `CONCERTINO_BASE_BRANCH`
  is).
- `package.json` + `README.md`/`docs/quickstart.md`/`docs/adapting-to-your-project.md`: confirmed
  concertino's own documented install/invocation model for adopting projects is
  `npm install -g concertino` (then `concertino ...`) or `npx concertino <command>` — never a
  relative `bin/concertino` path inside the target's own checkout.
- Grepped every `lib/ui/screens/*.js` for `key === 'g'`/`'g':` — no existing binding collides with
  the design's proposed reserved `g` key; that part of Decision 6/task 6.4 checks out.
- Grepped the whole repo for any existing shell script invoking `bin/concertino` — none exists;
  this is a wholly new invocation pattern, not a documented existing one.
- Confirmed `debugAttempts` default is `2` (`docs/config-reference.md`), matching the "2 total
  attempts" retry/skip bound's stated precedent.
- Confirmed `escalationTimeoutMinutes` default is `8` in `bin/concertino`'s
  `DEFAULT_ESCALATION_TIMEOUT_MIN`, matching the design's risk-mitigation claim (the bash script's
  own `:-60` fallback is just the "if the env var is somehow unset" floor, not the real default).

### Verdict: REFUTE

### Change Requests

1. **Decision 6's "no fork needed" reuse of `escalation.js`'s action verbs is false, verified
   against `lib/ui/watch.js`.** Design.md says the banner's `handleKey` returns the same action
   verbs (`reply-type`, `submit-reply`, `cancel-reply`, `open-reply`, `reply-backspace`) "so
   `watch.js`'s existing `case` blocks for those verbs handle both sources without a fork," and
   that "submitting calls `store.writeAnswer` directly... so the write side needs no new code at
   all." This is not true of the code as it exists today:
   - `watch.js:582-596` (`open-reply`/`cancel-reply`/`reply-backspace`/`reply-type`) hardcode
     mutation of `escalationReply` — the dedicated escalation screen's own sub-state, distinct from
     the `globalEscalationReply` the design itself specifies in task 6.3. If the banner's
     `handleKey` returns these same verb strings and they are dispatched into these same case
     blocks unmodified, pressing `g` on, say, the drilldown screen would set `escalationReply`
     (never read by anything since `mode !== 'escalation'`) instead of `globalEscalationReply` —
     the banner's reply box would never actually appear to be open, and Escape would never close
     it (spec.md's "Cancelling leaves the underlying screen untouched" scenario would not hold).
   - `watch.js:599-602` (`submit-reply`) and `watch.js:505-517` (`answerEscalation`, which
     `submit-reply` calls) unconditionally call `backToFleet()` on a successful write — which sets
     `mode = 'fleet'` and clears `escalationTicket`/`escalationReply`/`escalationNotice`,
     `drillTicket`, etc. If the banner's `submit-reply` is dispatched through this same path, a
     successful reply from, e.g., the drilldown screen would force-navigate the human back to the
     fleet — directly contradicting the ticket's own requirement ("an input box to reply to the
     agent... visible regardless of which screen you are on") and `cross-screen-escalation/spec.md`'s
     explicit scenario "the drilldown screen underneath is otherwise unaffected."
   This is not a minor wording nit — it is the central mechanism Decision 6 claims is "free." The
   design needs to say, concretely, how the dispatch layer will distinguish a banner-sourced action
   from an escalation-screen-sourced one before implementation starts (e.g., a `source` field
   threaded through the action shape, or separate action-type namespacing for the banner, with the
   corresponding `applyAction` branches spelled out) — and Decision 6 / proposal.md's "no new code
   needed" framing should be corrected to reflect that real (if small) new dispatch logic is
   required.

2. **Decision 4 / task 3.1's post-fast-forward re-render invocation is unverified against how this
   tool is actually distributed, and as written will silently no-op for every real adopting
   project.** The design hardcodes `node bin/concertino sync --out=<checkout>`, guarded only by
   "if `bin/concertino` exists there," and claims "an adopting project's own `concertino` binary is
   used the same way — same resolution `setup-worktree.sh`/`doctor` already rely on." That
   precedent does not exist: grepping the whole repo, no script anywhere invokes `bin/concertino`
   this way, and `package.json`/`README.md`/`docs/quickstart.md`/`docs/adapting-to-your-project.md`
   all describe the only two supported invocation paths for a project *adopting* concertino as
   `npm install -g concertino` (then bare `concertino ...`) or `npx concertino <command>` — neither
   of which leaves a `bin/concertino` file sitting inside the adopting project's own checkout at
   all. This repo is the one place `<checkout>/bin/concertino` genuinely exists (self-hosting).
   As written, the "guard for `bin/concertino` not being present" will trip on every real
   (non-self-hosting) install, meaning the re-render step described as the fix for staleness bite
   #2 ("the expensive one... cost an hour") will *always* degrade to "note: manual `concertino sync`
   needed" for actual users, not just occasionally on failure. That technically satisfies the AC's
   letter ("either re-render or state clearly that a re-render is needed") but defeats its intent,
   and the design's stated justification for why this is fine is factually wrong. Fix: resolve the
   installed `concertino` command the same way an adopting project's own scripts would invoke it —
   e.g., `command -v concertino` on `PATH`, falling back to `npx --no-install concertino` (or
   documenting that a locally-installed copy is required) — and update Decision 4 and task 3.1
   accordingly. `bin/concertino sync` as the literal command should remain the self-hosting-repo
   fallback only, not the primary path.

### Non-blocking notes

- Decision 6 also says `liveEscalations` uses "the same filter `fleet.js`'s `needsYou` already
  applies." It doesn't: `fleet.js:115` filters on `run.status === 'needs-you'`, which (per
  `reducer.js`'s `deriveStatus`) also includes runs whose status is `needs-you` purely from a
  `BLOCKER` verdict with no live `run.escalation` at all. The banner's own
  `r.escalation && !r.escalationStale` filter is narrower and is in fact the *correct* one for a
  banner that needs something to actually reply to via `answer.json` — but the "same filter"
  framing is inaccurate and worth fixing in the prose so a reader doesn't go looking for a shared
  helper that doesn't exist.
- `tasks.md` task 1.2 ("after worktree removal, add a fast-forward step") doesn't explicitly call
  out that this requires *relocating* the existing unconditional `run.end` emission
  (`cleanup.sh:53-56` today) to after the new fast-forward/escalation/re-render steps, even though
  design.md's Decision 1 makes clear that reordering is load-bearing for the "run reads as
  needs-you while blocked" behavior. Worth an explicit sub-bullet so the executor doesn't miss it.
- `.concertino.env` (per `bin/concertino`'s `renderEnv`) does not actually render
  `CONCERTINO_BASE_REMOTE` (only `CONCERTINO_BASE_BRANCH` is written there) — task 1.1's phrasing
  ("Source `.concertino.env`... to read `CONCERTINO_BASE_REMOTE`/`CONCERTINO_BASE_BRANCH`") slightly
  overstates what that file provides. Behaviorally harmless (`${CONCERTINO_BASE_REMOTE:-origin}`
  still defaults correctly whether or not the file sets it), but worth tightening.
