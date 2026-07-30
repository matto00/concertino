## Context

`persist-evidence.sh <TICKET_ID> <SOURCE_PATH>` copies `SOURCE_PATH` to
`<main checkout>/.concertino/runs/<TICKET_ID>/evidence/<basename(SOURCE_PATH)>`. Every caller
(the orchestrator's per-planning-artifact evidence emission, and the evaluator/skeptic's
`verdict.ref`) writes its artifact somewhere under that run's `WORKTREE_PATH`. Two real artifact
paths from a single run — `openspec/changes/<change>/specs/ticket-id-path-safety/spec.md` and
`openspec/changes/<change>/specs/evidence-telemetry/spec.md` — differ only in a directory
component above the filename, and both currently resolve to `evidence/spec.md`. The second call's
`cp -f` clobbers the first with no error, no differing exit code, and no distinguishing
information in the `READY ref=` line either caller goes on to log.

## Goals / Non-Goals

**Goals:**
- Two source paths that differ anywhere above the filename land at distinct destinations under
  `evidence/`.
- The same source path, called repeatedly (as the idempotency contract requires), keeps resolving
  to the same destination and overwrites only itself.
- Refs stay human-readable in an event log — no hash or opaque counter suffix.
- A path the script cannot safely relate to a worktree root fails loudly (`FAIL` + non-zero exit)
  rather than falling back to a scheme that could silently collide again.
- The script's CLI, its `READY ref=`/`FAIL` output contract, and every existing caller's
  invocation are unchanged — this only changes how `DEST_PATH` is derived internally.

**Non-Goals:**
- Not attempting to dedupe or diff *content* — two genuinely different artifacts that happen to
  collide on basename are kept as two files; nothing is merged.
- Not changing `evidence`/`verdict` event emission, `main_checkout()`, or the `TICKET_ID` shape
  validation — those are all unaffected by this change.
- Not handling `SOURCE_PATH`s that live entirely outside any git working tree (main checkout or a
  worktree) as a first-class case — see Decisions below on why `FAIL` is the right behavior there.
  (One real caller, `emit-event.sh`'s oversized-escalation-context path, did do this via a bare
  `mktemp -d`; per the Risks section below, that caller was fixed in place to stage its temp file
  inside the main checkout instead, rather than weakening this contract.)

## Decisions

**Derive `DEST_PATH` from `SOURCE_PATH`'s path relative to its own git worktree top-level, not
just its basename.**

1. Resolve `SOURCE_PATH` to an absolute, symlink-free path (`SRC_ABS`), the same way the script
   already resolves the main checkout — via `cd` + `pwd`, no external `realpath` dependency
   (consistent with the rest of the script, which avoids new binary dependencies).
2. Resolve the **top-level of the git working tree that contains `SOURCE_PATH`** via
   `git -C "$(dirname "$SRC_ABS")" rev-parse --show-toplevel`. This is deliberately the *worktree's
   own* toplevel, not `main_checkout()`'s shared `git-common-dir` — a worktree's toplevel is its
   own working directory (e.g. `$REPO/wt`), which is exactly the root every caller's artifact path
   is naturally relative to (`openspec/changes/<change>/...`).
3. `DEST_PATH = ${DEST_DIR}/<SRC_ABS with the toplevel prefix stripped>`, creating whatever
   intermediate directories that relative path implies under `evidence/` (`mkdir -p
   "$(dirname "$DEST_PATH")"`).
4. If step 2 fails (`SOURCE_PATH` is not inside any git working tree) — or the resolved absolute
   path is not actually prefixed by the resolved toplevel, which should not happen but is checked
   rather than assumed — the script prints `FAIL <reason>` and exits non-zero. It never falls back
   to a basename-only destination for that source.

Why this over the alternatives considered:
- **Hash or counter suffix** (e.g. `spec-a1b2c3.md`, `spec-2.md`): satisfies the collision
  requirement but reads worse in an event log — a human scanning `evidence` events for "the
  `ticket-id-path-safety` spec delta" has to open the file to find out, rather than reading it off
  the ref. The ticket's own acceptance criteria call this out as inferior for exactly this reason.
- **Full absolute source path minus leading `/`** (no worktree-relative step): avoids depending on
  git at all, but embeds the entire worktree location (including
  `.concertino/worktrees/<branch>/<ticket>/...`) into the persisted path, which is neither stable
  across runs (`.concertino/worktrees/...` differs per delivery) nor as readable as a path rooted
  at the artifact's own logical root (`openspec/changes/...`).
- **Hardcode a strip of a known prefix like `openspec/changes/<change>/`**: works for the planning
  artifacts (proposal/design/tasks/specs) but not for evaluator/skeptic reports, which live
  elsewhere in the worktree (e.g. under an evaluator-owned reports directory) — a git-toplevel-
  relative path is the one thing every caller's artifact path already shares.

**Idempotency is preserved for free.** Because `DEST_PATH` is a pure function of `SOURCE_PATH`
(via its resolved absolute path and worktree toplevel), calling the script twice for the same
source always derives the same `DEST_PATH`, and `cp -f` continues to overwrite it in place — no
special-casing needed to keep the existing "Idempotent/re-runnable" contract.

## Risks / Trade-offs

- **[Risk]** A `SOURCE_PATH` outside any git working tree now fails where it previously (silently)
  succeeded with a basename-only destination. → **Mitigation:** this was initially assessed as "no
  current caller does this," which turned out to be factually wrong — running the full `npm test`
  suite surfaced exactly one real caller that did: `emit-event.sh`'s `write_escalation_raised`
  stages an oversized escalation `context` field to a `mktemp -d` temp file (deliberately outside
  any git repo, since it lives under `/tmp`) before handing it to `persist-evidence.sh`. That call
  started failing under the new contract, breaking 2 of `emit-event.test.sh`'s 74 assertions
  (`oversized context: context_ref file exists` / `...ref content is the full untruncated
  context`). Rather than weaken `persist-evidence.sh`'s new FAIL-outside-any-git-worktree
  invariant — which would reopen exactly the silent-collision risk this change closes — this
  change's scope was extended to fix the caller instead: `write_escalation_raised` now stages that
  temp file under `ROOT` (the resolved main checkout, itself guaranteed to be a git working tree)
  via `mktemp -d "${ROOT}/.escalation-context-tmp.XXXXXX"` instead of a bare `mktemp -d`, so the
  path it hands to `persist-evidence.sh` is compliant with the new invariant. Every other artifact
  this script is invoked on (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, spec deltas,
  evaluator/skeptic reports) is already written inside `WORKTREE_PATH`, which is always a git
  worktree by construction (`setup-worktree.sh`), so no other caller was affected.
- **[Risk]** Destination paths are now deeper (`evidence/openspec/changes/<change>/specs/<cap>/
  spec.md` instead of `evidence/spec.md`), which is a larger visible change to anyone currently
  reading these refs. → **Mitigation:** the ref is still a real, readable path printed in full in
  every `READY ref=`/`evidence`/`verdict` line; nothing needs to reconstruct it from a shorter
  form. No caller does string-matching on the destination shape — they only ever relay the printed
  `ref=` value.
- **[Risk]** Existing tests that hardcode an expected `DEST_PATH` assuming basename-only naming
  need re-checking. → **Mitigation:** every existing test in `test/scripts/persist-evidence.test.sh`
  places its source file directly at the worktree/repo root (no subdirectory), so the
  worktree-relative path equals the basename in every existing case — those assertions are
  expected to keep passing unmodified. New coverage is added for the collision case, which does
  put sources in distinguishing subdirectories.
- **[Risk]** A downstream **consumer** that independently reconstructs a destination path — rather
  than relaying a `READY ref=` value read from the event log — can silently break even though no
  *caller* of `persist-evidence.sh` changed. This was missed in the initial Impact assessment
  (which only enumerated callers) and surfaced by the final-gate skeptic (`skeptic-final-1.md`):
  `lib/ui/ticket-text.js`'s `persistedPath()` hardcoded the old flat `evidence/ticket.md` path to
  find the drill-down's persisted ticket snapshot — an already-merged, spec-locked feature
  (`drilldown-ticket-context`). A real `ticket.md`'s `SOURCE_PATH` is always
  `WORKTREE_PATH/<change-dir>/ticket.md` (never the worktree root), so under this change's new
  worktree-relative scheme it always lands nested (e.g. `evidence/openspec/changes/<change>/
  ticket.md`), never at the flat path `persistedPath()` looked for — a **total** regression for
  every future run, degrading the drill-down to the launch pad cache and violating
  `drilldown-ticket-context`'s "survives worktree removal" guarantee outright. → **Mitigation
  (human-directed, option 2 — update the consumer and its spec, not `persist-evidence.sh`):**
  `persistedPath()` now performs a small, bounded depth-first search under
  `.concertino/runs/<TICKET_ID>/evidence/` for a file named `ticket.md`, rather than assuming a
  fixed relative path.
  This was deliberately implemented as a **search**, not a **reconstruction** of the specific
  nested shape (e.g. by threading a `changeName` and this project's `specProvider.changeDir`
  template through `resolve()`'s call sites): `lib/ui/*` never reads `concertino.config.json`
  anywhere else — it is driven purely from `.concertino/` runtime state — so hardcoding one
  project's spec-provider convention (`openspec/changes/...`) into the dashboard would silently
  break for any project configured with a different `specProvider.changeDir` (or none at all), and
  threading config through `resolve()`'s callers would be a materially larger, riskier change than
  this ticket's scope. Searching is provider-agnostic, requires no new plumbing, and is safe
  because `ticket.md` is persisted at most once per run (orchestrator.md Phase 1) — there is never
  more than one candidate to find. `drilldown-ticket-context/spec.md` is updated (spec delta in
  this change) to describe resolution by search rather than a fixed relative path, and
  `test/ticket-text.test.js` gained a regression test that invokes the real
  `core/scripts/persist-evidence.sh` on a real `ticket.md`-shaped nested source and confirms
  `resolve()` finds it — closing the exact gap (`withPersisted()`'s hand-placed fixture never
  exercised the real script) that let this regression through `npm test` in the first place.

## Migration Plan

No migration needed — this only changes how a fresh `persist-evidence.sh` invocation names its
destination going forward; it does not touch or rename previously-persisted evidence from earlier
runs. `core/scripts/persist-evidence.sh` is the canonical source; `scripts/concertino/
persist-evidence.sh` (the synced copy actually invoked by the orchestrator/evaluator/skeptic in
this repo) must be regenerated via `concertino sync` after the source changes, not hand-edited.

## Open Questions

None — the ticket's acceptance criteria fully determine the required behavior; the only design
freedom was which collision-safe naming scheme to use, decided above.
