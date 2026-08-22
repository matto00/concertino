## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Prior finding 1 (cmdDiff gap analysis incomplete) — CLOSED.** I enumerated every
  write/copy `sync` performs by reading `lib/cli/sync.js` and grepping `lib/cli/emit.js`
  for `write(`/`copy(`: copyAssets (`core/laws/*`, `core/workflow-state.template.md`,
  `core/scripts/**` recursive), `.concertino.env`, `speeds.json`, emitClaude (5 agents,
  `concertino-deliver.md`, `concertino-address-failure.md`, `.claude/settings.json` via
  `mergeAgentMergeSettings`+`mergeCostHookSettings`), emitCodex (`.codex/roles/*`,
  `AGENTS.md`, `.codex/agents/*.toml`, `.codex/prompts/concertino-deliver.md`,
  `.codex/config.toml`), emitOpencode (agents, command, `opencode.json`). Cross-checked
  against `cmdDiff`'s current coverage (lib/cli/diff.js:69-129). The residual set is
  exactly what tasks.md 3.1-3.8 now enumerates; 3.11 correctly notes opencode is already
  covered; `.codex/agents/*.toml` and `.codex/config.toml` are already covered. No file
  `sync` writes is left uncovered by the revised plan.
- **Merged-region handling is correct against source.** `AGENTS.md` /
  `.codex/config.toml` / `.claude/settings.json` are read-modify-write
  (emit.js:139-170 `mergeMarkedRegion`, :31-82 the settings mergers); tasks 3.5/3.7 and
  the spec's merged-result requirement match that, so the preview reflects what lands on
  disk rather than a raw block.
- **Prior finding 2 (requirement in wrong capability) — CLOSED.** `find specs -type f`
  returns only `specs/sync-provenance/spec.md`; no `core-resolution` delta remains.
- **Prior finding 3 (proposal contradiction) — CLOSED.** proposal.md now declares
  `New Capabilities: sync-provenance`, `Modified Capabilities: (none)`, consistent with
  design.md's Non-Goal "no change to resolveCore's resolution logic".
- **Provenance approach checked against `lib/cli/resolve-core.js`** — `gitRun` (:19)
  returns null on failure and `gitTopLevel` (:33) builds on it; design Decision 1 and
  task 1.2's degrade-to-"plain install" fallback mirror that existing discipline.
- **Re-ran the doctor.js claim twice** (`grep -n readdirSync|listFilesRecursive
  lib/cli/doctor.js`, then a direct read of lines 25-70) to be sure it wasn't a stale
  checkout: line 43 is `listFilesRecursive(path.join(core, 'scripts'))`; the flat
  `fs.readdirSync` at line 45 is over `core/laws`, which `ls -F core/laws` confirms
  contains only files.

### Verdict: REFUTE

### Change Requests

1. **design.md, final section "Note on a related pre-existing bug (out of scope,
   spinoff candidate)" — and tasks.md 3.12 — assert a defect that does not exist in the
   current source.** Both claim `doctor.js:42`'s `fs.readdirSync(path.join(core,
   'scripts'))` is a flat listing that would throw EISDIR on `core/scripts/lib/`. Ground
   truth (`lib/cli/doctor.js:43`) is
   `for (const f of listFilesRecursive(path.join(core, 'scripts')))` — already recursive,
   imported at doctor.js:10. The only flat `readdirSync` there is line 45 over
   `core/laws`, which has no subdirectories (`core/laws/` = README.md,
   systematic-debugging.md, ticket-drafting-escalation.md,
   verification-before-completion.md). Delete both the design.md note and tasks.md 3.12,
   or replace them with a claim re-derived from the file. As written, tasks.md 3.12
   instructs the orchestrator to file a follow-up ticket for a non-bug.

### Non-blocking notes

- tasks.md 3.5 says to compute `.claude/settings.json` "the same way
  `mergeAgentMergeSettings`/`mergeCostHookSettings` do". Both return early when
  `agentMerge.enabled` / `costTracking.enabled` is false (emit.js:32, :62) — i.e. `sync`
  writes nothing. Worth stating explicitly that `cmdDiff` must likewise emit no entry in
  that case, so the preview doesn't report a phantom "new file" for a settings.json
  `sync` would never create.
- `mergeAgentMergeSettings` is not in emit.js's `module.exports` (only
  `mergeCostHookSettings` is, emit.js:436-440). `diff.js` will need it exported, or the
  merge factored into a shared helper — a small implementation detail worth anticipating
  rather than discovering mid-task.
- The spec scenario "local edit to a copied script shows as changed" names
  `scripts/concertino/cleanup.sh`, which does exist in `core/scripts/` — good, the
  fixture is real.
