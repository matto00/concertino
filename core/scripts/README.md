# Concertino procedure scripts

Canonical, deterministic procedures the agents **call** instead of recalling a
multi-step procedure from prose — which is where hallucination (wrong worktree
path, missed env-copy, forgotten CORS flag) creeps in, especially after context
compaction.

`concertino init` copies these into your project at `scripts/concertino/` and
`concertino sync` writes `scripts/concertino/.concertino.env` alongside them with
the values resolved from `concertino.config.json`. The scripts source that env
file — so they stay generic and the config is the single source of truth.

## Contract

- Each script is idempotent and re-runnable.
- Success prints machine-parseable `READY <key>=<value>` lines on stdout.
- Failure prints `FAIL <reason>` on stderr and exits non-zero.
- `assert-phase.sh` prints `PASS <phase>` / `FAIL <reason>` — it is the
  postcondition gate the orchestrator runs before leaving a phase. The
  `setup` phase additionally requires (CON-136) a
  `.concertino/runs/<TICKET_ID>/evidence/premise-validation.md` artifact,
  resolved against the main checkout the same way the `delivery` phase's own
  gate-chain evidence check resolves it: a `## Premise Validation` heading
  with all three fields (`**Claims checked:**`, `**Already-done scope:**`,
  `**Sibling collisions:**`) substantively answered and a `**Verdict:**` of
  `no-drift`, `minor-staleness`, or `material-drift`; a `material-drift`
  verdict additionally requires a matching `ticket-drift`
  `escalation.raised` event (role=orchestrator, `context` starting with the
  literal marker `TICKET-DRIFT-ESCALATION`) in that run's `events.jsonl`.
  This check runs unconditionally on every `setup` invocation.
- `emit-event.sh` appends one JSON line to
  `<main checkout>/.concertino/runs/<TICKET>/events.jsonl`. In normal mode it
  always exits 0, including on internal error, so telemetry can never fail a
  run. Other scripts call it with `|| true` for the same reason. `--await` is
  the exception and exits non-zero in two cases: the escalation timed out, or
  the initial `escalation.raised` write failed — either way there is no answer
  coming, so the caller must fall back to escalating in chat. Like the other
  scripts it sources `.concertino.env`, for `CONCERTINO_ESCALATION_TIMEOUT_MIN`
  (`--await`'s deadline) — but it checks **two** locations: next to itself
  first, then `scripts/concertino/` under the main checkout. Escalations are
  raised from inside a worktree, whose own copy of this directory has no
  `.concertino.env`, so without that fallback the configured timeout would
  never apply and `--await` would silently use its hardcoded default.
- `persist-evidence.sh` copies an artifact into
  `<main checkout>/.concertino/runs/<TICKET>/evidence/` — unlike
  `emit-event.sh`, it can genuinely fail (missing source, unwritable
  destination) and does not swallow that failure, because a caller must never
  build an `evidence`/`verdict` ref from a copy that was never actually made.
- `gather-escalation-context.sh` is a pure formatter: it prints a structured
  context block for one of seven escalation kinds to stdout, or `FAIL`s on a
  missing required field or an unrecognized kind. The `ticket-drift` kind
  (CON-136) opens its output with the literal first line
  `TICKET-DRIFT-ESCALATION`, before the `claimed`/`actual`/`options` block —
  `emit-event.sh` drops any caller-supplied `kind=`, so this is how
  `assert-phase.sh setup`'s material-drift check identifies a matching
  escalation from `context` alone (a prefix match). It does not know about
  `emit-event.sh`'s byte cap and does not persist anything itself — pass its
  output as `context=` on the `emit-event.sh escalation --await` call, which
  owns truncation/persistence for an oversized value.
- `check-merge-readiness.sh` exits **3** with a `PENDING <names>` line when
  required checks are still running at the end of its wait window — a
  resumable "not yet", not a failure. Callers re-invoke; they must not treat
  it as a verdict (CON-159). Conditions 2-3 are skipped in that case.
- `check-merge-readiness.sh` can block for a while (bounded, a few minutes
  worst case) rather than failing on the first look: a pending/in-progress CI
  check and GitHub's transient post-push "still computing" mergeability state
  are both polled up to their own timeout before producing a `FAIL`, and a
  `BEHIND` branch is reconciled once — fetch, `git merge` (never rebase or
  force-push, so existing commits are never rewritten), push — before
  conditions are (re-)checked on the new HEAD. A caller invoking it through a
  tool with its own shorter default timeout must raise that timeout
  explicitly, or a still-genuinely-pending CI run reads as a tool timeout
  instead of this script's own, more informative, `FAIL`.
- `check-merge-readiness.sh` exits **4** with one `STALE <role> reviewed=<sha>
  head=<sha> changed=<paths>` line per stale role when condition 3's
  reviewed-source-has-moved check (CON-166) fires — distinct from `FAIL`
  (exit 1, dominates when both are present) and the `PENDING` exit 3 above.
  It means "re-run the named gate against the current head, then re-invoke";
  it is never a permanent block. The 4th positional argument is the
  planning-artifact prefix (e.g. `openspec`) this check excludes — supplied
  by the caller, never hardcoded.

- `watchdog.sh` is a driver's whenever-a-lane-is-dispatched tool, not
  optional tooling for large batches only (CON-177) — it runs whenever any
  lane is dispatched. It never reads transcript content (stat only, `-L`
  followed — tasks-dir entries are symlinks), validates both arguments at
  startup (a missing tasks-dir or lanes-file is a usage error, exit 2 — never
  a silent stand-down), and warns once (stderr) rather than either failing or
  polling forever silent when a tracked lane has no transcript at all.
  It takes the set of lanes still in flight as an explicit liveness input
  re-read on every poll rather than inferring stall from silence — a lanes
  file with every line removed (all lanes completed normally) makes it stand
  down silently, exit 0, no trip banner. A lane's line may also carry a
  ticket id (`<agentId> <label> [<TICKET>]` or `<agentId> <label>
  <TICKET>@/abs/repo/root`); once that ticket's
  `.concertino/runs/<TICKET>/events.jsonl` records a terminal `run.end`
  (ticket matched case-insensitively, same as `emit-event.sh`'s own
  uppercasing), the lane counts as complete automatically — so a forgotten
  lane line for a ticket that actually finished can no longer produce a
  false FLEET trip, which is what happened in the field on 2026-09-10. That
  repo root is resolved per lane, in order: (1) the inline `@/abs/path` on
  that lane's own line, (2) `$CONCERTINO_REPO_ROOT` if set, (3) `git
  rev-parse --git-common-dir` from the watchdog's own CWD (same as
  `emit-event.sh`'s `main_checkout()`) — the inline form exists because a
  single driving session commonly tracks lanes across more than one repo at
  once (e.g. helio and concertino tickets in the same batch), for which one
  global root is insufficient, and because the watchdog is often launched
  from outside the ticket's own repo altogether (a scratchpad, a different
  repo, a worktree a later `cleanup.sh` deletes) where CWD-based resolution
  finds nothing at all. A ticket whose root can't be resolved by any of the
  three warns once (stderr) rather than silently misjudging it either way.
  The lanes file should be edited atomically (write a temp file in the same
  directory, then `mv` over the original) — a plain truncate-then-rewrite
  caught mid-poll briefly reads as empty, which is otherwise indistinguishable
  from "no lanes in flight".
  Its lock lives at `<lanes-file's directory>/watchdog.pid.d/` — a
  *directory*, not a plain file, so acquiring it is a single atomic `mkdir`
  rather than a separate read-then-write that a second instance could race.
  Before ever signalling a PID recorded there, it confirms (via
  `/proc/<pid>/cmdline` or `ps`) that the PID's command line contains this
  script's own resolved absolute path (not merely the substring
  `watchdog.sh`, which a same-named but unrelated script would also match) —
  a stale lock's PID can be reused by an unrelated process after a crash,
  and this never signals a process it hasn't identified this way; a prior
  instance that doesn't honour repeated TERM signals within 50 attempts is
  given up on (exit 2) rather than retried forever. Both its FLEET (default
  15 min, all transcripts quiet) and LANE (default 3 h minimum, one tracked
  lane's own transcript quiet) trips print a diagnose-first message and
  never instruct or perform a kill of a tracked
  lane; a superseded instance exits 0 quietly rather than surfacing SIGTERM's
  raw 143 to whatever coordinator is watching it. See its own header comment
  for the full contract and env overrides used by its tests.

## Scripts

| Script              | Purpose                                                    | Args                                                        |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `setup-worktree.sh` | Create worktree, copy env files, derive ports, run hooks, resolve speed | `<TICKET_ID> <BRANCH> [SPEED]`                 |
| `resolve-speed.sh`  | (speed, harness) -> resolved budgets + per-role models + slow-only flags | `[SPEED] [HARNESS]`                          |
| `start-servers.sh`  | Start backend/frontend dev servers, health-wait            | `<WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]`     |
| `assert-phase.sh`   | Postcondition gate per phase                               | `<setup\|servers\|delivery\|cleanup> <WORKTREE_PATH> [...] [TICKET_ID]` |
| `check-merge-readiness.sh` | Deterministic pre-merge gate for the auditor (agent-merge): CI green (polling through pending), PR mergeable (auto-reconciling a BEHIND branch once), this run's gates passed, reviewed source not stale (CON-166) | `<WORKTREE_PATH> <BRANCH> <TICKET_ID> <ARCHIVE_PREFIX>` |
| `cleanup.sh`        | Stop servers, remove worktree                              | `<WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>`                 |
| `emit-event.sh`     | Append a dashboard event; `--await` blocks for an answer   | `<kind> [--await] k=v ...`                                  |
| `persist-evidence.sh` | Copy an artifact into the main checkout, print a durable ref | `<TICKET_ID> <SOURCE_PATH>`                               |
| `set-ticket-state.sh` | Set a local ticket's state (write-back seam for `ticketProvider.kind: "local"`) | `<tickets-dir> <TICKET_ID> <state>`               |
| `gather-escalation-context.sh` | Format a structured context block for an escalation kind | `<dependency\|api-change\|budget\|blocker\|contradiction\|ticket-ambiguity\|ticket-drift> k=v ...` |
| `triage-followup.sh` | Classify a suggested follow-up as fold-in/standalone from file overlap + caller-supplied judgment | `description=... files=... ac_relevant=<yes\|no> effort=<small\|large> worktree=... [base=...]` |
| `next-report-number.sh` | Collision-safe, disk-derived filename number for the evaluator's/skeptic's next review report | `<change-dir> <kind>`                    |
| `watchdog.sh`        | Two-signal fleet staleness watchdog (CON-177): polls transcript mtimes and exits (nonzero, diagnose-first text) on a stall; stands down silently when no lane is tracked live | `<tasks-dir> <lanes-file>` |

`resolve-speed.sh` reads `scripts/concertino/speeds.json` (rendered by
`concertino sync` alongside `.concertino.env`, from the config's `budgets`/
`speeds`/`modelTiers`/`models` blocks) — it never re-implements the
defaulting/merge logic itself, only the final (speed, harness) lookup. See
its own header comment for the full contract, and `docs/config-reference.md`
for the config shape.

## Ports

Derived from the ticket number so parallel orchestrators never collide:
`DEV_PORT = frontendPortBase + N`, `BACKEND_PORT = backendPortBase + N`
(bases come from `concertino.config.json → worktree.ports`).

## .concertino.env (generated — do not edit by hand)

`concertino sync` writes these keys; the scripts read them. Re-run `sync` after
changing `concertino.config.json`.

```
CONCERTINO_BASE_BRANCH          # from project.baseBranch, e.g. main
CONCERTINO_WORKTREE_BASE        # e.g. .concertino/worktrees
CONCERTINO_FRONTEND_PORT_BASE   # e.g. 5173
CONCERTINO_BACKEND_PORT_BASE    # e.g. 8080
CONCERTINO_ENV_FILES            # space-separated, e.g. "backend/.env"
CONCERTINO_WORKTREE_HOOKS       # ;-separated, e.g. "npx husky install"
CONCERTINO_HARNESS              # static default for run.start telemetry: the
                                 # single configured harness, or empty when more
                                 # than one is configured. setup-worktree.sh
                                 # overrides this at runtime with a harness-set
                                 # env var (CLAUDECODE -> claude-code,
                                 # CODEX_SANDBOX(_NETWORK_DISABLED) -> codex)
                                 # when present, falling back to this static
                                 # value and then "unknown".
CONCERTINO_BACKEND_CWD          # e.g. backend
CONCERTINO_BACKEND_START        # e.g. PORT=$BACKEND_PORT sbt run   (no nohup/redirect)
CONCERTINO_BACKEND_HEALTH       # e.g. http://localhost:$BACKEND_PORT/health
CONCERTINO_BACKEND_TIMEOUT      # seconds
CONCERTINO_FRONTEND_CWD         # e.g. frontend
CONCERTINO_FRONTEND_START       # e.g. PORT=$DEV_PORT BACKEND_PORT=$BACKEND_PORT npm run dev
CONCERTINO_FRONTEND_HEALTH      # e.g. http://localhost:$DEV_PORT
CONCERTINO_FRONTEND_TIMEOUT     # seconds
```

Leave a `*_START` empty to skip that server (e.g. a frontend-only or CLI project
with no backend).

`CONCERTINO_BASE_REMOTE` (default `origin`) is not written by `sync` — set it in
the environment if your base branch lives on a differently-named remote.

## Branching base

`setup-worktree.sh` fetches `<remote>/<baseBranch>` and cuts **new** branches from
it, so a burst of sequential tickets doesn't branch from a local base that has
fallen behind the remote. The fetch is non-fatal: offline or remote-less runs fall
back to the local base branch, then to `HEAD`, with a `note:` line. Attaching to an
**existing** branch never re-bases — resuming a ticket must not move its branch.

## Not (yet) scripted

Delivery (squash, archive, PR) stays in the orchestrator because its commit
messages and PR body are content, not procedure.
