## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Each round-1 change request re-checked against the real files, not the design's
own claims about them.

- **CR-1 (allowlist union) — fixed, and the allowlist is correct in content.**
  design.md D2, tasks.md 1.4, proposal.md "What Changes", and the spec
  requirement all now state the union of the fixed change-dir allowlist and the
  parsed `files-modified.md`. I checked the allowlist covers what is actually
  staged: `workflow-state.md`, `ticket.md`, reports and `specs/**` all live
  inside the change dir (`ls` of this run's own change dir), and
  `persist-evidence.sh:134` writes durable evidence to
  `.concertino/runs/<TICKET>/evidence`, which `.gitignore:4` excludes — so no
  out-of-change-dir workflow path is left unallowlisted. Content of the
  allowlist: confirmed. Its *form* is defective — see CR-1 below.

- **CR-2 (parse rule) — fixed and matches the real producer.**
  `core/roles/executor.md` step 4 instructs the executor to write exactly
  ``- `path/to/file.ext` — brief rationale``. D2a's rule (leading `^\s*[-*]\s*`
  then a backtick-quoted path; backticks elsewhere ignored) is precisely that
  shape, so it parses the well-formed case and rejects the prose case.
  Unparseable-with-content-outstanding is specified as a loud stop gated on
  `--allow-empty-declaration` (D2a, tasks 1.4, spec scenario 4, test task 3.7).

- **CR-3 (summary-not-enumeration case) — fixed.** D2b explicitly routes the
  `a194152c` count-only case into the unparseable path and declines to
  special-case it, with the executor-contract tightening named as out of scope.
  Decided rather than left open, which is what CR-3 asked for.

- **CR-4 (ground-truth premise) — fixed, verified against the file.**
  `core/roles/` exists, `core/agents/` does not. `core/roles/orchestrator.md`
  Phase 3 step 1 reads only "**Squash all branch commits** into one with
  subject `{{var:_ticketPrefixExample}} <description>` and trailer
  `{{var:commitTrailer}}`" — no git command. `grep -rn "reset --soft" core lib
  scripts .claude test` returns zero hits. design.md Context, proposal.md
  Impact and tasks.md 2.1 now all say `core/roles/orchestrator.md` and frame
  2.1 as replacing unspecified prose. Correct.

- **CR-5 (test wiring + naming) — fixed.** `package.json`'s `"test"` is a
  hand-maintained `node --test && bash test/scripts/<name>.test.sh && ...`
  chain (24 explicit bash entries, nothing auto-discovered); task 3.8 appends
  one conjunct without reordering. `ls test/scripts` confirms every script test
  is `<name>.test.sh`, and the only `*.selftest.sh` in the repo is
  `core/scripts/lib/git-child-env.selftest.sh` — so D5's naming choice matches
  the real convention.

- **CR-6 (falsifiable red-proof) — fixed.** tasks 3.4/3.5 now assert per
  scenario ("sibling file appears in `git show --name-only`" / "exits 0 and
  creates a commit") and mandate mutating `core/scripts/squash-branch.sh`
  in place under a restoring `trap`, which structurally excludes the
  inline-copy trap the ticket names.

- **CR-7 (spec scenarios) — fixed.** `specs/delivery-squash-guard/spec.md` now
  carries both the allowlisted-workflow-artifact scenario and the
  no-parseable-paths scenario, with the `--allow-empty-declaration` branch.

- **D3 undisturbed.** design.md D3 still logs-only, explicitly marked
  "Confirmed at design-gate round 1 — do not revisit", and tasks 1.3 says "log
  only — it never blocks or requires a rebase". No forced rebase reintroduced.

- **Scope creep still clean.** No artifact touches `cleanup.sh`,
  `check-merge-readiness.sh`, fast-forward logic or version-stamping;
  CON-128/131/132/121/HEL-764 appear only as Non-Goals. CON-133's landed work
  (`core/scripts/lib/git-child-env.sh`, `listFilesRecursive`,
  `CONCERTINO_CLEANUP_SKIP_SYNC`) is untouched.

- **New defect found while checking CR-1's implementation form** — the fixed
  allowlist is specified as a literal `openspec/changes/<CHANGE_NAME>/**` glob
  "baked into the script". `core/scripts/**` is **copied verbatim** by
  `lib/cli/emit.js:426-428` (`copy(...)`, no `renderBody`), so scripts get no
  variable substitution — unlike role prose, where `lib/cli/render.js:202`
  substitutes `<change-dir>` from `c.specProvider.changeDir`. That value is
  configurable: `config/concertino.schema.json:42` defaults it to
  `openspec/changes/<CHANGE_NAME>` but `lib/cli/init.js:135` emits
  `spec/changes/<CHANGE_NAME>` for `specProvider.kind: 'none'`. In such a
  project every staged change-dir file falls outside the hardcoded allowlist
  and the guard trips on every ordinary run — the exact
  always-tripping-guard failure mode CR-1 existed to remove, reintroduced one
  layer down. The established pattern avoids this: `next-report-number.sh`
  takes the change-dir *path* as an argument, supplied by role prose where
  `<change-dir>` is already substituted.

### Verdict: REFUTE

### Change Requests

1. **Do not hardcode `openspec/changes/<CHANGE_NAME>` in the script.** Take the
   change directory as an explicit argument (e.g. `<CHANGE_DIR>` replacing or
   alongside `<CHANGE_NAME>` in tasks.md 1.1), derive both the allowlist glob
   (`<CHANGE_DIR>/**`) and the `files-modified.md` path from it, and have
   tasks.md 2.1's orchestrator-prose edit pass `<change-dir>` — the token
   `lib/cli/render.js:202` substitutes from `c.specProvider.changeDir`. Update
   design.md D2 item 1 accordingly (it currently says "a glob baked into the
   script, not inferred per-run"), and record why: `core/scripts/**` is copied
   verbatim by `lib/cli/emit.js:426-428` with no variable substitution, and
   `specProvider.changeDir` is configurable (`lib/cli/init.js:129/135`,
   `config/concertino.schema.json:42`), so a baked-in openspec path makes the
   guard false-positive on every run in a non-openspec project. Mirror
   `next-report-number.sh`'s caller-passes-the-path convention.

2. **Fix the stale Goals bullet in design.md.** Goals bullet 2 still reads
   "Staged files after reset are compared against `files-modified.md`; any file
   outside that set stops the script" — the pre-CR-1 rule, now contradicted by
   D2's union. Restate it as the union of the change-dir allowlist and the
   parsed declaration so the document has one rule, not two.

### Non-blocking notes

- design.md D5 cites the selftest convention as `lib/git-child-env.selftest.sh`;
  the real path is `core/scripts/lib/git-child-env.selftest.sh`. Cosmetic — the
  naming decision it supports is correct.
- Round 1's criss-cross note was adopted well (`merge-base --all` + loud stop on
  multiple results, tasks 1.2) and the archive-commit coverage boundary is now
  explicit in D5. Both good.
- Once CR-1 is applied, task 3.5/3.7's fixtures should use a non-default change
  dir in at least one scenario so the parameterization is actually exercised
  rather than merely intended.
