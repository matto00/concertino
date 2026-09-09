## Evaluation Report — Cycle 2 (evaluation-2.md)

Commits under review: `2a270f3`, `c710d50` (the round-1 fix), `ef40ea5` (handoff update). Reviewed as `git diff 2a270f3..HEAD` on top of cycle 1's already-verified base.

### Phase 1: Spec Review — PASS

Issues: none.

Cycle 1's single change request is closed correctly and minimally.

`core/scripts/start-servers.sh:82-90` now reads:
```js
if (!u.port) process.exit(0);
process.stdout.write(String(u.port));
```
with a comment naming *why* (the false-BLOCKER class), not what. This is exactly the option the change request preferred — code moved to the contract, rather than the contract amended to the code — so design.md Decision 1 ("no explicit port ... skip it") and the spec delta's "Process identity cannot be determined" scenario ("no discoverable local port ... or no port at all → degrade") now both match the implementation. No spec/design edit was needed and none was made, which is the right call.

Re-probed the shipped function directly (not inferred from the diff):
```
http://localhost/health     -> []      (was [80] in cycle 1)
http://127.0.0.1/health     -> []      (was [80])
https://127.0.0.1/health    -> []      (was [443])
http://127.0.0.1:8319/health-> [8319]  (unchanged — the working path still works)
http://[::1]:9000/h         -> [9000]
https://example.com/health  -> []      (non-local, still skipped)
```
The false-BLOCKER path I found in cycle 1 is genuinely closed, and the explicit-port path is unregressed.

Scope: the round-2 diff touches only `core/scripts/start-servers.sh`, its rendered twin, `test/scripts/start-servers.test.sh`, `files-modified.md`, `workflow-state.md`, and adds `evaluation-1.md`. No drive-by changes. `openspec validate detect-bare-server-invocation --type change` exits 0. All prior cycle-1 PASS findings (three role docs, the mismatch/degrade arms, the drift-gate copy, the five restructured reuse blocks) are unaffected by this diff and remain as verified.

### Phase 2: Code Review — PASS

Issues: none.

Gates re-run fresh by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` unset; this repo's only gate is `npm test`):
- `npm test` — **exit 0**, `# pass 2254 / # fail 0` for the node-test portion plus every shell suite green, including `rendered-scripts-drift.test.sh`.
- `bash test/scripts/start-servers.test.sh` standalone — **38 passed, 0 failed**.
- `bash -n core/scripts/start-servers.sh` — clean.

CON-173 drift gate re-verified independently after the round-2 edit: `cmp core/scripts/start-servers.sh scripts/concertino/start-servers.sh` reports byte-identical, and both are `-rwxr-xr-x`. The rendered copy carries the same fix, comment included.

**RED-then-GREEN independently reproduced for the new assertions** (not taken from the executor's report). Scratch tree with `core/` + `test/` + `package.json` copied, only `core/scripts/start-servers.sh` reverted to `2a270f3` (the cycle-1, pre-fix version):
```
  FAIL portless local URL degrades (no port printed, not defaulted to 80)
       expected [] got [80]
  FAIL portless local https URL degrades (no port printed, not defaulted to 443)
       expected [] got [443]
  ok   explicit-port local URL still yields its port
  36 passed, 2 failed
```
Post-fix the same file is 38/38. So the two new assertions are genuinely failable by the exact defect they were written for, and the third (`explicit-port local URL still yields its port`) correctly passes in *both* revisions — it is a control/regression guard, not proof, and it is not mislabelled as the red one.

On the test's method: the new block extracts `local_port_from_url()` from `$SCRIPT` via `sed -n '/^local_port_from_url() {/,/^}/p'` and `eval`s it. This is the good version of a unit-level shell test, not the trap — it reads the **real script on disk** rather than restating the function inline, so it cannot pass against a stale copy while the shipped script diverges (my RED run above is the proof: swapping the script changed the result). The stated reason for going unit-level rather than end-to-end — binding a listener to :80/:443 needs privileges CI does not have — is accurate and is the correct trade rather than an excuse to skip coverage.

Code quality on the round-2 diff: three-line change, no new helper, no abstraction, comment explains the hazard rather than the mechanics. `files-modified.md` was updated to describe the round-2 change honestly, including the reason for the unit-level test. Nothing dead, nothing left over.

### Phase 3: UI Review — N/A

No files matching the UI triggers (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`) changed. The change touches `core/scripts/`, `scripts/concertino/`, `core/roles/`, `test/scripts/`, and the change's own `openspec/changes/**` artifacts.

### Overall: PASS

### Non-blocking Suggestions

(Neither affects the verdict; both are for a future ticket or a spare moment, not this one.)

- **`http://localhost:80/health` also degrades, and that is worth one sentence somewhere.** WHATWG `URL` normalizes an explicitly-written default port away, so `u.port` is `""` for `:80` on http and `:443` on https — an operator who writes the port *explicitly* still gets the degrade path. That is contract-safe (degrading is never a false FAIL, and it is the conservative direction), so it is not a defect against the spec's "mismatch only when..." rule. But it is a small surprise the next reader of `local_port_from_url()` will have to re-derive; a half-line in the existing comment ("note: URL normalization also empties `u.port` for an explicitly-written :80/:443, which degrades — deliberately") would save that.
- **Carried over from cycle 1, still applicable:** `start_listener_in()` draws `$(( 20000 + RANDOM % 20000 ))` with no collision retry, six times per run. A retry-on-conflict loop would remove a flake class that is unpleasant to diagnose from CI. Deliberately left as non-blocking again — it is pre-existing in kind and unrelated to this ticket's ACs.
- Carried over: `local_port_from_url()`'s local-host list includes `0.0.0.0`, slightly broader than the loopback set design.md enumerated. Harmless.
