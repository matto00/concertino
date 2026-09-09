## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review of `c103cbb` on `bug/phase4-teardown-races-auditor/con-171`. Everything below is my own measurement; round 1's report and the evaluations were read as claims only.

### What I verified (with evidence)

**CR-1 — batching is genuinely gone, and the per-pid loop alone clears the bound.** `grep -n readlink core/scripts/cleanup.sh` returns exactly three hits: two in the explanatory comment and one live call, `cwd="$(readlink "/proc/${pid}/cwd" 2>/dev/null)" || continue` at `:261`. No `targets` array, no line-count fallback, nothing left of the batched path. I re-measured rather than trusting the design's figure: extracted `worktree_holders` (`cleanup.sh:226-272`) verbatim and timed three full scans against a non-matching target on this host — **585 pids, 503 / 498 / 508 ms per scan**. Slightly slower than the design's quoted ~0.3 s (different machine/load), but the shape of the argument holds with a wide margin: the loop exits on a scan that starts before `SETTLE_DEADLINE_MS`, so worst-case wall time is bound + one scan ≈ **3.5 s against a 3 s deadline**, and the common no-holder case is one scan (~0.5 s). `pid_dir` is now `local` (`:250`).

**Rendered copies are byte-identical and no `concertino sync` ran.** `diff` of `core/scripts/{cleanup.sh,emit-event.sh,check-merge-readiness.sh,lib/auditor-lease.sh}` against their `scripts/concertino/` counterparts: all four identical. `git status --porcelain` shows only the expected `workflow-state.md` modification — no sync fanout. `git diff --name-only main...HEAD | grep -E 'pricing-table|report-cost'` → no hits (AC-5, hard constraint).

**CR-2 — no overclaim remains anywhere in the artifacts.** I grepped the whole change dir for `structurally impossible|guarantee|any live process|never destroys|impossible`. `design.md:18` (Goals) now scopes the mechanical guarantee to "while the auditor's script-owned lease is held … for the one role this change makes bracketed", with the probe named as best-effort; `specs/phase4-teardown-safety/spec.md:3` (Purpose) now reads "the auditor — bracketed by a script-owned lease …" plus the complementary probe. Both match what the requirement text and Decision 2's scope note actually promise. The only surviving `structurally impossible` is `design.md:84`, which is a different and true claim (a lease can never be created under a key the release path cannot address). No new overclaim was introduced by the rewrite.

**Normalisation is symmetric on both sides and cannot fail-open worse than before — probed directly, not reasoned about.** Both `lease_acquire` and `lease_find_by_worktree` route through the single `lease_normalize_worktree_path`, and the lookup side normalises *both* the query and the value read out of the lease file, so the two sides can never key differently within one environment. Live probe against a real lease under `/tmp`:
- acquire with a trailing slash → recorded `worktree=/tmp/leasetest/wt` (normalised at write time);
- lookup without the slash → HIT; lookup with a relative `./wt` from the parent dir → HIT;
- **lookup after the worktree directory was removed → HIT** — this is the case the brief flagged, and `realpath -m` (no existence requirement) is what makes it work; plain `realpath` would have failed exactly here;
- with `realpath` forced unavailable (shadowed `command -v`), the trailing-slash fallback still HITs; a `..`-containing path misses, which is strictly the pre-change exact-match behaviour, i.e. fail-open to today's un-guarded teardown, never a new strand. The code comment states precisely this.
Direction check: because the stored value is re-normalised by the same function at lookup, normalisation can only ever *add* matches relative to the old exact-string compare — it cannot turn a previous hit into a miss. No new fail-open, no new strand.

**Mutation coverage is real, re-verified on this HEAD (AC-6).** I mutated each signal separately in both copies and re-ran the suite, restoring after each:
- Signal A disabled (`if false && LEASE_FILE=…`) → **48 passed, 10 failed**.
- Signal B refusal disabled (`if false; then fail "…live`) → **52 passed, 6 failed**.
Both signals are load-bearing in the tests; neither can be deleted silently.

**Gates, re-run by me.** `bash test/scripts/phase4-teardown-guard.test.sh` → **58 passed, 0 failed**. `bash test/scripts/rendered-scripts-drift.test.sh` → **18 passed, 0 failed** (CON-172's gate). Full `npm test` → **exit 0**, no `N failed` with a non-zero count anywhere in the log. Note: an earlier `npm test` of mine overlapped in the background with my mutation experiment and reported 5 failures; I discarded that reading as contaminated and re-ran on a verified-clean tree rather than treating it as a finding — the clean re-run is the evidence cited here.

**Acceptance criteria traced.** AC-1: Signal A refusal at `cleanup.sh:296-302` (immediate, reports script/ticket/pid/ts) and Signal B refusal at `:341-345`, both via `fail()` above every destructive step (`if [ -d "$WORKTREE_PATH" ]` removal block follows at `:369+`). AC-2: bounded settle loop at `:320-338`, wall-clock deadline captured once, lease check outside it. AC-3: `--force-teardown` bypass with a loud pre-override report of exactly what is being overridden (`:349-366`); tests 21.x/22.x cover the flag and its mistyped-flag failure. AC-4: `core/roles/orchestrator.md` diff makes "consumed as this spawn call's own return value … the ONLY thing that satisfies this condition" explicit and names the out-of-band observations that do not. AC-5, AC-6: above.

### Verdict: CONFIRM

Both round-1 change requests are fully and honestly addressed, the fix I demanded (deleting the dead batching) is real rather than re-labelled, and I re-measured the deadline claim instead of accepting it. Nothing regressed.

### Non-blocking notes

- **`lease_normalize_worktree_path` itself has no test coverage.** Replacing its body with a pure passthrough leaves the suite at 58/58 green. I verified it functionally by hand (above) and its failure direction is fail-open to pre-change behaviour, so this is not blocking — but the trailing-slash / relative-path / worktree-already-removed cases are cheap to pin as tests 10.5-10.7 and would stop a future edit from silently reverting the `-m`.
- `design.md` Decision 3 quotes "~0.3 s for a full scan (584 pids)". I measure ~0.50 s for 585 pids on this host. The conclusion (ample margin against 3 s) is unaffected; the figure is just machine-specific and would read better as "sub-second on a real host" than as a single number.
- Round 1's stale-lease note stands: an abandoned run that ran `check-merge-readiness.sh` and never emitted an auditor verdict leaves a lease forever. Harmless (worktree-path-scoped, override documented), still a reasonable `doctor` follow-up.
