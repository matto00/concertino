## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read all artifacts fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/local-ticket-state-durability/spec.md`, `.openspec.yaml`,
  `workflow-state.md`, and round 1's `skeptic-design-1.md` (as claims to
  re-verify, not as fact).

- **Change Request 1 (broken pathspec) — closed.** `design.md` Decision 2 now
  states, unambiguously and with no second "either works" option: "The one
  correct invocation this design specifies: use the pathspec relative to
  `-C`'s target — `git -C "$DIR" add -- "$ID.md"` and `git -C "$DIR" commit
  -m "<message>" -- "$ID.md"` ... Do not reuse the existing `$FILE`
  variable for either git command's pathspec." `tasks.md` task 1.3 mirrors
  this exactly and explicitly calls out *why not* to reuse `$FILE`
  ("double-prefixes the pathspec against `-C "$DIR"` and fails whenever
  `$DIR` is relative — see design.md Decision 2 for the verified
  reproduction"). I independently re-reproduced both the failure and the fix
  in a scratch repo (not reusing round 1's transcript):
  ```
  -- relative DIR, buggy FILE var --
  fatal: pathspec 'tickets/CON-12.md' did not match any files
  exit=128
  -- relative DIR, fixed basename pathspec --
  exit=0
  commit exit=0
  98db230 test
  ```
  This confirms the revised design/tasks language now specifies exactly the
  invocation shape that works for the real (relative-`$DIR`) production call,
  with no ambiguous "either works" branch left for an implementer to take the
  wrong fork of.

- **Change Request 2 (test suite blind spot) — closed.** `tasks.md` now has
  task 3.7, explicitly labeled "**Required regression test (design.md
  Decision 2)**," which requires invoking the script with a relative
  `<tickets-dir>` from a controlled `cwd` — `(cd "$REPO" && "$SCRIPT" tickets
  CON-12 started)` — mirroring the real orchestrator call shape, and states
  plainly: "This is the case that must fail against a naive `git -C "$DIR"
  add -- "$FILE"` implementation and pass against the `-C "$DIR" ... --
  "$ID.md"` one ... every other planned case in this section uses an
  absolute `mktemp -d` path and cannot catch that defect by itself." This is
  precisely the regression test round 1 required, correctly scoped and
  correctly justified.

- **Task 5.3 softening** — confirmed accurate against the actual checkout:
  `find . -path ./.concertino -prune -o -name set-ticket-state.sh -print`
  (implicitly via repeating round 1's check) shows only `core/scripts/
  set-ticket-state.sh` exists; there is no `scripts/concertino/
  set-ticket-state.sh` synced copy in this repo. Task 5.3's revised wording
  ("As of this change it does not [exist] ... if absent, no action needed")
  matches this reality and no longer implies a nonexistent file needs
  updating.

- Cross-checked `design.md` Decision 2's prose against `tasks.md` 1.2/1.3 and
  `spec.md`'s Requirement 1 — all three now agree on a single invocation
  shape (`-C "$DIR"` + basename-only pathspec), no internal contradiction.

- Re-checked the rest of the artifact set for anything new introduced by the
  revision that might have broken something else: `proposal.md`'s "What
  Changes" section, Decisions 1/3/4, the Risks section, and the spec's three
  requirements/scenarios are otherwise unchanged from round 1 and were
  already found sound. No new placeholders, no new scope drift, no new
  contradictions introduced by the diff between round 1 and round 2.

### Verdict: CONFIRM

### Non-blocking notes

- Task 1.3's commit message example (`tickets: CON-12 -> started`) and the
  spec's requirement text ("a commit message identifying the ticket id and
  the new state") are consistent; exact wording is correctly left free.
- The design's reproduction transcript in Decision 2 and the one I ran
  independently agree on both the failure mode and the fix — this defect
  class (silent double-prefixing under `-C` with a relative directory) is
  now closed at the design level for both the implementation guidance and
  the regression test that will catch a regression of it.
