## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from the diff, the running test
suite, or my own probes — not from `evaluation-1.md` or `files-modified.md`.

### What I verified (with evidence)

**Ground truth of the change.** `git diff main...HEAD --stat` on commit a03e1fa:
13 files, 521 insertions. Real code surface is 3 files —
`core/scripts/persist-evidence.sh`, `scripts/concertino/persist-evidence.sh`,
`test/scripts/persist-evidence.test.sh`. The rest are role docs and OpenSpec
artifacts. No unrelated drift, no scope creep.

**AC1 — mtime preservation, test-backed.** `cp -f` → `cp -fp` at
`core/scripts/persist-evidence.sh:162`. The regression test backdates a source
to `2020-01-01` via `touch -d`, persists, and asserts `stat -c %Y` equality —
plus a guard assertion that the backdate really is in the past (so the check
can't pass vacuously if both stamps were "now").

*Mutation-verified, not merely green.* I reverted `cp -fp` to `cp -f` in place
and re-ran: `FAIL mtime preservation: destination mtime matches source mtime /
expected [1577865600] got [1788981146]` — 48 passed, 1 failed. Restored to
`cp -fp`: 49/49. The test exercises the fixed line; it is not an ambient pass.

**AC2/AC3/AC4 — role docs.** Read the full added blocks in `core/roles/evaluator.md`
(+36) and `core/roles/skeptic.md` (+33). All three required statements are
present in *both* docs: (a) persist raw screenshot/measurement artifacts via
`persist-evidence.sh` **at capture time**, citing the returned `ref=` path;
(b) temporal/positional evidence is fragile across relocation, self-authenticating
evidence preferred, and any residual mtime dependency must be disclosed;
(c) the gate-defect condition, explicitly "independent of verdict / regardless of
PASS-FAIL-CONFIRM-REFUTE". The AC's "and, if applicable, the executor's" is
correctly a no-op: `grep -n -i 'screenshot\|persist-evidence' core/roles/executor.md`
returns zero hits, so the executor has no such capture path to govern.

**AC5 — rendered-copy sync.** `diff core/scripts/persist-evidence.sh
scripts/concertino/persist-evidence.sh` → identical (byte-for-byte, both
diff hunks in the branch diff are the same two hunks). The CON-172/173 drift
gate `rendered-scripts-drift.test.sh` is green, including its
"real tree: drift check exits zero" case.

**Full gate re-run, by me.** `npm test` → exit 0, `# pass 2254 / # fail 0`,
plus all 40 shell suites green. Not relied on from the evaluator's report.

**Independent behavioral probes** (throwaway repo in `/tmp`, since a claim about
`cp` semantics deserves more than one test's word):
- Re-persist after the source's content *and* mtime change: destination content
  becomes `v2` and mtime becomes `2021-07-07 07:07:07` — matching the spec's
  amended idempotency scenario ("matches the source's current content and mtime
  after each run"), which the test file itself only asserts for content.
- Read-only (0444) source, persisted twice: both calls print `READY ref=`, exit
  0, and the second overwrite lands (`ro2`). `cp -p` propagating a restrictive
  mode does **not** wedge the overwrite path (`cp -f` unlinks first). This was my
  main suspected regression from adding `-p`; it does not occur.

**Spec delta.** `openspec validate preserve-evidence-mtime-and-persist-screenshots
--strict` → "is valid", exit 0. The MODIFIED requirement states the mtime
guarantee in contract terms and adds a matching scenario; the three ADDED
requirements map 1:1 onto AC2/AC3/AC4.

**UI / design judgment: N/A, deliberately.** This is the Concertino repo; the
diff is one shell script (mirrored), one shell test, and markdown role docs.
There is no frontend surface, no `frontend/**` path, and no `DESIGN.md` in
scope, so servers were not started and no screenshots were taken. Skipping the
UI section here is the documented "no UI changes" case, not an omission.

**Debugging law.** Not a bug-fix-by-guess: the root cause is mechanical and
probe-confirmed (`cp` without `-p` stamps copy time), the ticket records a
premise correction from `premise-validation.md` that narrowed the scope, and the
regression test is failable by mutation as shown above.

### Verdict: CONFIRM

### Non-blocking notes

- The `--no-clobber` identical-content early-return never touches the
  destination, so that path keeps the *first* persist's mtime rather than the
  current source's. The script comment discloses this honestly
  (`persist-evidence.sh` lines 41–43 and 147–149), but the spec's `--no-clobber`
  requirement text does not carry the same carve-out that the MODIFIED copy
  requirement now does. Content is identical by construction on that path, so
  there is no correctness impact — worth a sentence in the spec next time this
  requirement is touched.
- The amended idempotency scenario says the destination "matches the source's
  current content and mtime after each run", but the existing idempotency test
  asserts content only. I verified the mtime half by probe; a one-line
  `stat -c %Y` assertion there would make the spec scenario self-verifying in CI.
