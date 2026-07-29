## Context

`scripts/concertino/setup-worktree.sh` (canonical source: `core/scripts/setup-worktree.sh`,
copied verbatim by `concertino sync` — see `docs/harness-capabilities.md`, "Everything
that stays identical") is the one script both Claude Code and Codex runs invoke to
create a worktree and emit the `run.start` telemetry event. It already reads
`${CONCERTINO_HARNESS:-unknown}` at that emission point; the gap is only that nothing
ever sets `CONCERTINO_HARNESS`.

`.concertino.env` is rendered once, at `concertino sync` time, and is **shared** by
every harness a project configures — `renderEnv(c)` in `bin/concertino` is called a
single time per sync and writes one file regardless of `harnesses.length`. So a
project that configures both `claude-code` and `codex` cannot get a correct
per-run value out of a purely sync-time, static computation: sync has no way to know,
at render time, which of the two harnesses any future run will use. The ticket's
notes anticipate exactly this ("may not be cleanly determinable... propose the
closest honest alternative rather than guessing").

The one thing that *can* determine it, per-run, is the actual runtime environment the
script executes in. Verified directly in this environment:
- Claude Code sets `CLAUDECODE=1` in every subprocess its Bash tool spawns (confirmed
  via `env | grep -i claude` inside a live Claude Code session).
- The Codex CLI (`@openai/codex`, checked at `/usr/lib/node_modules/@openai/codex`)
  embeds the environment variable names `CODEX_SANDBOX` and
  `CODEX_SANDBOX_NETWORK_DISABLED` in its compiled binary — these are the sandbox
  markers the Codex CLI sets for every command it executes.

Neither of these is a documented public contract, so it's used defensively: presence
of the variable is the only thing relied on, not any particular value/format, and the
static `.concertino.env` default plus the literal `unknown` remain in the fallback
chain if detection ever stops working.

## Goals / Non-Goals

**Goals:**
- `run.start` records the harness that actually ran the workflow, for both the
  single-harness and multi-harness-configured cases.
- Never write a confidently-wrong value — an ambiguous case degrades to `unknown`,
  matching the dashboard's existing degradation-ladder principle, rather than
  guessing.
- Keep `.concertino.env` the single source `concertino sync` controls; runtime
  detection is a layered override inside the shared script, not a second
  config-generation path.

**Non-Goals:**
- Detecting harnesses other than `claude-code` / `codex` (no others are supported
  anywhere else in the config schema).
- A general-purpose "which AI CLI am I running under" library — this is scoped to
  the two variables `setup-worktree.sh` needs.
- Changing what `run.start`'s `harness` field is used for downstream (out of scope;
  the dashboard drill-down screen is a separate, already-planned slice).

## Decisions

### 1. `CONCERTINO_HARNESS` in `.concertino.env` is the *static default*, not the final value

`renderEnv(c)` writes:
- the single configured harness, if `c.harnesses.length === 1` (this is always
  correct — there is nothing else it could be), or
- an empty string, if more than one harness is configured (sync cannot know which
  one a given run will use; writing the first one, or a joined list, would both be
  a guess dressed up as a fact).

Alternative considered: write the full joined list (`"claude-code,codex"`) when
multiple are configured. Rejected — the ticket explicitly calls this out as the
wrong shape ("rather than the full configured list"), and a comma-joined value
would silently satisfy naive callers while still being wrong for telemetry that
expects one of two enum-like values.

### 2. Runtime detection lives in `setup-worktree.sh`, ordered ahead of the static default

Add a small `detect_harness()` helper immediately after the `.concertino.env`
source line:

```bash
detect_harness() {
  if [ -n "${CLAUDECODE:-}" ]; then echo "claude-code"; return; fi
  if [ -n "${CODEX_SANDBOX:-}" ] || [ -n "${CODEX_SANDBOX_NETWORK_DISABLED:-}" ]; then echo "codex"; return; fi
  echo ""
}
RUNTIME_HARNESS="$(detect_harness)"
HARNESS="${RUNTIME_HARNESS:-${CONCERTINO_HARNESS:-unknown}}"
```

`HARNESS` (not the raw `CONCERTINO_HARNESS`) is what gets interpolated into the
`run.start` emission. Resolution order: runtime signal → static sync-time default →
literal `unknown`. This is what makes both AC bullets true simultaneously: the
single-harness case is already right via the static default (detection is a no-op
there since it only ever narrows, never contradicts, the single configured value);
the multi-harness case is right *only* because of the runtime override.

Alternative considered: only rely on the static default and accept that
multi-harness projects stay `unknown`. Rejected — it does not meet the ticket's
explicit AC3 ("a run started under Claude Code records `claude-code`; one started
under Codex records `codex`"), which does not carve out an exception for
multi-harness projects.

Alternative considered: have each harness's rendered role/command file (the
per-harness `emitClaude`/`emitCodex` output) `export CONCERTINO_HARNESS=...`
before calling `setup-worktree.sh`, instead of runtime env-var sniffing. Rejected —
it requires every one of today's and future harness-invocation entry points
(slash command, `AGENTS.md` sequential flow, any future direct script invocation)
to remember to set it, whereas `CLAUDECODE`/`CODEX_SANDBOX` are already set
unconditionally by the harness process itself. Sniffing is strictly fewer places
that can forget.

### 3. `concertino validate` gains an informational line, not a new required field

`cmdValidate`'s existing "Integrations" section already validates `harnesses`
itself (non-empty, only known values). This change adds one more `ok()`/`warn()`
line there stating how `CONCERTINO_HARNESS` will resolve for the project's
configured harnesses — e.g. `harness telemetry   static: claude-code` or
`harness telemetry   runtime-detected (2 harnesses configured)`. This is
informational only: it never fails validation, because an empty static default is
a legitimate, honest state for a multi-harness project (Decision 1), not a
misconfiguration.

Alternative considered: add a new optional config field (e.g.
`telemetry.activeHarness`) that a human sets manually per checkout. Rejected — it
reintroduces exactly the "confidently wrong if the human forgets to update it"
failure mode the ticket is trying to eliminate, and duplicates information
(`CLAUDECODE`/`CODEX_SANDBOX`) the environment already provides for free.

## Risks / Trade-offs

- [Risk] `CLAUDECODE` / `CODEX_SANDBOX` are undocumented, unversioned environment
  variables set by third-party CLIs; a future release could rename or remove them,
  silently regressing detection back to the static default (or `unknown`).
  → Mitigation: detection only ever *narrows* the value (never used to fail a
  build or block delivery), the static default + `unknown` fallback chain stays in
  place unconditionally, and the design doc records exactly what was verified and
  when so a future maintainer investigating a regression has a starting point.
- [Risk] A user manually exports `CONCERTINO_HARNESS` in their shell profile,
  expecting it to be authoritative; runtime detection would silently override it
  when running under a detected harness. → Mitigation: this is the same shared
  `.concertino.env` sourced today with no export precedent, and the fallback chain
  already treats `CONCERTINO_HARNESS` as a default, not an override — documented in
  `docs/config-reference.md` and the script's own header comment.
- [Trade-off] Detection is Claude Code / Codex specific and hardcoded in
  `setup-worktree.sh` rather than pluggable. Acceptable — `harnesses` in the
  config schema is currently a closed enum of exactly these two values.

## Migration Plan

No migration — additive `.concertino.env` key, additive script logic. Existing
`.concertino.env` files without `CONCERTINO_HARNESS` still work (`${CONCERTINO_HARNESS:-unknown}`
default is unchanged as the final fallback). Projects pick up the fix on their next
`concertino sync`. This repo dogfoods itself, so the executor runs `concertino sync`
against its own worktree as part of implementation to regenerate
`scripts/concertino/*.sh` and `.concertino.env` from the edited `core/scripts/*` and
`bin/concertino`.

## Open Questions

None outstanding — the notes field in the ticket pre-empted the main ambiguity
(static-only determination is impossible for multi-harness projects), and Decision 2
resolves it with a verified, real signal rather than a guess.
