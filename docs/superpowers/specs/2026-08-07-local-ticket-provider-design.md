# Local ticket provider — running Concertino with no remote board

**Status:** design approved, not yet implemented
**Date:** 2026-08-07
**Ticket:** CON-44 (epic) — first slice

A tracked, file-backed ticket store so the Concertino delivery workflow runs on a
project that has no Linear board, with the launch pad, the delivery flow and
status write-back all working against local markdown files.

---

## Why

Not every project has a Linear or Jira board. The delivery workflow —
orchestrator/executor/evaluator/skeptic, evidence-gated phases, the whole
discipline — is valuable independent of where the ticket text came from, but the
dashboard half is hard-wired to Linear. For a distributable plugin, requiring a
Linear account is an adoption barrier before anyone has seen the tool work.

The audience, in order: adopters evaluating Concertino on a repo with no board,
then the author on small projects where standing up a Linear team is overkill.
That ordering is what makes this a first-class provider with docs and tests
rather than a thin personal escape hatch.

## What already exists

The ticket's premise needs one correction: `manual` is **not** entirely
unimplemented. The agent half already works.

- `lib/cli/render.js:143` renders manual-specific orchestrator prose — *"No
  external ticket system — the ticket text is provided inline or in the change
  dir `ticket.md`; skip status updates."*
- `lib/cli/emit.js:56` and `adapters/claude-code/agents.json` grant zero Linear
  MCP tools under `manual`, so the rendered orchestrator never reaches for a
  tool it does not have.

What is missing is the **dashboard half**, hard-wired in four places:

| Location | Assumption |
|---|---|
| `lib/ui/linear.js:513` | `launchPadStatus` refuses any `kind` but `linear` |
| `lib/ui/controllers/draft.js:24` | ticket drafting refuses the same |
| `lib/ui/watch.js:331` | `refreshLaunchPad` calls `linear.fetchTickets` directly |
| `lib/ui/cache.js:45` | persists to `.concertino/cache/linear.json` |

The seam that makes this tractable already exists: `normalise` /
`normaliseTicket` (`lib/ui/linear.js:341`), described in its own header as *"the
boundary Linear's wire format never crosses"*. A local store that emits that
same shape slots into the cache, the launch pad, the detail pane and the queue
with no downstream changes.

## Non-goals

Deferred to child tickets under CON-44:

- **TUI authoring.** Creating and editing local tickets from the dashboard,
  extending CON-21's draft flow to a provider with no remote counterpart.
  Blocked on this slice. In this slice you author tickets by writing markdown.
- **Comments.** Local tickets carry `comments: []`. Relates to CON-9.
- **A `github` provider** on the same resolver — the second implementation that
  would prove the interface.

CON-35 (priority column, inline detail pane) needs no child ticket: `priority`
and `epic` are in the normalised shape from day one, so it works on local
tickets the moment it lands.

---

## Decision 1 — `manual` is renamed to `local`, not joined by it

One boardless kind, not two. The old *behaviour* is dropped as a distinct kind
but survives as the degenerate case of `local`: a project configured `local`
with no `tickets/` directory behaves exactly as `manual` does today — ticket
text comes from the change dir's `ticket.md`, no status updates. Nothing is
lost.

Existing configs are not broken by a hard error. `withDefaults` normalises
`manual` → `local`, and `concertino validate` prints a deprecation notice
telling the user to update the file.

This matters because **`concertino migrate` cannot do renames.**
`lib/cli/migrate.js` is purely additive: it diffs `withDefaults(raw)` against
`raw` via `findAdded` and writes back only the *added* keys. There is no
value-rewrite path, and normalising in `withDefaults` avoids inventing one.

A shipped openspec requirement also names `manual` —
`openspec/specs/ticket-draft/spec.md:38` binds the draft flow's gating to
"`github` or `manual`". This repo treats those specs as contract, so it is
amended as part of this change.

## Decision 2 — a resolver module, leaving `linear.js` untouched

`lib/ui/ticket-provider.js` dispatches on `config.ticketProvider.kind` and
exports exactly the names the call sites already use, and no more:

| Export | Call site | Local implementation |
|---|---|---|
| `launchPadStatus` | `watch.js:271` | two-condition gate, no API key |
| `fetchTickets` | `watch.js:331` | directory scan |
| `resolveTeam` | `watch.js:352` | `tickets/` existence check |
| `teamKeyFromConfig` | `watch.js:323` | `teamKey` → `idExample` prefix. Does **not** honour `LINEAR_TEAM_KEY`, which is meaningless here |
| `stateTypesFromConfig` | `watch.js:334` | forwards to linear.js's — the state vocabulary is shared |
| `teamNotFoundMessage` | `watch.js:298`, `:355` | moves out of `watch.js` into the provider modules so the string is dispatched with everything else |
| `createTicket` | `draft.js:152` | throws. The draft flow is gated to `linear` until TUI authoring lands |

There is deliberately no `setState` export: status write-back is the
orchestrator's job and goes through a shell script (Decision 6), never through
the dashboard. Adding a JS path nothing calls would be dead code from day one.

The alternative — moving `linear.js` into `lib/ui/providers/` with an explicit
interface — is the better long-term home once a third implementation exists, but
today it moves a 578-line module and its dedicated test file for no behavioural
gain. The resolver is the same seam at a fraction of the churn, and it mirrors
the dispatch precedent already established in `launcher.js` / `harness.js`.
Promote to a `providers/` directory when the `github` provider lands and the
interface has been proven by two implementations.

```
lib/ui/ticket-provider.js       NEW — resolver, the only new dispatch point
lib/ui/tickets/local.js         NEW — the local store
lib/ui/linear.js                UNCHANGED
lib/ui/watch.js:37              require('./linear') → require('./ticket-provider')
lib/ui/cache.js:45              'linear.json' → 'tickets.json', schema 3 → 4
core/scripts/set-ticket-state.sh  NEW — canonical status write-back
```

Everything downstream of `normalise()` — the launch pad screens, `deriveEpics`,
the detail pane, the queue, retention — sees a shape it already understands and
does not change.

## Decision 3 — tickets are tracked in the repo, at a top-level `tickets/`

`.concertino/cache/` is gitignored because it is a *cache of someone else's
board*: sensitive content Concertino does not own. Local tickets are the
*source of truth*. Gitignoring the source of truth means the backlog dies with
the checkout, does not survive a clone, and is invisible to a collaborator, to
PR review and to CI — with no remote to re-fetch it from.

Top-level `tickets/`, not `.concertino/tickets/`. That directory's own gitignore
comment declares it *"generated per-project, never committed"*; putting the
source of truth inside it invites the one-line mistake that deletes the backlog.
A top-level directory is also consistent with how Concertino already behaves in
a consuming project — it writes `AGENTS.md`, `.claude/`, `.codex/`, `openspec/`.

Concertino does not manage the consuming project's `.gitignore` (nothing in
`lib/` writes one), so a tracked top-level directory needs no ignore-rule
surgery at all.

The path is fixed, not configurable. A `ticketProvider.dir` knob would add
config surface and a test matrix for a choice nobody has asked to make.

## Decision 4 — the ticket file format

`tickets/CON-12.md`:

```markdown
---
id: CON-12
title: Launch pad refuses non-linear providers
state: unstarted
priority: 2
epic: local-tickets
labels: [harness:codex]
---

## Description

...

## Acceptance criteria

- ...
```

| Field | Maps to | Notes |
|---|---|---|
| `id` | `identifier` | Optional; must equal the filename stem when present. Prefix from `ticketProvider.teamKey`, else `idExample`'s prefix. |
| `title` | `title` | |
| `state` | `state.type` **and** `state.name` | Linear's exact vocabulary: `backlog`, `unstarted`, `started`, `completed`, `canceled`. `stateTypesFromConfig` and the `launchPad.backlog: false` dial work untouched. |
| `priority` | `priority` | `0`–`4`, Linear's scale. `0` is a real "None", never `null` — the trap `linear.js:359` already documents. |
| `epic` | `epicId` + `epicName` | Both get the slug. Absent → the unassigned bucket `deriveEpics` already sorts last. |
| `labels` | `labels` | Feeds CON-62's `^harness:(.+)$` per-ticket override with no orchestrator change. |
| body | `description` | Everything after the frontmatter, verbatim. |
| — | `url` | Always `null`. Local tickets have no URL. |
| — | `comments` | Always `[]`, `commentCount: 0`, `commentsTruncated: false`. |

**Deliberately not stored in frontmatter:** `number` is derived from the id
suffix, `updatedAt` from the file's mtime. `estimate` and `assignee` are Linear
concepts with no local meaning and normalise to `null`, which the screens
already handle for Linear tickets that lack them.

The filename is authoritative because it is what `/concertino-deliver` takes.

## Decision 5 — the read path reuses the cache, with three divergences

The local store is already on disk, so caching it looks redundant. But `lp.cache`
is the single thing `launchpad.js`, `launchplan.js` and `ticketview.js` read, and
routing local tickets through it means zero controller changes.

```
ensureLaunchPad()  watch.js:267
  └─ ticketProvider.launchPadStatus(config, env)
        local: enabled ⟸ dashboard.launchPad.enabled === true && kind === 'local'
               No API-key check. Two conditions, not three.
  └─ cache.read(root)                                    unchanged

refreshLaunchPad()  watch.js:317
  └─ ticketProvider.fetchTickets({ teamKey, stateTypes })
        local: readdir tickets/*.md → parse frontmatter → normalise →
               sort by identifier (numeric-aware) → deriveEpics
               Reuses linear.js's exported deriveEpics verbatim.
  └─ cache.write(root, result, Date.now())               unchanged
```

The cache file is renamed to `.concertino/cache/tickets.json` — `linear.json` is
actively misleading once it holds local tickets — and `CACHE_SCHEMA_VERSION` goes
3 → 4. This costs no migration code: `cache.js`'s contract already states *"a
cold or unreadable cache is not an error"* and treats a mismatched version
exactly like a malformed file, so old rows self-heal to empty on first read.

Three deliberate divergences from the Linear path:

1. **`resolveTeam` becomes a directory check, not a second round-trip.**
   `watch.js:351` spends an extra call when a fetch returns zero tickets,
   because Linear answers an unknown team key and a genuinely-empty team
   identically. The call site is unchanged — local still needs to distinguish
   the two cases — but local's implementation is an `fs` existence check on
   `tickets/` rather than a network request: `{ found: true }` when the
   directory exists, `{ found: false }` when it does not.
2. **Missing `tickets/` reuses the `teamFound: false` channel with its own
   message.** The persistence machinery CON-20 built — `cache.teamFound`,
   rebuilt into `lp.error` on a cold process at `watch.js:298` — is exactly
   right here. Only the string changes: `teamNotFoundMessage` becomes
   provider-dispatched, and local says *"no tickets/ directory — create
   tickets/CON-1.md to get started"* rather than *"check
   ticketProvider.teamKey"*.
3. **Auto-refresh on open.** `launchpad.js:317`'s *"no tickets cached yet —
   press r to fetch"* exists because fetching costs a network round-trip.
   Reading a local directory does not, so `openLaunchPad` refreshes immediately
   under `local`. `r` still forces a re-read.

## Decision 6 — status write-back goes through a canonical script

`core/scripts/set-ticket-state.sh <TICKET_ID> <state>`, following the same
discipline as `emit-event.sh` and `persist-evidence.sh`. This repo has no state
mutation that is not behind a script, and the orchestrator under `local` has
Bash and no MCP tools, so a script is also the only thing it can reach.

It validates the state against the five values, rewrites only the frontmatter
`state:` line, and writes via temp-file + rename like `cache.js:127`. Non-zero
exit on a missing file or a bad state, which the orchestrator already knows how
to treat as `FAIL` → `BLOCKER`.

`{{block:ticketProvider}}` (`render.js:139`) gains the `local` case, replacing
`manual`:

> No external ticket system. The ticket lives at `tickets/$TICKET_ID.md` — read
> it for title, description and acceptance criteria, and read its frontmatter
> `labels` for the `harness:` override check. Set status with
> `scripts/concertino/set-ticket-state.sh "$TICKET_ID" <state>`. **If that file
> does not exist**, the ticket text is provided inline or in the change dir's
> `ticket.md` and you skip status updates entirely.

That final sentence is the preserved `manual` behaviour, now a degenerate case
rather than a separate kind.

Which lands the orchestrator's existing steps as:

| Orchestrator step | Under `local` |
|---|---|
| Setup 1 — fetch, set In Progress | Read `tickets/$TICKET_ID.md`; `set-ticket-state.sh "$TICKET_ID" started` |
| Setup 1 — CON-62 harness label | Frontmatter `labels`, same `^harness:(.+)$` match, no prose change |
| Phase 1 — write change-dir `ticket.md` | Copy title + body. The store format already opens `## Description`, which is what the dashboard's TICKET panel parses (`orchestrator.md:198-202`) |
| Delivery — PR link back to the ticket | **Skipped.** The PR URL is already recorded by `emit-event.sh … url=` (`orchestrator.md:582`), so nothing is lost |
| Cleanup — set Done, closing comment | `set-ticket-state.sh "$TICKET_ID" completed`; comment skipped |

---

## Error handling

| Condition | Behaviour |
|---|---|
| `tickets/` absent | Not an error. Launch pad opens empty with the create-a-ticket hint. |
| One file has malformed frontmatter | **Skip that file, keep the rest**, and surface `N tickets unreadable` in the launch pad. Per-file rather than `cache.js`'s all-or-nothing — one bad file must not blank the board. |
| `id:` present and ≠ filename stem | Counted as malformed. Silently preferring one would produce a ticket that cannot be addressed by the id written inside it. |
| `state:` not one of the five | Malformed, same treatment. |
| `priority` absent | `null`, which is *not* `0`. `0` is a real "None". |
| Delivery run with no matching file | Degenerate manual path: proceed on inline text, skip status writes. Not an escalation. |
| `set-ticket-state.sh` fails | Non-zero exit → the orchestrator's existing `FAIL` → `BLOCKER` treatment. |
| Duplicate ids | Impossible — filenames are unique by construction. |

## Scope

| Area | Change |
|---|---|
| Config | `config/concertino.schema.json` enum → `["linear","github","local"]`; `lib/config.js:445` validation; `withDefaults` normalises `manual` → `local`; `validate` prints a deprecation notice |
| Init | `init.js:190` prompt list; `init.js:104` `idExampleFor` gains `local: 'TICKET-1'` |
| Resolver | `lib/ui/ticket-provider.js` |
| Store | `lib/ui/tickets/local.js` |
| Cache | `cache.js:45` filename; `CACHE_SCHEMA_VERSION` 3 → 4 |
| Dashboard | `watch.js` require swap; `teamNotFoundMessage` moves out of `watch.js:156` into the provider modules; auto-refresh on open; `draft.js:26`'s message stops naming linear as the only option |
| Agents | `render.js:139` `manual` case → `local`; `adapters/claude-code/agents.json` `mcpTools` key rename (empty either way) |
| Script | `core/scripts/set-ticket-state.sh` |
| Spec | `openspec/specs/ticket-draft/spec.md:38` amended |
| Docs | `config-reference.md:126`, `adapting-to-your-project.md:44`, `ROADMAP.md:11` |

## Testing

| File | Covers |
|---|---|
| `test/tickets-local.test.js` **new** | frontmatter parse; the five states; `priority: 0` surviving as `0` not `null`; epic bucketing including the unassigned residue; missing `tickets/`; one malformed file among good ones; `id:` ≠ filename |
| `test/ticket-provider.test.js` **new** | dispatch by `kind`; unknown kind |
| `test/cache.test.js` | new filename; a v3 row self-healing to empty on read |
| `test/watch.test.js`, `test/launchpad.test.js` | **regression** — existing Linear coverage passing through the resolver unchanged. The main risk in the slice |
| `test/validate.test.js`, `test/config.test.js` | `local` accepted; `manual` normalised with a notice. Both currently assert on `manual` (`validate.test.js:148`, `config.test.js:451`) |
| `test/scripts/set-ticket-state.test.sh` **new** | valid and invalid state, missing file, atomicity, idempotence. Must be appended to `package.json`'s `test` script — the bash suites are listed explicitly, so a new one that is not wired in never runs |
| render test | the `local` block, following `auditor-render.test.sh` / `opencode-render.test.sh` |

### Note on the test-fake migration

`test/watch.test.js` mentions `linear` 29 times, but fakes it via
`require.cache[require.resolve('../lib/ui/linear')]` and re-requires `watch.js`
fresh. Since the resolver itself does `require('./linear')` and calls through the
module object at call time, **those fakes keep working unmodified** — the
resolver picks the fake out of `require.cache` when it loads. The tests need one
added `delete require.cache[ticketProviderPath]` beside the existing
`delete require.cache[watchPath]`, or a stale resolver holds a stale `linear`
reference across tests. That is the whole migration.

## Build order

1. Config + schema (`local` accepted, `manual` normalised)
2. Resolver + store — pure, fully testable in isolation
3. Cache rename + schema bump
4. `watch.js` wiring, message dispatch, auto-refresh
5. `set-ticket-state.sh` + its bash test, wired into `package.json`
6. `render.js` `local` block + render test
7. Docs and the openspec spec amendment
