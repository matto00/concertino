## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/evidence-telemetry/spec.md`,
  `files-modified.md`, and `evaluation-1.md` from
  `openspec/changes/fix-persist-evidence-path-collision/`.
- Read the full diff: `git diff main...HEAD` (14 files, `core/scripts/persist-evidence.sh`,
  `core/scripts/emit-event.sh`, and their synced copies, plus planning artifacts and one test
  file).
- Confirmed `scripts/concertino/{persist-evidence,emit-event}.sh` are byte-identical to their
  `core/scripts/` sources (`diff`, both silent).
- Ran `bash test/scripts/persist-evidence.test.sh` myself: 32 passed, 0 failed, including both new
  cases (collision, outside-any-git-worktree).
- Ran `bash test/scripts/emit-event.test.sh` myself: 74 passed, 0 failed, including the
  oversized-context and failed-persist cases the human-directed scope extension touches.
- Ran the full `npm test` myself: exit 0, 748 node tests passed / 0 failed, all 16 shell suites
  green.
- **Independently reproduced all four ACs** with a from-scratch throwaway git repo (not relying on
  the test harness):
  - Two sources sharing basename `spec.md` in `specs/a/` and `specs/b/` → distinct `READY ref=`
    paths, each resolving to its own content.
  - Re-running on the same source (content changed) → same `DEST_PATH`, content updated in place
    (idempotency confirmed).
  - A source under `/tmp` (outside any git working tree) → `FAIL source is not inside any git
    working tree: ...`, exit 1, no `READY` line.
- Verified the `emit-event.sh` scope extension is sound and matches the human's decision exactly:
  `ROOT="$(main_checkout)"` is resolved once near the top of the script (line 153) and is in scope
  when `write_escalation_raised` (defined later) runs; `mktemp -d "${ROOT}/.escalation-context-tmp.XXXXXX"`
  anchors the temp file inside a guaranteed git working tree instead of `/tmp`. No fallback or
  special-casing was added to `persist-evidence.sh` itself — read the full script; the only paths
  through it are success or one of three `FAIL` branches, none of which tolerate a non-git source.
  `design.md`/`proposal.md`/`tasks.md` (task 3.5) all accurately describe this fix and its
  rationale; nothing here contradicts the human's ruling.
- Cleaned up two throwaway artifacts my own verification created outside the worktree (a scratch
  git repo under `/tmp`, and one stray `.concertino/runs/CONDEMO1/` I created in the *main
  checkout* by manually invoking `persist-evidence.sh` for a live-path repro — removed via `rm -rf`
  before finishing).

### A regression the evaluator's review did not catch

`design.md`'s Impact section and `evaluation-1.md`'s scope check both frame "no other caller was
affected" purely in terms of scripts that *invoke* `persist-evidence.sh` (orchestrator,
evaluator/skeptic's `verdict.ref`, `emit-event.sh`). They never checked for a downstream
**consumer that reconstructs the destination path itself**, independent of the `READY ref=` value
any caller relays.

`lib/ui/ticket-text.js:37-39`:
```js
function persistedPath(root, ticket) {
  return path.join(root, '.concertino', 'runs', ticket, 'evidence', 'ticket.md');
}
```
This hardcodes the **old flat, basename-only** destination for `ticket.md`. It is not a caller of
`persist-evidence.sh` — it independently reconstructs where `persist-evidence.sh` is supposed to
have put the file, per the already-merged, active spec `openspec/specs/drilldown-ticket-context/
spec.md:70`: *"a persisted `ticket.md` at `.concertino/runs/<TICKET_ID>/evidence/ticket.md` in the
main checkout"* — flat, no subdirectory. That spec also requires (line 90-99, "Ticket text is
resolved from the persisted copy, never the worktree, so it works after the worktree is
destroyed") that this be the only source that survives `cleanup.sh --phase4`.

`ticket.md`'s real `SOURCE_PATH`, per `orchestrator.md:198-202`, is always
`WORKTREE_PATH/openspec/changes/<change-name>/ticket.md` — never at the worktree root. Under this
change's new worktree-toplevel-relative scheme, that source **always** resolves to
`evidence/openspec/changes/<change-name>/ticket.md`, never to `evidence/ticket.md`. I confirmed
this is not hypothetical — I ran the actual updated script on a real artifact in this repo:

```
$ ./core/scripts/persist-evidence.sh CONDEMO1 "openspec/changes/fix-persist-evidence-path-collision/ticket.md"
READY ref=/home/matt/Development/concertino/.concertino/runs/CONDEMO1/evidence/openspec/changes/fix-persist-evidence-path-collision/ticket.md
```

and then fed that exact directory shape into the real `resolve()` from `lib/ui/ticket-text.js`:

```
$ node -e '... tt.resolve(root, "CON-99", { tickets: [] }) ...'
resolve() result: null
expected persistedPath: .../evidence/ticket.md   // file actually lives at .../evidence/openspec/changes/some-change/ticket.md
```

`resolve()` returns `null` (or silently falls through to the launch pad cache, when present) even
though the persisted `ticket.md` genuinely exists — it's just not where `persistedPath()` looks.
This is a **total** regression, not an edge case: every future ticket's `ticket.md` lives under
`openspec/changes/<change>/`, so it will never again land at the flat path this change's own
implementation once produced and the merged `drilldown-ticket-context` spec still requires.
Concretely, after this change ships: the drill-down header/TICKET panel silently degrades to the
launch pad cache for every future run (losing the "more honest, worked-from" source the CON-18/19
work explicitly preferred it for), and the merged spec's own "survives worktree removal" guarantee
(`drilldown-ticket-context/spec.md:90-99`) is violated outright for every future run, since the
persisted copy this guarantee depends on is never found at the path the resolver checks.

This gap exists specifically because `test/ticket-text.test.js` never invokes
`persist-evidence.sh` — its `withPersisted()` helper (`test/ticket-text.test.js:13-16`) manually
writes the file directly at the flat path `persistedPath()` expects, so it stays green regardless
of what `persist-evidence.sh` actually does. `npm test`'s green run gives no signal here; I
confirmed this by re-running `test/ticket-text.test.js` in isolation — 12/12 pass, none of them
exercise the real script.

I grepped for any other consumer that independently reconstructs an `evidence/` sub-path (as
opposed to relaying a `ref=` value read from the event log) and found only this one call site
(`lib/ui/ticket-text.js`); `lib/ui/screens/drilldown.js`'s own evidence-list rendering and the
CON-19 evidence reader both just use the `ref=` string already logged, so they are unaffected —
this is an isolated but real gap, not a broader pattern.

### Verdict: REFUTE

### Change Requests

1. **Reconcile `persist-evidence.sh`'s new destination-naming scheme with the merged
   `drilldown-ticket-context` spec's flat `evidence/ticket.md` contract, and with
   `lib/ui/ticket-text.js`'s `persistedPath()`, which still hardcodes that flat path.** Two
   directions are plausible — pick one and update the other side to match, plus a spec delta if
   the chosen resolution changes `drilldown-ticket-context`'s stated contract:
   - Keep `ticket.md` landing at a stable, flat location the drill-down can find (e.g. special-case
     `ticket.md`'s destination, or have the orchestrator persist it with a `SOURCE_PATH` this
     scheme treats specially), leaving `drilldown-ticket-context/spec.md` and `ticket-text.js`
     unchanged; or
   - Update `lib/ui/ticket-text.js`'s `persistedPath()` to derive the same
     `openspec/changes/<change>/ticket.md`-shaped nested path this change now produces, and add a
     spec delta to `drilldown-ticket-context` documenting the new path shape.
   Either way, add a regression test that exercises the **real** `persist-evidence.sh` output
   feeding into `ticket-text.js`'s `resolve()` (not a hand-placed file at the currently-assumed
   path), so a future change to either side's path convention is caught automatically instead of
   silently degrading a merged, spec-locked feature.
2. Re-run `test/ticket-text.test.js` and `npm test` after the fix to confirm the drill-down's
   ticket-text resolution genuinely finds a `ticket.md` persisted by the *updated*
   `persist-evidence.sh`, not just the hand-placed fixture the current test uses.

### Non-blocking notes

- `write_escalation_raised`'s new `mktemp -d "${ROOT}/.escalation-context-tmp.XXXXXX"` is cleaned
  up unconditionally (`rm -rf "$tmp_dir"`), but a hard kill between `mktemp` and that cleanup would
  leave a stray `.escalation-context-tmp.*` directory at the main checkout's root, visible in `git
  status` (untracked). Worth a `.gitignore` entry for `.escalation-context-tmp.*` at some point;
  not blocking since this is no worse than the pre-existing `/tmp` leak risk the comment already
  acknowledges, and the working tree stayed clean in every test run I performed.
