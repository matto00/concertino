- `core/scripts/cleanup.sh` — Phase 4 teardown gains the fast-forward algorithm (ref-only when
  `<base>` isn't checked out anywhere, `merge --ff-only` when it is and clean), the bounded
  retry/skip escalation via `emit-event.sh escalation --await`, and the best-effort
  post-fast-forward re-render. The existing unconditional `run.end` emission moved to after these
  new steps so the escalation banner shows correctly while it's blocking.
- `scripts/concertino/cleanup.sh` — re-synced copy of the above (`node bin/concertino sync`),
  byte-identical to `core/scripts/cleanup.sh` per `doctor`'s drift check.
- `bin/concertino` — `cmdDoctor` gains `checkBaseBranch`, a new `Git` section reporting when local
  `main` is behind its fetched remote and naming Phase 4 cleanup's fast-forward as the usual cause;
  silent when even/ahead or when the fetch itself fails.
- `lib/ui/banner.js` (new) — the cross-screen escalation banner: `renderBanner` (oldest live
  escalation, role, elapsed, truncated question, `+N more`, and the reply box when open),
  `handleKey` with its own `banner-*` action namespace, and `suppressedOnOwnScreen`.
- `lib/ui/watch.js` — wires the banner in: `computeLiveEscalations` (exported, pure), the
  `globalEscalationReply`/`globalEscalationTicket` state pair, `g`-key routing in `onKey()` ahead
  of the router, matching `banner-*` cases in `applyAction`, and banner composition above
  `router.render(...)`'s output in `draw()`.
- `core/roles/orchestrator.md` — Phase 4 section notes the `cleanup.sh --phase4` Bash call may now
  block on a fast-forward escalation and needs the same long timeout guidance already given for the
  orchestrator's own `--await` calls.
- `package.json` — registers the two new shell test files in the `test` script.
- `docs/dashboard.md` — documents the cross-screen escalation banner, the `g` key, and the
  automatic `main` fast-forward.
- `README.md` — the orchestrator's ensemble-table row now mentions the fast-forward-and-escalate
  step as part of cleanup.
- `test/scripts/cleanup.test.sh` (new) — end-to-end coverage of the fast-forward algorithm against
  real throwaway git remotes: already-current no-op, update-ref path, `merge --ff-only` path, dirty
  tree escalates and changes nothing, diverged base escalates and changes nothing, a successful
  retry, and `READY cleaned worktree=...` in every case.
- `test/scripts/doctor-base-branch.test.sh` (new) — doctor's local-main-behind-remote check: warns
  with the commit count and names the fast-forward as the cause, silent when current/ahead, clears
  once fast-forwarded, and degrades silently when the remote is unreachable.
- `test/banner.test.js` (new) — `renderBanner`/`handleKey`/`suppressedOnOwnScreen` coverage:
  rendering, the oldest-plus-count behavior, the reply box, and suppression on the escalation's own
  dedicated screen.
- `test/watch.test.js` — extended with `computeLiveEscalations` coverage (filtering, sorting,
  edge cases).
