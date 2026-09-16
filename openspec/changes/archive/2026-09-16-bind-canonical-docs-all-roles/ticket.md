# CON-195: canonicalDocs bound to auditor or orchestrator validates as configured but is never rendered

## Description

A `canonicalDocs` entry whose `bindTo` includes `auditor` or `orchestrator` is accepted by config validation, reported by `concertino validate` as bound to those roles, and **then silently dropped**. The document never appears in the rendered agent file.

`lib/cli/render.js` wires the `docList(role)` helper to exactly three placeholders:

```js
case 'docsExecutor':  return docList('executor');
case 'docsEvaluator': return docList('evaluator');
case 'docsSkeptic':   return docList('skeptic');
```

There is no `docsAuditor` or `docsOrchestrator` case, and no corresponding `{{block:}}` placeholder exists in `core/roles/auditor.md` or `core/roles/orchestrator.md`. Their placeholder sets are:

- `auditor.md` — `cwdGuard`, `subagentEscalationNotify`
- `orchestrator.md` — `harnessResume`, `ticketProvider`, `specScaffold`, `specArtifacts`, `standaloneTicket`, `specArchive`, `agentMergePermissionCheck`, `hygiene`

So the binding has nowhere to land.

### Why this is Urgent rather than cosmetic

**The auditor is the role that merges.** A repo that binds its code-quality standard, its design standard, or its rules document to the auditor gets a merge decision made by an agent that was never shown any of them — while `validate` reports the binding as present. The failure is invisible from the config, invisible from the validate output, and only discoverable by grepping the rendered agent file.

Reproduced in a consuming repo: a `canonicalDocs` entry with `"bindTo": ["orchestrator","executor","evaluator","skeptic","auditor"]` renders into three of the five. `grep -c CHARTER .claude/agents/concertino-auditor.md` gives `0`; same for the orchestrator. The three wired roles give `1` each.

helio does not hit this only because its two entries bind to `["executor","evaluator"]` and `["executor","evaluator","skeptic"]`.

## Scope

1. Add `docsAuditor` and `docsOrchestrator` cases to the `docList` switch in `lib/cli/render.js`.
2. Add the corresponding `{{block:docsAuditor}}` / `{{block:docsOrchestrator}}` placeholders to `core/roles/auditor.md` and `core/roles/orchestrator.md`, sited where a bound document should actually be read — for the auditor, before the merge decision.
3. **Make a binding that cannot render a hard validation error rather than a silent no-op.** This is the part that matters beyond the two missing cases: validation currently reports a binding as configured without checking that a placeholder exists to receive it. Any future role added without a docs placeholder reintroduces the same silent gap.

## Acceptance criteria

- A `canonicalDocs` entry bound to `auditor` appears in the rendered `concertino-auditor.md`; same for `orchestrator`.
- `concertino validate` fails, naming the entry and role, when a `bindTo` target has no placeholder to render into.
- Existing bindings to executor/evaluator/skeptic are unchanged.
- Every failure arm carries mutation evidence: the validation error is proven to fire by removing it and watching the test go red. A test that can only pass is not evidence.

## Verified premise notes (orchestrator, Setup step 2)

The premise was reproduced end-to-end before any branch was derived; full evidence is at
`.concertino/runs/CON-195/evidence/premise-validation.md`. Verdict: no-drift. Every claim in
the ticket held. Four facts established there that materially change the work:

1. **The bug is reproducible exactly as described.** A config binding a doc to all five roles
   passes `concertino validate` at exit 0 (printing all five role names), and a real `sync`
   then renders it into 3 of 5: executor/evaluator/skeptic `1`, orchestrator/auditor `0`.
2. **`config/concertino.schema.json:102` is additional, unstated scope.** It declares
   `bindTo` items as `enum: ["executor","evaluator","skeptic"]`, excluding `auditor` and
   `orchestrator`. That enum is NOT enforced at runtime — there is no ajv or any validator;
   the schema is loaded only via `loadSchema`/`flattenSchema` for the TUI settings screen —
   which is precisely why the broken config validates clean today. The enum must be widened
   as part of this change, or a now-correct binding becomes schema-invalid the moment it works.
3. **`AGENTS.md` is a render target, not a standard.** All 71 lines sit inside
   `CONCERTINO:BEGIN`/`CONCERTINO:END` and are written by `lib/cli/emit.js:264`. Do not
   hand-edit it. The binding standards for this change are `CONTRIBUTING.md` and
   `.concertino/laws/`.
4. **Where the validator must read role templates from.** `lib/cli/emit.js:243` renders via
   `read(path.join(core, 'roles', role + '.md'))` against the core resolved by
   `lib/cli/resolve-core.js`, with no override handling — `sync` does NOT honor
   `.concertino/roles/` overrides (only `eject` does, `lib/cli/eject.js:29,54`). Any
   placeholder-coverage check must therefore read templates from the same resolved core that
   rendering reads, not from a hardcoded package-relative path and not via the override path.

Two constraints on scope part 3, established in the same pass:

- `collectConfigIssues(cfg, opts)` (`lib/config.js`) receives only `out` (the project root).
  It has no access to the resolved `core/`, and `lib/config.js` is deliberately
  dependency-free (`lib/cli/*` depends on `lib/config`, never the reverse) — so it must not
  `require('./cli/resolve-core')`.
- That same function is shared with the TUI settings screen's save-time validation. This is
  not a blocker: `collectConfigIssues` already touches the filesystem for this very field
  (`exists(path.join(out, d.path))` at `lib/config.js:666`), so a disk-reading check has
  direct precedent. `lib/ui/screens/settings.js` itself stays pure.
