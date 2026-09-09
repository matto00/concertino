## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from the branch's own files, the
running test suite, and live process probes — not from `evaluation-2.md`, which
I read only as a set of claims to check.

### What I verified (with evidence)

**Ground truth re-established**
- `git log --oneline -6` on `bug/detect-bare-server-invocation/CON-165`: the three
  claimed commits (`2a270f3`, `c710d50`, `ef40ea5`) are present on top of `1838b4b`.
- `git diff main...HEAD --stat`: 18 files, +620/-17. The only production surfaces
  are `core/scripts/start-servers.sh` (+94), its render `scripts/concertino/start-servers.sh`
  (+94), `test/scripts/start-servers.test.sh` (+105/-17), and the three role docs.
  No scope drift beyond the ticket.
- `diff core/scripts/start-servers.sh scripts/concertino/start-servers.sh` → **identical**.
  The rendered copy is genuinely in sync, not merely asserted (and
  `rendered-scripts-drift.test.sh` passes in the suite run below).

**AC 1 — canonical scripts require the worktree path positionally, never `$PWD`**
- `grep -n 'WORKTREE_PATH="\${1' core/scripts/*.sh` shows `${1:?usage...}` in all seven
  worktree-taking scripts; `grep -rn 'PWD' core/scripts/*.sh` returns **zero hits**.
  The premise-validation finding ("already satisfied, no code change needed") is
  independently confirmed, not taken on trust.

**AC 2 — role docs prohibit bare invocation**
- `git diff main...HEAD -- core/roles/`: executor.md (after the gates block),
  evaluator.md (after the `start-servers.sh` call site), skeptic.md (inside the UI
  server-start bullet) each carry an explicit "never invoke `npm`/`vite`/`sbt`/`npx
  playwright` bare" prohibition with the CON-165 rationale, placed adjacent to the
  call site as design.md Decision 3 specifies. No rendered agent files are tracked
  in this repo (`.claude/agents/` is absent), so `core/roles/` is the whole surface.

**AC 3 — reuse path verifies process identity**
- Read the full `start_one()` reuse branch. The check derives the port from the
  already-resolved `$url` (not from `$DEV_PORT`/`$BACKEND_PORT`), finds listening
  pids via `lsof -ti :PORT -sTCP:LISTEN` with a `/proc/net/tcp{,6}` inode→pid
  fallback, and raises `FAIL` only for the exactly-one-pid + readable-cwd +
  not-under-`realpath "$WORKTREE_PATH"` case — matching design.md Decision 2 and the
  spec's three scenarios. Every other case degrades to today's behavior. The failure
  path emits a `gate.result` with `status=fail` in the same shape as the pre-existing
  timeout failure, and `exit 1` is at function scope (not inside a subshell), so it
  really terminates the script.
- Under `set -euo pipefail` I traced each new assignment (`local X; X="$(...)"` split
  form throughout, `if proc_cwd="$(readlink -f ...)"` guarded); no new early-exit hazard.
- `proc_cwd` is function-scoped `local`, so `${proc_cwd:-unknown cwd}` in the FAIL
  message is genuinely in scope at that point.
- **Live probe of the identity primitive against real processes** (not toy fixtures):
  sourced `pids_on_local_port()` out of the branch script and ran it across 12 live
  listening ports from `ss -ltnp`. It correctly returned exactly one pid with a
  resolvable cwd for user-owned servers (`/home/matt`, `/home/matt/.local/share/Steam`),
  `UNREADABLE` for other-user processes (→ degrade path), and empty for ports it
  cannot attribute (→ degrade path). The lsof branch behaves on real-world input.

**AC 4 — mutation-failable coverage (the load-bearing check)**
- `bash test/scripts/start-servers.test.sh` → **38 passed, 0 failed** (2.9s), run twice
  with identical results.
- **Mutation M1** (`*) mismatch=1 ;;` → `mismatch=0`, i.e. detection neutered):
  **3 failures** — "exit non-zero on foreign-cwd reuse attempt", "no READY ... reusing
  printed", "stderr reports a FAIL distinct from the health-timeout message". The new
  coverage cannot pass without the fix, which is exactly the AC-4 requirement.
- **Mutation M2** (`local mismatch=0` → `=1`, i.e. always reject): **7+ failures**
  across the pre-existing reuse blocks (HEL-1 telemetry, TICK-9, no-explicit-id,
  CON-79). So the restructured per-block listeners (design.md Decision 4) act as a
  real false-positive guard, not just re-pointed fixtures.
- Script restored from backup after each mutation; `git status --porcelain` shows the
  script clean (only the expected uncommitted `workflow-state.md` / `evaluation-2.md`).
- The portless-URL regression from evaluator round 1 is covered by three direct
  assertions on `local_port_from_url` extracted from the real script via `sed` (so it
  cannot drift from a copy), and the fix in `c710d50` genuinely returns nothing for
  `http://localhost/health` and `https://127.0.0.1/health` while still returning `8080`
  for an explicit port.

**Full gate re-run**
- `npm test` → **rc=0** (whole suite: node `--test` plus ~40 shell suites, including
  `rendered-scripts-drift`, `check-constraints-carryover`, `assert-phase`). Re-run once
  to confirm stability. No `shellcheck` on this machine and no `.husky/pre-commit` in
  this repo, so there is no lint gate I skipped.

**Test hygiene (checked, not a defect)**
- I found two stray `createServer` node processes on the machine and suspected the new
  `start_listener_in` helper leaked listeners. Controlled probe: `pgrep -fc createServer`
  before/after a clean suite run → **4 → 4, no leak**. The two strays predate these runs
  (pid generation ~2.5M vs ~3.6M current). Measurement instability, not a defect —
  reported here because a single anomalous reading is not a verdict.

**UI/design judgment**
- Not applicable and deliberately skipped: the diff touches only shell scripts, role
  markdown, and OpenSpec artifacts. `git diff main...HEAD --stat` shows zero frontend
  files, so no server start, navigation, or screenshots were warranted.

**Iron Laws**
- `verification-before-completion`: every claim above is backed by a command I ran in
  this session, including two independent mutations.
- `systematic-debugging`: this is a bug ticket, and the root cause is probe-confirmed
  and recorded — the ticket's own premise-validation section refutes two of the four
  proposed fixes against the actual tree (Fix 1 already satisfied; Fix 3-as-stated
  already true by construction) and names the real remaining gap (reuse-path silent
  adoption). The regression test exercises that exact path and is mutation-failable
  in both directions.

### Verdict: CONFIRM

The change closes the ticket's real gap (silent adoption on the reuse path) with a
conservative, degrade-by-default rule that matches its own spec, is genuinely
mutation-failable, and does not regress any existing reuse coverage. Ships.

### Non-blocking notes

- `specs/dev-server-process-identity/spec.md`, "Process identity cannot be determined"
  says the degrade path "logs a note and reuses". Two of the four degrade branches do
  log (`cwd unreadable`, `ambiguous pid count`); the **no-pid-found** and
  **no-local-port / non-local host** branches print nothing (the former carries only an
  inline code comment). Behaviourally correct — silence is arguably better than a note
  on every non-local health URL — but the spec's THEN clause overstates it. Either drop
  "logs a note" from that scenario or add the note. Cosmetic, no correctness impact.
- A same-user process whose cwd resolves to exactly `/` (rootless container proxy, a
  user systemd service) is readable and not under `WORKTREE_PATH`, so it takes the hard
  `FAIL` path. design.md Decision 2's parenthetical lists "a proxied/containerized
  process whose cwd is meaningless, e.g. `/`" among the *degrade* cases, but the
  normative rule it states (and the shipped code) only degrades when the cwd is
  *unreadable*. In practice such processes usually run as root and are unreadable, so
  this is narrow — but if a false BLOCKER ever shows up here, treating a resolved cwd of
  exactly `/` as ambiguous is the one-line fix, and the parenthetical is worth tightening
  either way.
