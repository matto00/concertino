# dev-server-process-identity Specification

## Purpose
Prevents a canonical server-start script from silently adopting a healthy-but-foreign process as this run's dev/backend server, closing the class of bugs where a run measures or writes into the wrong worktree.

## Requirements

### Requirement: Reuse path verifies process identity before adopting a healthy server
When `start-servers.sh`'s reuse check finds a process already responding healthily on the expected health URL, it SHALL determine the local port from that URL and, when a single local pid can be found listening on it whose `/proc/<pid>/cwd` is readable, verify that the resolved cwd falls under the run's `WORKTREE_PATH` before treating the response as this run's server. A pid found and readable whose cwd does not resolve under `WORKTREE_PATH` SHALL be treated as a mismatch, not a successful reuse.

#### Scenario: Reusing a server that genuinely belongs to this worktree
- **WHEN** `start-servers.sh` finds a healthy response on the expected port, and the responding process's cwd resolves under `WORKTREE_PATH`
- **THEN** the script reuses it and prints `READY <label>=<url>` as today

#### Scenario: A bare, foreign process is healthy on the expected port
- **WHEN** a server was started bare (outside any canonical script), from a cwd outside `WORKTREE_PATH`, and happens to be listening and healthy on the exact local port `start-servers.sh`'s resolved health URL points at for this run
- **THEN** `start-servers.sh` does not silently reuse it; it reports the mismatch and exits non-zero, exactly as it already does for a health-check timeout

#### Scenario: Process identity cannot be determined
- **WHEN** the health URL has no discoverable local port (a non-loopback/non-local host, or no port at all), or no local pid is found listening on the parsed port, or **more than one local pid is found listening on the parsed port** (an ambiguous case — the script does not guess which one is authoritative), or exactly one pid is found but its `/proc/<pid>/cwd` is unreadable (permissions, non-Linux, or a proxied/containerized process)
- **THEN** `start-servers.sh` degrades to today's trust-the-health-check behavior — it logs a note and reuses the server exactly as before; this is not treated as a mismatch and does not fail the run

### Requirement: Role docs prohibit bare tool invocation where a canonical script exists
`core/roles/executor.md`, `core/roles/evaluator.md`, and `core/roles/skeptic.md` SHALL each state explicitly that agents must never invoke `npm`, `vite`, `sbt`, or `npx playwright` bare when a canonical script exists for the same purpose (e.g. `start-servers.sh` for starting dev/backend servers).

#### Scenario: A role doc is read for server-start guidance
- **WHEN** an executor, evaluator, or skeptic reads its own role doc for how to start or verify dev/backend servers
- **THEN** the doc states that the canonical script must be used, and that a bare invocation of the underlying tool is prohibited for that purpose
