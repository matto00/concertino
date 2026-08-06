## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/agent-merge/spec.md` from the worktree fresh (not from any prior
  report's narrative).
- `git log --oneline` / `git show 88c23d4`: the round-1 fix commit, on top
  of `0d4c6d8` (the original delivery). Diff touches only `lib/config.js`,
  `files-modified.md`, `test/config.test.js`,
  `test/scripts/agent-merge-permission-render.test.sh` — no scope creep,
  no touch to the AC2/AC3/AC4 surfaces (`orchestrator.md`, `render.js`,
  `emit.js`, `docs/config-reference.md`, `README.md`), which round 1
  already traced and confirmed independently and which `git diff` confirms
  remain byte-identical since round 1. I do not re-litigate those three ACs
  here; nothing in round 2 touches them.
- Ran `npm test` fresh in the worktree: `node --test` + all
  `test/scripts/*.test.sh` → **1570/1570 passed** (up from round 1's 1568,
  matching the 2 new unit tests added in `test/config.test.js`; the new
  shell section (h) in `agent-merge-permission-render.test.sh` is 6
  additional assertions inside the existing 25-count suite, all green).
  Reproduced, not trusted.
- Read `lib/config.js`'s `checkAgentMergePermission` (lines ~290-310) in
  full: the new `if (!exists(script)) return { ok: false, reason:
  'scripts/concertino/check-agent-merge-permission.sh not found — run
  \`concertino sync\` first' };` guard is correctly placed before
  `execFileSync`, uses the module's existing `exists = (p) =>
  fs.existsSync(p)` helper (line 37), and does fix round 1's exact
  reproduction: the raw `spawnSync ... ENOENT` no longer appears.
  Independently reproduced against a fresh, never-synced throwaway repo
  (three runs: `doctor`, `validate`) — confirmed clean, no `ENOENT`/
  `spawnSync` anywhere in the output.
- Read the two new regression tests in `test/config.test.js` and section
  (h) in `agent-merge-permission-render.test.sh`: both genuinely exercise
  the never-synced state (`agentMergeProject({ noScript: true })` skips
  the pre-copy; the shell test never calls `concertino sync` before
  `doctor`/`validate`) — not a rubber-stamp test that pre-populates the
  fixture then claims to test its absence.

### Live reproduction — a new gap not covered by round 1's fix or its tests

Round 1's fix is real and correctly closes the specific scenario it
targeted (script itself absent). But independently re-running the CLI
against fresh throwaway projects — not just the two scenarios the new
tests happen to cover — surfaces a message-construction defect that both
predates round 1 (present since the original `0d4c6d8` delivery, in the
"grant present but not covering both required rules" scenario) **and** is
now reproduced afresh in the very code path round 1's fix touched. AC1
requires the warning to cleanly name "what is missing and how to grant
it" — this defect actively works against that in two ways:

**1. Redundant, confusing instruction text (round 1's own fix path).**
`checkAgentMergePermission`'s new guard returns a reason that already
contains its own fix instruction (`"... not found — run \`concertino
sync\` first"`). Both call sites — `lib/config.js:663` and
`lib/cli/doctor.js:255` — then unconditionally append a *second*,
differently-worded instruction: `` `${reason} — run \`concertino sync\` to
add the missing grant` ``. Reproduced live, fresh never-synced project:

```
! scripts/concertino/check-agent-merge-permission.sh not found — run `concertino sync` first — run `concertino sync` to add the missing grant
```

The same double-suffix bug already existed pre-round-1 for the
"`.claude/settings.json` missing" scenario (the shell script's own stderr,
`check-agent-merge-permission.sh:89`, already says `"... — run
\`concertino sync\`"`, and the call sites append the same suffix again):

```
! FAIL no .claude/settings.json found at /tmp/.../.claude/settings.json — run `concertino sync` — run `concertino sync` to add the missing grant
```

**2. A structurally broken, multi-line warning for the single most likely
first-touch scenario — both required rules missing (empty/irrelevant
`permissions.allow`).** Reproduced live, fresh project with
`scripts/concertino/check-agent-merge-permission.sh` present,
`.claude/settings.json` present but `permissions.allow: []`:

```
$ node bin/concertino doctor --out=... --config=...
  ─── Agent-merge ────────────────────────
  ! FAIL missing permission rule: Bash(gh pr merge:*)
FAIL missing permission rule: Task(concertino-auditor) — run `concertino sync` to add the missing grant
```

Root cause: `check-agent-merge-permission.sh` writes one `FAIL <msg>` line
per missing rule to stderr (`fail()`, lines 55/101). When both rules are
missing, `execFileSync`'s `e.stderr` is a **two-line** string, and
`checkAgentMergePermission`'s catch block joins nothing — it hands that
raw multi-line string straight through as `reason`. Both `warn(msg)`
(`validate.js:49`) and `r.warn(msg)` (`doctor.js:265`) do a bare
`console.log(`  ${yellow('!')} ${msg}`)` with no newline-collapsing, so
the second `FAIL ...` line prints **unindented, outside the `!` marker,
visually detached from the box-drawing section** — not a cosmetic
one-line redundancy but a broken rendering of the exact "name what is
missing" text AC1 requires, and for the scenario a human opting into
agent-merge for the first time with a brand-new/empty `.claude/settings.json`
allow list is at least as likely to hit as either of the two states the
new tests cover.

I confirmed no test in the diff (old or new) exercises this: `ONE_RULE_
SETTINGS` (single missing rule → single-line reason, no bug) is tested in
`test/config.test.js`; the both-rules-missing case
(`BOTH_RULES_SETTINGS`'s complement — an empty or irrelevant allow array)
is defined as a constant but never used against `collectConfigIssues`/
`checkAgentMergePermission` in any test, and section (f)/(h) of the shell
suite only test "settings.json entirely absent" and "script entirely
absent" — both single-line-reason paths. The multi-rule-missing path is
the one gap none of the 1570 passing tests reach.

### Verdict: REFUTE

### Change Requests

1. **`lib/config.js`'s `checkAgentMergePermission`** (~line 300-303): the
   `reason` returned when `execFileSync` fails should collapse the
   script's multi-line stderr into a single, cleanly-joined message (e.g.
   `stderr.split('\n').filter(Boolean).join('; ')`) before it is ever
   handed to a caller — not passed through with embedded newlines that
   break the single-line `warn()`/`r.warn()` renderers in
   `lib/config.js:663` and `lib/cli/doctor.js:255`. Add a regression test
   (unit test in `test/config.test.js` using a settings.json with an empty
   or irrelevant `permissions.allow`, i.e. exercising the *both-rules-
   missing* path already defined via a `BOTH_RULES_SETTINGS`-shaped
   sibling, and/or a new section in `agent-merge-permission-render.test.sh`
   asserting the doctor/validate output has no bare/unindented
   continuation line and no literal double `FAIL ` prefix) that would have
   caught this.

2. **`lib/config.js:663` and `lib/cli/doctor.js:255`**: stop
   unconditionally appending `` — run `concertino sync` to add the missing
   grant `` to every `reason`. At minimum, only append it when the reason
   does not already mention `concertino sync` (both the script's own
   "settings.json missing" message and the round-1 fix's "script not
   found" message already carry a complete, correctly-worded instruction)
   — or, more robustly, remove the "how to fix it" clause from
   `checkAgentMergePermission`'s own reason strings entirely and let the
   two call sites be the single place that clause is ever appended, so the
   two can never say it twice in two different ways in the same line.
   Extend the round-1 regression tests (`test/config.test.js`'s two new
   tests, `agent-merge-permission-render.test.sh` section (h)) to assert
   the rendered message does **not** contain the string `concertino sync`
   twice — the current tests only assert it's present at least once, which
   is why this doubling shipped past them.

### Non-blocking notes

- `emit.js`'s `mergeAgentMergeSettings` still appends newly-added rules in
  iteration order rather than sorting, versus design.md Decision 4's
  "(sorted, deduplicated)" prose — already flagged non-blocking in round 1
  (evaluation-1.md, skeptic-final-1.md); unchanged, still agree it's
  cosmetic only.
- Literal `FAIL ` prefix bleeding into the doctor/validate warning text
  (`! FAIL missing permission rule: ...`) reads slightly odd even once
  Change Request 1 is fixed (single-line case: `! FAIL missing permission
  rule: Bash(gh pr merge:*) — run ...`) — stripping the script's own
  `FAIL ` token before display would be cleaner, but is not required to
  satisfy AC1's literal wording once the line renders as one coherent
  sentence; raising as a polish note only, not blocking.
