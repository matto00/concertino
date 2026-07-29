## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket ACs traced to code, not claims**: read CON-14 from Linear directly.
  - AC1 (validate before path use, reuse pattern): `core/scripts/emit-event.sh:72,149`
    and `core/scripts/persist-evidence.sh:37-42` both add
    `looks_like_ticket() { [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; }` — the
    identical literal regex already used by `assert-phase.sh`/`start-servers.sh`/
    `cleanup.sh` (confirmed via `grep -n looks_like_ticket` across all six files —
    byte-for-byte the same expression). Reuse-as-inline-duplication (not a shared
    lib) is consistent with pre-existing project convention (`assert-phase.sh`
    already carries its own copy) and is explicitly justified as a non-goal in
    `design.md` ("Non-Goals: Extracting a shared shell library").
  - AC2 (rejected ticket → emit nothing): `emit-event.sh:148-149` folds the shape
    check into the pre-existing `[ -z "$TICKET" ] && exit 0` branch — read the
    full file, confirmed no `RUN_DIR`/`mkdir` runs before the check.
  - AC3 (`persist-evidence.sh` refusal doesn't fail the run): confirmed via
    `grep -rn persist-evidence.sh` that every call site (`skeptic.md`,
    `evaluator.md`, `orchestrator.md`, `emit-event.sh`'s own internal call) was
    already written against the pre-existing FAIL/no-ref contract this change
    reuses verbatim — no caller changes were needed or made.
  - AC4 (tests cover a traversal attempt, nothing written outside runs dir): read
    the new test blocks in `test/scripts/emit-event.test.sh` (lines ~350-365) and
    `test/scripts/persist-evidence.test.sh` (lines ~72-91) — both assert exit
    code, no `READY`/stdout leak, and a before/after `find` diff over the whole
    repo showing no new file anywhere.

- **Re-ran the gates myself** (not trusted from the evaluator's report):
  - `bash test/scripts/ticket-pattern.test.sh` → 15 passed, 0 failed.
  - `bash test/scripts/emit-event.test.sh` → 63 passed, 0 failed.
  - `bash test/scripts/persist-evidence.test.sh` → 20 passed, 0 failed.
  - `npm test` (full suite) → every reported group ends `N passed, 0 failed`;
    `ℹ fail 0` from the node:test runner section. No failures anywhere.

- **Manual exploit attempts against both scripts directly** (independent of the
  authored test cases, to rule out a test asserting the wrong thing):
  - `persist-evidence.sh '../../../../../../tmp/pwned-CON' /tmp/evil-source.txt`
    → `FAIL invalid TICKET_ID: ...`, exit 1, `ls /tmp/pwned-CON` confirms nothing
    was created.
  - `persist-evidence.sh 'CON-1/../../../../../tmp/pwned2' ...` (slash embedded
    mid-string rather than a pure `../` prefix) → also rejected, since `/` is
    outside the allowed character class.
  - `emit-event.sh note 'ticket=../../../../../tmp/pwned-evt' msg=hi` from a
    freshly initialised repo → exit 0, `find / -maxdepth 2 -name "pwned-evt*"`
    found nothing.
  - Cleaned up all temp artifacts afterward; `git status` in the worktree shows
    no stray files from my probing.

- **Re-rendered copies verified identical**: `diff core/scripts/emit-event.sh
  scripts/concertino/emit-event.sh` and the `persist-evidence.sh` equivalent both
  produced no output — the sync task was actually run, not merely claimed in
  `files-modified.md`.

- **Sweep claim (ticket's "Notes" section) independently checked**: grepped every
  script under `core/scripts/` for `${TICKET` / `${TICKET_ID` used to build a
  `mkdir`/`DEST_DIR`/`RUN_DIR`-shaped path — only the two call sites this change
  fixes exist. Spot-checked `setup-worktree.sh`: it builds `WORKTREE_PATH` from
  `BRANCH`, not `TICKET_ID`, so it is correctly out of scope here (a separate,
  pre-existing concern the design doc correctly excludes as a non-goal).

- **No scope creep / no regressions**: the only pre-existing test line changed is
  `ticket=42` → `ticket=HEL-42` in `emit-event.test.sh`'s numeric-identity-field
  case, a necessary consequence of narrowing the accepted shape (bare digits no
  longer start with a letter/`#`), called out in `files-modified.md` and an
  inline comment, and the sibling `role=7` assertion is untouched.

- **No UI to review** — this is a shell-only change with no dashboard/view
  surface; skipped step 4 of the final-gate procedure as instructed.

### Verdict: CONFIRM

### Non-blocking notes
- `test/scripts/persist-evidence.test.sh`'s new traversal case writes stderr to
  a fixed path (`/tmp/persist-evidence-test-err`) rather than a `mktemp`-scoped
  file; harmless today (tests aren't run concurrently against the same TMPDIR)
  but a shared literal path is a latent collision risk if that ever changes.
