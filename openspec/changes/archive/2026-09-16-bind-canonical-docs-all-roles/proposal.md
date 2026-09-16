## Why

A `canonicalDocs` entry bound to `auditor` or `orchestrator` passes `concertino validate`, is
reported by it as bound to those roles, and is then silently discarded at render time — the
document never reaches the agent file. The auditor is the role that *merges*, so a repo that
binds its code-quality standard, design standard, or rules document to the auditor gets merge
decisions from an agent that was never shown any of them, while `validate` reports the binding
as present. The failure is invisible from the config and invisible from the validate output; it
is discoverable only by grepping a rendered agent file.

Reproduced end-to-end before this change was scoped: a doc bound to all five roles validates at
exit 0 listing all five, then renders into three (`executor`/`evaluator`/`skeptic` = 1,
`orchestrator`/`auditor` = 0).

## What Changes

- Wire `docsAuditor` and `docsOrchestrator` into the `docList` switch in `lib/cli/render.js`, so
  a doc bound to either role renders like the three already-wired roles.
- Add `{{block:docsAuditor}}` to `core/roles/auditor.md`, sited **before** the merge decision, and
  `{{block:docsOrchestrator}}` to `core/roles/orchestrator.md`, sited where the orchestrator
  authors planning artifacts — a bound doc must be read at the point it applies, not filed at the
  end of the role.
- Replace the silent no-op with a **hard validation error**: `collectConfigIssues` fails, naming
  the entry and the specific role, when a `bindTo` target has no docs placeholder to render into.
  This is the durable half — it closes the class, not just the two instances, so a future role
  added without a docs placeholder cannot silently reintroduce the gap.
- Widen `config/concertino.schema.json`'s `canonicalDocs.bindTo` item enum from
  `["executor","evaluator","skeptic"]` to all five roles. Not in the ticket's scope list, but
  required: the enum currently excludes the two roles being fixed, so a now-correct binding would
  be schema-invalid the moment it starts working.

## Capabilities

### New Capabilities

- `canonical-docs-binding`: every role a `canonicalDocs` entry can be bound to must have a
  placeholder that receives it, and a binding that cannot render must fail validation loudly
  rather than be dropped silently.

### Modified Capabilities

<!-- None. The only existing spec mentioning canonicalDocs is settings-screen/spec.md, whose
     requirements concern that field's editability in the TUI, not binding-to-render coverage.
     No existing requirement changes. -->

## Impact

- `lib/cli/render.js` — two new `docList` cases.
- `core/roles/auditor.md`, `core/roles/orchestrator.md` — one new placeholder each.
- `lib/config.js` — new placeholder-coverage check in `collectConfigIssues`, which is shared with
  the TUI settings screen's save-time validation. Precedent exists: that function already reads
  the filesystem for this very field (`exists(path.join(out, d.path))`).
- `config/concertino.schema.json` — `bindTo` enum widened to all five roles.
- Consuming repos: a repo with an `auditor`/`orchestrator` binding starts rendering that doc on
  its next `concertino sync`. No consuming repo is broken by the new validation error, because an
  unrenderable binding was already a no-op — the error surfaces a defect that was already there.
  helio is unaffected either way: its two entries bind only to executor/evaluator/skeptic.
- Rendered artifacts in this repo are gitignored (`/.claude/agents/concertino-*.md`), so no
  re-rendered agent file is committed here; `core/scripts/` is untouched, so the tracked
  `scripts/concertino/` render and its drift gate are unaffected.
