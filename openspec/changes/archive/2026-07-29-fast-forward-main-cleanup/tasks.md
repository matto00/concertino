## 1. cleanup.sh: fast-forward algorithm

- [x] 1.1 Source `.concertino.env` in `core/scripts/cleanup.sh` (matching `setup-worktree.sh`) —
      only `CONCERTINO_BASE_BRANCH` is actually rendered there today (`bin/concertino`'s
      `renderEnv` does not write `CONCERTINO_BASE_REMOTE`); read both with `${VAR:-default}`
      (`origin`/`main`) so behavior is correct whether or not the file sets either one.
- [x] 1.2 Move the existing unconditional `run.end` emission (currently right after worktree
      removal) to *after* the new fast-forward/escalation/re-render steps (tasks 1.3–3.2) — this
      is load-bearing: `reducer.js` only reads a run as `needs-you`-while-blocked and reverts to
      `done` once `run.end` lands, so emitting it too early would make the escalation banner
      never show for this run's own fast-forward. Then add the fast-forward step itself:
      `git fetch --quiet <remote> <base>` (best-effort — skip the rest of this step silently if
      the fetch fails).
- [x] 1.3 Compare local `<base>` tip vs fetched `<remote>/<base>` tip; no-op silently if equal.
- [x] 1.4 When local `<base>` is a strict ancestor (`git merge-base --is-ancestor`), locate
      whether `<base>` is checked out anywhere via `git worktree list --porcelain`.
- [x] 1.5 Not checked out anywhere → `git update-ref refs/heads/<base> <remote>/<base>`.
- [x] 1.6 Checked out somewhere and clean (`git status --porcelain` empty there) →
      `git -C <that worktree> merge --ff-only <remote>/<base>`.
- [x] 1.7 Checked out somewhere and dirty, or not a strict ancestor (diverged) → do not touch
      anything; fall through to the escalation step (task group 2).

## 2. cleanup.sh: escalation and retry/skip bound

- [x] 2.1 On an unresolvable fast-forward, call `emit-event.sh escalation --await
      ticket=<T> question="<reason>" options=retry,skip` and capture the answer.
- [x] 2.2 `retry` → re-run the task-1 algorithm exactly once more; anything else (including
      timeout or free text) → treat as `skip`.
- [x] 2.3 If the retried attempt also fails to resolve cleanly, log a `note:` to stderr and do
      not escalate again.
- [x] 2.4 Ensure `cleanup.sh --phase4` still exits 0 and prints its `READY cleaned worktree=...`
      line regardless of the fast-forward's outcome.

## 3. cleanup.sh: post-fast-forward re-render

- [x] 3.1 After a fast-forward actually moves the ref (silently or via `retry`), attempt a
      best-effort re-render of whichever checkout's `main` moved, resolving the command in this
      order (first match wins): (a) `command -v concertino` on `PATH` → `concertino sync
      --out=<checkout>` (the real path for every adopting project); (b) `<checkout>/bin/concertino`
      exists → `node <checkout>/bin/concertino sync --out=<checkout>` (this repo's own
      self-hosting case); (c) otherwise `npx --no-install concertino sync --out=<checkout>` as a
      last resort. Do **not** assume `bin/concertino` exists in an adopting project — it doesn't.
- [x] 3.2 On re-render failure (or no `concertino` resolvable by any of the three), print a
      `note:` to stderr that a manual `concertino sync` is needed; never fail the script on this
      account.

## 4. Sync the rendered copy

- [x] 4.1 Re-render `scripts/concertino/cleanup.sh` from the edited `core/scripts/cleanup.sh`
      (`node bin/concertino sync`) so `doctor`'s byte-identical drift check stays green.

## 5. doctor: local-main-behind-remote check

- [x] 5.1 In `bin/concertino`'s `cmdDoctor`, add a `Git` (or similar) section with a best-effort
      fetch of the configured base remote/branch, skipping the whole check silently on failure.
- [x] 5.2 Compare local base branch vs fetched remote tip (`git rev-list --left-right --count`);
      warn with the commit count and name Phase 4 cleanup's fast-forward (not having run, or an
      out-of-workflow merge) as the usual cause when behind.
- [x] 5.3 No warning when even with or ahead.

## 6. Dashboard: cross-screen escalation banner

- [x] 6.1 Add `lib/ui/banner.js`: `renderBanner(escalation, opts)` (oldest live escalation, role,
      elapsed, truncated question, `+N more` when applicable, and the reply box when open) and
      `handleKey(key, state)` returning its **own** action types — `banner-reply-type`,
      `banner-reply-backspace`, `banner-cancel-reply`, `banner-submit-reply` — never the bare
      verbs `lib/ui/screens/escalation.js` owns (`reply-type`/`submit-reply`/...), so the two
      can't be dispatched into each other's `applyAction` cases by accident. Pure — no disk
      access.
- [x] 6.2 In `lib/ui/watch.js`, compute `liveEscalations = runs.filter(r => r.escalation &&
      !r.escalationStale)` each poll — narrower than, and NOT the same as, `fleet.js`'s
      `needsYou` filter (`status === 'needs-you'` also matches a `BLOCKER`-verdict run with no
      live `run.escalation`, which the banner has nothing to write an answer for) — sorted
      oldest-`raisedAt`-first.
- [x] 6.3 Add `globalEscalationReply`/`globalEscalationTicket` state (mirroring the existing
      `escalationReply` pattern, but a fully independent pair — never aliased to it) to
      `currentState()`.
- [x] 6.4 Reserve `g` as the global "open banner reply" key; confirm it does not collide with any
      existing screen's bindings (grep every `screens/*.js` `handleKey`) before wiring it — if it
      does, pick the next free single letter and update design.md's Decision 6 accordingly.
      (Confirmed no collision — grepped every `screens/*.js` `handleKey`; `g` is unbound
      everywhere.)
- [x] 6.5 In `onKey()` (before `router.handleKey` is called at all): if `globalEscalationReply` is
      open, route the keystroke to `banner.handleKey` instead of the router — the same "reply box
      owns every keystroke while open" precedence `escalation.js` already gives its own reply box,
      applied one level higher. Otherwise, if `g` is pressed, `liveEscalations` is non-empty, and
      no screen-local reply/prompt already owns the keyboard (`!prompt && !escalationReply &&
      !drillConfirm`), open the banner's reply box for the oldest live escalation.
- [x] 6.6 Add matching `banner-*` cases to `applyAction`: `banner-reply-type`/
      `banner-reply-backspace` mutate `globalEscalationReply.value`; `banner-cancel-reply` clears
      `globalEscalationReply`/`globalEscalationTicket` with **no** call to `backToFleet()`;
      `banner-submit-reply` calls `store.writeAnswer` directly against `globalEscalationTicket`
      (the same function `answerEscalation` calls — reuse it, don't fork it) and, on success,
      clears the two global-reply fields without navigating — `mode` and every other screen's
      state stay exactly as they were.
- [x] 6.7 Compose the banner above `router.render(...)`'s output in `draw()`, suppressed only when
      `mode === 'escalation'` and `escalationTicket` equals the banner's targeted ticket.
- [x] 6.8 Verify the banner disappears on the next poll once its escalation clears (answered or
      timed out) — no additional clearing logic beyond the existing live-escalation recompute.

## 7. Orchestrator role note

- [x] 7.1 In `core/roles/orchestrator.md`'s Phase 4 section, add a sentence noting the
      `cleanup.sh --phase4` Bash call should use a long timeout (matching the existing
      `emit-event.sh escalation --await` guidance), since it may now block on a fast-forward
      escalation.
- [x] 7.2 Re-render the rendered agent files (`node bin/concertino sync`) so the change reaches
      `.claude/agents/concertino-orchestrator.md`.

## 8. Tests

- [x] 8.1 `test/scripts/cleanup.test.sh` (new): silent no-op when already current; silent
      update-ref fast-forward when `main` isn't checked out anywhere; silent `merge --ff-only`
      fast-forward when checked out and clean; dirty tree changes nothing; diverged base changes
      nothing; `cleanup.sh --phase4` still exits 0 and prints `READY cleaned worktree=...` in
      every case (mirroring `test/scripts/doctor-artifacts.test.sh`'s throwaway-checkout style).
      Also covers the retry-succeeds scenario.
- [x] 8.2 Extend `test/scripts/doctor-artifacts.test.sh` or add a sibling test asserting doctor
      warns with a commit count when local `main` is behind, and is silent when even or ahead.
      (Added `test/scripts/doctor-base-branch.test.sh` as a sibling, matching that file's own
      style, plus coverage for an unreachable remote degrading silently.)
- [x] 8.3 `test/banner.test.js` (new, mirroring `test/escalation.test.js`'s style): banner shows
      on non-owning screens, suppressed on its own escalation screen, shows oldest + count for
      multiple, disappears once resolved.
- [x] 8.4 Extend `test/watch.test.js`/`test/reducer.test.js` as needed for the `liveEscalations`
      computation and the new global reply state's interaction with existing poll-loop behavior.
      (Extended `test/watch.test.js` with `computeLiveEscalations` coverage; `reducer.js`'s
      escalation model is unchanged per design.md, so `reducer.test.js` needed no changes.)
- [x] 8.5 Run the full suite (`npm test`) and confirm everything passes before handing off to
      evaluation.

## 9. Docs

- [x] 9.1 `docs/dashboard.md`: document the cross-screen escalation banner and the `g` (or
      chosen) key.
- [x] 9.2 `docs/quickstart.md` or `README.md`, wherever `cleanup.sh`/Phase 4 is already
      documented: mention the automatic fast-forward and its escalation.
