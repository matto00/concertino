## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/dev-server-process-identity/spec.md` in full.
- Read the persisted premise evidence `.concertino/runs/CON-165/evidence/premise-validation.md`.
- Ground truth `core/scripts/start-servers.sh`: lines 33-35 confirm all three args are positional-required (Fix 1 genuinely already satisfied); lines 81-82 confirm the reuse branch (`curl -sf "$url"` → `note: ... already healthy ... reusing`) performs **zero** identity check. The premise validation's central claim holds.
- `start_one()` signature (line 71) takes `label cwd cmd health timeout log` — **no port argument**. The health URL is `eval`-expanded from `$health` (line 80) and may reference `$DEV_PORT`/`$BACKEND_PORT` but is not required to.
- Existing test suite: `test/scripts/start-servers.test.sh` (220 lines) is wired into `npm test` (`package.json:23`). Its reuse-branch blocks (`HEL-1` at lines 40-66, and the 20-iteration ms-resolution loop `HEL-3` at lines 107-130) start a node listener from the *test's* cwd and invoke `"$SCRIPT" "$WT" 0 0` with `CONCERTINO_BACKEND_HEALTH=http://127.0.0.1:${LISTENER_PORT}/`. The listener's cwd is not under `$WT`, and the passed ports are `0 0` — unrelated to the health URL's port.
- `git ls-files .claude` → only commands/settings/skills; no `.claude/agents/` rendered role copies exist in this repo.
- No `lsof` or `/proc/net/tcp` usage exists anywhere in `core/` or `scripts/` today (`grep`, zero hits) — this is a new dependency, not an established pattern.

### Verdict: REFUTE

The core idea is right and the premise work is honest. But the design is not implementable as written: it collides with the existing test suite in a way no artifact mentions, leaves the load-bearing "which port" question undefined, and contradicts itself on the degradation rule.

### Change Requests

1. **The change breaks existing tests, and no artifact says so.** `test/scripts/start-servers.test.sh` lines 40-66 and 107-130 both drive the reuse branch with a listener whose cwd is a `mktemp` repo root, not under `WORKTREE_PATH` — exactly the condition the new check turns into a loud `FAIL`. `tasks.md` 4.1 ("confirm no regression") is therefore unsatisfiable by construction. Add an explicit task to update those two blocks (start the stand-in listener from inside `$WT`, or otherwise satisfy the new invariant) and state in `design.md` that pre-existing reuse-branch coverage is affected. Silently discovering this mid-execution is how a fix gets "adjusted" until the tests pass.

2. **"Target port" / "the relevant port" is undefined, and the obvious reading is wrong.** `design.md` Decision 1 says "the pid(s) listening on the target port"; `tasks.md` 1.1 says "the relevant port". `start_one()` has no port parameter, and the existing tests prove `DEV_PORT`/`BACKEND_PORT` can be `0 0` while the real health URL port is something else entirely. Specify the derivation explicitly — parse host+port from the **resolved** `$url` — and specify the behavior when the health URL has no port, or a non-loopback/non-local host (where no local pid can ever be found). Two implementers would read this two ways today.

3. **`design.md` Decision 2 and `tasks.md` 1.1 contradict each other on the degradation rule, and the gap is a real false-`BLOCKER` class.** Decision 2 promises to "degrade to today's behavior, never turn an environmental gap into a new class of false BLOCKER"; task 1.1 then narrows that to `/proc/<pid>/cwd` being unreadable and declares "no matching pid found is still a mismatch". Concertino runs arbitrary `CONCERTINO_*_START` commands for arbitrary projects — a containerized or otherwise proxied backend yields either no local pid or a proxy process whose cwd is `/`, and would now hard-fail a run that works fine today. Resolve the contradiction in one direction explicitly and justify it (e.g. mismatch only when a pid is found **and** its cwd is readable **and** resolves outside `WORKTREE_PATH`; no-pid/unreadable degrades with a note), and add it to the spec's scenarios so the behavior is contract, not implementation detail.

4. **Task 2.1 points at the wrong test home.** It proposes "a script-level check under `scripts/concertino/` test conventions — follow `test-gate-in-isolation.sh`'s pattern". The actual convention for this script is `test/scripts/start-servers.test.sh`, already existing and already wired into `npm test`. Point 2.1 there. Likewise replace task 4.1's "full existing test suite for `core/scripts/` (or the project's designated gate command)" with the literal command (`npm test`) — a gate named vaguely is a gate that gets run vaguely.

5. **Task 3.3 defers a question that is answerable now.** It asks the executor to "check whether `concertino sync` output is tracked here ... and, if so, note this in the completion report rather than silently skipping it". `git ls-files .claude` shows no `.claude/agents/` in this repo, so there is no rendered role copy to update. Replace 3.3 with the settled fact (or delete it) — a task whose body is "figure out later and maybe mention it" carries no acceptance signal.

### Non-blocking notes
- `lsof`/`/proc/net/tcp` is a genuinely new dependency for these scripts (zero prior uses). The `now_ms()` node-fallback precedent cited in Risks is a weaker analogue than it reads — worth a one-line note that the fallback path itself gets exercised, not just written.
- Spec Requirement 2 (role-doc wording) is a documentation assertion, not a behavioral one; consider whether it belongs as a spec requirement or just a task, given the proposal itself calls it deliberately non-load-bearing.
- Scope/AC tracing is otherwise clean: ticket ACs 1-4 each map to a task or an explicit, evidenced "already satisfied", and no scope drift beyond the ticket was found.
