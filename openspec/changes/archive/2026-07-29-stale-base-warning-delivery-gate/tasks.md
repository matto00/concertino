## 1. assert-phase.sh delivery-gate stale-base check

- [x] 1.1 In `core/scripts/assert-phase.sh`'s `delivery)` case, after the existing pushed/clean
      checks, add a best-effort stale-base check: fetch `CONCERTINO_BASE_REMOTE`/`CONCERTINO_BASE_BRANCH`
      (defaults `origin`/`main`, matching `setup-worktree.sh`), compute `merge-base HEAD
      <remote>/<branch>`, and compare it to the fetched remote tip.
- [x] 1.2 When they differ, print a stderr warning naming the total commit count and up to 5 commits
      (short SHA + subject, most recent first, `git log --oneline -5 <merge-base>..<remote-tip>`),
      with a `(+N more)` suffix beyond 5 — per design.md Decision 4.
- [x] 1.3 Guard every git call in this check so nothing it does can trip `set -euo pipefail` and
      abort the script — fetch failure, unresolvable ref, or any unexpected git error must all
      degrade to "skip this check silently," never to a script failure or a change in the gate's
      exit code / `PASS delivery` stdout line (design.md Decision 2, Goals).
- [x] 1.4 When the warning fires, emit a best-effort `gate.warning` event via `emit-event.sh` with
      `ticket`, `gate=phase:delivery`, `behind=<N>`, `base=<branch>`, `remote=<remote>`, and
      `commits=<comma-separated short SHAs, same up-to-5 cap>` (design.md Decision 3). Do not emit
      this event when the base is current or the check was skipped.
- [x] 1.5 Mirror the change into the self-hosted rendered copy `scripts/concertino/assert-phase.sh`
      (identical to `core/scripts/assert-phase.sh` today — keep it identical) so this repo's own
      delivery runs exercise the same behavior; if a `concertino sync` render step exists, prefer
      running it over a hand copy.

## 2. Tests

- [x] 2.1 In `test/scripts/assert-phase.test.sh`, add a delivery-phase test where the branch's base
      is current with the fetched remote: assert no warning line and no `gate.warning` event, and
      that `PASS delivery` / exit 0 are unchanged.
- [x] 2.2 Add a test where the fetched remote base carries commits the branch's merge-base doesn't
      (e.g. commit directly to the bare/local "remote" used as the fetch source in the test's
      throwaway repo after cutting the branch): assert the stderr warning names the correct count
      and commits, a `gate.warning` event is appended with the expected fields, and the gate still
      exits 0 and prints `PASS delivery`.
- [x] 2.3 Add a test covering more than 5 commits behind: assert the count is correct, the listed
      commits are capped at 5, and a `(+N more)` suffix appears.
- [x] 2.4 Add a test where the fetch fails (e.g. remote pointed at a nonexistent path): assert no
      warning, no `gate.warning` event, and the gate still exits 0 / prints `PASS delivery`.
- [x] 2.5 Run `bash test/scripts/assert-phase.test.sh` (and the full `npm test`) and confirm all
      pass, including the pre-existing setup/servers/cleanup coverage in the same file.

## 3. Housekeeping

- [x] 3.1 Remove the "Stale-base warning at the delivery gate" bullet from `ROADMAP.md`'s Near-term
      section (proposal.md's "What Changes").
- [x] 3.2 Sanity-check the new spec (`openspec/changes/stale-base-warning-delivery-gate/specs/delivery-stale-base-warning/spec.md`)
      against the implemented behavior — every scenario should be true of the actual script output.
