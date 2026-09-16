## Context

See `proposal.md` — Why, and `ticket.md` — "Verified premise notes" for the reproduction and the
four facts established before scoping. The constraints that actually shape this design:

- **Rendering reads role templates from a resolved core.** `lib/cli/emit.js:243` renders via
  `read(path.join(core, 'roles', role + '.md'))`, where `core` comes from
  `resolveCore(repo, out, coreOverride)` in `lib/cli/resolve-core.js`. That resolution is
  non-trivial: it can pick the *target worktree's* own `core/` rather than the executing
  package's. `sync` does not honor `.concertino/roles/` overrides — only `eject` does
  (`lib/cli/eject.js:29,54`).
- **`lib/config.js` must not depend on `lib/cli/`.** `collectConfigIssues(cfg, opts)` receives
  only `out` (project root) and has no notion of a resolved core. The dependency direction is
  `lib/cli/* -> lib/config`, never the reverse; `lib/config.js` is deliberately
  dependency-free and side-effect-free at module scope.
- **`collectConfigIssues` is shared with the TUI.** `lib/ui/screens/settings.js` runs the same
  function for save-time validation and documents itself as pure ("this file never touches the
  filesystem itself"). A disk-reading check inside `collectConfigIssues` is nonetheless
  consistent: it already does `exists(path.join(out, d.path))` for this very field
  (`lib/config.js:666`). Purity belongs to the screen module, not to the validator.
- **The schema enum is unenforced.** `config/concertino.schema.json:102` caps `bindTo` to
  `["executor","evaluator","skeptic"]`, but nothing validates against it at runtime (no ajv; the
  schema is read only by `loadSchema`/`flattenSchema` for the settings screen). This is *why*
  today's broken config validates clean.
- **Two distinct failure directions exist.** `render.js:229`'s `default` arm returns
  `'{{block:' + name + '}}'` — an orphan placeholder leaks literal text into the rendered file,
  while an unwired binding vanishes silently. A complete fix must not trade one for the other.

## Goals / Non-Goals

**Goals:**

- A `canonicalDocs` entry bound to any of the five roles renders into that role's agent file.
- An unrenderable binding is a hard validation error naming the entry and the role.
- The mechanism is role-set-driven, so a future sixth role cannot silently reintroduce the gap.

**Non-Goals:**

- `agentMerge.protectedPaths` (CON-193) — related but explicitly out of scope.
- Teaching `sync` to honor `.concertino/roles/` overrides. Today only `eject` does; changing
  that is its own behavioral change and is recorded below as a follow-up, not folded in.
- Re-siting the three existing doc placeholders, or changing what `docList` emits.

## Decisions

### Decision 1: Derive the check from the role set, not from a hardcoded list of two

The validation asks, for each role named in a `bindTo`: does that role's template contain the
docs placeholder for it? This is computed from the canonical `ROLES` array already exported by
`lib/config.js:122` (`['orchestrator','executor','evaluator','skeptic','auditor']`), rather than
from a literal `['auditor','orchestrator']`.

*Why over the alternative:* a hardcoded pair fixes the two known instances and leaves scope
part 3 unmet — the ticket is explicit that the durable requirement is that a *future* role added
without a placeholder cannot reintroduce the gap. Deriving from `ROLES` makes the check total
over the role set by construction.

### Decision 2: The placeholder name is a pure, shared function of the role name

A single helper maps a role to its docs placeholder name (`auditor` -> `docsAuditor`), used by
both `render.js`'s switch and `config.js`'s validation, so the two cannot disagree about what
placeholder a role expects. A mapping duplicated in two files is a future drift bug of exactly
the kind CON-52 already cost this repo.

*Why over the alternative:* letting `render.js` keep an independent literal switch and having
validation guess the same names by convention would mean a rename in one file silently
invalidates the other — the check would then pass while rendering still dropped the doc.

### Decision 3: Validation reads role templates from the package's own `core/`, and degrades to silence if absent

`collectConfigIssues` resolves role templates at `path.join(REPO, 'core', 'roles', <role>.md)`
using the `REPO` constant `lib/config.js:22` already uses for `SCHEMA_PATH`. It must NOT
`require('./cli/resolve-core')` (Decision's Context: layering). If a template file cannot be
read, the check emits **no** error for that role.

*Why fail-silent on a missing template specifically:* `collectConfigIssues` runs from the TUI and
from `validate` in consuming repos where `REPO` is `node_modules/concertino` — the core is
present there, but an eject/vendoring topology could leave it absent. An unreadable template is
an environment fact, not a config defect, and turning it into a config error would fail a
*correct* user config for a reason the user cannot act on. The unreadable-template case is
therefore the one arm that does not fail closed, and that is deliberate and bounded: it is
strictly the "we cannot tell" case, never the "placeholder is missing" case.

*Accepted limitation, stated plainly:* because validation reads the package core while rendering
may resolve a *worktree's* core (`resolve-core.js`), the two can in principle consult different
template sets in the narrow same-superproject-worktree topology. Closing that would require
inverting the layering. The residual risk is low — role templates diverging between a worktree
and its own package core is precisely the case `resolveCore` already prints a divergence note
for — and it is recorded as a follow-up rather than silently ignored.

### Decision 4: Site each placeholder where the document is actually consumed

- **Auditor** — immediately after `## Evidence discipline (binding)` and *before*
  `## The four conditions a safe merge requires` (`core/roles/auditor.md`, around line 49). The
  ticket is explicit that it must precede the merge decision; a doc listed after
  `### Merging` would be read only once the merge had already happened, which is the bug in a
  different costume.
- **Orchestrator** — in `## Phase 1: Planning`, at the point the orchestrator authors the
  planning artifacts, since that is where a standards document actually bears on its output.

Both follow `core/roles/executor.md:50-52`'s established convention: a short "read the relevant
one at the moment you need it, not from memory" lead-in followed by the placeholder.

### Decision 5: Widen the schema enum in the same change

`config/concertino.schema.json:102`'s `bindTo` enum grows to all five roles. Although unenforced
today, leaving it would make a now-working binding schema-invalid, and would mislead the settings
screen and any future validator. Additive only — no previously valid config becomes invalid.

## Risks / Trade-offs

- **[Consuming repos gain a new hard error]** -> A repo whose `bindTo` names an unsupported role
  now fails validation where it previously passed. This is the intended behavior and surfaces a
  binding that was already a silent no-op. No repo's *working* configuration breaks, and helio's
  two entries (executor/evaluator, executor/evaluator/skeptic) are unaffected.
- **[Validation and rendering could read different cores]** -> Bounded and documented in
  Decision 3; a follow-up, not a fold-in.
- **[Mutation evidence is mandatory, not optional]** -> Each new failure arm must be proven by
  removing the guard and observing the test go red. The acceptance criteria call this out
  because a test that can only ever pass is not evidence. This applies to all three arms:
  missing placeholder, unknown role, and the render coverage itself.
- **[Placeholder added without a switch case]** -> Would leak literal `{{block:...}}` text via
  `render.js:229`. Decision 2's shared mapping plus render-coverage assertions over all five
  roles guard both directions.

## Migration Plan

No data migration. Consuming repos pick this up on their next `concertino sync`.

**Does helio need a `concertino sync` afterwards?** *Functionally, no.* helio's two
`canonicalDocs` entries bind only to `executor`, `evaluator`, and `skeptic` — all three already
wired — so its rendered agent files are byte-unchanged in the doc-list regions, and its config
raises no new validation error. A sync would still be *beneficial* to pick up the two new role
placeholders (rendering "(none configured)" in its orchestrator/auditor files) and would become
*required* the moment helio binds anything to `orchestrator`/`auditor`. Per this run's brief,
no sync is run against helio here; that remains the driver's call.

**This repo's own rendered artifacts:** `/.claude/agents/concertino-*.md` are gitignored, so no
re-rendered agent file is committed. `core/scripts/` is untouched, so the tracked
`scripts/concertino/` render and `rendered-scripts-drift.test.sh` are unaffected.

## Open Questions

None blocking. Two follow-ups deliberately excluded from this change:

1. `sync` does not honor `.concertino/roles/` overrides though `eject` does — which makes the
   ticket's own suggested workaround ("forking the role via `.concertino/roles/`") ineffective
   for a sync-rendered role. Worth its own ticket.
2. This repo's `specProvider.validateCmd` is `openspec validate --change "<CHANGE_NAME>"`, which
   openspec 1.10.0 rejects with `unknown option '--change'`. Separately, `openspec validate`
   exits 0 even when reporting errors, so its exit status is not a usable gate — output must be
   parsed. Both are pre-existing defects in this repo's own workflow config, unrelated to this
   capability.
