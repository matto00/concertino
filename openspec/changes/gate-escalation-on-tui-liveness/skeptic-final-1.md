## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff is what it claims.** `git log --oneline main..HEAD` → `a7e5215`, `a2f3467`. `git diff --stat main...HEAD` → 16 files; the only non-artifact code is `core/scripts/tui-attached.sh` (new, 110 lines), its byte-identical render `scripts/concertino/tui-attached.sh` (`diff` → identical; both `100755` per `git ls-files -s`), `core/roles/orchestrator.md` (+74/-5), `test/scripts/tui-attached.test.sh` (new), and the `package.json` test-runner wiring.
- **Detection reuses the documented authority, verbatim.** `tui-attached.sh`'s `main_checkout()` is character-for-character `core/scripts/emit-event.sh:94-103`. Its node one-liner reproduces `lib/ui/watch-lock.js`'s `readLock()` (`typeof parsed.pid !== 'number'` → absent) and `pidAlive()` (`process.kill(pid,0)`, `EPERM` → alive) exactly — not bash's `kill -0`, which does differ on EPERM. `heartbeatAt` is never read. Every failure path exits 1.
- **Tests are real, not vacuous.** `bash test/scripts/tui-attached.test.sh` → 10 passed / 0 failed, re-run twice. Coverage maps 1:1 onto the `tui-liveness-detection` spec scenarios (live pid, no lockfile, dead pid, torn JSON, non-numeric pid, EPERM pid 1 → attached, non-git dir, invoked-from-worktree). Case 9.1 is a genuine mutation check: it rewrites the EPERM ternary to `process.exit(0)` and asserts the mutant flips case 3.1 — so the liveness assertion is provably load-bearing.
- **Full suite green.** `npm test` → `SUITE_RC=0`, `# pass 2248 / # fail 0` plus all 35 shell-script suites, including the pre-existing `escalation-loop`, `escalation-raise-wait`, `sync-core-resolution`, and `watch-smoke` suites — no regression in the escalation machinery this change gates.
- **Live end-to-end.** Ran `./scripts/concertino/tui-attached.sh` from this worktree → exit 1. The real `/home/matt/Development/concertino/.concertino/cache/watch.lock` exists with `{"pid":2693549,...}` and `ps -p 2693549` shows no such process — i.e. it resolved the *main checkout's* lock from inside a worktree and correctly refused a stale dead-holder lock. That is the dangerous-direction guarantee demonstrated on real state, not a fixture.
- **Distribution works without a manifest edit.** `lib/cli/emit.js:442-454` `copyAssets()` copies `core/scripts` via `listFilesRecursive` and chmods `*.sh` 0755, so `concertino sync` renders the new script into consumer repos with no registration step. `.claude/agents/` is untracked (locally rendered) and already carries the new prose (8 `TUI_ATTACHED` hits).
- **AC trace.** AC1 satisfied (`orchestrator.md:1110-1125` + the script). AC3/AC5 satisfied (`:1152-1153` TUI-attached branch explicitly unmodified; the `--await`/`--raise-only`/trap/wizard text below is untouched by the diff). AC4 satisfied on both branches — the no-TUI branch contains no deadline at all, and the `--wait-only` exit-1 handling at `:1357-1360` is unchanged. AC6 satisfied (script header + every exit path). AC7 satisfied (`:1141-1151` mandates `concertino answer`, and correctly distinguishes it from the untouched raw-`emit-event.sh` `--await`-timeout fallback). The root's fresh re-check (step 1a, `:1330-1344`) matches the second spec requirement including the "raise always writes `escalation.raised`, so a late-attaching dashboard has a real deadline" argument.
- **AC2 — traced and NOT met.** See Change Request 1.

### Verdict: REFUTE

### Change Requests

1. **`core/roles/orchestrator.md:718-726` — "Triaging a suggested follow-up" is a second, ungated escalation raise site that still hardcodes a blocking `--await`.**
   The design (`design.md:114`, "Decision 2 — Gating the orchestrator's single call site") rests on CON-127's assumption that there is exactly one raise call site. Ground truth in the file contradicts that: step 4 of "Triaging a suggested follow-up" contains its own literal invocation —

   ```bash
   scripts/concertino/emit-event.sh escalation --await "${ARGS[@]}"
   ```

   — with no `TUI_ATTACHED` check anywhere above it. Its only link back to the gated procedure is the prose "Same blocking-call, per-call timeout, and off-ramp rules as 'How to raise one' below apply unchanged", which enumerates timeout/off-ramp rules and does not mention the topology or liveness branch; and "unchanged" reads as *inherit today's behaviour*. An agent executing step 4 literally runs an unconditional `--await`.

   This breaks **AC2** ("With no TUI attached, raising an escalation performs no blocking `--await` wait and reaches the human in chat immediately") for the follow-up-triage escalation — which is not an exotic path; it fires on any run that produces a suggested follow-up, and it is a *root*-branch `--await`, i.e. the exact 8-minute dead wait the ticket exists to delete. Non-root raises here would also skip the `--raise-only` bookkeeping the new branch requires.

   Fix: make this site consult the same single signal — either replace the snippet with an explicit `TUI_ATTACHED` branch mirroring `:1110-1153`, or (preferred, keeps one authority) delete the hardcoded `--await` line and route step 4 through "How to raise one" wholesale, with the sentence at `:723-726` amended to say the *entire* raise procedure — including the CON-126 TUI-liveness branch — applies, not just the timeout/off-ramp rules. Please also re-grep for any further literal `emit-event.sh escalation --await|--raise-only` outside the gated procedure; I found only this one (the `cleanup.sh` mention at `:949` is inside that script and legitimately out of scope).

### Non-blocking notes

- `docs/dashboard.md:560-568` still describes the orchestrator as raising with `emit-event.sh escalation --await, which blocks` with no mention of the no-TUI branch. Not an AC (AC5 names `orchestrator.md` only), but the user-facing doc is now one branch behind the behaviour.
- The `--out=DIR` divergence (`concertino watch` resolves the lock dir via `resolveOut(args)`; this script mirrors `emit-event.sh`'s `git rev-parse --git-common-dir`) is honestly disclosed in the script header and fails safe toward "not attached". Agreed as out of scope; worth a spinoff if `--out` ever becomes common.
- Test 3.1's "dead pid" is a just-reaped child pid — theoretically recyclable between reap and check. Vanishingly unlikely and self-contained; noted only for completeness.
