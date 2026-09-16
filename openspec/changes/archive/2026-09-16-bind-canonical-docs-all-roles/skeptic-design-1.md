## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Claim 1** — `lib/cli/render.js` lines 44-47: `docList` switch has exactly `docsExecutor`/`docsEvaluator`/`docsSkeptic` cases, no `docsAuditor`/`docsOrchestrator`. Confirmed by direct read.
- **Claim 2** — `grep -n "block:" core/roles/auditor.md` returns only `cwdGuard` and `subagentEscalationNotify`; `core/roles/orchestrator.md` returns `harnessResume`, `ticketProvider`, `specScaffold`, `specArtifacts`, `standaloneTicket`, `specArchive`, `agentMergePermissionCheck`, `hygiene`. No docs placeholder in either. Confirmed.
- **Claim 3** — `lib/config.js:657-670` (canonical-docs section) validates `path`/`bindTo` presence and file existence only; no check that a `bindTo` role has a placeholder to receive it. Confirmed.
- **Claim 4** — `lib/config.js:122`: `const ROLES = ['orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor'];`, exported at line 895. Confirmed.
- **Claim 5** — `grep -n "require(" lib/config.js` shows only `fs`, `path`, `child_process`; no `require('./cli/...')`. Layering direction intact. Confirmed.
- **Claim 6** — `lib/config.js:666`: `exists(path.join(out, d.path))` — filesystem touch already present in this function. Confirmed.
- **Claim 7** — `config/concertino.schema.json:102`: `"bindTo": { "type": "array", "items": { "enum": ["executor", "evaluator", "skeptic"] } }` — 3-role enum, and no ajv/schema enforcement is wired at runtime (only referenced by `loadSchema`/`flattenSchema` for the settings screen per design.md, not independently re-verified by me but consistent with the absence of any ajv `require` in `lib/config.js`). Confirmed.
- **Claim 8** — `render.js:229`: `default: return '{{block:' + name + '}}';`. Confirmed.
- **Claim 9** — `lib/cli/emit.js:242-243` renders via `read(path.join(core, 'roles', role + '.md'))` against a `core` resolved elsewhere in the function (consistent with `resolveCore` usage described in design.md); `lib/cli/eject.js:28-29,53-54` are the only sites referencing `.concertino/roles/` override paths — `emit.js`'s render loop has no such reference. Confirmed sync does not honor role overrides; only eject does.
- **Placeholder siting geometry** — `core/roles/auditor.md`: `## Evidence discipline (binding)` at line 35, `## The four conditions a safe merge requires` at line 49, `### Merging (only on all four conditions holding)` at line 231. A placeholder inserted between lines 35-49 genuinely precedes the merge-decision section by a wide margin — Decision 4's siting claim holds. `core/roles/orchestrator.md`: `## Phase 1: Planning` at line 583, a real planning-authoring section — plausible siting for `docsOrchestrator`.

### Design judgment

**Scope part 3 (hard-fail validation) closes the class, not just the two instances.** Decision 1 derives the role-coverage check from the exported `ROLES` const rather than a hardcoded `['auditor','orchestrator']` pair, and Decision 2's shared role→placeholder-name helper is consumed by both `render.js` and `config.js`, per tasks.md 1.1/2.1/3.1. A future sixth role added to `ROLES` without a matching template placeholder is caught by the same mechanism that catches today's two cases — this is a real class-closing design, not signature-matching on the known bug.

**Decision 3's fail-silent arm is a correctly-bounded "cannot tell" case, not a hole that reintroduces the bug.** It fires only when the role template file itself is unreadable (a topology fact — missing/vendored core), never when the template is readable but lacks the placeholder (which is the actual "placeholder missing" failure and correctly hard-fails per 3.1). The design honestly discloses a narrower residual risk: validation reads `REPO`'s own `core/roles/`, while rendering may resolve a worktree's own `core/` via `resolveCore` — in the narrow same-superproject-worktree topology, these two could diverge, letting a binding pass validation using one template set while rendering with another. This is disclosed as an accepted limitation and recorded as a follow-up rather than hidden. It is a legitimate, bounded gap for a design gate, not a silent recreation of the shipped bug — the two-file-agreement mechanism (Decision 2) is what actually prevents the ordinary-repo case.

**Auditor siting is genuinely achieved.** Confirmed above by line-number geometry: the specified insertion point (between "Evidence discipline" and "four conditions") sits ~180 lines before "### Merging", satisfying the ticket's "before the merge decision" requirement in substance, not just by claim.

**Mutation-evidence planning in tasks.md section 5 is adequate.** It covers all three concrete failure arms the AC calls out: missing-placeholder (5.2), unknown-role (5.3), and render-coverage (5.4/2.1's revert-one-case check), each specified as red→restore→green, plus a positive render-coverage assertion across all five roles (5.1) and the "(none configured)" default-arm guard (2.4) covering the opposite failure direction named in design.md Risks. Task 5.5 requires the full `npm test` chain with a pasted summary.

**No unstated assumption found that would produce a passing-but-worthless test.** The design explicitly guards against both failure directions (silent drop vs. leaked literal placeholder), ties render.js and config.js to one shared mapping so they cannot silently diverge, and derives the check from the same role enumeration used elsewhere in the codebase rather than inventing a parallel list.

### Verdict: CONFIRM

### Non-blocking notes
- The disclosed core-resolution mismatch (Decision 3's "Accepted limitation") between validation's `REPO`-based read and rendering's `resolveCore`-based read is real, if narrow. Worth a one-line addition to design.md's Open Questions cross-referencing this as a specific known limit of the current fix, rather than only appearing inside Decision 3's prose — but this is cosmetic; the substance is already recorded.
- tasks.md 3.3's fail-silent arm should make sure its unit test asserts "no error is produced" specifically for the missing-placeholder condition being suppressed by an unreadable core, not merely that validation doesn't crash — this is implied by task 3.3's own wording but worth the executor double-checking against Decision 3's exact framing ("cannot tell" vs "placeholder missing") when it writes the test.
