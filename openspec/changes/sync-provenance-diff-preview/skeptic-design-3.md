## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- **The retracted doctor.js EISDIR claim is genuinely retracted and the retraction is itself accurate.**
  `grep -n "listFilesRecursive\|readdirSync" lib/cli/doctor.js` →
  line 43 `for (const f of listFilesRecursive(path.join(core, 'scripts')))`,
  line 45 `for (const f of fs.readdirSync(path.join(core, 'laws')))`.
  `find core/laws -mindepth 1 -type d | wc -l` → `0` (laws holds 4 flat .md files).
  So the flat readdirSync can never hit a directory entry: no EISDIR bug.
  design.md's closing "Note on a round-1 skeptic finding, retracted" states exactly
  this (lines 43/45 named correctly), and `grep -rn "3.12\|EISDIR" tasks.md` finds
  nothing — task 3.12 is gone. Retraction is correct and complete.

- **The plan's central factual claim — cmdDiff's coverage gap — is real.**
  Enumerated every write `sync` performs: `lib/cli/sync.js:36-41` (copyAssets,
  `.concertino.env`, `speeds.json`, emitClaude/emitCodex/emitOpencode) plus every
  `write()`/`copy()`/merge call in `lib/cli/emit.js`. Cross-checked against every
  `diff(...)` call in `lib/cli/diff.js:70-125`. The delta is exactly the set the
  plan claims: the copyAssets trio (`emit.js:422-428`), `.claude/commands/
  concertino-address-failure.md` (`emit.js:120`), `.claude/settings.json`
  (`emit.js:46,80`), `.codex/roles/concertino-*.md` (`emit.js:224`), `AGENTS.md`
  (`emit.js:245`), `.codex/prompts/concertino-deliver.md` (`emit.js:259`).

- **No file `sync` writes is left uncovered by the plan.** `.codex/config.toml`
  (`emit.js:267-269`) is *already* diffed today (`diff.js:107-108`), so its absence
  from tasks §3 is correct, not an omission — and spec.md only names it in the
  merged-comparison clause, not as a new-coverage item, which is consistent.
  `.codex/agents/*.toml` (`emit.js:257`) already covered (`diff.js:104`). Opencode
  outputs already covered (`diff.js:117-125`), matching task 3.11's "confirm, don't
  duplicate". `.concertino.env`/`speeds.json` already covered (`diff.js:70-71`).

- **Task 3.3's "verbatim, chmod aside" framing matches ground truth**: `copyAssets`
  copies scripts byte-for-byte and only chmods post-copy (`emit.js:426-428`), so a
  content diff has full parity with what sync writes.

- **Internal consistency across artifacts:** ticket AC1-AC4 each trace to a task —
  AC1/AC2 → tasks 1.1-1.3, 2.1-2.2 + spec Requirements 1-2; AC3 → tasks 3.1-3.11 +
  spec Requirement 3; AC4 → task 4.2 (red-before-green with a real local edit) +
  spec scenarios "local edit to a copied script/law/template shows as changed".
  No task exceeds the ticket's scope; the explicit out-of-scope items (version
  stamping, the 2165-line deletion) appear as Non-Goals in design.md and nowhere in
  tasks.md. No TODO/TBD/"figure out later" in any artifact; Open Questions is
  legitimately empty given each decision names concrete functions and call sites.

- **Fallback discipline is specified, not hand-waved:** task 1.2 and spec's "git
  unavailable" scenario both pin git-failure → "plain install", mirroring
  `resolve-core.js`'s existing `gitRun` null-on-failure pattern.

### Verdict: CONFIRM

### Non-blocking notes
- Task 3.5 (`.claude/settings.json`): sync applies **two** mergers in sequence
  (`mergeAgentMergeSettings` at `emit.js:121`, then `mergeCostHookSettings` at
  `emit.js:122`, the second reading the file the first wrote). The diff must
  compose both against the on-disk file to represent the real post-sync state;
  applying only one would under-report. The task mentions both but not the
  ordering dependency — worth making explicit at implementation time.
- Provenance via `process.argv[1]`: a global npm bin can be a *chain* of symlinks.
  `fs.realpathSync` (task 1.1) resolves the whole chain, which is right, but the
  report should name the final target, not the first hop.
