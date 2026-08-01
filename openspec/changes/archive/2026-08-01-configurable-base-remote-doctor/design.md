## Context

`concertino doctor`'s `Git` section (`checkBaseBranch()` in `bin/concertino`, added by CON-25)
compares local `main` against `origin/<base>`, with the remote name written in as the literal
string `'origin'`. Meanwhile `scripts/concertino/cleanup.sh` (main-fast-forward, also CON-25),
`assert-phase.sh delivery` (delivery-stale-base-warning), and `setup-worktree.sh` all already
resolve the base remote from the environment variable `CONCERTINO_BASE_REMOTE`, falling back to
`'origin'`. No config field currently writes that variable, so `renderEnv()` never emits it and
every shell script's `${CONCERTINO_BASE_REMOTE:-origin}` fallback is always exercised — there is
nothing yet for `doctor`'s hardcoded literal to disagree with. It becomes a real disagreement the
moment a config field for the base remote exists, unless `doctor` is wired to read it too.

## Goals / Non-Goals

**Goals:**
- Introduce `project.baseRemote` (default `'origin'`) as the single config source of truth for
  the base remote name, mirroring the existing `project.baseBranch` (default `'main'`) field
  exactly.
- `doctor`'s `checkBaseBranch()` reads `cfg.project.baseRemote || 'origin'` instead of the
  hardcoded literal — the same pattern it already uses for `cfg.project.baseBranch || 'main'`.
- `renderEnv()` emits `CONCERTINO_BASE_REMOTE` from that same field, so every shell script that
  already reads it (`cleanup.sh`, `assert-phase.sh`, `setup-worktree.sh`) picks up a non-default
  value automatically, with no changes needed to those scripts.
- Absent configuration, behavior is byte-for-byte unchanged: both paths resolve to `'origin'`.

**Non-Goals:**
- Not adding an interactive `concertino init` wizard prompt for this field — it is a rare,
  advanced override (fork-based workflows), consistent with how other advanced fields
  (`worktree.hooks`, `canonicalDocs`) are left as post-init manual edits rather than prompted for.
- Not making any *functional* change to `cleanup.sh`, `assert-phase.sh`, or `setup-worktree.sh`
  themselves — they already read `CONCERTINO_BASE_REMOTE` correctly; only the write side
  (`renderEnv`) and `doctor`'s read side are missing today. (`cleanup.sh` does get one doc-comment
  correction — see tasks.md 2.5 — since this change makes its existing "not currently rendered"
  comment factually stale.)
- Not touching the `BASE_BRANCH`/remote resolution for anything other than the base-remote name
  (e.g. this does not add a way to configure *per-worktree* remotes, or multiple remotes).

## Decisions

**Single config field, two consumers, one source of truth.** `project.baseRemote` is read
directly by `doctor` (which already has `cfg` in scope inside `checkBaseBranch(out, cfg, r)`) and
indirectly by every shell script via `renderEnv()`'s `CONCERTINO_BASE_REMOTE` line. This is
exactly the existing `project.baseBranch` / `CONCERTINO_BASE_BRANCH` pattern, so there is no new
resolution mechanism to design — just filling in the one field that pattern is missing.
Alternative considered: have `doctor` shell out to read `.concertino.env` instead of `cfg`
directly, to more literally match what the shell scripts do. Rejected — `doctor` already reads
`cfg.project.baseBranch` directly rather than parsing the rendered env file, and there is no
reason to treat the remote differently from the branch; both should read config the same way.

**Default via `withDefaults()`, not inline `||` at every call site.** `withDefaults()` already
normalizes `c.project.baseBranch = c.project.baseBranch || 'main'` once, at config-load time.
Add the equivalent `c.project.baseRemote = c.project.baseRemote || 'origin'` line right next to
it, so both `checkBaseBranch()` and `renderEnv()` can read `c.project.baseRemote` directly without
each needing their own fallback. (`checkBaseBranch()` additionally keeps a defensive `|| 'origin'`
at its own call site, matching the existing defensive `|| 'main'` next to it, in case `cfg` was
loaded via a path that bypassed `withDefaults()`.)

**Surface it in `concertino validate` output.** Add an `ok('baseRemote', ...)` line immediately
after the existing `ok('baseBranch', ...)` line in `cmdValidate`'s `Project` section, so the
resolved value is visible the same way `baseBranch` already is.

## Risks / Trade-offs

- [Silent staleness if `concertino sync` isn't re-run after changing `project.baseRemote`] →
  Pre-existing risk shared by every config field surfaced through `renderEnv()` (including
  `baseBranch` today); not a new failure mode introduced by this change, and the existing
  `checkArtifacts()` doctor check already warns generally when rendered files "differ from core"
  — no new mitigation needed here.
- [A project renames its remote without updating `project.baseRemote`] → Out of scope: this
  change makes the two paths agree with *configuration*, not with the actual state of `git
  remote -v`; validating that the configured remote name actually exists is a separate concern
  `doctor`'s existing best-effort fetch-failure handling already degrades safely against (a fetch
  against a non-existent remote fails silently, exactly like today's offline case).

## Migration Plan

Purely additive and backward-compatible: existing `concertino.config.json` files with no
`project.baseRemote` field continue to default to `'origin'` everywhere, identical to current
hardcoded behavior. No migration steps required. Projects that want a non-default base remote
add `"baseRemote": "upstream"` under `project` and re-run `concertino sync`.
