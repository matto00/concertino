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

## Scripts

| Script              | Purpose                                                    | Args                                                        |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `setup-worktree.sh` | Create worktree, copy env files, derive ports, run hooks   | `<TICKET_ID> <BRANCH>`                                      |
| `start-servers.sh`  | Start backend/frontend dev servers, health-wait            | `<WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>`                 |
| `assert-phase.sh`   | Postcondition gate per phase                               | `<setup\|servers\|delivery\|cleanup> <WORKTREE_PATH> [...]` |
| `cleanup.sh`        | Stop servers, remove worktree                              | `<WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>`                 |

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
