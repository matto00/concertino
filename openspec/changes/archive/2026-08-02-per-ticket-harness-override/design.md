## Context

Today's harness resolution (see `openspec/specs/harness-identity/spec.md`) is
two-layered and entirely project-scoped:

1. `concertino sync` writes a static `CONCERTINO_HARNESS` default into
   `.concertino.env` — a single value when the project's `harnesses` config
   array has exactly one entry, empty otherwise.
2. `setup-worktree.sh` resolves the harness actually used for a given run at
   run time: `CLAUDECODE`/`CODEX_SANDBOX*` env signals first, falling back to
   the static default, falling back to `unknown`.

Neither layer has any notion of an individual ticket. `lib/config.js` already
defines the full set of implemented adapters as `VALID_HARNESSES = ['claude-code', 'codex']` and `concertino validate` already checks the project's
`harnesses` config array against it — that check is reused here, not
reinvented.

`mcp__linear__get_issue` (the only ticket-fetch path the orchestrator uses
today — `ticketProvider` is prose-only config, not a pluggable module) already
returns a ticket's `labels` array as part of its normal response, with zero
additional Linear API surface. The dashboard's own Linear client
(`lib/ui/linear.js`) fetches and normalises `labels` the same way for its
ticket cache.

## Goals / Non-Goals

**Goals:**
- A ticket can declare which of the currently-implemented harnesses
  (`claude-code`, `codex`) should run it, and the orchestrator honors that
  choice for that one run, ahead of both the project's config default and
  runtime env detection.
- An unsupported/unimplemented harness name on a ticket fails loudly, before
  any worktree is created — never silently falls back to the project default.
- `concertino validate` can be pointed at a specific ticket to confirm ahead
  of time whether its declared override (if any) is valid.
- The harness field stays an open enum: adding a third adapter later never
  requires touching this override's schema/plumbing again, only
  `VALID_HARNESSES` and the corresponding adapter itself.

**Non-Goals:**
- Changing the dashboard launch pad's batch launch-plan screen
  (`lib/ui/screens/launchplan.js`). That screen picks one harness for an
  entire batch of tickets (`h` to cycle, `plan.harness`) — none of this
  ticket's acceptance criteria mention it, and per-ticket harness inside a
  multi-ticket batch UI is a materially different (larger) design problem:
  showing/reconciling N different per-ticket overrides inside one batch,
  concurrency, and port assignment. Left as a natural follow-up ticket if
  wanted.
- Implementing a `local-llm` (or any other new) harness adapter.
- Any change to how `CONCERTINO_HARNESS` static default or runtime env
  detection themselves work — both are unchanged; a ticket override simply
  gets checked ahead of them.

## Decisions

### Decision 1 — Override channel: a Linear label, `harness:<value>`

Considered: (a) a Linear label (`harness:codex`), (b) a Linear custom field.

Chosen: **(a) a label.** `get_issue` already returns `labels` today with zero
new Linear API surface or schema. A custom field would require per-project
Linear configuration (custom fields are workspace/team-specific, not
guaranteed to exist) and a new GraphQL field in the fetch — extra machinery
for a boolean-ish "which of ~2 known values" choice a label already expresses
cleanly. Labels also generalize better across `ticketProvider.kind` (a GitHub
issue label works the same way, when/if that provider is filled in) — a
custom field's shape is far more provider-specific.

Convention: exactly one label matching `^harness:(.+)$` is honored. If a
ticket somehow carries more than one such label (misconfiguration), the
orchestrator treats this the same as an unsupported value — hard stop,
surfaced by name, never silently picks one.

### Decision 2 — Resolution order: ticket override outranks BOTH existing layers

The ticket's acceptance criteria are explicit: a supported per-ticket harness
takes precedence "over the project's `harnesses` config default and over
runtime env-based detection." This is a real, intentional change to
`harness-identity`'s existing resolution order (today: runtime signal > static
default > `unknown`) — the new order is:

1. **Ticket-declared override**, if present and valid (new — highest
   priority).
2. Runtime env signal (`CLAUDECODE` / `CODEX_SANDBOX*`) — unchanged.
3. Static `CONCERTINO_HARNESS` default — unchanged.
4. `unknown` — unchanged.

This does not change *what* runtime detection measures (the harness the
current process is actually executing under) — see Decision 5 for how the
override and a contradicting runtime signal coexist.

### Decision 3 — Where the fail-loud check lives: orchestrator Setup, before `setup-worktree.sh`, PLUS defense-in-depth inside the script itself

The acceptance criteria require the error to land "before worktree setup
begins." Two call sites get the check, not one:

1. **Primary: `core/roles/orchestrator.md` Setup step 1** (ticket fetch).
   Immediately after fetching the ticket, parse `labels` for `^harness:(.+)$`.
   If found and the value is not in the implemented set, this is a hard stop
   — present it to the human exactly like a Setup `BLOCKER` (see
   orchestrator.md's Setup step 3 "If the script prints `FAIL`... treat it as
   a `BLOCKER`" precedent) — before deriving a branch name, before calling
   `setup-worktree.sh` at all, so literally no worktree work happens.
2. **Defense in depth: `setup-worktree.sh` itself.** The orchestrator is not
   the only conceivable caller of this script (it is explicitly documented as
   "the canonical script" other tooling is meant to call rather than
   hand-roll worktree setup). If invoked directly with a `HARNESS_OVERRIDE`
   the implemented set doesn't contain, the script prints `FAIL` and exits
   non-zero **before** any git/worktree operation — mirroring exactly how a
   bad `SPEED` already fails via `resolve-speed.sh` before worktree creation
   today.

Both checks validate against the same source of truth (Decision 4), so they
can never disagree.

### Decision 4 — Single source of truth for "implemented adapters": `lib/config.js`'s `VALID_HARNESSES`, exposed to bash via a new synced env var

`lib/config.js` already defines `VALID_HARNESSES = ['claude-code', 'codex']`
and is what `concertino validate` checks the project's `harnesses` config
array against. Rather than hand-maintaining a second copy of this list in
bash, `concertino sync` writes a new key into `.concertino.env`:

```
CONCERTINO_IMPLEMENTED_HARNESSES='claude-code codex'
```

(space-separated, generated from `VALID_HARNESSES.join(' ')`). Both
`setup-worktree.sh`'s defense-in-depth check and the orchestrator's own
Setup-step check (which can read the same file, or simply hold the same
prose-documented list — the orchestrator is an LLM agent, not a script, so it
reads `VALID_HARNESSES`'s value the same way it already reads other synced
config today) validate against this one value. Adding a third adapter later
only requires updating `VALID_HARNESSES` in `lib/config.js` — this env var and
every consumer of it stay unchanged.

### Decision 5 — `setup-worktree.sh` signature and READY contract, and why the override must NOT flow into model-tier resolution

New optional 4th positional argument, added at the end (backward compatible
— every existing 3-arg call site is unaffected):

```
setup-worktree.sh <TICKET_ID> <BRANCH> [SPEED] [HARNESS_OVERRIDE]
```

**Design-gate round 1 finding (addressed here):** an earlier version of this
decision fed `HARNESS_OVERRIDE` straight into the same `HARNESS` variable
already passed to `resolve-speed.sh "$SPEED" "$HARNESS"` for per-role model
selection. Traced end to end, that broke the exact scenario the ticket
defines as first-class: a ticket labeled `harness:codex`, run by an operator
who is (as today's architecture requires — there is no dispatcher anywhere in
this codebase that launches a different CLI process per ticket) actually
inside a live Claude Code session (`CLAUDECODE` set), would resolve
`MODELS.<role>` to Codex model ids (`codex-mini-latest` / `gpt-5.1-codex` —
`modelTiers.codex.*` in `speeds.json`) and then feed that string into Claude
Code's own `Agent(model=...)` call, which expects a Claude Code model name
(`haiku`/`sonnet`/`opus`) — breaking every sub-agent spawn for that run. The
ticket's acceptance criteria are entirely about which harness is treated as
the ticket's declared *identity* (telemetry, validation, fail-loud-on-unknown)
— they never mention per-role model selection, which is a downstream, already
-shipped concern (`delivery-speed-presets`) that is fundamentally about which
models are *valid for the process actually executing `Agent(...)` calls right
now*, a hard runtime fact a ticket label cannot change.

**Resolution: two variables, deliberately kept apart.**

```bash
RUNTIME_HARNESS="$(detect_harness)"
# Unchanged from pre-CON-62 behavior — this is the ONLY harness value ever
# passed to resolve-speed.sh for MODELS purposes. A ticket override never
# reaches this variable, so per-role model ids always stay valid for the
# harness actually running this process, regardless of what any ticket
# declares.
MODEL_TIER_HARNESS="${RUNTIME_HARNESS:-${CONCERTINO_HARNESS:-unknown}}"

# Identity/telemetry/validate/fail-loud purposes ONLY — this is what
# `READY harness=`, `READY harness_source=`, and the run.start event's
# `harness=` field report. HARNESS_OVERRIDE (already validated against
# CONCERTINO_IMPLEMENTED_HARNESSES per Decision 3/4 before this point) wins
# here even when it contradicts RUNTIME_HARNESS — this is the literal
# "takes precedence... over runtime env-based detection" the acceptance
# criteria ask for, scoped to identity, not to model selection.
if [ -n "${HARNESS_OVERRIDE:-}" ]; then
  HARNESS="$HARNESS_OVERRIDE"
  HARNESS_SOURCE="ticket-override"
else
  HARNESS="$MODEL_TIER_HARNESS"
  HARNESS_SOURCE="${RUNTIME_HARNESS:+runtime-detected}"
  HARNESS_SOURCE="${HARNESS_SOURCE:-${CONCERTINO_HARNESS:+static-default}}"
  HARNESS_SOURCE="${HARNESS_SOURCE:-unknown}"
fi

# resolve-speed.sh is called with MODEL_TIER_HARNESS, never HARNESS —
# see Decision 3a's existing "one authoritative resolution" comment in
# setup-worktree.sh, which this preserves unchanged.
```

This is a deliberate, explicit, narrower exception to `harness-identity`'s
existing "SHALL NOT report a harness value that contradicts a detected
runtime signal" requirement than the earlier draft: the exception applies
only to the identity/telemetry `HARNESS` value, never to `MODEL_TIER_HARNESS`.
When the override and `RUNTIME_HARNESS` agree (the expected common case — an
operator who already knows a ticket is labeled `harness:codex` opens the
Codex CLI to run it), `HARNESS` and `MODEL_TIER_HARNESS` are simply equal and
there is nothing to reconcile. Only the contradicting case is where the two
variables diverge, and only `HARNESS` (identity) reflects the ticket's
stated intent there — `MODEL_TIER_HARNESS` (and therefore every per-role
model id) always reflects reality. A future harness-switching dispatcher that
actually launches the correct CLI per ticket (out of scope here — see
Goals/Non-Goals) would make the two variables converge in practice, at which
point this distinction stops mattering; until then, decoupling them is what
keeps this ticket's override safe to ship without depending on that dispatcher
existing first.

Two new READY lines (additive, existing parsers unaffected):

```
READY harness=<value>
READY harness_source=ticket-override|runtime-detected|static-default|unknown
```

### Decision 6 — `concertino validate --ticket <ID>`

New optional flag on the existing `validate` command. When passed:

- Live-fetches the one named ticket via the configured `ticketProvider`
  (Linear today — reuses `lib/ui/linear.js`'s existing single-issue fetch
  shape rather than a second GraphQL client).
- Parses `labels` for `^harness:(.+)$` exactly as the orchestrator does.
- Reports in the existing Integrations section:
  - No override label found → informational line, same as today's "resolves
    at runtime" message.
  - Override found and valid → informational line naming the ticket and the
    override value, and that it will take precedence.
  - Override found and invalid → a validation **error** (non-zero exit),
    naming the ticket and the unsupported value — this is the concrete
    "surfaces per-ticket harness overrides it finds and validates each
    against the set of implemented adapters" acceptance criterion.
- Omitting `--ticket` behaves exactly as `validate` does today — no
  regression for the existing static-config-only check.

## Risks / Trade-offs

- **[Risk]** A ticket carries a stray label that happens to match
  `harness:...` for unrelated reasons (e.g. a team labels tickets
  `harness:legacy` for an unrelated taxonomy). → **Mitigation**: the
  convention is documented in `docs/config-reference.md` as a reserved
  prefix; an unrecognized value still fails loudly rather than silently doing
  something unexpected, so a false-positive label surfaces immediately as an
  escalation rather than mis-routing a run silently.
- **[Risk]** Duplicating the "implemented harnesses" list across
  `lib/config.js` (JS) and `.concertino.env` (bash) could drift if
  `concertino sync` isn't re-run after `VALID_HARNESSES` changes. →
  **Mitigation**: this is the same trade-off `CONCERTINO_HARNESS` itself
  already accepts (sync-time snapshot, not live) — no new risk class, and
  `concertino sync` is already a required step whenever config changes.
- **[Risk]** The override reaching all the way to a "hard stop" for an
  unsupported harness means a mistyped label (e.g. `harness:claude`, missing
  the `-code`) blocks a run entirely rather than warning-and-falling-back. →
  **Mitigation**: this is the explicit acceptance criterion ("must not fail
  silently or mid-run") — a loud, early, easy-to-fix stop is the intended
  behavior, not an accident.
- **[Risk]** (design-gate round 1) A ticket override that contradicts the
  detected runtime harness could silently feed the wrong harness's model ids
  into the live `Agent(model=...)` call, breaking every sub-agent spawn for
  that run. → **Mitigation**: Decision 5 deliberately decouples identity
  (`HARNESS`, override-aware) from model-tier resolution
  (`MODEL_TIER_HARNESS`, always the actually-detected runtime harness,
  never the override) — a contradicting override changes what telemetry and
  `concertino validate --ticket` report, never which model ids get resolved
  for the process that is actually executing.

## Migration Plan

No data migration. Rollout is additive and backward compatible:
`setup-worktree.sh`'s new 4th arg is optional, `concertino validate`'s new
flag is optional, the new READY lines are additive, and no ticket carries a
`harness:` label until a team starts adding one deliberately. Existing
single- and multi-harness projects see byte-for-byte unchanged behavior for
any ticket with no such label.
