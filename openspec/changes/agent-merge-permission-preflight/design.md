## Context

`agentMerge.enabled: true` in `concertino.config.json` is a config-level opt-in
the orchestrator resolves into `AGENT_MERGE = true`. Under Claude Code's
auto-mode permission classifier, that resolution is not itself evidence of
authorization: the classifier evaluates the auditor spawn (and would evaluate
`gh pr merge` too) against the session transcript, which contains no human
statement granting merge authority — only the agent's own assertion that
config says so. The classifier denies it, correctly, from its own point of
view. The result observed on CON-73: all gates pass, the PR is created and
linked, then the auditor spawn is denied, the orchestrator correctly falls
back to the manual-confirm flow, but only after the PR already exists and a
`SECURITY WARNING: [Merge Without Review]` has already been surfaced — a
confusing, wasted round-trip on every agent-merge run under Claude Code.

Codex and OpenCode are out of scope for the classifier problem itself — the
ticket's concrete case and the classifier message are Claude Code auto-mode
specific. The fix's `.claude/settings.json` grant is therefore claude-code-only;
the orchestrator's pre-check step degrades to a no-op on other harnesses (no
change there today).

## Goals / Non-Goals

**Goals:**
- Make the human's `agentMerge.enabled: true` opt-in reach Claude Code's
  permission classifier as real evidence, so the common case (freshly synced
  project) never hits a mid-run denial at all.
- Give `doctor`/`validate` a way to catch drift between the two opt-ins
  (config says enabled, harness grant missing or removed) before a run ever
  reaches Delivery.
- Move the ask from "after being denied" to "before spawning" for any run
  that still reaches Delivery with the grant missing, so a denial (if it
  still happens for reasons outside this fix's control) is never
  rediscovered mid-spawn with a wasted PR-creation round-trip.
- Preserve every byte of the `AGENT_MERGE = false` path.

**Non-Goals:**
- Verifying against Anthropic's actual classifier behavior end-to-end — this
  environment cannot exercise a real Claude Code auto-mode session to confirm
  that a `.claude/settings.json` allow rule actually suppresses the
  classifier for these two actions. This design follows the ticket's own
  Option 2 recommendation and the codebase's existing precedent for exactly
  this kind of unverifiable-here harness contract (see
  `core/roles/orchestrator.md`'s "Per-spawn model overrides" section, which
  states the same caveat about a different Claude Code contract and defines
  the same "verify against the live harness; degrade silently if it doesn't
  hold" fallback). If the grant does not in practice suppress the classifier,
  the orchestrator's pre-check (goal 3 above) is what keeps the run safe: it
  still asks before spawning rather than discovering a denial mid-spawn.
- Auto-fixing a missing grant from inside a running delivery. Doctor/validate
  only warn; the orchestrator only asks. Nothing in this change edits
  `.claude/settings.json` outside of `concertino sync`.
- Any change to the auditor role's own behavior, `check-merge-readiness.sh`,
  or the four merge conditions it checks.
- Extending this to Codex/OpenCode, which don't have this classifier.

## Decisions

### Decision 1: The two required permission rules, and where they live

Two Claude-Code-syntax allow-rule strings, computed by one pure function
(`agentMergePermissionRules()`, added to `lib/config.js` next to
`collectConfigIssues`) so `emitClaude` (writer) and `collectConfigIssues`
(checker) can never drift against each other in JS:

```js
function agentMergePermissionRules() {
  return [
    'Bash(gh pr merge:*)',
    'Task(concertino-auditor)',
  ];
}
```

- `Bash(gh pr merge:*)` — the one mutating command the auditor ever runs
  (`core/roles/auditor.md`: "the one command with a side effect is `gh pr
  merge`"). Standard, well-documented Claude Code Bash-tool allow-rule
  syntax; not itself a new assumption.
- `Task(concertino-auditor)` — the auditor *spawn* itself, which is the
  action CON-73's classifier denial actually named ("tries to spawn the cold
  `concertino-auditor` sub-agent ... the harness's auto-mode permission
  classifier denies the spawn"). Claude Code's underlying subagent-dispatch
  tool is named `Task` regardless of what a given harness surface calls it
  (this project's own `Agent` tool is the dispatch surface; `Task` is the
  permission-rule tool identifier Claude Code's settings schema uses for it).
  Scoped to `concertino-auditor` specifically — not a bare `Task` grant,
  which would authorize spawning *any* subagent, a materially broader grant
  than what `agentMerge.enabled` opts into.

Kept in exactly one JS function so a future correction to either string (if
live testing against the harness shows the syntax needs adjusting — see
Non-Goals) is a one-line change that both the writer and the checker pick up
identically; no second copy to remember.

The bash-side counterpart (`scripts/concertino/check-agent-merge-permission.sh`,
Decision 2) necessarily hardcodes the same two strings in shell instead of
`require()`-ing the JS — no shared runtime between Node and the shell scripts
elsewhere in this codebase either (`speeds.json`/`.concertino.env` are
sync-time *rendered* artifacts for exactly this reason). A code comment in
each of the three places (`lib/config.js`, `emit.js`'s call site, the shell
script) cross-references the other two, matching this codebase's existing
convention for unavoidable cross-language duplication (e.g. `budgets`
defaults duplicated between `config/concertino.schema.json` and
`lib/config.js`, cross-referenced by comment).

### Decision 2: Check the main checkout's settings.json, not the worktree's — and resolve it the way `check-merge-readiness.sh` already does

**Correction after design-gate round 1 REFUTE.** `.claude/settings.json` is
written only by `concertino sync`, which targets the **main checkout**
(`lib/cli/sync.js`'s `out` defaults to `cwd`) — and, like
`.claude/agents/concertino-*.md`, it is gitignored, so a freshly created
worktree never has a copy of it (verified directly during the design-gate
round: `setup-worktree.sh`'s only worktree copy mechanism,
`worktree.envFiles`, is not proposed to include it, and this change's own
worktree had no `.claude/` at all). This also answers Decision 1's open
question about *where* the classifier actually reads from: since Claude
Code's own permission plumbing is rooted at the project (main checkout), not
a worktree, the main checkout is the objectively correct place to check —
not merely a workaround for the copy problem.

`scripts/concertino/check-agent-merge-permission.sh <WORKTREE_PATH>` —
resolves the **main checkout from `$WORKTREE_PATH`**, using the exact
`main_checkout()` helper `check-merge-readiness.sh` already carries (`git
rev-parse --git-common-dir`, duplicated rather than sourced, matching that
script's own stated reason: every procedure script in this suite stays
standalone), then checks `<main_checkout>/.claude/settings.json` — never
`$WORKTREE_PATH/.claude/settings.json`. Same stdout/stderr contract as
`assert-phase.sh`/`check-merge-readiness.sh`: `PASS` and exit 0 when that
file exists and its `permissions.allow` array (via `jq`) contains both
required rule strings; otherwise `FAIL <reason>` (one line per missing rule,
"no .claude/settings.json found", "could not resolve main checkout", or a
JSON-parse-failure reason) to stderr, non-zero exit. A missing/unparseable
settings file, or a worktree with no resolvable main checkout, is a `FAIL`,
not a silent pass — same fail-closed posture `check-merge-readiness.sh`
already uses for an unrecognized mergeability status.

Called from two places:
- `concertino doctor`'s new "Agent-merge" section (via `execSync`, same
  pattern `checkBaseBranch` already uses for a shell-out check), passing the
  project root itself (`opts.out`) — already the main checkout in this
  call site, so `main_checkout()` resolves to it trivially. Only when
  `cfg.agentMerge.enabled` is `true` and `claude-code` is in
  `cfg.harnesses`; otherwise this section is a silent no-op, matching every
  other conditionally-gated doctor/validate section in this codebase.
- The orchestrator, immediately before the `AGENT_MERGE = true` branch's
  auditor spawn in Phase 3 (Decision 3), passing `$WORKTREE_PATH` — the
  script resolves the main checkout itself from there.

One script, one contract, two callers, one resolution helper — avoids
re-deriving the same jq query and the same main-checkout resolution in
`lib/config.js` (Node) and in `core/roles/orchestrator.md` (prose bash)
independently.

### Decision 3: Orchestrator pre-checks once, at the top of the `AGENT_MERGE = true` branch — gated by a sync-time harness block, not a runtime field

**Correction after design-gate round 1 REFUTE.** The original design gated
this step on "this run's resolved harness, read from `workflow-state.md`'s
`harness` field" — but no such field exists anywhere in
`core/workflow-state.template.md` or the orchestrator's Setup write list,
and adding one would be new persisted-state surface purely to answer a
question `concertino sync` already knows the answer to at render time (which
harnesses this rendered copy of `orchestrator.md` was even generated for).
Instead, this uses the exact convention `core/roles/orchestrator.md` already
has for a harness-conditional passage: a `{{block:...}}` template
placeholder resolved by `lib/cli/render.js`'s `block(name, c, harness)`
function at `concertino sync` time (see the existing `{{block:harnessResume}}`
usage) — each rendered harness's copy of this file gets different prose
for this step, decided once at sync time, no runtime lookup needed.

`core/roles/orchestrator.md` Phase 3 step 7's `AGENT_MERGE = true` branch
gains one step, `{{block:agentMergePermissionCheck}}`, placed immediately
before the existing auditor spawn:

- **Rendered for `claude-code`:**
  ```bash
  scripts/concertino/check-agent-merge-permission.sh "$WORKTREE_PATH"
  ```
  - `PASS` → proceed to spawn the auditor exactly as today. No behavioral or
    cost change to the already-working case (a freshly-synced project).
  - `FAIL` → do **not** attempt the spawn. Raise one escalation (per "How to
    raise one") naming the missing rule(s) verbatim from the script's
    stderr, with `options=retry,fallback` (`kind=blocker` if bubbled per
    CON-76's `PENDING_ESCALATION` — see the note on this below): `retry`
    means the human ran `concertino sync` (or edited `.claude/settings.json`
    by hand) and wants the check re-run; `fallback` means proceed on today's
    `AGENT_MERGE = false` flow for this run (present the PR, wait for a
    manual "merged"). This satisfies the ticket's AC 2 second branch ("asks
    the human before the auditor spawn rather than after being denied") and
    keeps the actual classifier interaction — if it still denies for a
    reason outside this fix's control — from ever being reached blind.
- **Rendered for `codex`/`opencode`:** a one-line note that this step is N/A
  on this harness (no auto-mode permission classifier of this kind exists
  there today) and the auditor spawn proceeds unconditionally, exactly as
  before this change.

This check does not run at all when `AGENT_MERGE` resolves `false` for the
run (unaffected — matches AC 4), regardless of harness.

This is a **pre-check, not a substitute** for the classifier itself possibly
still denying the spawn in practice (Non-Goals) — it only removes the
*avoidable* denial (grant genuinely missing, catchable in one `jq` read)
before any PR-creation round-trip happens. If the grant is present and the
classifier denies anyway, that surfaces exactly as it does today (an
`ESCALATION`-style STOP from the harness itself, per the ticket) — this
change does not, and cannot from inside a delivery, alter the classifier's
actual runtime decision.

**`PENDING_ESCALATION.kind` for this escalation.** `core/workflow-state.template.md`'s
`kind` enum (`planning | blocker | budget | followup | final-gate`) has no
dedicated slot for "the harness-level permission grant this run needs is
missing." This design assigns it `kind: "blocker"` — the closest existing
fit (a local, environmental precondition a human must fix outside the
running delivery, same character as the existing environmental `BLOCKER`
category) — rather than widening the shared enum for one new call site. No
change to `workflow-state.template.md` itself is needed.

### Decision 4: `concertino sync` additively merges the grant, non-destructively

`emitClaude` (`lib/cli/emit.js`), when `c.agentMerge.enabled` is `true` and
`claude-code` is in the harnesses being emitted, merges
`agentMergePermissionRules()` into `<out>/.claude/settings.json`'s
`permissions.allow` array:

- Read the existing file if present; `{}` if absent or unparseable (never
  crash `sync` over a malformed pre-existing settings file — same
  degrade-safely posture doctor's other checks already use, e.g.
  `checkOllamaProvider`'s network-failure handling).
- Parse `permissions` (default `{}`) and `permissions.allow` (default `[]`).
- Add each required rule not already present (string equality — no need for
  pattern-equivalence logic beyond exact match, since `sync` itself always
  writes the exact canonical string).
- Write back the whole file, pretty-printed, preserving every other key
  (`permissions.deny`, `permissions.ask`, anything else a human added) byte-
  for-byte apart from the `permissions.allow` array gaining the (sorted,
  deduplicated) required entries.
- When `c.agentMerge.enabled` is `false`, **do not touch the file at all** —
  not even to remove previously-added rules. Symmetric with this codebase's
  existing "Append-only" precedent for Linear relations (`save_issue`'s
  `blockedBy`/`blocks`/`relatedTo`) and with `worktree.envFiles`-style
  additive checks elsewhere: a stale, unused allow-rule sitting in
  `.claude/settings.json` after a project turns `agentMerge.enabled` back off
  is inert (it grants a capability the run never asks the classifier to
  authorize), whereas silently deleting a settings-file entry a sync tool
  didn't originally ask permission to touch is the wrong default. A human
  who wants it gone can remove it by hand.
- No `--dry-run` change needed beyond what `write()` already does for every
  other `sync`-managed file (`emit.js` already threads `dry` through every
  `write()` call it makes; this new write follows the same call shape).

### Decision 5: Where the checker's warning renders

New "Agent-merge" section in `collectConfigIssues` (`lib/config.js`), placed
after "Providers" (mirrors the file's existing section order: feature-neutral
core sections first, opt-in feature sections after). Silent no-op unless
`cfg.agentMerge.enabled` is `true` AND `claude-code` is in `cfg.harnesses` —
matches every other conditionally-gated section already in this function
(Providers/Ollama, UI, etc.). When active, shells out to the same
`check-agent-merge-permission.sh` script (Decision 2) against `opts.out`,
reports `ok('agentMerge.permissions', ...)` on `PASS`, or `warn(...)` naming
the exact missing rule(s) plus `— run \`concertino sync\` to add the missing
grant automatically` on `FAIL`. Never a `fail()`/hard error: a missing grant
degrades a run to the existing, safe `AGENT_MERGE = false`-equivalent manual
pause (via Decision 3's escalation) — it is not a broken config the way a
missing `gates` entry is.

### Decision 6: Docs

`docs/config-reference.md` gains a new `## agentMerge` section (placed after
`## budgets`, before `## providers`, mirroring the doc's existing top-to-
bottom config-key ordering) stating the two-part opt-in explicitly: (1) the
config default/override, exactly as `README.md` already documents it, and
(2) the harness-level grant `concertino sync` now maintains in
`.claude/settings.json` for Claude Code, spelling out that (1) alone never
authorizes an actual merge under Claude Code's auto mode. `README.md`'s
existing one-line agent-merge description (line 33) gets a trailing pointer
to the new config-reference section rather than being rewritten in place —
it already correctly says "opt-in toggle... that replaces the fourth
checkpoint", which stays true; it just doesn't yet say *how* that toggle
actually reaches the harness.

## Risks / Trade-offs

- **The `Task(concertino-auditor)` syntax may not be exactly what Claude
  Code's settings schema expects** → this is the central unverifiable-here
  risk (see Non-Goals). Mitigated by: (a) it degrades safely — a
  non-matching rule simply means the classifier still evaluates the spawn
  as it does today, no worse than before this change; (b) the orchestrator's
  pre-check (Decision 3) is grounded only in *this repo's own* file
  (`.claude/settings.json` actually containing the string `sync` wrote), so
  the pre-check itself is 100% correct and testable even if the underlying
  classifier-suppression premise turns out to need a follow-up ticket to
  correct the exact string.
- **Settings-file merge could clobber a hand-authored `.claude/settings.json`
  if the merge logic has a bug** → mitigated by reading-modifying-writing the
  whole parsed object (never a blind overwrite) and by the additive-only,
  never-remove policy (Decision 4) minimizing the blast radius of any bug to
  "one array gained two strings it shouldn't have," never data loss.
- **A project that never runs `concertino sync` after turning on
  `agentMerge.enabled`** → exactly the drift doctor/validate's new check
  (Decision 5) exists to catch, and exactly the case the orchestrator's
  pre-check (Decision 3) turns into a clean escalation instead of a mid-spawn
  surprise.

## Migration Plan

No migration for existing projects: `agentMerge.enabled` already defaults to
`false` (unaffected), and any project that already has it `true` simply gains
the grant (and, if `claude-code` isn't its harness, gains nothing — no-op) the
next time `concertino sync` runs. No schema version bump; `.claude/settings.json`
is additive/optional, matching this codebase's existing "config key absent →
behaves exactly as before" convention used throughout `collectConfigIssues`.
