## Context

CON-128's original filing ("stale global downgrades files") was refuted by a
direct-evidence investigation, documented on the ticket. What remains in
scope is cheap and would have collapsed that two-day diagnosis into a single
command: (1) provenance reporting before any write, distinguishing a linked
global from a genuinely separate one, and (2) a real diff preview — which
turns out to **already exist** as `concertino diff`, with one material gap:
it never diffs the files `copyAssets` writes (`scripts/concertino/*`,
`.concertino/laws/*`, `.concertino/workflow-state.template.md`), which are
exactly the files most likely to carry un-upstreamed local fixes (see
CON-133).

## Goals / Non-Goals

**Goals:**
- Print, before any file is written by `sync` or compared by `diff`: the
  resolved binary path as invoked, whether that path resolves through a
  symlink, and if so whether the symlink's target is itself a git
  working-tree root (linked global) vs. a plain install with no `.git`
  (separate global).
- Print the resolved `core/` root alongside it (reusing `resolveCore`'s
  existing return value — no change to resolution logic itself).
- Extend `concertino diff` to cover `scripts/concertino/*`,
  `.concertino/laws/*`, `.concertino/workflow-state.template.md`, so a local
  edit to any of those shows up as a pending loss in the diff summary.
- Make `sync --dry-run`'s existing terse behavior legible (help text) rather
  than reimplementing diff content inside it a second way.

**Non-Goals:**
- Version stamping, generation counters, or "downgrade" detection — the
  original ticket's root cause did not hold, and this is explicitly dropped.
- Explaining the still-unexplained 2165-line deletion from 2026-08-20.
- Any change to `resolveCore`'s actual resolution *logic* — this only adds
  reporting around calls that already happen.
- Interactive confirmation prompts before `sync` writes (out of scope; the
  preview is what `diff` is for, run separately, by design — matches
  existing UX where `diff` suggests running `sync` to apply, not the other
  way around).

## Decisions

### Decision 1: Provenance detection lives in `lib/cli/shared.js`, not `resolve-core.js`

`resolve-core.js` decides which `core/` to use; it does not know or care how
the CLI itself was invoked (npm-linked global, plain global, `npx`, or a dev
checkout run directly). Provenance is a distinct, unconditional report about
the *invocation*, printed once per command from `sync.js`/`diff.js`, not
folded into `resolveCore`'s existing conditional divergence note (which
stays exactly as-is — it already covers the worktree-core-divergence case
this ticket isn't touching).

`process.argv[1]` gives the path as invoked (before symlink resolution,
since Node does not resolve `argv[1]` itself). `fs.lstatSync(argv[1]).isSymbolicLink()`
tells us whether it's a symlink; `fs.realpathSync` gives the resolved target.
Once we have the realpath, `git -C <dirname(realpath)> rev-parse
--show-toplevel` succeeding (and resolving to an ancestor of the realpath)
identifies "resolves into a git working tree" — the linked-global case. No
`.git` reachable from the realpath's directory means a plain (non-git)
install — could be a real separate global install, or an `npm install`ed
copy; either way, "not a dev checkout" is the correct, honest signal.

Alternatives considered: shelling out to `npm ls -g --depth=0` to ask npm
directly whether the package is linked. Rejected — npm's own `ls -g` output
format is not guaranteed stable across npm major versions, requires a
subprocess call unconditionally on every sync/diff, and duplicates
information the symlink check already gives us directly and cheaply.

### Decision 2: `cmdDiff`'s new file coverage reuses `diffFile`, not a second diff renderer, and covers every file `sync` writes — not just `copyAssets`

**Revised after the design-gate skeptic's round-1 REFUTE**, which correctly
found the original version of this decision scoped only to `copyAssets`
while `sync` also writes several files `cmdDiff` never touched:
`.claude/commands/concertino-address-failure.md`, `.claude/settings.json`
(via `mergeAgentMergeSettings`/`mergeCostHookSettings`),
`.codex/roles/concertino-*.md`, `AGENTS.md` (via `mergeMarkedRegion`), and
`.codex/prompts/concertino-deliver.md`. AC3 ("a diff-preview mode shows
what a sync would change") is not met by covering only `copyAssets` — it
requires covering everything `sync` can write. This decision now scopes to
the full set.

`copyAssets`'s per-file writes are single-file copies of already-final
content (`core/laws/<f>` → `.concertino/laws/<f>` verbatim, same for the
workflow-state template; `core/scripts/**` → `scripts/concertino/**`
verbatim, chmod aside) — `lib/cli/doctor.js`'s `checkArtifacts` already
byte-compares this exact trio for drift reporting, so `cmdDiff`'s new loops
over it mirror `doctor.js`'s proven compare logic (`listFilesRecursive`/
`fs.readdirSync` enumeration, same path-joins) rather than inventing a new
one, reusing `diffFile` for the actual unified-diff output instead of
`doctor.js`'s simpler byte-equality check (`diff` wants content, `doctor`
only wants a yes/no).

The remaining five files/regions are each rendered/merged by `emitClaude`/
`emitCodex` today via `write()`/`copy()`/the merge helpers — `cmdDiff`
computes the same content those functions compute (re-reading the adapter
templates, calling the same merge helpers with the same inputs) and calls
`diffFile` against each destination, exactly mirroring each write call's
own path-join and content-derivation so the two can never drift apart
silently. `.claude/settings.json` and `AGENTS.md`/`.codex/config.toml` are
merged-region files (existing hand-authored content outside the markers
must survive) — `diffFile` against the *merged* result (not the raw
`blockText`) is what correctly represents what `sync` would actually leave
on disk, consistent with how `mergeMarkedRegion`/the settings mergers are
already invoked from `emitClaude`/`emitCodex` themselves.

Alternatives considered: writing a bespoke lightweight diff for these
cases. Rejected — `diffFile` already exists, is already tested by
implication via the rest of `cmdDiff`, and using it keeps output format
(colorized unified diff, changed/new/unchanged counts) consistent across
every file category `diff` reports on. Also considered: leaving the five
non-`copyAssets` files out of scope and closing the ticket on the
`copyAssets` subset alone. Rejected per the skeptic's finding — AC3 is
about `sync`'s full blast radius, not one category of it.

### Decision 3: `sync --dry-run` stays terse; provenance is the only addition to it

Reimplementing content-level diffing inside `--dry-run` would duplicate
`cmdDiff` a third way inside the same codebase. Instead, `sync --dry-run`
gains the same provenance line `diff`/a real `sync` print, and its existing
`console.log('concertino sync → ' + out + dim('  (dry run)'))` line grows
one more line pointing at `concertino diff` for content-level preview. This
matches the ticket's own framing: "this may be a matter of surfacing and
documenting it" rather than building new machinery.

## Risks / Trade-offs

- **Git working-tree detection has false negatives in odd environments**
  (e.g. `git` binary unavailable) → matches `resolve-core.js`'s own existing
  fallback discipline (`gitRun` returns `null` on any failure, resolution
  falls back to "not part of the same superproject"); provenance detection
  does the same — a `git` failure is reported as "not a linked checkout"
  rather than throwing, since silence about a `git` failure is safer than
  crashing a sync.
- **Extending `cmdDiff`'s file coverage could alter its counts for existing
  callers/tests expecting exactly today's five categories** → covered by
  reading `test/` for any assertion pinned to `cmdDiff`'s current file set
  before adding the three new categories, and adding fixtures with a real
  local edit to a copied script to prove the gap closes (red before green,
  per the delivery instructions' verification standard).

## Open Questions

None — scope is bounded to the two ticket items and both have a concrete,
already-scoped implementation path above.

## Note on a round-1 skeptic finding, retracted after ground-truth re-check

The round-1 design-gate skeptic flagged a suspected `doctor.js:42` EISDIR
bug (a flat `readdirSync` over `core/scripts`, which contains a nested
`core/scripts/lib/`). Re-verified directly against `lib/cli/doctor.js`
during round 2: `doctor.js` already uses `listFilesRecursive` over
`core/scripts` (line 43); the flat `fs.readdirSync` is over `core/laws`
(line 45), which has no nested subdirectories. No bug exists here — this
note (and the corresponding tasks.md item) is retracted, not carried
forward as a follow-up.
