- `test/scripts/rendered-scripts-drift.test.sh` — new drift gate (CON-172): compares every file under `core/scripts/**` against its `scripts/concertino/**` counterpart, asserts every rendered `.sh` is executable (never compares modes for equality), separates content-mismatch/not-executable/missing-counterpart failures, honours a written-reason exemption list for the missing-counterpart case only, and prints the `concertino sync` remedy.
- `package.json` — registers the new test in the explicit `test` script chain so the gate runs as part of routine `npm test`.
- `scripts/concertino/squash-branch.sh` — re-rendered from `core/scripts/squash-branch.sh` to clear existing drift (CON-163 validate-before-reset, CON-162 staged-blob validation, CON-164 `DRY_RUN=1`, grouped-bullet declaration parser).
- `scripts/concertino/check-merge-readiness.sh` — re-rendered from `core/scripts/check-merge-readiness.sh` to clear existing drift (CON-159 CI-poll-window change, CON-152 owner-override token handling).
- `scripts/concertino/cleanup.sh` — re-rendered from `core/scripts/cleanup.sh` to clear existing drift.
- `scripts/concertino/README.md` — re-rendered from `core/scripts/README.md` to clear existing drift.

Not modified (verified untouched): `scripts/concertino/pricing-table.json` and `scripts/concertino/report-cost.sh` in the main checkout — absent from this worktree entirely, and confirmed still present, untracked, and byte-identical to `core/scripts/` in the main checkout as the final pre-commit step (task 4.5).
