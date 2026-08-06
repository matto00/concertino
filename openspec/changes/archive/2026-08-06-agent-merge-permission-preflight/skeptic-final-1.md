## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/agent-merge/spec.md`, `files-modified.md`, `evaluation-1.md` in full
  from the worktree (not from another agent's narrative).
- `git diff main...HEAD --stat` — 24 files changed, matches
  `files-modified.md`'s list exactly (`lib/config.js`, `lib/cli/{doctor,emit,
  render}.js`, `core/roles/orchestrator.md`, `core/scripts/` +
  `scripts/concertino/check-agent-merge-permission.sh` (byte-identical, diffed
  directly), `docs/config-reference.md`, `README.md`, `package.json`, new/
  updated tests). No scope creep.
- Ran `npm test` fresh in the worktree: `node --test` → 1568/1568 passed;
  all `test/scripts/*.test.sh` including the two new suites
  (`check-agent-merge-permission.sh`: 16/16, `agent-merge permission grant
  rendering`: 19/19) passed. Matches evaluation-1.md's claimed numbers
  exactly — reproduced, not just trusted.
- Read `lib/config.js` (`agentMergePermissionRules`, `checkAgentMergePermission`,
  the new "Agent-merge" section in `collectConfigIssues`), `lib/cli/emit.js`
  (`mergeAgentMergeSettings`), `lib/cli/doctor.js` (`checkAgentMerge`),
  `lib/cli/render.js` (`agentMergePermissionCheck` block case), and the
  `core/roles/orchestrator.md` diff (Phase 3 step 7 insertion + circuit-
  breaker table row + escalation-point bullet) in full — each traces
  cleanly to the design.md decision it implements (rule strings, main-
  checkout resolution matching `check-merge-readiness.sh`'s exact
  `main_checkout()` helper — diffed byte-for-byte identical — sync-time
  `{{block:...}}` gating, not a nonexistent runtime `harness` field).
- Diffed `core/scripts/check-agent-merge-permission.sh` against
  `scripts/concertino/check-agent-merge-permission.sh`: identical (packaging
  claim verified, not assumed).
- Confirmed `config/concertino.schema.json`'s existing `agentMerge` block
  needed no change (verified: no new field required by anything shipped).
- Traced all four ACs:
  1. **doctor/validate warn on a missing grant** — `lib/config.js`'s
     "Agent-merge" section and `lib/cli/doctor.js`'s `checkAgentMerge`, both
     via the shared `checkAgentMergePermission`. Traced to real code and
     exercised it live (see Change Request 1 below — this AC is **not**
     cleanly met in one common, unaccounted-for scenario).
  2. **Orchestrator asks before spawning, not after a denial** —
     `{{block:agentMergePermissionCheck}}` inserted immediately before the
     auditor spawn in `core/roles/orchestrator.md`; `render.js`'s new case
     renders `PASS`→spawn / `FAIL`→escalate(`retry`,`fallback`) prose for
     `claude-code`, N/A prose for codex/opencode. Traced and consistent with
     spec.md's scenarios. Met.
  3. **Docs state the two-part opt-in plainly** — read the new `##
     agentMerge` section in `docs/config-reference.md` and the `README.md`
     one-liner's added pointer in full; both state the split accurately and
     specifically (grant rules named, `concertino sync` named as the
     maintainer). Met.
  4. **`AGENT_MERGE = false` fallback unchanged** — `git diff` shows the
     `AGENT_MERGE = false` branch of `orchestrator.md` untouched; the new
     escalation's `fallback` option explicitly lands on it (spec.md's "A
     permission-grant fallback lands on the identical flow" scenario,
     matched in the orchestrator prose diff). Met.

### Live reproduction — a real gap in AC1

I did not stop at re-running the test suite; I exercised the actual CLI
against fresh throwaway projects to see what a human opting into agent-merge
for the first time would actually see, since this is exactly the failure
mode CON-73/this ticket is about ("a mismatch... becomes a diagnosable
config error, not a surprise").

Reproduced **three times**, independently, against two different base
configs (a hand-written minimal config and `config/examples/generic.json`),
via `concertino sync`, `concertino validate`, and `concertino doctor`, each
against a **freshly initialized project that has never been synced before**
(`agentMerge.enabled: true`, `claude-code` in `harnesses`, no
`scripts/concertino/` populated yet):

```
─── Agent-merge ────────────────────────
! spawnSync /tmp/tmp.XXXXXXXXXX/scripts/concertino/check-agent-merge-permission.sh ENOENT — run `concertino sync` to add the missing grant
```

This is `lib/config.js`'s `checkAgentMergePermission` calling
`execFileSync(script, [out], ...)` (line ~296) with **no existence check on
`script` itself** before invoking it. When the check script hasn't been
copied onto disk yet (a brand-new project, or `concertino validate` run
before the first ever `concertino sync`), `execFileSync` throws Node's raw
`spawnSync ... ENOENT` and that becomes the warning's `reason` text (the
`catch` block's `stderr || e.message` fallback — `e.stderr` is an empty
buffer for a spawn failure, so it falls through to `e.message`).

This directly undermines AC1's explicit wording — "warns... **naming what is
missing** and how to grant it" — for the single most natural first-touch
scenario of this whole feature: a project turning `agentMerge.enabled` on
for the first time. The message leaks an internal path/errno instead of a
clean diagnostic ("no `.claude/settings.json` found — run `concertino
sync`", which is what the script itself would print if it were merely
*invoked and failing*, as opposed to *absent*).

I confirmed this is not covered by any test in the diff: every test that
exercises `checkAgentMergePermission`/the doctor/validate "Agent-merge"
section (`test/config.test.js`'s `agentMergeProject()` helper,
`test/scripts/agent-merge-permission-render.test.sh`'s section (f)) **always
pre-populates `scripts/concertino/check-agent-merge-permission.sh` on disk
first** — either via `fs.copyFileSync` in the JS helper, or by running a
full `concertino sync` before removing only `.claude/settings.json`. The
"script itself doesn't exist yet" branch — the actual first-sync state —
is exercised by none of the 1568+ passing tests, which is exactly why this
reproduces live but the suite is green.

Practical severity: not a crash, not a wrong exit code (still a `warn`, not
a `fail`; `concertino sync` itself completes and correctly writes the grant
seconds later in the same invocation). But `concertino validate` run
standalone, before ever syncing — a realistic sanity-check workflow — shows
**only** this confusing line, with no other section (unlike `doctor`, which
separately also reports the missing scripts under "Rendered artifacts" a
few lines later) to contextualize it.

### Verdict: REFUTE

### Change Requests

1. **`lib/config.js`'s `checkAgentMergePermission`** (~line 290-303): guard
   against the check script not existing yet before calling
   `execFileSync`, and return a clean, on-brand reason in that case — e.g.
   `if (!exists(script)) return { ok: false, reason: 'scripts/concertino/check-agent-merge-permission.sh not found — run `concertino sync` first' };`
   — instead of letting Node's raw `spawnSync ... ENOENT` leak into the
   `doctor`/`validate` warning text. Add a regression test (unit test in
   `test/config.test.js`, or a new case in
   `test/scripts/agent-merge-permission-render.test.sh`) that exercises
   `checkAgentMergePermission`/the doctor+validate "Agent-merge" section
   against a project whose `scripts/concertino/check-agent-merge-permission.sh`
   has genuinely never been written (i.e., does **not** pre-copy the script
   the way `agentMergeProject()` and section (f) currently always do) —
   this is the actual first-sync/pre-sync-validate state the fix needs to
   cover, and the one state none of the current 35 new tests exercise.

### Non-blocking notes

- `emit.js`'s `mergeAgentMergeSettings` appends newly-added rules in
  iteration order rather than sorting the final array, while design.md
  Decision 4's prose says "(sorted, deduplicated)". No scenario in spec.md
  requires ordering, and every test checks membership, not order — already
  correctly flagged as non-blocking in evaluation-1.md; I agree it is
  cosmetic only.
