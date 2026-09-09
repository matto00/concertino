## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold spawn. Round 1's two change requests and its non-blocking exec-bit note were re-derived from the artifacts and the trees, not from the round-1 narrative.

### What I verified (with evidence)

**CR1 (task 3.4 would have written to an owner-protected path) — genuinely fixed, not reworded.** `tasks.md` 3.4 now names the synthetic-exemption route (round-1's preferred option b), names both protected paths as untouchable, and states the concrete reason (the main checkout's path prefix contains this worktree). `design.md` Decision 7 records the rule at design level. `specs/rendered-script-drift-gate/spec.md` adds "Exemption evidence never writes to an owner-protected path" as a normative scenario, so the constraint survives into the capability rather than living only in a task. `tasks.md` 4.5 adds a pre-commit existence/untracked/byte-identity check on both files. The mechanism 3.4 depends on is also actually specified, not assumed: task 1.4 and the spec both require the exemption table to accept environment-supplied entries, so the synthetic entry needs no edit to the script under test. This is a real fix.

**CR2 ("decays loudly" asserted but unimplemented) — genuinely fixed.** CON-173 exists in Linear (fetched: "Rule on scripts/concertino/pricing-table.json and report-cost.sh…", team Concertino, status Backlog, created 2026-09-09, references CON-172, states the either/or and that either resolution deletes both entries). It is a real open ticket, not a placeholder id. `design.md` Decision 4 now says the opposite of what round 1 refuted — it explicitly concedes that a comment "sits inert indefinitely" and locates the decay mechanism externally in CON-173; the Risks entry says the exemption is indefinite until CON-173 resolves "and this design does not pretend otherwise". Tasks 1.4 seeds the reason text with the ticket id, and the spec now requires every entry to name "a tracked open question, not merely a free-text remark".

**Non-blocking exec-bit note — adopted, but on a false premise. This is the finding.** See CR1 below.

**Nothing else regressed.** AC coverage still traces (AC1→1.1-1.6, AC2→§3, AC3→1.5, AC4→1.2/spec, AC5→§2, AC6→2.7/3.4/4.5). Decisions 2, 3, 5 are unchanged and still check out. No new placeholders or TODOs.

### Verdict: REFUTE

One defect, introduced by the round-2 revision itself, and it is the kind that makes the gate red on arrival.

### Change Requests

1. **Decision 8's exec-bit comparison contradicts what `concertino sync` actually does, and would fail on a correctly-rendered file today.** Round 1's note asserted "`sync.js` has no `chmod` in its `write` path" — that is true of `sync.js` but the script copy does not go through `write()`. It goes through `copyAssets()` in `lib/cli/emit.js:446-451`:

   ```js
   copy(path.join(core, 'scripts', f), dest, dry);
   if (!dry && f.endsWith('.sh')) fs.chmodSync(dest, 0o755);
   ```

   Sync therefore forces **every** rendered `.sh` to `0o755` regardless of the core file's mode. Two consequences, both fatal to Decision 8 as written:

   (a) **The gate would be red on arrival on a fifth file the tasks do not touch.** `core/scripts/lib/git-child-env.sh` is mode `644` and `scripts/concertino/lib/git-child-env.sh` is mode `755`, with identical blob content. Reproduced three ways: `stat -c %a` in this worktree, `stat -c %a` in the main checkout, and `git ls-files -s`, which shows `100644 a1eff65… core/…` vs `100755 a1eff65… scripts/concertino/…` — i.e. it is committed index state, not a local filesystem artifact. `tasks.md` §2 enumerates only the four content-drifted files, so nothing in the plan clears this, and the spec's "The gate passes on the delivered branch" scenario would fail.

   (b) **The remedy the gate prints cannot fix the failure class.** On a mode mismatch the gate says "run `concertino sync`" (task 1.5), but sync re-chmods to `755` and would reproduce the exact mismatch on every run — an unclearable red with a remedy that does nothing. That is worse than the content-only gate it replaces.

   Required revision: restate Decision 8 in terms of the renderer's real contract instead of mode equality. The property `copyAssets` establishes is "every rendered `.sh` is executable" — so the gate should assert that the rendered `.sh` **is executable**, independent of core's mode, and not compare the two modes. Update `design.md` Decision 8 (including the now-false "`sync.js`'s `write` path has no `chmod`" premise, citing `lib/cli/emit.js:450` instead), `tasks.md` 1.3, and the spec's "A rendered copy has lost its executable bit" scenario, whose current WHEN ("core is executable and its rendered counterpart … is not") also does not describe the case actually present in the tree. If instead you intend mode equality, then §2 must gain a task normalising `lib/git-child-env.sh` **and** the change must alter `copyAssets`' unconditional chmod — which is a `concertino sync` behaviour change the design's Non-Goals explicitly rule out. The assert-executable framing is the one that fits the stated non-goals.

### Non-blocking notes

- `proposal.md` still describes the exemption reason as "owner has not ruled — see ticket.md", the bare-remark form round 1 refuted and that design/tasks/spec have all since replaced with the CON-173 citation. Stale one-liner, contradicts the three authoritative artifacts; worth a one-word edit for consistency.
- The environment-supplied exemption addendum (task 1.4, spec) is a new escape hatch: any caller setting that env var can suppress missing-counterpart failures for arbitrary paths. It is test-only in practice and cannot suppress a content mismatch, so it is not a hole worth blocking on — but it is a new trade-off and the Risks section does not mention it.
- Ordering nits: `design.md` places Decision 7 and 8 before Decision 6, and `tasks.md` places 4.5 before 4.4. Cosmetic only.
