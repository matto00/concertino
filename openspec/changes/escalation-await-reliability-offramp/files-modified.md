# Files modified — CON-47 (cycle 1)

## Source

- `core/scripts/emit-event.sh` — Decision 1's root-cause fix: two-branch
  `.concertino.env` sourcing (local `${SCRIPT_DIR}` first, then
  `${ROOT}/scripts/concertino/` as the worktree fallback) inserted immediately
  after `ROOT="$(main_checkout)" || exit 0`, plus a header-comment note (task
  1.2) documenting both locations and that `CONCERTINO_ESCALATION_TIMEOUT_MIN`
  is the setting this affects. A code comment calls out that `source` overrides
  an already-exported same-named variable, so it is not later mistaken for a bug.
- `core/roles/orchestrator.md` — Decision 2's trust off-ramp: a new "When to
  stop doubting an answer" clause in "How to raise one", placed immediately
  after the existing Exit 0 / Non-zero exit bullets. Five bullets: corroborate
  before recording; recording is terminal for the run; do not reopen (naming
  the re-litigating-the-human failure mode); answers only, never timeouts
  (explicitly consistent with the existing "a timeout is never an approval");
  and no coverage for an unsolicited claim with no standing `escalation.raised`.
- `core/scripts/README.md` — task 1.3: the `emit-event.sh` contract entry now
  documents the `.concertino.env` sourcing and why it needs two locations.

## Tests

- `test/scripts/emit-event.test.sh` — five new cases (tasks 2.1–2.4) at the end
  of the suite, plus two helpers. `script_copy()` runs each case against an
  isolated `mktemp -d` copy of the script so no `.concertino.env` is ever
  written into `core/scripts/`, which the rest of the suite invokes directly
  (the pre-existing cases that pass `CONCERTINO_ESCALATION_TIMEOUT_MIN` as a
  process env var would otherwise be silently overridden by it).
  `run_await_bounded()` bounds each wait and reports an overrun as a failure —
  necessary because a regression in the sourcing puts `--await` back on its
  60-minute default, which would park the suite for an hour instead of failing.
  It kills with SIGKILL, not TERM/INT, since those are exactly what `on_kill`
  traps to write `escalation.timeout` and would forge the evidence under test.

## Tracked rendered copies (hand-refreshed per tasks.md section 4 — no `concertino sync`)

- `scripts/concertino/emit-event.sh` — full hand-copy of
  `core/scripts/emit-event.sh` (byte-identical before and after; nothing
  unrelated to sweep in).
- `scripts/concertino/README.md` — hand-edited in the one relevant spot only
  (the same textual edit task 1.3 applied to `core/scripts/README.md`'s
  `emit-event.sh` entry), **not** a full copy — a full copy would reintroduce
  ~9 lines of pre-existing, unrelated CON-22 content this tracked copy does not
  carry.

## Not touched (pre-existing, unrelated vendored drift)

The main checkout's pre-existing CON-22 vendored drift — `setup-worktree.sh`,
`resolve-speed.sh`, `speeds.json`, and the rest of `scripts/concertino/README.md`'s
divergence from `core/scripts/README.md` — is untouched by and unrelated to this
change. `.claude/agents/concertino-orchestrator.md` is gitignored, untracked, and
not even present in this worktree; there is no Codex orchestrator artifact to
render (this project renders `claude-code` only, and `sync` never emits a `.toml`
for the orchestrator role).

## Root cause (systematic-debugging evidence)

- **Root cause:** the *configuration-loading layer* of
  `core/scripts/emit-event.sh` — the script never sourced `.concertino.env` at
  all (unlike all five sibling procedure scripts), so
  `CONCERTINO_ESCALATION_TIMEOUT_MIN` (rendered as 8) never reached
  `TIMEOUT_MIN="${CONCERTINO_ESCALATION_TIMEOUT_MIN:-60}"`; `--await` always ran
  on its 60-minute fallback, six times the harness's 10-minute call cap, so the
  harness always killed the call first. (Established and probe-verified during
  the design gate, rounds 1–2; re-confirmed here as a before/after regression.)
- **Probe:** ran the new cases against the *pre-fix* script —
  `git checkout HEAD -- core/scripts/emit-event.sh && bash test/scripts/emit-event.test.sh`
- **Probe output (pre-fix):**

  ```
    FAIL local .concertino.env: timeout was recorded
         expected [1] got [0]
    ok   no .concertino.env beside the worktree's own copy
    FAIL main-checkout .concertino.env applies from inside a worktree
         expected [rc=1] got [still-running-after-20s]
    FAIL worktree case: timeout recorded in the main checkout's log
         expected [1] got [0]
    FAIL sourced .concertino.env overrides an exported timeout
         expected [rc=1] got [still-running-after-20s]
    ok   no .concertino.env: default deadline still governs (still waiting)
    ok   no .concertino.env: raised but not timed out
    69 passed, 5 failed
  ```

  `still-running-after-20s` is the symptom itself: with a `.concertino.env`
  setting the deadline to 0, the unpatched script never saw it and was still
  polling on the 60-minute default. Post-fix the same suite reports
  `74 passed, 0 failed`. The two "no `.concertino.env` anywhere" cases pass
  identically before and after, confirming zero behavior change for that path.
