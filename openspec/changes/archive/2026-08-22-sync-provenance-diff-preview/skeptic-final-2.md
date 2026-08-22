## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review. Every claim below derives from the current tree + commands I ran myself.

### What I verified (with evidence)

**The round-1 gap (21faa2e).** Read `lib/cli/shared.js` `reportProvenance()` directly.
The `else` branch now exists: a non-symlink `process.argv[1]` prints
`install: plain install (no linked dev checkout)`. Confirmed live, not from the diff:
- Direct real-file invocation (`node <wt>/bin/concertino diff --out=<tmp>`) →
  `binary: .../bin/concertino` / `install: plain install (no linked dev checkout)` /
  `core: .../core`. Classification line is present. Matches spec scenario
  "plain global install, no git ancestry" ("a symlink **or a real file** … → plain install,
  with no working-tree root named").
- Symlink → dev checkout → `symlink → …` + `install: linked global (dev checkout at <toplevel>)`.
- Symlink → a copied package outside any git tree (`/tmp/.../fakepkg`) →
  `symlink → …` + `install: plain install (no linked dev checkout)`.
  So the linked-vs-separate-global distinction is real, not asserted.

**Mutation check on the new test.** Deleted the `else` branch from `shared.js` and ran
`node --test test/provenance.test.js`: `not ok 4 - diff prints a plain-install provenance
line for a real-file binary invoked directly` (`# fail 1`). Restored the file
(`git status` clean apart from a pre-existing `workflow-state.md` edit). The regression test
is load-bearing, not vacuous.

**Gates re-run by me.** `npm test` → exit 0 (all suites `N passed, 0 failed`, incl. the new
`provenance` + `diff-coverage` suites and `squash-branch.test.sh: 19 passed`).
`npm run test:selftest` → exit 0.

**AC1 — provenance before any write.** In `sync --dry-run` output the `binary:`/`install:`/
`core:` lines are at lines 60–62, the first `would copy` at line 64. Same code path
(`reportProvenance`) for the real write path.

**AC2 — linked global vs separate global install.** Three-scenario evidence above.

**AC3 — diff preview, no writes.** Fresh real `sync` into a throwaway dir, then `diff` →
`0 changed · 0 new · 44 unchanged`, exit 0. After edits, `diff` left the edited files
untouched (`LOCAL EDIT MARKER` still present in `scripts/concertino/cleanup.sh` afterwards).

**AC4 — local edits shown as pending losses.** Edited four files in the target
(`scripts/concertino/cleanup.sh`, `.concertino/laws/verification-before-completion.md`,
`.concertino/workflow-state.template.md`, `.claude/agents/concertino-skeptic.md`). `diff`
reported `4 changed · 0 new · 40 unchanged`, each edit shown as a `-` line, plus
`run \`concertino sync\` to apply`. Also verified the merged-region semantics: text appended
to `AGENTS.md` *outside* the CONCERTINO markers is correctly reported `unchanged`, while an
edit *inside* the managed region flips it to changed (`5 changed · 0 new · 39 unchanged`)
with the edit shown as a removed line — exactly the two AGENTS.md spec scenarios.

**Safety constraint honored.** All CLI runs used throwaway `--out=` dirs under the session
scratchpad; nothing was run against the concertino repo or helio, and none of the protected
paths were touched.

### Verdict: CONFIRM

### Non-blocking notes
- `reportProvenance()` consults git only in the symlink branch. A developer running
  `node bin/concertino` directly from inside the concertino dev checkout is therefore
  labeled `plain install (no linked dev checkout)` while `core:` points at that same dev
  checkout — literally true (no symlink involved) but slightly self-contradictory to a
  fast reader. Not a spec/AC violation (the spec only pins the no-git-ancestry real-file
  case, which is correct). A future polish would be to run `gitTopLevel` for non-symlinks
  too and say `dev checkout (running from <toplevel>)`.
- Diff output prints target paths relative to cwd, which produces long `../../../../tmp/...`
  strings for out-of-tree targets. Cosmetic only.
