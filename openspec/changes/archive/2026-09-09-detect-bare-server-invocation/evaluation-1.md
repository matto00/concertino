## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `2a270f3 CON-165 Verify reuse-path process identity before adopting a healthy server`

### Phase 1: Spec Review — FAIL

Verified PASS:
- AC "canonical scripts require the worktree path positionally" — premise-validated as already satisfied; no regression introduced (`start_one()` still takes no port arg; `WORKTREE_PATH` is positional `$1`).
- AC "role docs prohibit bare invocation" — present in all three: `core/roles/executor.md` (verification-gates section), `core/roles/evaluator.md:158-161` (next to the `start-servers.sh` call site), `core/roles/skeptic.md:96-98`. Matches spec delta requirement 2 and design Decision 3.
- AC "reuse path verifies process identity" — implemented in `core/scripts/start-servers.sh:135-168`.
- AC "mutation-failable coverage" — genuinely mutation-failable; independently confirmed RED against the pre-fix script (see Phase 2).
- All tasks 1.1–4.2 marked `[x]` and each corresponds to something actually in the diff.
- No scope creep. `openspec validate detect-bare-server-invocation --type change` exits 0.

Issue:
1. **The implemented mismatch/degrade boundary does not match design.md Decision 1 or the change's own spec delta for the "no explicit port" case.** Design Decision 1 states: *"If the parsed URL has no explicit port ... no identity check is meaningful — skip it"*, and `specs/dev-server-process-identity/spec.md`'s "Process identity cannot be determined" scenario makes that contract: *"the health URL has no discoverable local port (a non-loopback/non-local host, **or no port at all**) ... THEN start-servers.sh degrades to today's trust-the-health-check behavior"*. The code instead substitutes a default port:

   `core/scripts/start-servers.sh:82` — `const port = u.port || (u.protocol === "https:" ? "443" : "80");`

   Probed directly against the shipped function (not inferred from reading):
   ```
   http://127.0.0.1/health   -> [80]
   http://localhost/health   -> [80]
   http://127.0.0.1:8319/... -> [8319]
   https://example.com/...   -> []      (correctly skipped)
   ```
   So a portless local health URL takes the *checking* path, not the degrade path. Concrete consequence: a project whose `CONCERTINO_*_HEALTH` is `http://localhost/health` (a local reverse proxy, or a container publishing on 80) now gets a hard `FAIL` "does not belong to this worktree" whenever the single listener on :80 has a readable cwd outside the worktree (a proxy's cwd is typically `/`). That is exactly the new false-BLOCKER class Decision 2 was written to avoid ("a run that works fine today must keep working"), and it is a divergence from a contract this very change introduced. No test exercises the portless case in either direction.

### Phase 2: Code Review — PASS

Gates re-run by me, fresh, in `WORKTREE_PATH` (`CLEAN_WORKTREE` unset). This repo's only gate is `npm test`:
- `npm test` — exit 0 (full suite, including `rendered-scripts-drift.test.sh`, which is green).
- `bash -n core/scripts/start-servers.sh` — clean.
- `bash test/scripts/start-servers.test.sh` standalone — **35 passed, 0 failed**.

CON-173 drift gate, verified independently: `diff core/scripts/start-servers.sh scripts/concertino/start-servers.sh` empty, and `cmp` reports byte-identical. Both executable.

**RED-then-GREEN evidence for task 2.2 independently reproduced** (not taken from the executor's report). I copied `core/` + `test/` + `package.json` into a scratch tree, replaced only `core/scripts/start-servers.sh` with `git show main:core/scripts/start-servers.sh`, and ran the *new* test file against it:
```
start-servers.sh (CON-165: reuse-path process identity)
  FAIL exit non-zero on foreign-cwd reuse attempt   expected [yes] got [no]
  FAIL no READY ... reusing printed                 expected [0] got [1]
  FAIL stderr reports a FAIL distinct from the health-timeout message  expected [1] got [0]
  32 passed, 3 failed
```
Two things this establishes beyond the executor's claim: (a) the new block genuinely goes red pre-fix — its precondition does not guarantee it; and (b) the *restructured* five reuse blocks (`HEL-1`, the ms-resolution loop on `HEL-3`, `TICK-9`, the no-explicit-id block, `CON-79`) all pass **both** pre-fix and post-fix, so §1.3 is a behavior-preserving restructure rather than a re-pointing that hides a change. (An earlier, thinner scratch harness of mine was confounded — every block failed for an unrelated environment reason, and the "exit non-zero" assertion passed there for the wrong reason; the result above is from the corrected, non-confounded harness. Worth noting because it is the same trap design.md's Risks section names.)

Boundary conformance re-derived from the code rather than the summary — `core/scripts/start-servers.sh:135-168` mismatches **only** when `pid_count -eq 1` AND `readlink -f /proc/<pid>/cwd` succeeds and is non-empty AND the resolved cwd is neither `$wt_real` nor under `$wt_real/`. `pid_count -gt 1`, `pid_count -eq 0`, unreadable cwd, and empty `port_local` each degrade with a stderr note and no failure. That matches Decision 2 exactly — *except* for the portless-URL entry condition flagged in Phase 1, which is about which URLs reach the check at all, not about the check's own arms.

Also verified positively: the five reuse blocks passing post-fix means the *match* arm is exercised, not just the mismatch arm — the check is not vacuously always-failing.

Other checks: helpers are small, named, and commented with the reason (`sort -u` dedupe for dual-stack) rather than the mechanics; no dead code, no TODO/FIXME; `lsof`-absent path falls back to `/proc/net/tcp{,6}` as designed; `proc_cwd` in the failure message is function-scoped `local` and always set on the mismatch path; the failure emits `gate.result status=fail` in the same shape as the existing timeout failure, behind the same ticket-shape guard. No security surface (no untrusted input crosses a boundary; `node -e` receives the URL as `argv`, not interpolated).

### Phase 3: UI Review — N/A

No files matching the UI triggers (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`) changed. The change touches `core/scripts/`, `scripts/concertino/`, `core/roles/`, `test/scripts/`, and the change's own `openspec/changes/**` artifacts (not `openspec/specs/**`).

### Overall: FAIL

One change request. Everything else in the change is sound, and the evidence quality (real RED-then-GREEN, both arms of the check exercised) is above the bar.

### Change Requests

1. `core/scripts/start-servers.sh:82` — make a portless local health URL degrade instead of defaulting to 80/443, per design.md Decision 1 and the spec delta's "Process identity cannot be determined" scenario. Replace
   `const port = u.port || (u.protocol === "https:" ? "443" : "80");`
   with
   `const port = u.port; if (!port) process.exit(0);`
   (then `process.stdout.write(String(port));`). Mirror the change verbatim into `scripts/concertino/start-servers.sh` via direct `cp` and re-verify `diff` is empty (CON-173). Add one assertion to `test/scripts/start-servers.test.sh` covering it — a run whose `CONCERTINO_BACKEND_HEALTH` has no explicit port must not be able to produce the `does not belong to this worktree` FAIL. Alternatively, if the default-port behavior is judged *intentional*, that is a contract change: amend design.md Decision 1 and the spec scenario in the same commit and say why the false-BLOCKER risk on :80 is acceptable — but do not leave code and spec disagreeing.

### Non-blocking Suggestions

- `test/scripts/start-servers.test.sh` — `start_listener_in()` draws `$(( 20000 + RANDOM % 20000 ))` with no retry on collision. The pre-change code had one such draw; there are now six per run, so the odds of a spurious failure (a foreign process already on the drawn port would make a *reuse* block mismatch) rose ~6x. A short retry loop — draw, `curl`/bind-probe, redraw on conflict — would remove a flake class that will be annoying to diagnose from CI.
- `local_port_from_url()` accepts `0.0.0.0` in its local list. A health URL pointed at `0.0.0.0` is unusual and harmless here, but it is not what design.md enumerated; dropping it would keep the list exactly the loopback set the spec scenario describes.
