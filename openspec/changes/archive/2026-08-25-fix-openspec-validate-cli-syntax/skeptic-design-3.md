## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Round-2's single blocking CR — the vacuous `--dry-run` render verification — is genuinely applied, and I re-measured the underlying facts myself rather than trusting the narrative.

- **`--dry-run` removed, real `--out` sync in its place.** design.md Decision 4 now carries the `OUT="$(mktemp -d)"; node bin/concertino sync --out="$OUT" ...` block plus an explicit "**`--dry-run` must NOT be used for this**" paragraph. Decision 6 and tasks 7.1 / 8.2(a) match. No `--dry-run` remains anywhere in the render-verification path (only in the unrelated pre-existing `test:selftest` script, which this change does not claim as evidence).
- **The 0-vs-47 measurement is real, re-measured by me.** `sync --out=<mktemp -d> --config=config/examples/helio.json --dry-run` → `0` files; the same command without `--dry-run` → `47` files. The plan's stated numbers are exact.
- **The "4 occurrences / assert total absence" claim is real.** `grep -c 'validate --change'` on the rendered `$OUT/.claude/agents/concertino-orchestrator.md` → `4`. The rendered path asserted in task 7.2 (`.claude/agents/concertino-orchestrator.md`) exists in the real render output. So the exists-and-non-empty precondition (7.2, 8.2b) is checkable and the absence assertion is non-trivial.
- **The `hasnt`-is-vacuous-on-missing-file rationale is accurate.** `test/scripts/auditor-render.test.sh:22`: `hasnt(){ if grep -qF "$2" "$3" 2>/dev/null; then bad ...; else ok ...; fi; }` — returns `ok` when the file does not exist. Decision 6's justification for the exists precondition is correct, not hand-waved.
- **Enumeration is accurate and complete.** My own `grep -rn 'validate --change\|validateCmd'` (excluding `node_modules`, `.concertino/worktrees`, `openspec/changes/archive`) returns exactly the seven table rows in Decision 4 at exactly the stated lines: `docs/config-reference.md:258`, `lib/cli/render.js:75`, `lib/cli/init.js:132`, `core/roles/orchestrator.md:582` and `:868`, `openspec/specs/followup-triage/spec.md:101`, `config/examples/concertino.json:19`, `config/examples/helio.json:11`. No eighth location. `config-reference.md:269` is a table row that does not quote the command (task 3.5's parenthetical handles it correctly). `proposal.md` now says "seven tracked locations" — the round-2 "five" staleness is fixed.
- **CLI surface re-verified independently.** `openspec --version` → `1.2.0`; `openspec validate --help` → `Usage: openspec validate [options] [item-name]`, offers `--type <type>` and `--changes`, and has no `--change`. Decisions 1, 2 and 5 rest on true premises.
- **Spec delta present and coherent.** `specs/spec-provider-commands/spec.md` has three ADDED requirements with scenarios covering the render fallback, the `init` scaffold, red-on-malformed with non-zero exit, and the stated-version + trust-`--help` rule. Each maps to tasks (3.x, 4.x, 5.x, 6.x, 8.x); no AC is uncovered and no task is outside the ticket.
- **No new defect introduced by the round-2 edits.** tasks.md 7.x/8.x are internally consistent with Decisions 4 and 6; 8.4 (prove-it-fails with a numeric exit code) and 8.5 (non-vacuous assertion count) close the two ways this test could otherwise ship green-and-worthless.

### Verdict: CONFIRM

The design is sound enough to implement. The round-2 objection is fully and correctly resolved, with the measurements it rests on independently reproduced here.

### Non-blocking notes

- **One wrong line citation in tasks.md 2.1.** It cites `core/roles/orchestrator.md:904` as the non-invocation prose mention of `openspec validate`. Ground truth: line 904 is unrelated `openspec archive` fold-in prose; the actual non-invocation mention is **`core/roles/orchestrator.md:854`** ("`openspec validate` cannot operate on an…"). This is not blocking — 2.1's instruction is to derive the audit from a fresh `grep -rn 'openspec ' core/roles/`, and the citation is a parenthetical example — but the executor should record `:854` in the audit table and not go looking for anything at `:904`.
- `npm run test:selftest` (package.json:24) is itself a `--dry-run` sync, i.e. it writes nothing and asserts nothing. Out of scope for CON-130, but it is the same vacuity class this change just designed around and is worth a follow-up ticket.
