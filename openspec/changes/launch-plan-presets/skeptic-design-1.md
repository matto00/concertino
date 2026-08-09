## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/launch-presets/spec.md` in full.
- Read the actual codebase ground truth the design reasons about:
  - `lib/ui/queue-cache.js` (sibling-module contract: temp-file + `fs.renameSync`, cold/malformed read → safe default) — matches Decision 1's claimed mirror.
  - `lib/ui/controllers/launchpad.js` (`open-launchplan`, `cycle-harness`, `cycle-agent-merge`, `cycle-provider`, `cycle-speed`, `confirm-launch`) — the per-field mutation bodies Decision 3's refactor plan claims to reuse are present and behave as described, with one gap (CR2 below).
  - `lib/ui/harness.js` (`canonicalHarness`, `cliLabel`, `providerChoices`, `launchTemplate`) — signatures and value domains match what design.md Decisions 1/3/4 assume.
  - `lib/ui/screens/launchplan.js` — confirmed `w` is genuinely unbound today (`handleKey` binds `\x1b, \r, c, h, m, s, p, n, H, S, P` plus scroll keys only) — the escalated free-letter pick is correct.
  - `lib/ui/screens/settings.js` / `lib/ui/controllers/settings.js` — confirmed `p` is genuinely unbound at the settings screen's top level today (only `j/k/h/l/tab/Enter/space/S/esc` are bound) — the `p`-opens-PRESETS entry point is free.
  - `lib/ui/router.js` / `lib/ui/controllers/index.js` — confirmed the `{ render, handleKey }` / `CONTROLLERS` array registration pattern Decision 6 describes is real and matches every existing screen.
  - `config/concertino.schema.json` — confirmed `harnesses` items enum is `claude-code|codex|opencode` (canonical ids), consistent with Decision 1/2's stated value domain for a preset's `harness` field.
  - `lib/ui/screens/fleet/*`, `watch.js` — confirmed `markDoneConfirm`/`clearQueueConfirm`'s y/anything-else shape exists as a real precedent for Decision 4's delete confirmation.
- Traced the one navigation claim in Decision 6 (`esc` on PRESETS returns to `settings`, not `fleet`) against `watch.js`'s actual `applyAction`:
  ```
  function applyAction(action) {
    if (!action) return false;
    if (action.type === 'back') {
      backToFleet();
      return true;
    }
    ...
    return controllers.applyAction(action, ctx);
  }
  ```
  This intercepts `action.type === 'back'` **unconditionally**, before any controller (including the new `presets` controller) ever sees it, and always calls `backToFleet()`. This is not mode-aware.
- Checked the two existing screens design.md cites as precedent for "returns to wherever it was opened from" — `sessions.js` (opened only via fleet's `v`) and `launchpad.js` (opened only via fleet) — both also emit the plain `{ type: 'back' }` on Escape, and both are *only ever opened from fleet*, so their generic `back → fleet` routing is correct by coincidence, not because the shared `back` action is origin-aware. This precedent does not actually establish what Decision 6 claims it does.
- Found the actual existing precedent for a screen that needs a *different* Escape destination: `docview.js` (opened only from drill-down's EVIDENCE panel). Its own `handleKey` returns the same opaque `{ type: 'back' }`, but its **router-seam wrapper** (`routeHandleKey`) explicitly translates that into a distinct top-level action before it reaches `watch.js`:
  ```
  function routeHandleKey(key, state) {
    ...
    if (action.type === 'back') return { type: 'back-to-drilldown-from-doc' };
    ...
  }
  ```
  with its own header comment explaining exactly why: "the generic `back` action ... always means 'return to the drill-down' here, and is translated to that concrete action name." This is the established, correct pattern for a screen whose Escape must not go to fleet — and it is the one design.md needed but didn't find or apply.
- Confirmed the second, narrower gap: `cycle-provider` (existing code) gates on **both** `plan.perRowEditable && plan.providerConfigured` before letting the batch provider be touched at all. `plan.perRowEditable` is `!ctx.cfg.launchCommand` — i.e., a project with a custom `dashboard.launchCommand` override has no flag slot for a provider decoration, so the *existing* `p` key is a no-op in that case even when `providers.ollama` is configured. Design.md Decision 3's stated apply-preset condition for the provider dimension names only `plan.providerConfigured`, omitting the `plan.perRowEditable` check the sibling dimension it's modeled on already enforces.

### Verdict: REFUTE

### Change Requests

1. **`design.md` Decision 6 / `tasks.md` 3.7 — the PRESETS screen's Escape-to-settings mechanism does not work as designed against the actual `watch.js` dispatch, and the cited precedent is wrong.**
   `watch.js`'s `applyAction` hard-codes `action.type === 'back' → backToFleet()`, unconditionally, *before* any controller (including the planned `presets` controller from tasks.md 3.1–3.9) is ever consulted. If `lib/ui/screens/presets.js`'s `handleKey`/`routeHandleKey` emits the plain `{ type: 'back' }` on Escape — which is what tasks.md 2.3/3.7 literally describe ("`back` (Escape, no prompt/confirm open)") — pressing Escape on PRESETS will silently return to **fleet**, not `settings`, directly violating spec.md's own "Escape returns to the settings screen without saving" requirement and ticket.md's acceptance criteria intent. Design.md's citation of `sessions.js`/`launchpad.js` as existing precedent for this working is incorrect: both of those screens are *only ever opened from fleet*, so their plain `back → fleet` routing is coincidentally right, not evidence of origin-aware behavior. The codebase already has the correct pattern for this exact situation — `docview.js`, whose `routeHandleKey` translates the screen-internal `{ type: 'back' }` into a distinct top-level action (`'back-to-drilldown-from-doc'`) that a caller-specific handler interprets, precisely because the generic `back` always means fleet. Required revision: `design.md` Decision 6 and `tasks.md` 3.7/4.1 must specify that `presets.js`'s `routeHandleKey` translates Escape into a **distinct** action name (e.g. `back-to-settings` or `presets-back`), and that `controllers/presets.js` (not `watch.js`'s generic interceptor) is what routes it to `mode = 'settings'` — mirroring `docview.js`'s established mechanism, not the plain shared `back` used by screens that only ever have one origin.

2. **`design.md` Decision 3 — the preset-apply provider dimension is missing the `perRowEditable` guard the dimension it's modeled on already has.**
   The existing `cycle-provider` case (`controllers/launchpad.js`) refuses to touch `plan.provider` unless **both** `plan.perRowEditable` (`!ctx.cfg.launchCommand`) and `plan.providerConfigured` hold — a project with a `dashboard.launchCommand` override has no flag slot to decorate, so the batch's own `p` key is a no-op there regardless of `providers.ollama` config. Decision 3's stated apply-preset condition for provider ("only applied when `plan.providerConfigured` … and the preset's provider value is a member of `harnessCmd.providerChoices(...)`") omits the `perRowEditable` check. As written, `w` would let a preset set `plan.provider` in exactly the situation the existing `p` key refuses to, which is inconsistent with "each dimension … apply<Dimension>(plan, value, ctx) helpers those four cases call" (Decision 3's own stated reuse goal — the reused helper should carry the same guard the original case enforces, or the design should say explicitly why provider's application doesn't need it). Required revision: add `plan.perRowEditable` to Decision 3's stated provider-apply condition (and to spec.md's "provider … only when a provider is configured for the project and the preset's provider value is reachable" scenario text, which has the identical omission), so the refactored `applyProvider` helper's actual gate matches `cycle-provider`'s existing one exactly.

### Non-blocking notes

- Decision 4's claim that the PRESETS screen's `p` gate "exactly mirror[s] the launch plan's own p-cycle gate" is imprecise — the launch plan's own gate is two conditions (`providerConfigured && perRowEditable`), while the PRESETS screen's `p` (a standalone screen with no `launchCommand`-override concept of its own) only needs one. Not a defect since the PRESETS screen genuinely has no analogous override state to gate on, but worth tightening the wording so a reader doesn't go looking for a `perRowEditable` equivalent that isn't there by design.
- Everything else checked out cleanly against ground truth: the on-disk store's temp-file+rename contract, the three escalated decisions (batch-level-only scope, dedicated-screen management, `w` as the free letter), the router/controller wiring pattern, the harness/provider value-domain claims, and the delete-confirmation precedent all match the actual code exactly as described.
