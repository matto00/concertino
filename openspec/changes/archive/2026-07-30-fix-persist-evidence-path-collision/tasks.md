## 1. Implement collision-safe destination naming

- [x] 1.1 In `core/scripts/persist-evidence.sh`, replace the basename-only `DEST_PATH`
      derivation with one based on `SOURCE_PATH`'s path relative to the top-level of the git
      working tree that contains it (`git -C "$(dirname "$SRC_ABS")" rev-parse --show-toplevel`),
      per design.md's Decisions section.
- [x] 1.2 Create the destination's intermediate directories (`mkdir -p
      "$(dirname "$DEST_PATH")"`) before the `cp -f`.
- [x] 1.3 When the source is not inside any git working tree (or the resolved absolute path is
      unexpectedly not prefixed by the resolved toplevel), print `FAIL <reason>` to stderr and
      exit non-zero without copying anything or emitting `READY`.
- [x] 1.4 Update the script's header comment to describe the new destination-naming scheme (it
      currently only mentions the flat `evidence/<basename>` layout).

## 2. Regenerate the synced copy

- [x] 2.1 Run `concertino sync` (or the project's equivalent) so
      `scripts/concertino/persist-evidence.sh` matches the updated
      `core/scripts/persist-evidence.sh` — do not hand-edit the synced copy.
- [x] 2.2 Confirm the two files are identical after sync (`diff core/scripts/persist-evidence.sh
      scripts/concertino/persist-evidence.sh`).

## 3. Tests

- [x] 3.1 Add a test case to `test/scripts/persist-evidence.test.sh` covering two source paths
      that share a basename (`spec.md`) but live in different directories within the same
      worktree — assert both `READY ref=` lines print, both destination files exist, and each
      resolves to its own source's content.
- [x] 3.2 Add a test case for a `SOURCE_PATH` that exists and is readable but is outside any git
      working tree — assert `FAIL`, non-zero exit, and no `READY` line.
- [x] 3.3 Re-run the full existing `test/scripts/persist-evidence.test.sh` suite and confirm every
      pre-existing scenario (main-checkout-not-worktree, survives worktree removal, missing
      source, idempotent re-run, traversal-shaped ticket ID) still passes unmodified — the
      worktree-relative path equals the basename in every existing case since those tests place
      sources directly at the worktree/repo root, so no hardcoded expected paths should need to
      change.
- [x] 3.4 Run the full project test suite (`npm test`) to confirm no other script or test depends
      on the old flat `evidence/<basename>` layout. Surfaced a real regression in
      `test/scripts/emit-event.test.sh` (2 of 74 assertions), resolved by task 3.5 below rather than
      by weakening persist-evidence.sh's contract — see design.md's Risks section for the full
      account. Now fully green (confirmed by re-running both
      `test/scripts/persist-evidence.test.sh` and `test/scripts/emit-event.test.sh` after 3.5, and
      by `npm test` as a whole).

## 3.5 Fix the one real caller broken by the new FAIL-outside-any-git-worktree contract

- [x] 3.5 In `core/scripts/emit-event.sh`'s `write_escalation_raised`, stage the oversized-context
      temp file under `ROOT` (the resolved main checkout, itself always a git working tree) via
      `mktemp -d "${ROOT}/.escalation-context-tmp.XXXXXX"` instead of a bare `mktemp -d` (which
      lands under `/tmp`, outside any git repo). Preserves the existing cleanup semantics (`rm -rf
      "$tmp_dir"` regardless of outcome), the fallback-to-no-`context_ref` behavior if persist still
      fails, and the 4000-byte line-cap logic, all untouched. Re-sync
      `scripts/concertino/emit-event.sh` via `concertino sync` (same pattern as 2.1/2.2) rather than
      hand-editing it.

## 3.6 Fix the one real consumer broken by the new destination-naming scheme

Surfaced by the final-gate skeptic (`skeptic-final-1.md`, REFUTE) after task 4.1: `npm test`'s
green run gave no signal because `test/ticket-text.test.js` hand-places its fixture at the old
flat path instead of exercising the real script — see design.md's Risks section for the full
account and the human's directed resolution (option 2 — update the consumer and its spec, not
`persist-evidence.sh`).

- [x] 3.6.1 Update `lib/ui/ticket-text.js`'s `persistedPath()` so it locates a persisted
      `ticket.md` correctly under the new worktree-relative destination-naming scheme, instead of
      assuming the old flat `evidence/ticket.md` path. Implemented as a bounded search under
      `.concertino/runs/<TICKET_ID>/evidence/` rather than reconstructing the exact nested shape
      (see design.md's Risks section for why: `lib/ui/*` does not read `concertino.config.json`
      anywhere else, and hardcoding this project's `openspec/changes/...` convention would break
      for a project configured with a different spec provider).
- [x] 3.6.2 Add a spec delta to `drilldown-ticket-context` (this change's `specs/` directory)
      updating the "persisted `ticket.md` at `.concertino/runs/<TICKET_ID>/evidence/ticket.md`"
      requirement to describe resolution by search rather than a fixed relative path.
- [x] 3.6.3 Add a regression test to `test/ticket-text.test.js` that invokes the real
      `core/scripts/persist-evidence.sh` on a real `ticket.md`-shaped source nested under
      `openspec/changes/<change>/` and confirms `resolve()` finds it — closing the exact gap
      (`withPersisted()`'s hand-placed fixture never exercised the real script) that let the
      original regression through `npm test`.
- [x] 3.6.4 Check whether any other consumer independently reconstructs a `persist-evidence.sh`
      destination path (as opposed to relaying a `ref=` value already read from the event log).
      Grepped `lib/`/`bin/` for any other `.concertino/runs/.../evidence` path construction —
      `lib/ui/screens/drilldown.js`'s evidence-list rendering and the CON-19 evidence reader both
      only use the already-logged `ref=` string; `ticket-text.js` was the only such call site.
- [x] 3.6.5 Re-run `test/ticket-text.test.js` and the full `npm test` to confirm the drill-down's
      ticket-text resolution genuinely finds a `ticket.md` persisted by the *updated*
      `persist-evidence.sh`, not just the pre-existing hand-placed fixture.

## 4. Handoff

- [x] 4.1 Record which files were modified in a `files-modified.md` note in this change's
      directory for the orchestrator's delivery step.
