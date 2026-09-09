## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold spawn. Every claim below was re-derived from the trees and from `lib/cli/emit.js`, not from the round-2 narrative or the orchestrator's summary.

### What I verified (with evidence)

**The round-2 CR is fixed correctly, not merely responsively.**
- Re-read `lib/cli/emit.js:441-451`: `copyAssets()` does `copy(...); if (!dry && f.endsWith('.sh')) fs.chmodSync(dest, 0o755);` — sync forces every rendered `.sh` to 0755 irrespective of core's mode. Decision 8's premise now matches the source it cites, including the `copyAssets()`-not-`write()` distinction.
- `git ls-files -s` confirms the exact case that would have been red under mode equality: `100644 core/scripts/lib/git-child-env.sh` vs `100755 scripts/concertino/lib/git-child-env.sh`, identical blob. It is committed index state, not a local artifact.
- The corrected framing is green on arrival, measured rather than assumed: `find scripts/concertino -name '*.sh' ! -perm -u+x` returns **nothing** — every rendered `.sh` in the tree is already executable, so "assert the rendered `.sh` is executable" passes today on all 20 rendered scripts without any task in §2 touching modes beyond the four files being re-rendered.
- Spec now carries both directions: "A rendered script is not executable" (fails, "whatever the mode of its core counterpart") and "A non-executable core file with an executable render is not reported". The second scenario is the one that pins the corrected semantics and would fail a mode-equality implementation. `tasks.md` 1.3 and 2.5 match, and 3.2b demands both halves of the evidence (clear a bit → red; `lib/git-child-env.sh`'s 644-vs-755 → not reported). That is a failable demonstration, not an assertion.

**Nothing new was introduced; the plan's file set matches the tree exactly.** I enumerated `core/scripts/**` and compared against `scripts/concertino/**` myself: DIFFERS = `README.md`, `check-merge-readiness.sh`, `cleanup.sh`, `squash-branch.sh` (exactly tasks 2.1-2.4); MISSING = `pricing-table.json`, `report-cost.sh` (exactly the two seeded exemptions). No fifth stale file, no unaccounted missing file. So the gate as designed is green on arrival on all three axes (content, missing, executable).

**Round-2's three non-blocking notes were taken and are real.** `proposal.md` now reads "reason: owner has not ruled — tracked by CON-173, filed by this change's design gate" (the stale "see ticket.md" line is gone). Risks now carries "The environment-supplied exemption addendum is a new escape hatch", naming the arbitrary-path suppression, its test-only purpose, and that it cannot suppress a content mismatch. CON-173 re-fetched from Linear independently: real, open (Backlog, team Concertino, created 2026-09-09), states the either/or and that either resolution deletes both entries — so Decision 4's external decay mechanism is grounded.

**Prior rounds' fixes did not regress.** Decision 7 and the "Exemption evidence never writes to an owner-protected path" spec scenario are intact; task 3.4 still names both protected absolute paths and the worktree-prefix hazard; 4.5 still re-checks existence/untracked/byte-identity before commit. AC1→1.1-1.6, AC2→§3 + the failable-by-mutation requirement, AC3→1.5, AC4→1.2 + spec, AC5→§2, AC6→2.7/3.4/4.5. No TODO/TBD/placeholder anywhere in the artifacts.

**Mechanical:** `npx openspec validate rendered-scripts-drift-gate --type change` → "is valid".

### Verdict: CONFIRM

### Non-blocking notes

- `tasks.md` 1.3 says "collect content mismatches and non-executable renders and missing counterparts into **two** separate lists" (three conditions, two lists), and 1.5 names only the `content differs` and `never rendered` headings. An implementer could reasonably either add a third heading or fold non-executable under `content differs`. Both readings satisfy the spec ("SHALL name the offending path") and both print the correct remedy (`concertino sync` does re-chmod), so this is a diagnostic-clarity nit, not a correctness fork. A third heading reads better.
- Task 1.6 says to register "in the existing `bash test/scripts/*.test.sh` sequence"; `package.json`'s `test` is an explicit `&&` chain of named files, not a glob. Harmless, but the phrasing invites a moment's confusion.
- `ticket.md`'s recorded-decision paragraph still writes the exemption reason as "owner has not ruled — CON-172"; design/tasks/spec/proposal all say CON-173. `ticket.md` is the input artifact rather than a render target, so I would not edit it, but the seeded string in the implementation must be the CON-173 form.
- Round-2's ordering nits (Decision 7/8 before 6; task 4.5 before 4.4) remain. Cosmetic, agreed.
