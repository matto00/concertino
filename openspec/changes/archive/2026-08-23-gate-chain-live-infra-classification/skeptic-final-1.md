## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from the committed diff, the real
scripts, and commands I ran myself. No UI in this change (workflow/process +
bash scripts only), so the servers/visual-judgment section does not apply and
no dev server was started.

### What I verified (with evidence)

**1. The actual committed diff (not the planning docs).**
`git log --oneline main..HEAD` → single commit `501dbb8`. `git diff main...HEAD --stat`
→ 27 files, 2378 insertions. I read the full diff of `core/scripts/assert-phase.sh`,
`core/scripts/check-gate-chain-change.sh`, `core/scripts/test-gate-in-isolation.sh`
(env section), `core/roles/executor.md`, `core/roles/orchestrator.md`, and
`test/scripts/assert-phase.test.sh`. Implementation matches design.md's Decisions
1–7, including the round-1/round-2 corrections (evidence read from the *persisted*
`design.md` under `.concertino/runs/<TICKET>/evidence/`, per-script transcript
naming with `/`→`__` flattening, single-run pass/fail verdict rather than the
abandoned red/green-diff formulation).

**2. AC 5 — "enforced by the workflow, a run that skips them fails a gate" — holds
mechanically, not in prose.**
The evidence check lives in `core/scripts/assert-phase.sh`'s `delivery` case
(lines ~140–234), *not* in the classifier. `check-gate-chain-change.sh` only emits
`GATECHAIN yes|no` + `HUSKY`/`SCRIPT` lines. `assert-phase.sh` then:
 - fails closed if the classifier itself errors (`gate-chain classification failed (fail-closed)`),
 - fails if no persisted `design.md` exists,
 - runs a node routine requiring the literal heading `## Gate-Chain Implications Checklist`
   plus all five verbatim `**...**` prompts with non-placeholder answers (rejects
   `tbd`/`n/a`/`na`/`todo`/empty),
 - fails per changed script path lacking `<evidence>/.concertino/gate-chain-isolation-evidence/<flattened>.md`
   or lacking a `**PASS**` verdict inside it.
`fail()` sets `FAILED=1` and the script exits 1 at the tail, so any of these blocks
Delivery before `gh pr create` (orchestrator Phase 3 step 4).
This is demonstrated, not asserted: `test/scripts/assert-phase.test.sh` adds five
cases against the **real** script and throwaway bare-remote+clone fixtures —
GC-1 (.husky touched, no evidence) exit 1; GC-2 (checklist only) exit 1 naming
`scripts/check-foo.mjs`; GC-3 (transcript for an *unrelated* script) exit 1 still
naming the touched script; GC-4 (full evidence) exit 0 `PASS delivery`; GC-5
(ordinary diff) exit 0 unaffected. That is exactly the ticket's required
"blocked, then proceeds once evidence is recorded" demonstration.

I also ran the classifier against this very branch:
`./scripts/concertino/check-gate-chain-change.sh "$PWD" origin/main CON-132` → `GATECHAIN no`,
correct (the concertino repo has no `.husky/` dir), so this run is legitimately
not self-gated.

**3. Independent re-verification of the `GIT_WORK_TREE` deviation from design.md.**
design.md Decision 5 step 3 says `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`
exported "exactly as Husky's own hook-launcher exports them"; the implementation
(`test-gate-in-isolation.sh` lines 135–165) deliberately leaves `GIT_WORK_TREE`
UNSET, documented inline. I reproduced this myself, from scratch, in my own
`mktemp -d` sandbox (`/tmp/skeptic-probe.E3DXOS`) — never against this repo,
helio, or any real repo. Stated before running: had this probe been run in a real
checkout without the throwaway-repo safeguard, `git init` under an inherited
`GIT_DIR` would have re-initialised that real repo as bare, i.e. the exact CON-132
incident. Two disposable main-repo+linked-worktree pairs, `git init` run from
inside the linked worktree:

```
[gitdir_only]   before: bare=false   after: bare=true
[with_worktree] before: bare=false   after: bare=false
```

Confirmed independently: exporting `GIT_WORK_TREE` masks the incident's mechanism
entirely. The implementation is *more* correct than the design prose (real git
hooks export `GIT_DIR`/`GIT_INDEX_FILE` and rely on cwd), and the deviation is
documented in the script header. Not a defect.

I additionally ran the helper myself against the bundled known-bad fixture:
`./scripts/concertino/test-gate-in-isolation.sh SKEPTICPROBE-1 test/scripts/fixtures/gate-in-isolation/known-bad-git-init.sh`
→ printed its plain-language pre-flight statement, then
`FAIL target script ... corrupted the fixture ... - fixture bareness changed: 'false' -> 'true'`,
and persisted a transcript to
`/home/matt/Development/concertino/.concertino/runs/SKEPTICPROBE-1/evidence/.concertino/gate-chain-isolation-evidence/test__scripts__fixtures__gate-in-isolation__known-bad-git-init.sh.md`
— byte-identical in shape to the path `assert-phase.sh` looks for, so the
producer/consumer path contract is verified end-to-end, not just asserted.
The real surrounding repo was unharmed (`git -C /home/matt/Development/concertino
rev-parse --is-bare-repository` → `false`, HEAD → `main`). I deleted my probe
artifacts afterwards; `git status --short` in the worktree is back to only the
expected workflow files.

**4. `npm test` is genuinely green right now.**
Ran it myself: `EXIT=0`. `check-gate-chain-change.sh: 8 passed, 0 failed`,
`test-gate-in-isolation.sh: 9 passed, 0 failed`, no `not ok` lines anywhere in the
log (`grep -icE "^ *(not ok|fail)"` → 0).

**5. Scope honesty and the pre-existing sync drift claim.**
The diff contains only this ticket's files plus (a) `package.json` wiring the two
new selftests into the `test` chain and (b) the rendered `scripts/concertino/`
copies. All five rendered files are byte-identical to their `core/scripts/`
sources (`diff` → same for `assert-phase.sh`, `check-gate-chain-change.sh`,
`test-gate-in-isolation.sh`, `lib/git-child-env.sh`, `lib/git-child-env.selftest.sh`).
`lib/` had to be rendered because the updated `assert-phase.sh` sources it —
in-scope, not drive-by.
I verified the drift claim against `main` itself rather than trusting the report:
comparing `git show main:core/scripts/<f>` to `git show main:scripts/concertino/<f>`
shows `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`
already drifted on `main`, and `report-cost.sh`/`squash-branch.sh` missing from
the rendered tree on `main`. The drift genuinely predates this branch; this branch
resolves only `assert-phase.sh` (necessarily) and leaves the rest untouched, which
is the honest scope.

**6. Acceptance criteria traced.**
- AC1 (identified in planning; cannot reach Delivery without the checklist) —
  `core/roles/orchestrator.md` Phase 1 step 4a (advisory) + `assert-phase.sh delivery`
  hard block; GC-1/GC-2 tests.
- AC2 (linked-worktree question explicitly asked) — required verbatim prompt
  `**Does it behave differently from a linked worktree than from a main checkout?**`,
  greppped by the node routine in `assert-phase.sh`; wording restated identically in
  both role docs, so prose and grep cannot drift.
- AC3 (isolation demo under hook-shaped env, evidence recorded) —
  `test-gate-in-isolation.sh` + per-script transcript required by the gate; selftest
  proves the harness detects real corruption (verified independently above).
- AC4 ("I ran it and it passed" is not evidence, and why) — `core/roles/executor.md`
  step 6a states it plainly with the `GIT_DIR`-inheritance reason.
- AC5 (workflow-enforced, not agent recall) — see item 2.
- Ticket scope item 4 (staging) — explicitly kept advisory with stated reasoning
  (design.md Decision 7: post-squash, commit count is unobservable at the gate),
  which is what the ticket's own instruction requires instead of a silent downgrade.

### Verdict: CONFIRM

### Non-blocking notes
- `assert-phase.sh` picks the persisted checklist via `for f in "$GC_EVIDENCE_DIR"/openspec/changes/*/design.md; ... break`
  — the first glob match wins. With one change dir per ticket (the norm) this is
  exact; with two, it could read the wrong `design.md`. Failure direction is
  usually fail-closed, but a stray change dir *with* a checklist could in principle
  satisfy the gate for a different change. Cheap hardening: fail if the glob matches
  more than one file.
- The isolation transcript check is `grep -qF '**PASS**'`, so a hand-written
  transcript would satisfy it. That is fine against the ticket's actual threat model
  (omission / agent recall), not against forgery — worth stating in the spec so a
  later reader doesn't over-trust it.
- The transcript lands in the worktree at `.concertino/gate-chain-isolation-evidence/`,
  which relies on `.concertino/` being gitignored in the target repo or the gate's own
  "worktree has uncommitted changes" precondition would trip. True for concertino and
  helio; the test fixtures explicitly gitignore it. Worth one sentence in the executor
  guidance for target repos that don't.
