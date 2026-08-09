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
  postcondition gate the orchestrator runs before leaving a phase.
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
  context block for one of six escalation kinds to stdout, or `FAIL`s on a
  missing required field or an unrecognized kind. It does not know about
  `emit-event.sh`'s byte cap and does not persist anything itself — pass its
  output as `context=` on the `emit-event.sh escalation --await` call, which
  owns truncation/persistence for an oversized value.
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

## Scripts

| Script              | Purpose                                                    | Args                                                        |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `setup-worktree.sh` | Create worktree, copy env files, derive ports, run hooks, resolve speed | `<TICKET_ID> <BRANCH> [SPEED]`                 |
| `resolve-speed.sh`  | (speed, harness) -> resolved budgets + per-role models + slow-only flags | `[SPEED] [HARNESS]`                          |
| `start-servers.sh`  | Start backend/frontend dev servers, health-wait            | `<WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]`     |
| `assert-phase.sh`   | Postcondition gate per phase                               | `<setup\|servers\|delivery\|cleanup> <WORKTREE_PATH> [...] [TICKET_ID]` |
| `check-merge-readiness.sh` | Deterministic pre-merge gate for the auditor (agent-merge): CI green (polling through pending), PR mergeable (auto-reconciling a BEHIND branch once), this run's gates passed | `<WORKTREE_PATH> <BRANCH> <TICKET_ID>` |
| `cleanup.sh`        | Stop servers, remove worktree                              | `<WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>`                 |
| `emit-event.sh`     | Append a dashboard event; `--await` blocks for an answer   | `<kind> [--await] k=v ...`                                  |
| `persist-evidence.sh` | Copy an artifact into the main checkout, print a durable ref | `<TICKET_ID> <SOURCE_PATH>`                               |
| `set-ticket-state.sh` | Set a local ticket's state (write-back seam for `ticketProvider.kind: "local"`) | `<tickets-dir> <TICKET_ID> <state>`               |
| `gather-escalation-context.sh` | Format a structured context block for an escalation kind | `<dependency\|api-change\|budget\|blocker\|contradiction\|ticket-ambiguity> k=v ...` |
| `triage-followup.sh` | Classify a suggested follow-up as fold-in/standalone from file overlap + caller-supplied judgment | `description=... files=... ac_relevant=<yes\|no> effort=<small\|large> worktree=... [base=...]` |
| `next-report-number.sh` | Collision-safe, disk-derived filename number for the evaluator's/skeptic's next review report | `<change-dir> <kind>`                    |

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
