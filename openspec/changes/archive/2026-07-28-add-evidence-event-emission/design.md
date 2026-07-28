## Context

`lib/ui/reducer.js` and `lib/ui/screens/drilldown.js` already implement the
`evidence` event fully (slice 2b): any event kind is folded generically into
`run.events` (no reducer `case` is needed for a kind to appear in the
timeline), and `evidenceLines()` in `drilldown.js` already filters
`run.events` for `kind === 'evidence'` and renders `label || ref ||
'(untitled)'`, falling back to `no evidence recorded` when the list is empty.
So this change is scoped entirely to **emission**: a script + role-doc change,
zero UI/reducer code.

`WORKTREE_PATH` (e.g.
`.concertino/worktrees/feature/.../CON-10`) is, on disk, a subdirectory of the
main checkout — but it is still a `git worktree`, and `cleanup.sh --phase4`
removes it (`git worktree remove --force` + the directory). `.concertino/runs/<TICKET>/`
lives in the main checkout and is never touched by `cleanup.sh`. Both the
evaluator's and skeptic's report files, and the orchestrator's planning
artifacts, are written under `WORKTREE_PATH` today — so a `ref` built from
their natural location is a path that stops resolving the moment
`cleanup.sh --phase4` runs, which is exactly when a run has succeeded and a
human is most likely to want to read the evidence.

## Goals / Non-Goals

**Goals:**
- Every planning artifact, evaluation report, and skeptic report the run
  produces gets an evidence `ref` that resolves from the dashboard's working
  directory (the main checkout) both before and after Phase-4 cleanup.
- Reuse the `run.start`/`gate.result`/`verdict` pattern of small,
  independent, idempotent, `READY`/`FAIL`-contracted scripts rather than
  asking an LLM role to hand-roll a copy + JSON-emit sequence from prose.
- Decide, explicitly, whether evaluator/skeptic reports need a *second*,
  redundant `evidence` event alongside their existing `verdict` event.

**Non-Goals:**
- No retention/rotation policy for `.concertino/runs/<TICKET>/evidence/` —
  out of scope, matches the fact that `events.jsonl` itself has none either.
- No dashboard "open this file" keybinding — the drill-down already only
  *displays* `ref`/`label` as text (`describeEvent`/`evidenceLines`); making
  it launch `$EDITOR` is a separate, unrequested feature.
- No change to `TIER2_KINDS`/`TIER3_KINDS` classification in `reducer.js` —
  the ticket's acceptance criteria don't ask for `evidence` to affect the
  `telemetry: full|partial|none` computation, and doing so is a behavior
  change (a run could now report `full` telemetry based on artifact
  side-effects rather than only agent-authored coordination events) this
  ticket has no mandate to make.

## Decisions

### 1. A new script, `persist-evidence.sh`, owns the durable-copy step

`persist-evidence.sh <TICKET_ID> <SOURCE_PATH>`:
- Resolves the main checkout the same way `emit-event.sh` does
  (`git rev-parse --git-common-dir`, normalised for relative/absolute output
  across git versions) — duplicated rather than sourced, matching every
  other procedure script's existing "independent, no shared lib" shape (see
  `emit-event.sh`'s own comment on why `now_ms()` is copied rather than
  imported).
- Copies `SOURCE_PATH` to
  `<main checkout>/.concertino/runs/<TICKET_ID>/evidence/$(basename SOURCE_PATH)`,
  creating the directory as needed.
- On success prints `READY ref=<absolute destination path>` — the same
  `READY key=value` contract `setup-worktree.sh` already uses, not
  `emit-event.sh`'s "always exit 0" telemetry contract, because this script's
  job is a real file operation that can genuinely fail (missing source,
  unwritable destination) and callers need to know that before building an
  event around a `ref` that was never actually persisted.
- On failure (source missing/unreadable, copy fails) prints `FAIL <reason>`
  to stderr and exits non-zero. **No event is emitted in this case** — an
  unresolvable `ref` is worse than no evidence event, so a caller only emits
  once `persist-evidence.sh` has confirmed the copy exists.
- Idempotent/re-runnable: re-persisting the same source overwrites the
  previous copy, matching the existing scripts' contract.

Alternative considered: fold the copy step directly into `emit-event.sh`
(e.g. a `--persist=<path>` flag). Rejected — `emit-event.sh`'s one job is
"append a line, never fail the caller"; giving it a real filesystem
side-effect with its own failure mode would break that single-purpose
contract and its "always exits 0" guarantee (which callers throughout the
codebase rely on via `|| true`). Two small scripts, each honest about its own
contract, is more in keeping with the existing script suite than one script
serving two contracts.

Alternative considered: embed report content directly in the event line
(the way CON-1's `first_error` carries content, not a pointer, specifically
to dodge this exact trap). Rejected for reports — `first_error` is one
truncated line; a proposal, design doc, evaluation report, or skeptic report
is routinely multiple KB, far past `emit-event.sh`'s 4000-byte per-line cap.
A durable *copy* is the content-carrying move at this size, not a copy of
the bytes into the JSON line itself.

### 2. The orchestrator emits `evidence` for planning artifacts; evaluator/skeptic do not emit a second one for their reports

The ticket explicitly asks this to be decided and justified rather than
defaulted. Two facts drive it:

- **Planning artifacts have no other event that carries a path to them
  today.** `proposal.md`/`design.md`/`tasks.md`/spec deltas are produced in
  Phase 1 and referenced by nothing in the event log — that is the actual
  gap the ticket's "no role or script ever emits one" line describes. A
  dedicated `evidence` event is the only way these become visible in the
  drill-down at all.
- **Evaluator/skeptic reports already have one: `verdict.ref`.** The
  drill-down timeline already renders it (`describeEvent`'s `verdict` case
  shows `ev.ref` as the line's detail — covered by the existing test
  `"at 78 cols, a verdict's report reference is no longer truncated away"`).
  Adding a second `evidence` event pointing at the *identical* file would put
  the same path in two places in the same run's log for zero additional
  information — pure duplication, which cuts against this codebase's
  standing preference for events that each carry a fact nothing else
  already carries (see `emit-event.sh`'s own handling of `t=`/`kind=`
  overrides, and the `escalation.answer_discarded` event, both written
  specifically to avoid a duplicate or misleading record rather than staying
  silent).

So: `verdict`'s `ref` is fixed to be durable (via `persist-evidence.sh`) for
both evaluator and skeptic, and that is the only change at those two call
sites — no new `evidence` event kind is emitted there. The EVIDENCE panel
will therefore, after this change, list planning artifacts; evaluation and
skeptic reports remain visible via the TIMELINE's `verdict` lines, which
already show the (now-durable) `ref`.

Alternative considered: emit both `evidence` and `verdict` for every
evaluator/skeptic report, matching the AC's most literal reading. Rejected
per the ticket's own explicit steer ("Emitting both by default without
deciding would be the wrong answer either way") and the duplication argument
above.

### 3. `ref` is always an absolute path into the main checkout, never worktree-relative

Every call site (`orchestrator`, `evaluator`, `skeptic`) builds `ref` from
`persist-evidence.sh`'s `READY ref=<path>` output, never from the artifact's
original `WORKTREE_PATH`-relative location. This is true for both the
orchestrator's dedicated `evidence` events and the evaluator/skeptic's
`verdict.ref`.

**Corner case: `persist-evidence.sh` itself fails for an evaluator/skeptic
report.** The orchestrator's planning-artifact loop already handles its own
`FAIL` case correctly (skip that artifact's `evidence` event, task 2.2) — the
evaluator/skeptic's `verdict` event needed the equivalent treatment, since
`verdict` is unconditionally mandatory (a run must always report a
PASS/FAIL/BLOCKER or CONFIRM/REFUTE/BLOCKER outcome) and so cannot simply be
skipped the way a discretionary `evidence` event can. The only fix consistent
with this decision's own unconditional language is: emit `verdict` with no
`ref` field at all when `persist-evidence.sh` fails, never with the raw
`WORKTREE_PATH`-relative path. `lib/ui/screens/drilldown.js`'s `verdict` case
already renders `ev.ref || ''` — an absent `ref` degrades to an empty detail
column, not an error — so this costs nothing on the UI side and keeps the
"never worktree-relative" guarantee unconditional rather than carving out an
exception for the one path (a `persist-evidence.sh` failure) most likely to
correlate with the destination being genuinely broken.

## Risks / Trade-offs

- **Disk growth**: each evidence copy duplicates a (typically small,
  markdown) artifact under `.concertino/runs/<TICKET>/evidence/`. No
  retention policy exists for `events.jsonl` either; out of scope here, same
  as Non-Goals.
- **Divergence between the copy and a live artifact**: if an artifact is
  re-persisted (e.g. the evaluator re-runs on cycle 2, overwriting
  `evaluation-1.md`... no — filenames already carry the cycle/gate/round
  number, e.g. `evaluation-2.md`, `skeptic-final-2.md`, so distinct cycles
  never collide and never overwrite each other's evidence copy). A single
  cycle's own report being persisted twice (e.g. a retried bash call) is a
  harmless idempotent overwrite of identical content.
- **`persist-evidence.sh` failing silently from a caller's perspective**: a
  role's `[ -n "$REF" ] && emit-event.sh ... || true` pattern (mirroring the
  rest of the telemetry call sites) means a copy failure quietly produces no
  evidence event rather than blocking the run — intentional, matching "never
  let telemetry block delivery," but means a persistently failing evidence
  copy (e.g. an unwritable `.concertino/runs/` in some deployment) would go
  unnoticed by the run itself. Same trade-off `emit-event.sh` already makes
  for every other event kind.

## Migration Plan

No migration — purely additive. Existing runs' logs are untouched; a run
that never emitted `evidence` still renders "no evidence recorded" honestly,
which is required to keep working (AC: "the existing `no evidence recorded`
path still renders for a run that genuinely has none").

After the role docs and `core/scripts/persist-evidence.sh` are added,
`node bin/concertino sync` must be run inside the worktree so this
repo's own `.claude/agents/concertino-{orchestrator,evaluator,skeptic}.md`
and `scripts/concertino/persist-evidence.sh` (the rendered copies this very
repo dogfoods) pick up the change — otherwise the source-of-truth `core/`
files change but the agents actually invoked in this repo do not.
