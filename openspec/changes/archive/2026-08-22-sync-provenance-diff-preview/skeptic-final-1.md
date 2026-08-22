## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Repo is concertino (a CLI); there is no dev server or UI surface, so the
servers/Playwright/design-standard portions of the final gate do not apply and
were skipped for that reason. All CLI invocations below ran against throwaway
`--out=` dirs under the session scratchpad — never against
`/home/matt/Development/concertino`, `/home/matt/Development/helio`, or any
other real repo. The sibling CON-87 worktree and the untracked WIP paths were
not touched.

### What I verified (with evidence)

**Diff read from ground truth.** The CON-128 work is exactly one commit,
`4d3e8e6` (18 files; `lib/cli/{shared,sync,diff,emit,resolve-core,help,doctor}.js`,
`test/provenance.test.js`, `test/diff-coverage.test.js`, openspec artifacts).
The larger `main...HEAD` stat is CON-129/CON-133 already in this branch's
ancestry but not yet on `main` — not this ticket's change.

**Gates re-run by me, not taken on the evaluator's word.**
- `npm test` → `# tests 2247 / # pass 2247 / # fail 0`, process exit 0.
- `npm run test:selftest` → exit 0.

**AC1 — provenance before any write: MET.** Real `sync` into a throwaway dir:
```
concertino sync → .../scratchpad/tgt
  harnesses: claude-code, codex, opencode
  binary: .../CON-128/bin/concertino
  core:   .../CON-128/core
  refreshed .concertino/ assets + scripts/concertino/     <- first write, after
```
Provenance lines precede the first write line. Also verified for `--dry-run`,
which additionally prints the `concertino diff` pointer and left the target
empty (0 files after the run).

**AC2 — linked global vs separate global: MET for the symlink case.** Built a
fake linked global (symlink → this git checkout) and a fake plain global
(symlink → a de-gitted copy under /tmp) and invoked both:
- linked → `install: linked global (dev checkout at .../CON-128)`
- plain  → `install: plain install (no linked dev checkout)`

**AC3 — preview covers what sync would change, without writing: MET, measured
rather than assumed.** Synced all three harnesses into a throwaway target (53
files), appended a marker to every file, then ran `diff`: `50 changed · 0 new ·
1 unchanged`. Cross-checking the set of paths `diff` examined against the set
of files `sync` wrote leaves **zero** sync-written files uncovered (the one
remaining file, `spec/archive/.gitkeep`, is written by `init.js:275`, not by
`sync` — confirmed by grep and by its absence from the sync log). `AGENTS.md`
correctly reported `unchanged` because the edit landed outside the
`CONCERTINO:BEGIN/END` region, which `sync` would in fact preserve — the
merged-outcome semantics are right, not merely "diffed". Same for
`.claude/settings.json` with `agentMerge`/`costTracking` enabled: a locally
added `allow` rule reports `unchanged`, matching the append-only merger.
Nothing was written by `diff` (target file count unchanged).

**AC4 — local edits show as pending losses: MET.** Editing
`scripts/concertino/cleanup.sh`, `.concertino/laws/*`, and
`.concertino/workflow-state.template.md` in the target all render as `-` lines
in the unified diff — the exact CON-133 hazard class that was previously
invisible.

**Red-before-green independently reproduced.** Copied the tree, reverted only
`lib/cli/diff.js` to `4d3e8e6^`, ran `node --test test/diff-coverage.test.js`:
`# pass 4 / # fail 8`, with the 8 failures being precisely the new-coverage
cases. The new tests are load-bearing, spawn the real `bin/concertino`, and
mutate the real rendered target files rather than an expectation copy.

**Code-level parity check.** `diff.js`'s reproductions of `emitCodex`'s codex
role render, `roleIndex`/`blockText`, and `emitClaude`'s address-failure
substitution were compared line-by-line against `emit.js:135-141, 241-266` —
they match, including the `read(core/roles/...)` (not `readRoleFile`) source
and the merger application order (`applyAgentMergeSettings` then
`applyCostHookSettings`, mirroring `emit.js`).

### Verdict: REFUTE

One narrow, reproduced divergence between the shipped behavior and the spec
delta this change itself adds. Everything else above is clean.

### Change Requests

1. **`lib/cli/shared.js:reportProvenance()` prints no install classification at
   all when `process.argv[1]` is not a symlink, but this change's own spec
   delta says it should.**
   `openspec/changes/sync-provenance-diff-preview/specs/sync-provenance/spec.md`,
   scenario "plain global install, no git ancestry", reads: *"WHEN the invoked
   binary is a symlink **(or a real file)** whose resolved target has no git
   working tree in its ancestry THEN the provenance report labels it a plain
   (non-linked) install"*. Reproduced twice by invoking a de-gitted copy
   directly (a real file, non-symlink) from a non-git dir:
   ```
     binary: .../scratchpad/plain/bin/concertino
     core:   .../scratchpad/plain/core
   ```
   — no `install:` line. The `if (isSymlink)` branch in `reportProvenance()`
   gates the classification entirely, and no test covers the non-symlink case
   (`test/provenance.test.js` builds a symlink for both the linked and the
   plain fixture). Fix either side, but they must agree: preferably emit
   `install: plain install (no linked dev checkout)` — or a `direct
   checkout`/`plain install` classification derived from the same
   `gitTopLevel` check — in the non-symlink path too, with a test that invokes
   a real-file binary from a non-git directory; or, if the non-symlink case is
   deliberately out of scope, strike "(or a real file)" from that spec scenario
   so the archived spec does not assert behavior the CLI does not have.

### Non-blocking notes

- `diff.js` re-derives `roleIndex`/`blockText` and the codex role wrapper by
  duplicating `emit.js`'s literal strings. They are byte-identical today (I
  checked), and `test/diff-coverage.test.js`'s "fresh sync → 0 changed" test
  would catch drift, but extracting the two builders into shared helpers would
  make the drift structurally impossible rather than test-detected. Worth a
  follow-up, not a blocker.
- Working tree at review time had `openspec/.../workflow-state.md` modified and
  `evaluation-1.md` untracked — expected in-flight artifacts, not code.
