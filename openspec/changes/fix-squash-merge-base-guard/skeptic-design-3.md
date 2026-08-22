## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Cold re-derivation from the real files; the design doc's own claims about the
codebase were re-checked, not taken on faith.

- **CR-1 (no hardcoded change-dir in the script) — fixed, and the mechanism it
  relies on is real.** Every premise the fix rests on is true in ground truth:
  `lib/cli/render.js:202` is `text.split('<change-dir>').join(c.specProvider.changeDir)`
  — the token exists and is substituted into role prose. `lib/cli/emit.js:426-428`
  (`copyAssets`) copies `core/scripts/**` with `copy(...)` only, no `renderBody`,
  so scripts genuinely receive no substitution. `config/concertino.schema.json:42`
  defaults `changeDir` to `openspec/changes/<CHANGE_NAME>` and `lib/cli/init.js:135`
  emits `spec/changes/<CHANGE_NAME>` for `specProvider.kind: 'none'` (also present
  in `config/examples/generic.json:6` and `opencode-ollama.json:6`), so it is
  genuinely configurable. The artifacts now match: tasks.md 1.1 adds `<CHANGE_DIR>`
  to the usage line with an explicit "NEVER hardcodes" note, 1.4 derives both the
  allowlist glob and the `files-modified.md` path from it, 2.1 has the
  orchestrator prose pass the `<change-dir>` token, design.md D2 item 1 is
  rewritten from "baked into the script" to caller-supplied, and proposal.md +
  `specs/delivery-squash-guard/spec.md` (requirement text and the
  workflow-artifact scenario) both say "caller-supplied ... never hardcoded".
- **The convention it mirrors is real.** `core/scripts/next-report-number.sh`
  header: `Usage: next-report-number.sh <change-dir> <kind>`; call sites
  `core/roles/skeptic.md:124` and `core/roles/evaluator.md:178` pass
  `"WORKTREE_PATH/<change-dir>"`. The rendered value still carries a runtime
  `<CHANGE_NAME>` placeholder the agent fills — identical to how the existing
  callers work, so 2.1's call site is consistent, not a new idiom. I ran the
  script myself to number this report; it behaved as documented.
- **CR-2 (stale Goals bullet) — fixed.** design.md Goals bullet 2 now reads
  "compared against the union of a caller-supplied change-dir allowlist and the
  parsed `files-modified.md` declaration". No surviving statement of the
  pre-union rule anywhere in design.md; the document states one rule.
- **No regression of round 1/2 fixes.**
  - D3: still logs-only, still carries "Confirmed at design-gate round 1 — do
    not revisit"; tasks 1.3 still says "This is a log only — it never blocks or
    requires a rebase". No forced rebase reintroduced.
  - Ground-truth path: `core/roles/orchestrator.md` exists, `core/agents/` does
    not; `sed -n '768,784p' core/roles/orchestrator.md` shows Phase 3 step 1 at
    ~775 as bare prose with no git command, matching Context and tasks 2.1.
    `grep -rn "reset --soft" core lib scripts test` → zero hits (the improvised
    command is nowhere in the repo, as the design asserts).
  - Test wiring/naming: `ls test/scripts` is uniformly `<name>.test.sh` (30
    files); the only `*.selftest.sh` in the repo is
    `core/scripts/lib/git-child-env.selftest.sh`. `package.json`'s `test` is a
    hand-maintained `bash test/scripts/*.test.sh` chain, so task 3.8's append is
    still required and still correctly framed as append-don't-reorder.
  - Scope: proposal Impact and design Non-Goals still exclude `cleanup.sh`,
    `check-merge-readiness.sh`, CON-128/131/132/121, HEL-764. No artifact touches
    them. Nothing new crept in this round.
- **Round 2's follow-on suggestion was adopted.** tasks 3.5 and 3.7 now both
  specify a NON-default change-dir fixture (`spec/changes/<name>`), so the new
  `<CHANGE_DIR>` parameterization is actually exercised by the acceptance test
  rather than merely intended — the parameterization cannot silently rot.
- **Design remains implementable.** No `TODO`/`TBD`/deferred decision remains;
  Open Questions is empty and the D2b count-only case is decided, not parked.
  Every ticket AC traces to a task: AC1→1.2/3.3, AC2→1.3/D3, AC3→1.4/3.5/3.7,
  AC4→1.5/3.6, AC5→3.1-3.4/4.1-4.2.

### Verdict: CONFIRM

Both round-2 change requests are genuinely applied and independently
corroborated against the source files they cite. Nothing round 1 or round 2
fixed has regressed. The remaining nits below are wording-level and cannot
mislead an implementer, so they are not blocking.

### Non-blocking notes

- design.md D5 still cites the selftest convention as
  `lib/git-child-env.selftest.sh`; the real path is
  `core/scripts/lib/git-child-env.selftest.sh` (carried over from round 2's
  non-blocking note). Cosmetic — the naming decision it supports is correct.
- The word "fixed" survives as a modifier on the allowlist in a few places
  (tasks 1.4 bullets 3-4, spec scenarios 1/2/4: "outside the fixed allowlist").
  Since the same task/requirement defines it two lines earlier as the
  caller-supplied `<CHANGE_DIR>/**`, "fixed" reads as "the constant part of the
  union" and is unambiguous — but "change-dir allowlist" would be cleaner and
  removes any residual echo of the round-2 defect's phrasing.
