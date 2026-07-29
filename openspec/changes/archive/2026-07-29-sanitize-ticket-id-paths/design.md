## Context

`emit-event.sh` and `persist-evidence.sh` each resolve the main checkout and then interpolate
`TICKET_ID`/`TICKET` directly into a directory path with no shape check. Three sibling scripts
(`assert-phase.sh`, `start-servers.sh`, `cleanup.sh`) already carry an identical inline guard —
`looks_like_ticket() { [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; }` — added after two prior
incidents (a confirmed shell-injection via `$(...)`, and a `.`-containing id that made a tmux
target ambiguous). `test/scripts/ticket-pattern.test.sh` already asserts those three shell copies
and `lib/ui/ticket.js`'s `TICKET_RE` stay byte-identical. This is a security fix, touches two
call sites with different failure contracts (telemetry must never fail a run; evidence
persistence already has a defined `FAIL`/exit-non-zero contract), and the pattern-duplication
choice needs to be justified once rather than re-litigated per script — hence a design doc.

## Goals / Non-Goals

**Goals:**
- Close the path-traversal exposure in both scripts before the launch pad starts feeding ticket
  ids programmatically.
- Keep exactly one pattern definition in spirit (identical regex text everywhere), even though it
  stays physically duplicated per script, consistent with every existing copy.
- Preserve each script's existing external contract for well-formed ticket ids and existing
  failure modes — this change only narrows what is accepted, never widens or changes shape for
  valid input.

**Non-Goals:**
- Extracting a shared shell library. Every comment in this suite (`emit-event.sh`'s `now_ms()`,
  `persist-evidence.sh`'s `main_checkout()`) is explicit that these scripts stay independent,
  single-file, and sourceable by neither Claude Code nor Codex adapters assuming a shared lib
  path. Adding a sixth inline copy is consistent with five existing ones, not a new problem.
- Changing what a *valid* ticket id may contain. The pattern itself is unchanged; only its set of
  call sites grows.
- Retrofitting validation into scripts the sweep found clean (`gather-escalation-context.sh`,
  `start-servers.sh`'s own body beyond the existing guard, `setup-worktree.sh`).

## Decisions

**1. Validate before any directory is touched, in both scripts.**
`persist-evidence.sh` currently checks `SOURCE_PATH` readability, then resolves the main
checkout, then builds `DEST_DIR` and `mkdir -p`s it. The ticket-shape check is inserted
immediately after argument parsing — before `main_checkout` is even called — so a rejected id
never causes any filesystem side effect, matching the acceptance criterion that traversal must
produce *no write*, not merely a write followed by cleanup. Same placement in `emit-event.sh`:
before `RUN_DIR` is computed, ahead of the `mkdir -p "$RUN_DIR"` line.

**2. Two different failure shapes, matching each script's existing contract — not a new shared one.**
- `emit-event.sh`: on a rejected `TICKET`, behave exactly as the existing `[ -z "$TICKET" ] && exit
  0` early-return two lines above it already does — print nothing, write nothing, exit 0. This is
  the tier-2 telemetry degradation the ticket calls for ("emit nothing rather than write somewhere
  wrong"), and it is already the script's behavior for the *empty*-ticket case; an invalid-shape
  ticket is folded into the same branch rather than inventing new stderr/exit-code conventions
  telemetry has never had. The one exception already in the script — `--await`'s blocking path —
  is reached only after the same early check, so it inherits the guard for free; no separate check
  needed there. Alternative considered: print a warning to stderr. Rejected — nothing currently
  reads this script's stderr in the normal (non-`--await`) path, and adding the first such
  contract for one failure mode is more surface than the fix needs.
- `persist-evidence.sh`: on a rejected `TICKET_ID`, follow the script's existing `FAIL <reason>` /
  exit-non-zero / no-`READY`-line contract, identical in shape to "source missing" and "copy
  cannot be written". Every call site already treats this script as `|| true` and omits `ref` on
  any non-zero exit (evidence-telemetry spec, "A failed persist does not produce a broken evidence
  event"), so no caller changes. Alternative considered: silently no-op like `emit-event.sh`.
  Rejected — `persist-evidence.sh` is a synchronous copy operation with a defined failure contract
  callers already branch on (`persist_out="$(...)" || ...`); staying inside that contract is less
  change than adding a second, telemetry-style silent-drop mode to a script that has never had one.

**3. Reuse the literal pattern text, not a refactor.**
Both new checks use the exact bracket expression
`^[A-Za-z#][A-Za-z0-9_-]*[0-9]$`, copy-pasted, matching Decision non-goal above. This keeps
`test/scripts/ticket-pattern.test.sh`'s "byte-identical across every copy" assertion meaningful
once extended to the two new call sites — a fifth copy that drifted by even one character would
be caught by the same mechanism that already guards the first three.

**4. Extend the existing pattern test rather than write a parallel one.**
`ticket-pattern.test.sh` already has the extraction/comparison machinery; it grows two more
`extract()` calls (for `emit-event.sh` and `persist-evidence.sh`) and folds them into the existing
all-equal comparison, plus the `../escape`-shaped case is exercised directly at the script level
(new assertions in `emit-event.test.sh` and `persist-evidence.test.sh`) rather than only at the
regex level — the acceptance criteria ask for filesystem-level proof (nothing written outside the
runs directory), which a pure regex test cannot demonstrate.

## Risks / Trade-offs

- [Risk] A legitimate ticket id shaped outside the pattern (e.g. lowercase-only, or ending in a
  letter) now silently loses telemetry / fails evidence persistence, with no loud signal in the
  common case. → Mitigation: this is the exact same risk the three existing guarded scripts
  already accept, using the identical pattern; CON-14 does not change what "ticket-shaped" means,
  only which scripts enforce it. If the pattern itself is ever found too narrow, that is a
  separate ticket against `looks_like_ticket`/`TICKET_RE`, not this one.
- [Risk] Six independent copies of the same regex (five shell + one JS) is a real drift hazard.
  → Mitigation: `ticket-pattern.test.sh` is the guardrail, extended by this change to cover all
  five shell copies; it already fails loudly on any divergence.
- [Trade-off] `persist-evidence.sh` and `emit-event.sh` now disagree in shape on how they fail
  (exit-non-zero-with-stderr vs. silent exit-0). → Accepted: this mirrors the two scripts'
  pre-existing, different failure contracts for every *other* failure cause already in each
  script (see Decision 2); introducing a single shared failure shape here would be the actual
  inconsistency.

## Migration Plan

No data migration. Both scripts remain backward compatible for every ticket id already accepted
by `looks_like_ticket` (i.e. every id any current call site has ever successfully produced —
`setup-worktree.sh` derives worktree paths from a validated ticket-shaped branch suffix already).
Roll out is the commit landing on `main`; no flag, no staged rollout. Rollback is a plain revert —
neither change touches persisted state format.

## Open Questions

None — the pattern, its placement, and both scripts' failure shapes are fully determined by
existing precedent in this suite.
