## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Read all five planning artifacts**: `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/ticket-detail-navigation/spec.md`.

- **`focus === 'queue'` block** (`fleet.js:1348-1358`): confirmed `f`'s
  `queueState.pending[queueFocus]` resolution pattern the design cites as
  precedent for the new `t` branch is exactly as described, and confirmed `t`
  is not currently in the suppressed-key list (`\r`, `l`, right-arrow, `n`,
  `N`) — free to bind, matching task 1.1/1.4's claim.

- **`focus === 'quickstart'` block** (`fleet.js:1361-1381`): confirmed `a` →
  `{ type: 'quickstart-add', index: quickStartFocus }` is emitted
  unconditionally (no access to the eligible list inside `handleKey`), the
  exact precedent Decision 1/task 1.2 cites for the new
  `view-ticket-quickstart` action. Confirmed `t` is likewise not in this
  block's suppressed-key list.

- **Bottom-of-`handleKey` `l` binding** (`fleet.js:1435-1437`):
  `runs[selected].ticket` is a plain identifier string passed the same way to
  `open-drilldown`/`open-escalation`/`attach` — matches Decision 1's claim
  that RUNNING/DONE's ticket data is "already a full identifier string,
  already present in `state`."

- **Decision 2's stated bug** (binding `t` only at the bottom of `handleKey`
  would let it act on a stale `runs[selected]` while QUEUED/QUICK START is
  focused): verified this is real — neither focus block's suppressed-key list
  currently includes `t`, so without a focus-scoped branch, `handleKey` would
  fall through both `if` blocks to the bottom `runs[selected]`-gated branch.
  The design's two-places-for-`t` structure is necessary, not gratuitous.

- **`watch.js`**: read `openLaunchPad()` (`:672-710`), `case 'open-ticketview'`
  (`:2145-2154`), `case 'back-to-launchpad'` (`:2156-2158`), `backToFleet()`
  (`:624-657`), `backToLaunchPad()` (`:659-663`), `currentState()`
  (`:609-622`), and `case 'quickstart-add'` (`:1499-1526`, precedent for
  `view-ticket-quickstart`'s re-derive-fresh-and-no-op pattern). All match
  the design's description precisely — the refactor plan (extract
  `ensureLaunchPad()`, add `ticketviewReturnMode`) is a faithful, minimal
  diff against what's actually there.

- **`ticketview.js`** (full file read): `findTicket` reads
  `launchPad.cache.tickets`, `handleKey`'s `esc` hardcodes
  `{ type: 'back-to-launchpad' }`, `render` calls `findTicket` — exactly as
  design.md's Context section and Decisions 3/5 claim. Confirmed the two
  cited existing test names (`esc backs out to the launch pad`,
  `routeHandleKey still dispatches back-to-launchpad on esc, taking priority
  over scroll handling`) exist verbatim in `test/ticketview.test.js:130,267`.

- **`router.js`**: confirmed `mode: 'ticketview'` is already a registered
  screen — no router change needed, matching the plan's silence on it.

- **`docs/dashboard.md`'s keybinding table** (`:105-110`): confirmed it
  currently lists only `↵`, `j`/`k`, `n`, `N`, `g`, `q` — `l`, digit-jump,
  `f`, `C` (`fleet.js:203`), `c` (`fleet.js:193`), and `s` (`fleet.js:1407`)
  are indeed all absent, and all six are genuinely bound in the current
  source. The reconciliation task's claims check out — **with one
  exception**, below.

- **Action-name collision check**: `grep -rn "view-ticket"` across `lib/`
  and `test/` returns nothing pre-existing — `view-ticket` and
  `view-ticket-quickstart` are genuinely free names, not accidentally
  reusing an existing action.

### One inaccuracy found (non-blocking)

`tasks.md` §4.2 lists `Q` as a table gap to reconcile, describing it as
"`Q` (open the launch pad's tickets pane...)". I verified this is **stale and
wrong on two counts**:

1. `Q` no longer exists as a binding anywhere in the current source
   (`grep -n "'Q'" lib/ui/screens/*.js` returns nothing) — it was removed
   outright by CON-56 (`git show f9f0d11`, "Make fleet QUICK START section
   always visible, remove Q toggle"), which landed on this same branch's base
   immediately before this ticket was authored.
2. Even when `Q` existed, it toggled QUICK START section *visibility in the
   fleet view* (`QUICK_START_TOGGLE_KEY`) — it never had anything to do with
   "the launch pad's tickets pane." That description is inaccurate
   regardless of the removal.

This is an unverified claim from the ticket carried through proposal.md and
tasks.md without being checked against current source — exactly the kind of
thing this gate exists to catch. That said, task 4.2 already contains its own
hedge ("confirm the exact key/action by reading `launchpad.js`/`fleet.js`
rather than assuming"), and a `Q`-key grep during execution will immediately
turn up nothing, so a competent implementer following the task's own
instruction will not add a false row. This is a documentation-only,
non-core-AC concern (AC5's table reconciliation is framed as "worth
reconciling," not a hard requirement), so I am not blocking the round over
it — flagging it so the executor doesn't waste time chasing a feature that
was already removed.

### Other checks

- No placeholders/TBDs/deferred decisions found in any artifact.
- Proposal, design, tasks, and spec are internally consistent — action
  shapes, case names, and file/line targets agree across all four documents
  everywhere I cross-checked them against real source.
- No scope drift: every task traces to one of the ticket's five ACs; no task
  does anything the ACs don't call for beyond the explicitly-scoped doc
  reconciliation.
- Every AC has a corresponding spec scenario and a corresponding task.
- No contract/schema changes are needed and none are claimed.

### Verdict: CONFIRM

### Non-blocking notes

1. `tasks.md` §4.2's `Q` bullet is stale (see above) — correct or drop it
   during execution rather than trusting it at face value; the task's own
   "verify against source" instruction already covers this, no artifact edit
   required before implementation starts.
