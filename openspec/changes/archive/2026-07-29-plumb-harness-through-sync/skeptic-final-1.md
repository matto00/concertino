## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket/AC source of truth**: read `ticket.md` in the worktree and
  independently fetched CON-2 via `mcp__linear__get_issue` — text is identical,
  confirming no drift between the Linear ticket and the local artifact.

- **AC1 — `concertino sync` writes `CONCERTINO_HARNESS` into
  `scripts/concertino/.concertino.env`**: `git show a09fec3 -- bin/concertino`
  shows `renderEnv(c)` pushing
  `CONCERTINO_HARNESS=' + envValue(c.harnesses.length === 1 ? c.harnesses[0] : '')`.
  Ran `cat scripts/concertino/.concertino.env` myself — contains
  `CONCERTINO_HARNESS='claude-code'`, sitting alongside the other
  `CONCERTINO_*` keys as required.

- **AC2 — value reflects the harness in use, not the full list**: confirmed via
  `test/scripts/harness-identity.test.sh` cases a.1/a.2, which I ran myself
  (see gate re-run below): single-harness config → the one value; two-harness
  config → empty string (never a guessed value), with `setup-worktree.sh`'s
  runtime `detect_harness()` resolving the actual value at run time. Read the
  full `core/scripts/setup-worktree.sh` diff — `HARNESS` resolution order is
  runtime signal → static default → `"unknown"`.

- **AC3 — Claude Code run records `claude-code`, Codex run records `codex`**:
  the evaluator's report claimed a "live verification" via this worktree's own
  `run.start` event; I re-verified this independently, correcting the
  evaluator's imprecise phrasing ("this worktree's own
  `.concertino/runs/CON-2/events.jsonl`" — that path does not exist inside the
  worktree; the real path is the main checkout's
  `/home/matt/Development/concertino/.concertino/runs/CON-2/events.jsonl`,
  which is where the orchestrator's own `setup-worktree.sh` invocations for
  this ticket actually wrote). I read that file directly and confirmed two
  `run.start` lines for CON-2, same worktree path/ports: the earlier one (pre-
  fix, before code checkout) has `"harness":"unknown"`, the later one (post-
  fix Setup phase re-run) has `"harness":"claude-code"` — a genuine live
  before/after demonstrating the fix on a real orchestrator run under Claude
  Code. I also confirmed `CLAUDECODE=1` is actually present in my own live
  session env (`env | grep CLAUDECODE`), validating that the detection
  variable the code relies on is real, not fabricated. The Codex path (b.2/b.3
  in the test file) is exercised only by the test harness, which is
  appropriate — no live Codex session is available in this review, and the
  ticket's honesty principle is satisfied either way since the code only ever
  reports a value it can actually observe.

- **AC4 — `bin/concertino validate` accepts the key and docs document it**: ran
  `node bin/concertino validate` myself against this project's own config —
  output includes `✓ harness telemetry  static: claude-code` in the
  Integrations section, and overall `✓ valid  all checks passed` (no failure
  from the new key). Read `docs/config-reference.md` diff — new paragraph
  under the `harnesses` row documents the full static/runtime/`unknown`
  resolution chain in `scripts/concertino/.concertino.env`.

- **Honesty requirement (ticket's explicit warning against guessed values)**:
  read the full diff for guessed-value smells. Found none — `renderEnv` writes
  empty string (not a picked-arbitrarily harness) when more than one is
  configured; `detect_harness()` returns real presence of `CLAUDECODE` /
  `CODEX_SANDBOX(_NETWORK_DISABLED)`, never a default codified as fact; the
  final fallback is the literal string `"unknown"`, not a fabricated harness
  name. `design.md`'s Decisions section (lines 53-157) explicitly engages with
  and rejects guessing at each branch point. This matches the actual shipped
  code, not just the design doc.

- **Dogfooding / core-vs-scripts drift**: ran
  `diff core/scripts/setup-worktree.sh scripts/concertino/setup-worktree.sh`
  myself — exit 0, byte-identical. Same check via `git show` for
  `core/scripts/README.md` vs `scripts/concertino/README.md` — identical
  diffs applied to both. No drift between source-of-truth and regenerated
  copies.

- **Gate re-run (fresh, not trusted from evaluator's report)**: ran
  `npm test` myself in the worktree. Exit code 0. All suites green, including
  the new `harness identity (CON-2)` suite: `14 passed, 0 failed` (single- and
  multi-harness `renderEnv` cases, all six `setup-worktree.sh` runtime-
  resolution branches including the both-signals-set-CLAUDECODE-wins case and
  the runtime-overrides-a-conflicting-static-default case). No regressions in
  the rest of the suite (`node --test` unit tests + all other
  `test/scripts/*.test.sh`).

- **Scope**: `git show a09fec3 --stat` — diff touches exactly `bin/concertino`,
  `config/concertino.schema.json`, `core/scripts/{README.md,setup-worktree.sh}`,
  `docs/config-reference.md`, their `scripts/concertino/` regenerated
  counterparts, `package.json` (test wiring), the new test file, and the
  standard OpenSpec change-tracking artifacts. No unrelated changes.

- **No UI surface**: this is a CLI/shell-script-only change; per the
  orchestrator's own note, Phase 3/UI review is N/A for this project and this
  ticket. No dev servers were started.

### Verdict: CONFIRM

### Non-blocking notes
- The evaluator's report described the live `run.start` verification as
  reading "this worktree's own `.concertino/runs/CON-2/events.jsonl`" — that
  exact path doesn't exist inside the worktree (it's in the main checkout).
  The underlying claim (before/after `unknown` → `claude-code` on a real
  orchestrator run) is true and I reproduced it from the correct path; future
  evaluation reports should be precise about which checkout a cited file lives
  in, since a cold reviewer following the stated path verbatim would get a
  false "missing evidence" signal.
