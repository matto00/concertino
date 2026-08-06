## Skeptic Report — final gate (round 3, skeptic-final-3.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/agent-merge/spec.md` from the worktree fresh — not from
  `skeptic-final-1.md`/`-2.md`'s or the executor's narrative.
- `git log --oneline`: fix commit `44af3e9` on top of `88c23d4` (round-1
  fix) on top of `0d4c6d8` (original delivery). `git show 44af3e9 --stat`:
  touches `core/scripts/check-agent-merge-permission.sh`,
  `lib/cli/doctor.js`, `lib/config.js`, `scripts/concertino/check-agent-merge-permission.sh`,
  `test/config.test.js`, `test/scripts/agent-merge-permission-render.test.sh`,
  plus change-dir bookkeeping files. `git diff 88c23d4 44af3e9 -- core/roles/orchestrator.md lib/cli/render.js lib/cli/emit.js docs/config-reference.md README.md`
  is empty — the round-2 fix touches none of the AC2/AC3/AC4 surfaces round 1
  already traced. I re-verified AC2/AC3/AC4 directly below rather than just
  citing that emptiness.
- `diff core/scripts/check-agent-merge-permission.sh scripts/concertino/check-agent-merge-permission.sh`
  → identical (packaging claim re-verified, not assumed).
- Ran `npm test` fresh in the worktree: `node --test` → **1574/1574 passed,
  0 failed** (`# tests 1574 / # pass 1574 / # fail 0`); all
  `test/scripts/*.test.sh` suites green, including
  `check-agent-merge-permission.sh` (16/16) and `agent-merge permission
  grant rendering` (34/34, including new sections h.7/h.8/i.1–i.7).
  Reproduced, not trusted.
- Read `lib/config.js`'s `checkAgentMergePermission` and the new
  `withAgentMergeFixHint` in full (diff hunk `git show 44af3e9` lines
  ~137–182): the "script not found" reason no longer carries its own fix
  clause; the `execFileSync` catch block now does
  `stderr.split('\n').map(l => l.replace(/^FAIL\s*/, '').trim()).filter(Boolean).join('; ')`
  before returning `reason`; `withAgentMergeFixHint` appends the
  "run `concertino sync`..." suffix exactly once, guarded by a
  `/concertino sync/` idempotency check. Read both call sites
  (`lib/config.js`'s `collectConfigIssues` and `lib/cli/doctor.js`'s
  `checkAgentMerge`) — both now route through `withAgentMergeFixHint(reason)`
  instead of unconditionally concatenating their own suffix. Read the shell
  script's diff: the "no .claude/settings.json found" stderr line dropped
  its embedded "— run `concertino sync`" clause, consistent with the new
  single-appender contract.

### Independent live reproduction of both round-2 defects, against the actual CLI (not the new tests)

I did not rely on the new regression tests passing — I re-exercised the
exact scenarios `skeptic-final-2.md` reproduced, against fresh throwaway
projects built the same way the test harness does (`config/examples/generic.json`
+ `agentMerge.enabled: true`), independently of any fixture the diff's own
tests use.

**Defect 1 (doubled fix-hint suffix), never-synced project:**
```
$ node bin/concertino doctor --out=<tmp> --config=<tmp>/concertino.config.json
  ─── Agent-merge ────────────────────────
  ! scripts/concertino/check-agent-merge-permission.sh not found — run `concertino sync` to add the missing grant
```
Exactly one "run `concertino sync`" clause, not two. Confirmed identically
in both `doctor` and `validate` output.

**Defect 2 (unjoined multi-line FAIL), both rules missing at once**
(`concertino sync` run first to establish a real grant, then
`.claude/settings.json` hand-edited to `{"permissions":{"allow":[]}}`):
```
$ node bin/concertino doctor --out=<tmp> --config=<tmp>/concertino.config.json
  ─── Agent-merge ────────────────────────
  ! missing permission rule: Bash(gh pr merge:*); missing permission rule: Task(concertino-auditor) — run `concertino sync` to add the missing grant
```
One coherent line, both rules named, correctly indented under the `!`
marker, no bare/detached continuation line, no leading `FAIL ` token (the
`FAIL` stripping was applied uniformly, so the previously-flagged cosmetic
"literal FAIL prefix" non-blocking note from round 2 is also gone — checked
the single-missing-rule case separately: `! missing permission rule:
Task(concertino-auditor) — run \`concertino sync\`...`, no `FAIL ` anywhere).
Confirmed identically in `validate` output.

Both defects are genuinely closed, not just test-satisfied.

### Acceptance criteria retraced (fresh, not re-citing round 1/2's trace)

1. **doctor/validate warn, naming what's missing and how to fix it** — live
   output above satisfies this cleanly in all three failure shapes (script
   absent, one rule missing, both rules missing) with no leaked internals,
   no doubling, no broken rendering. Met.
2. **Orchestrator asks before spawning, not after a denial** —
   `core/roles/orchestrator.md`'s `AGENT_MERGE = true` branch (`git diff
   main...HEAD`) inserts `{{block:agentMergePermissionCheck}}` immediately
   before the auditor spawn; `lib/cli/render.js`'s new case renders a
   `PASS`→spawn / `FAIL`→escalate(`options=retry,fallback`) contract for
   claude-code, N/A prose for codex/opencode; a new "Circuit breakers" table
   row and "Always reaches the human" bullet name this as a distinct
   escalation point. Untouched since round 1 (confirmed by the empty
   `git diff 88c23d4 44af3e9` above). Met.
3. **Docs state the two-part opt-in plainly** — read `docs/config-reference.md`'s
   `## agentMerge` section and `README.md`'s pointer in full: both name the
   config key as part 1, the harness-level permission grant as part 2,
   explain why the config key alone is insufficient under Claude Code's
   auto mode, and name `concertino sync` as the mechanism that closes the
   gap. Met.
4. **`AGENT_MERGE = false` fallback keeps its current behaviour** —
   `git diff main...HEAD -- core/roles/orchestrator.md`: the `AGENT_MERGE =
   false` branch is not present anywhere in the diff hunks (only the `true`
   branch is touched, plus two new table/bullet additions after it); the new
   escalation's `fallback` option explicitly routes to "the identical
   `AGENT_MERGE = false` flow." Met.

### Verdict: CONFIRM

### Non-blocking notes

- `emit.js`'s `mergeAgentMergeSettings` still appends rules in iteration
  order rather than sorting, vs. design.md Decision 4's "(sorted,
  deduplicated)" prose — flagged non-blocking in rounds 1 and 2, unchanged,
  still cosmetic only (no scenario in spec.md requires ordering; every test
  checks membership).
- The round-2 "literal `FAIL ` prefix" polish note is resolved as a side
  effect of the round-3 fix (the token-strip now applies uniformly to
  single- and multi-line reasons) — worth noting as a positive, not a
  requirement that was outstanding.
