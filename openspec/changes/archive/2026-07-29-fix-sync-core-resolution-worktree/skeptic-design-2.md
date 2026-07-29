## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/core-resolution/spec.md` in full (all revised since round 1), and the
  round-1 skeptic report (`skeptic-design-1.md`) for context only.
- Re-ran `grep -n "CORE\b" bin/concertino` and
  `grep -n "copyAssets(\|emitClaude(\|emitCodex(\|readRoleFile(\|function cmdInit\|function cmdEject\|function cmdDiff\|function cmdSync\|function cmdDoctor\|function cmdUpdate\|checkArtifacts(" bin/concertino`
  against the real file to check the revision's Decision 5 / Impact claims,
  not just trust them.
- Read the real `readRoleFile` (:90-93), `emitClaude` (:403-433), `emitCodex`
  (:435-468), `cmdEject` (:662-716), `cmdUpdate` (:1304-1339), `cmdInit`
  (:1351-1394) to confirm every call site and the exact CORE-dependency shape
  design.md's Context/Decision 5 describe.
- Read `main_checkout()` in `core/scripts/emit-event.sh` (:58-67) to confirm
  the mechanism Decision 1 claims to mirror.
- Grepped all five planning docs for `refus|non-zero|exit 1|exit non` to
  confirm no residual contradiction on the refuse-vs-pick question survives
  the revision.
- Checked `test/scripts/` and `package.json`'s `test` script for existing
  coverage of `cmdEject`/`cmdDiff` — confirmed none exists today (only
  unrelated `test/control.test.js` uses the word "refused" for TUI restart
  logic, not CLI eject/diff).
- **Independently reproduced, with real `git` commands in throwaway repos,**
  whether Decision 1's ancestry check ("matching `git rev-parse
  --git-common-dir`") actually distinguishes the npm-installed case from a
  worktree of Concertino's own repo, for the topology that a real npm install
  actually produces (see Finding A below) — not just trusted the design's
  prose claim that it "cannot false-positive."
- Confirmed via `git worktree list` in this actual repo that this project's
  own delivery worktrees are created *nested inside* the main checkout
  (`.concertino/worktrees/...`), which is directly relevant to Finding A.

### Finding 1 (round 1) — re-verified: genuinely resolved

`tasks.md`, `design.md`, and `spec.md` now agree with each other and with the
ticket's literal AC: the worktree-diverged-core case renders successfully
from the target's own core and prints a divergence note (`design.md` Decision
2; `spec.md` "Divergence... announced, not silent" requirement and its
scenario; `tasks.md` 3.1). No task or requirement anywhere describes a
refusal/non-zero-exit outcome anymore — the `grep` for
`refus|non-zero|exit` across all five docs shows every remaining mention is
in `ticket.md`'s original notes (the human's open question) or `design.md`'s
own Decision 2 rationale explaining why refusal was rejected. `tasks.md` and
`spec.md` have zero such mentions. No internal contradiction remains.

### Finding 2 (round 1) — mostly resolved; one residual test-coverage gap

Design.md's Context (:5-13) and Decision 5 (:212-226) now correctly name, and
match against the real file, every function that touches `CORE` — directly
or by forwarding it to a function that does: `readRoleFile` (:92, direct),
`emitCodex` (:438, direct *and* via `readRoleFile` at :458), `emitClaude`
(indirect, via `readRoleFile` at :411 — correctly listed even though
`emitClaude` itself never reads `CORE` directly), `copyAssets` (:472-478,
direct), `checkArtifacts` (:773-777, direct) — and all six commands
(`cmdSync`, `cmdDoctor`, `cmdUpdate`, `cmdInit`, `cmdEject`, `cmdDiff`), which
I confirmed by reading each one: `cmdInit` really does call `copyAssets`
directly at :1381, *before* its own trailing `cmdSync(...)` call at :1394,
exactly as design.md claims; `cmdEject` really does call `readRoleFile`
independently at :691/:703; `cmdUpdate` doesn't read `CORE` itself but simply
forwards to `cmdSync(args)` at the end (:1339), so no separate resolution is
strictly needed there — harmless over-statement, not a gap.

New task 3.5 (init smoke test) closes the specific hole round 1 called out
for `cmdInit`. However, **`cmdEject` and `cmdDiff` still have zero planned
test coverage**, despite `spec.md`'s own "Every core-reading code path uses
the resolved core" requirement explicitly promising a scenario for them
("eject and diff read from the resolved core", spec.md:87-91). `tasks.md`'s
test section (3.1-3.6) only exercises `sync` (3.1-3.4) and `init` (3.5) —
no task creates the eject/diff test the spec itself commits to, and no
existing test in `test/` invokes `concertino eject` or `concertino diff` at
all (confirmed by grep — only unrelated TUI "refused" tests exist). If the
executor's parameter-threading refactor misses a call site inside `cmdEject`
or `cmdDiff`, nothing in this plan's test suite, nor `node --check`, would
catch the resulting `ReferenceError` before delivery.

### Finding 3 (round 1) — NOT actually resolved; concrete reproduction

`design.md`'s Non-Goals (:71-76) and Decision 1 (:118-127) now explicitly
claim the common-dir ancestry check "is exact" and "cannot false-positive on
an unrelated consumer project that happens to have its own top-level `core/`
directory for unrelated reasons." I tested this claim directly rather than
trusting the prose, because round 1 flagged exactly this class of bug and
the fix needs to actually close it, not just claim to.

Reproduction (real `git`, throwaway repo, simulating a git-tracked consumer
project `myproject` that has `npm install`ed `concertino` — the *ordinary*
real-world npm-installed topology, not the artificial one `tasks.md` 3.3
tests):

```
mkdir myproject && cd myproject && git init -q
mkdir -p node_modules/concertino core     # core/ = myproject's OWN unrelated dir
git add -A && git commit -q -m init
cd node_modules/concertino
$ git rev-parse --git-common-dir
../../.git
$ realpath "$(git rev-parse --git-common-dir)"
/tmp/.../myproject/.git          # <- identical to myproject's own common-dir
```

Because `node_modules/concertino` (playing the role of `REPO`, the
executing script's own package location) has no `.git` of its own, `git
rev-parse --git-common-dir` run from inside it walks *up* the filesystem and
finds `myproject`'s own `.git` — the exact same common-dir `out` (=
`myproject`) resolves to. Decision 1's `scriptCommon == targetCommon` check
therefore reports "same superproject: yes" for **every** git-tracked
consumer project that npm-installs `concertino`, not just for genuine
worktrees of Concertino's own repo. The algorithm then falls through to
`targetRoot = gitTopLevel(out)` (= `myproject`), checks whether
`myproject/core` exists — and in this repro it does, coincidentally, exactly
per round 1's finding 3 scenario — and renders from it, **regressing AC #2
("the npm-installed case is unchanged")** for any git-tracked consumer whose
project happens to have its own top-level `core/` directory (a common,
generic name — "core business logic," "core utilities," etc.).

I confirmed this isn't merely a hypothetical by also reproducing the
*intended* worktree case in the same way, to make sure I wasn't
misunderstanding `git rev-parse`'s behavior generally:

```
main/  (git repo, core/scripts/foo.sh = "ORIGINAL")
  worktree "wt" added via `git worktree add ../wt`, foo.sh edited to "EDITED"
$ (from wt) git rev-parse --git-common-dir   → /tmp/.../main/.git
$ (from wt) git rev-parse --show-toplevel    → /tmp/.../wt
$ (from main) git rev-parse --git-common-dir → .git (same, after normalize)
```

This case resolves correctly — `wt`'s common-dir matches `main`'s, and
`show-toplevel` correctly isolates `wt`'s own root. The problem is that the
**identical git signature** (`scriptCommon == targetCommon`) is produced by
both the intended case (a real worktree of Concertino's own repo) and the
false-positive case (an unrelated consumer project that merely nests
`node_modules/concertino` inside its own tree) — because `git
rev-parse --git-common-dir` only answers "do these two paths belong to the
same working tree," which is true whenever *either* path is a descendant of
the other's repo root, regardless of *why*. `node_modules/<pkg>` being a
descendant of the consuming project's root is exactly this project's own
delivery-worktree topology too: I confirmed via `git worktree list` that
this repo's own worktrees (e.g. this very `CON-13` worktree) are nested
*inside* the main checkout under `.concertino/worktrees/...` — so "is one
side nested inside the other's tree" cannot, by itself, be used to
distinguish the two cases either; a genuinely more specific signal is needed
(e.g., confirming `REPO`'s own toplevel is an ancestor-or-self of `out`'s
toplevel — the direction the nesting runs in the intended case — versus the
reverse direction in the npm-nested-dependency case; or comparing repository
identity via origin URL / initial commit rather than just tree membership).
I'm not prescribing the exact fix — that's the executor's job — but the
current algorithm, as specified, provably does not achieve what Decision 1
and the Non-Goals section claim it achieves.

Crucially, **task 3.3 as written does not catch this**: it sets up "a target
that is its own independent git repo (not a worktree/checkout sharing
common-dir with the executing script's repo)" — a wholly separate `.git`,
which correctly produces a common-dir mismatch and is correctly rejected.
That is a different, less realistic topology than the one an actual `npm
install concertino` produces for a git-tracked consumer (where `REPO` is
necessarily *inside* the consumer's own tree, sharing its common-dir). Task
3.3 will pass; the real vulnerability it was meant to close remains.

### New contradictions introduced by this revision

None found beyond the residual gaps in Findings 2 and 3 above. Decision 2's
refuse-vs-pick reasoning is sound, not a dodge: it correctly identifies that
once ancestry is genuinely confirmed there is exactly one correct core to
render (the target's own, since that's the tree actually being committed
to), and that the original bug's real defect was silence, not the pick
itself — addressed via the divergence note and Decision 4's unconditional
`doctor` reporting. I have no objection to Decision 2 on its own terms; my
objection is that Decision 1's ancestry confirmation, which Decision 2's
reasoning depends on being trustworthy, is not as exact as claimed.

### General soundness

- The npm-installed case is **not** provably preserved, per Finding 3 above
  — this is the central remaining problem.
- The self-safety plan (task ordering: implement + test in throwaway repos
  before invoking `sync`/`doctor` against this worktree, task 4.1-4.2) is
  still adequate for `cmdSync`/`cmdDoctor`/`cmdInit`, which do get exercised
  by the new tests before this worktree's own tools are trusted. It is not
  adequate for `cmdEject`/`cmdDiff`, which get no exercise at all (Finding
  2's residual gap) — though this delivery workflow doesn't currently
  invoke `eject`/`diff` on itself, so the self-corruption risk the
  orchestrator specifically flagged is not implicated by that particular gap
  the way it would be for `sync`/`doctor`.

### Verdict: REFUTE

### Change Requests

1. Tighten (or replace) Decision 1's ancestry check so it actually
   distinguishes "target is a genuine worktree/checkout of the same
   superproject as the executing script's own Concertino source" from "the
   executing script's package merely happens to be nested inside the
   target's own, unrelated git-tracked tree" (e.g., via `node_modules`
   during an ordinary npm install) — the `git rev-parse --git-common-dir`
   equality check alone cannot distinguish these, as demonstrated by the
   reproduction above. Update `design.md`'s Non-Goals claim to match
   whatever the tightened algorithm actually guarantees, and add a test case
   for the *specific* realistic topology (git-tracked consumer project +
   npm-installed `concertino` nested via `node_modules` + consumer's own
   coincidental top-level `core/` directory) — not just the wholly-unrelated-
   repo case task 3.3 currently covers, which does not exercise this gap.
2. Add a task (and, if the spec's existing "eject and diff read from the
   resolved core" scenario is to be relied on as a real guarantee rather
   than aspirational prose) a corresponding test that actually invokes
   `concertino eject` and `concertino diff` against a resolved-core target
   post-refactor, so a missed or broken call-site update in either function
   is caught before delivery rather than shipping with zero coverage.

### Non-blocking notes

- Decision 2 (pick, don't refuse, with a loud note) is sound and
  well-justified — no further changes needed there.
- Decision 4 (`doctor` unconditional core-path reporting) and Decision 3
  (`--core` override on all six commands) remain clear and correctly scoped.
- Task 3.5's `cmdInit` smoke test is a good, concrete closure of round 1's
  `cmdInit`-specific gap.
