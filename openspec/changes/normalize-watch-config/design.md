## Context

`lib/config.js`'s `withDefaults(c)` is the single normaliser used by `sync`/`diff`/`eject`/`migrate` — it applies defaults (budgets, model tiers, `worktree.*`, `agentMerge`, etc.) and resolves the deprecated `ticketProvider.kind: "manual"` alias to `"local"`. `lib/cli/watch.js`'s `cmdWatch` is the one CLI entry point that never calls it: it `JSON.parse`s `concertino.config.json` and hands the raw object straight to `lib/ui/watch.js`'s `watch({ root, config })`.

`withDefaults` itself assumes its input already has `project` and `ticketProvider` as objects (true of anything `concertino init` writes — see `lib/config.js:149-151`) and throws a `TypeError` otherwise. `cmdWatch`'s own existing comment — `/* watch works without config */` — establishes a contract this change must not break: a missing config file, or one that fails to `JSON.parse`, must still bring up the dashboard, just without any config-derived behavior. That contract has to extend to "config parses as JSON but isn't `withDefaults`-shaped" too, since a hand-edited or partial `concertino.config.json` is exactly the kind of file this class of bug tends to involve.

Downstream, `lib/ui/watch.js` and `lib/ui/ticket-provider.js` already carry substantial defensive code and comments written *because* `cmdWatch` skips normalisation today — most notably `ensureLaunchPad`'s try/catch around `linear.launchPadStatus`/`teamNotFoundMessage` (an unresolvable `ticketProvider.kind` must never escape the stdin `'data'` listener uncaught — that's the CON-44 regression this ticket references) and `ticket-provider.js`'s own `ALIASES = { manual: 'local' }` table. None of that defensive code is made redundant by this change: `withDefaults` doesn't validate `ticketProvider.kind` at all (it only rewrites the one known-deprecated alias), so a typo'd or unsupported kind (e.g. `"github"`, which `concertino validate` accepts but `ticket-provider.js` has no module for) reaches `watch()` regardless of whether the config was normalised. The comments describing that defensiveness do need updating, though — several state "cmdWatch never calls withDefaults" as an unqualified, still-true fact, which becomes wrong (or at least incomplete) once this change lands.

## Goals / Non-Goals

**Goals:**
- `cmdWatch` normalises a successfully-parsed config via `withDefaults` before constructing the dashboard, so every future config-derived behavior in the TUI inherits defaults/alias-resolution for free instead of having to re-derive it (or skip it, as happened once already).
- Preserve `cmdWatch`'s existing "watch works without config" contract exactly: no config file, malformed JSON, and a well-formed-JSON-but-`withDefaults`-incompatible config must all still bring up the dashboard.
- Bring the stale "cmdWatch never normalises" comments (in `lib/ui/watch.js`, `lib/ui/ticket-provider.js`, and their tests) up to date with the new, narrower reality.

**Non-Goals:**
- Removing or weakening any of the existing defensive handling downstream (`ensureLaunchPad`'s try/catch, `ticket-provider.js`'s `ALIASES` table, the "typo'd kind" / `"github"` gate-message tests). `withDefaults` doesn't validate `kind`, so all of that is still load-bearing after this change.
- Changing `withDefaults` itself, or any other `withDefaults` call site (`sync`/`diff`/`eject`/`migrate`).
- Making `loadConfig` (which `process.exit(1)`s when no config file exists) the mechanism used here — that behavior is wrong for `watch`, which must come up with no config at all.

## Decisions

**Decision 1 — normalise via a try/catch around `withDefaults`, falling back to the raw parsed object, not `{}`.**
`cmdWatch` will:
1. If the config file doesn't exist, or fails to `JSON.parse`, keep today's behavior exactly: `config = {}`.
2. Otherwise, `JSON.parse` the file into `raw`, then attempt `config = withDefaults(JSON.parse(JSON.stringify(raw)))` (deep-cloned, since `withDefaults` mutates its argument in place and partially mutates it before throwing on an incompatible shape — the clone keeps `raw` itself pristine for the fallback).
3. If that `withDefaults` call throws (missing `project`/`ticketProvider`, or any other shape `withDefaults` doesn't tolerate), catch it and use `config = raw` — the same un-normalised object `cmdWatch` would have handed over today. This is a **deliberate, narrower fallback**, not a silent broadening of the "no config" case: whatever *did* parse is still visible to `watch()`, exactly matching pre-this-ticket behavior for that specific edge case, and is what satisfies this ticket's second acceptance criterion.

Alternative considered: normalise unconditionally and let a `withDefaults` throw propagate as a hard failure (forcing every `concertino.config.json` to be `withDefaults`-shaped). Rejected — it would turn a hand-edited or partially-written config into a fatal crash of `concertino watch`, which is strictly worse than today (today it's silently un-normalised but still comes up) and directly contradicts this ticket's second acceptance criterion.

Alternative considered: pre-seed `raw.project = raw.project || {}` / `raw.ticketProvider = raw.ticketProvider || {}` before calling `withDefaults`, so it never throws for a missing-key reason. Rejected — that's `cmdWatch` reimplementing a piece of `withDefaults`'s own contract at a second call site, which is exactly the kind of drift this ticket exists to close off; a try/catch keeps `withDefaults` the single place that owns its own preconditions.

**Decision 2 — comment updates only downstream, no behavior change to `lib/ui/watch.js` / `lib/ui/ticket-provider.js`.**
The try/catch in `ensureLaunchPad` and the `ALIASES` table in `ticket-provider.js` stay exactly as they are today — see Non-Goals. Their comments currently assert "cmdWatch never calls withDefaults" as flat fact; they'll be updated to say normalisation is now the common path, with the fallback (Decision 1) as the documented reason a raw/unnormalised config can still reach `watch()`. This is what satisfies this ticket's first acceptance criterion ("or the reason it deliberately does not is documented at the call site") for the fallback branch specifically.

**Decision 3 — new capability spec (`watch-config-normalization`) rather than folding into an existing one.**
No existing `openspec/specs/*` capability covers `cmdWatch`'s config-loading behavior specifically (`cli-config-path-resolution` covers only `--out`/`--config` path resolution, not what happens to the parsed contents). A new, narrowly-scoped capability spec is clearer than stretching an unrelated one.

## Risks / Trade-offs

- [A config that parses as JSON but is missing `project`/`ticketProvider` silently gets zero normalisation, forever, with no user-visible signal] → Acceptable: this is strictly a fallback to today's existing (universal) behavior, not a regression, and `concertino validate`/`doctor` remain the tools that surface a malformed config explicitly. Adding a warning here is out of scope for this ticket (no acceptance criterion asks for one) and would risk clutter on `watch`'s own screen for what's meant to be a silent-degrade path.
- [Deep-cloning the parsed config on every `watch` invocation adds a small allocation] → Negligible: `concertino.config.json` is small and this happens once per process start, not per poll tick.

## Migration Plan

Not applicable — no schema, data, or API change. The next `concertino watch` invocation picks up the new behavior automatically; no user action required.
