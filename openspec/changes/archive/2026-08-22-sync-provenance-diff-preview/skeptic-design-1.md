## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas.
- Read the actual source myself, not the plan's paraphrase:
  - `lib/cli/diff.js` — `cmdDiff` diffs: `scripts/concertino/.concertino.env`, `speeds.json`,
    `.claude/agents/concertino-{orchestrator,executor,evaluator,skeptic,auditor}.md`,
    `.claude/commands/concertino-deliver.md`, the codex `.toml` roles + `.codex/config.toml`,
    the opencode agents/command/`opencode.json`. **Confirmed:** nothing from `copyAssets`.
  - `lib/cli/emit.js:421-433` `copyAssets` — `core/laws/*`, `core/workflow-state.template.md`,
    `listFilesRecursive(core/scripts)`. Plan's paraphrase is accurate, including the recursive
    enumeration (`core/scripts/lib/` really does exist — `git-child-env.sh`), so tasks 3.3's
    insistence on `listFilesRecursive` is correct and non-trivial.
  - `lib/cli/sync.js` — `core` is resolved before the first `copyAssets`/`write`, so tasks 2.1 is
    implementable as written.
  - `lib/cli/resolve-core.js` — `gitRun`/`gitTopLevel`/`realpathSafe` exist and degrade to `null`
    on failure; tasks 1.1/1.2's reuse plan is grounded.
- Empirically checked design.md's load-bearing factual claim about `process.argv[1]`:
  ran `node /tmp/provtest/link.js` where `link.js` is a symlink to `real.js` →
  `argv1=/tmp/provtest/link.js`, `__filename=/tmp/provtest/real.js`, `lstatSync(argv[1]).isSymbolicLink()===true`.
  **The claim holds** — Node does not symlink-resolve `argv[1]`.
- Checked the real install topology: `/usr/bin/concertino -> ../lib/node_modules/concertino/bin/concertino`,
  and `/usr/lib/node_modules/concertino -> /home/matt/Development/concertino`. Two-level symlink;
  `realpathSync` collapses both, and the git-ancestry check then correctly labels it a linked global.
  Design Decision 1 is sound for the actual environment.
- `openspec/specs/` inventory: `core-resolution` exists; there is **no** existing diff/preview capability.

### Verdict: REFUTE

The provenance half (Decision 1, tasks 1.x/2.x) is sound and I could not break it. Two blocking
problems remain: the gap analysis behind the diff half is incomplete against AC3, and the spec
deltas do not say what the proposal says they say.

### Change Requests

1. **The `cmdDiff` gap analysis is incomplete — `copyAssets` is not the only thing `diff` misses.**
   `proposal.md` claims the copied-assets gap was found "by direct comparison of `cmdDiff` against
   `copyAssets`" and that `diff` "already satisfies most of AC3". I compared `cmdDiff` against the
   *emitters* too, and `sync` writes at least five more categories `cmdDiff` never diffs:
   - `lib/cli/emit.js:120` → `.claude/commands/concertino-address-failure.md` (diff only covers
     `concertino-deliver.md`). This is precisely a file that has historically carried local edits
     clobbered by sync — the same class of loss AC4 names.
   - `lib/cli/emit.js:121-122` → `.claude/settings.json` (`mergeAgentMergeSettings`,
     `mergeCostHookSettings`).
   - `lib/cli/emit.js:224` → `.codex/roles/concertino-*.md`; `:245` → `AGENTS.md`;
     `:259` → `.codex/prompts/concertino-deliver.md`.
   With only tasks 3.1-3.3 implemented, `concertino diff` would still print "0 changed" while a
   sync is about to overwrite a locally-edited `concertino-address-failure.md` or `AGENTS.md`.
   AC3 ("shows what a sync would change") would remain unmet. Either extend the plan to cover the
   full `sync` write set (preferred — and structure it so the two can't drift, per the spirit of
   task 3.4), or explicitly scope-out the extras in `design.md` Non-Goals with a stated reason and
   a spinoff, rather than leaving them silently unlisted.

2. **`specs/core-resolution/spec.md` contains the wrong requirement.** That delta file's sole
   requirement is "`concertino diff` covers copied assets, not only rendered/merged files" — which
   has nothing to do with `core-resolution` (whose stated Purpose is *which `core/` directory to
   render from*). Archived as-is, it would pollute `openspec/specs/core-resolution/spec.md` with a
   diff-coverage requirement. Move it to its own capability delta (there is no existing diff/preview
   capability in `openspec/specs/`, so this is a **new** capability, e.g. `sync-diff-preview`), and
   declare it under "New Capabilities" in `proposal.md`.

3. **`proposal.md`'s "Modified Capabilities: core-resolution" entry is contradicted by every other
   artifact.** It states `resolveCore`'s "existing divergence note becomes one part of a fuller
   provenance report printed unconditionally". But `design.md` Non-Goals says the divergence note
   "stays exactly as-is"; Decision 1 puts provenance in `shared.js` explicitly *not* folded into
   `resolveCore`; `proposal.md`'s own Impact section says "`lib/cli/resolve-core.js` — no behavior
   change"; `tasks.md` has no core-resolution task; and the `core-resolution` delta contains no such
   requirement. Delete the Modified-Capabilities entry (nothing about core-resolution actually
   changes) or make one of the two readings true everywhere.

### Non-blocking notes

- `lib/cli/doctor.js:29-47` (`checkArtifacts`) **already** byte-compares exactly the three copied-asset
  categories this change adds to `diff`, and warns "differs from core". The plan never mentions it.
  The extension is still worth doing (`doctor` gives a filename list, not a unified diff, and is not
  the pre-sync preview), but the proposal's framing overstates the novelty — worth one sentence
  acknowledging the overlap so a reader doesn't conclude the drift was previously undetectable.
- Related latent bug, out of scope: `doctor.js:42` enumerates `core/scripts` with a flat
  `fs.readdirSync`, so it will hit `core/scripts/lib` (a real directory) and `readFileSync` it —
  the exact EISDIR trap `resolve-core.js` documents and tasks 3.3 avoids. Worth a spinoff ticket.
- Task 1.3: `process.argv[1]` is relative when invoked as `node bin/concertino`. Resolve to an
  absolute path before printing, or the provenance line is ambiguous in exactly the dev-checkout
  case it exists to disambiguate.
- Decision 1's git-ancestry test has a false-positive shape: a plain install unpacked *inside* some
  unrelated git working tree would be labelled a linked global. Acceptable, but say so in Risks.
- `npx openspec validate` is not runnable here ("could not determine executable to run"), so I did
  not machine-check the delta headers; CR 2/3 are from reading the files directly.
