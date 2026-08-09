'use strict';

// Launch-pad and launch-plan actions: browsing/selecting tickets, the queue
// handoff ('confirm-launch'), the plan's cycling knobs (concurrency /
// harness / agent-merge / speed / start-now), and the ticket detail view's
// origin-aware navigation (CON-54). Dispatched from watch.js's applyAction —
// see controllers/index.js for the shared contract.
//
// launchpadScreen/launchplanScreen/harnessCmd are pure modules, safe to
// require here; queue/queueCache and the async launch-pad helpers
// (ensureLaunchPad/openLaunchPad/refreshLaunchPad — they read the ticket
// cache and call linear.js, both faked via require-cache in tests) arrive
// through ctx so the fakes keep flowing through watch.js alone.

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const launchpadScreen = require('../screens/launchpad');
const launchplanScreen = require('../screens/launchplan');
const harnessCmd = require('../harness');

// Rebuilds a plan's launch command for its current harness/agent-merge/speed
// AND batch provider. Kept separate from cycle-harness/cycle-speed's own
// re-application because the provider contributes FLAGS (codex's
// `--oss --local-provider …`) rather than a token inside the quoted
// {{TICKET}} argument, so it has to be layered on after those two are done.
function applyBatchProviderFlags(plan, config) {
  const base = launchplanScreen.withSpeedFlag(
    launchplanScreen.withAgentMergeFlag(
      harnessCmd.launchTemplate(plan.harness) || plan.launchCommand, plan.agentMerge),
    plan.speed);
  if (!plan.provider) return base;
  const flags = harnessCmd.providerCommandFlags(plan.provider, plan.harness, config);
  return flags ? base.replace(/^(\S+)\s/, '$1 ' + flags + ' ') : base;
}

// CON-111, design.md Decision 3: the four dimensions' own per-field
// mutation bodies, factored out of cycle-harness/cycle-agent-merge/
// cycle-speed/cycle-provider (below) so the SAME logic is reused, unchanged,
// by both an individual field cycle and the 'apply-preset' case — not a
// second, parallel implementation of what each dimension means. Each
// function mutates ONLY the field(s) intrinsically tied to that one
// dimension; plan.launchCommand/plan.resolvedModels are rebuilt ONCE by the
// CALLER after every field an action touches has been applied (never
// per-field — see 'apply-preset' below, which can touch up to four fields in
// one keystroke and must still only rebuild the command/preview once).

// CON-65: provider routing is per-harness, and an explicit provider choice
// may not be reachable from the harness now in effect (CON-75) — dropped
// rather than carried as a choice this harness cannot honour. Exactly what
// cycle-harness has always done; just named and reused.
function applyHarness(plan, harness, config) {
  plan.harness = harness;
  const ollama = config && config.providers && config.providers.ollama;
  plan.providerDefault = (ollama && (ollama.harnesses || []).includes(harnessCmd.canonicalHarness(harness)))
    ? 'ollama' : 'default';
  if (plan.provider && !harnessCmd.providerChoices(config, harness).includes(plan.provider)) {
    plan.provider = null;
  }
}

function applyAgentMerge(plan, enabled) {
  plan.agentMerge = enabled;
}

function applySpeed(plan, speed) {
  plan.speed = speed;
}

function applyProvider(plan, provider) {
  plan.provider = provider;
}

function handle(action, ctx) {
  const S = ctx.S;
  const { queue, queueCache } = ctx.deps;
  switch (action.type) {
    case 'open-launchpad':
      ctx.openLaunchPad();
      return true;

    case 'move-launchpad': {
      const lp = S.launchPad;
      if (!lp) return true;
      if (lp.pane === 'epics') {
        const total = ((lp.cache && lp.cache.epics) || []).length;
        lp.epicIndex = Math.max(0, Math.min(lp.epicIndex + action.delta, Math.max(0, total - 1)));
        lp.ticketIndex = 0; // the ticket list just changed under it
      } else {
        const total = launchpadScreen.ticketsForEpic(lp).length;
        lp.ticketIndex = Math.max(0, Math.min(lp.ticketIndex + action.delta, Math.max(0, total - 1)));
      }
      return true;
    }

    case 'switch-pane':
      if (S.launchPad) S.launchPad.pane = action.pane;
      return true;

    // A ticket the launch pad is already showing as `▲ running` may be
    // DEselected (clearing a stale selection someone made before it went
    // live is harmless) but never selected in the first place — see
    // launchpad.js's isSelectable for the tmux-addressing failure this
    // prevents. This is layer one of two (queue.tick is layer two).
    case 'toggle-select': {
      const lp = S.launchPad;
      if (!lp) return true;
      const t = launchpadScreen.ticketsForEpic(lp)[lp.ticketIndex];
      if (t) {
        if (lp.selected.has(t.identifier)) lp.selected.delete(t.identifier);
        else if (launchpadScreen.isSelectable(t, S.runs, S.queueState)) lp.selected.add(t.identifier);
      }
      return true;
    }

    case 'select-all': {
      const lp = S.launchPad;
      if (!lp) return true;
      for (const id of launchpadScreen.selectableIdentifiers(launchpadScreen.ticketsForEpic(lp), S.runs, S.queueState)) {
        lp.selected.add(id);
      }
      return true;
    }

    // 'q' on the tickets pane (CON-41, design.md Decision 3) — queues only
    // the currently-highlighted ticket, mirroring 'quickstart-add' exactly:
    // resolve the target fresh from current state (never a value cached from
    // a previous draw()), no-op if it doesn't resolve or isn't currently
    // selectable (covers both "already running" and "already queued" — the
    // same isSelectable refusal 'toggle-select'/'select-all' above
    // re-check), and hand the queue primitives the ticket's IDENTIFIER
    // STRING, never the ticket object — queue.js's pending/inFlight
    // collections are identifier-string collections throughout
    // (inlineStatus's and isSelectable's own queueState.pending/inFlight
    // membership checks are keyed on ticket.identifier; a queue entry
    // holding a ticket object instead would silently stop matching them).
    case 'add-to-queue': {
      const lp = S.launchPad;
      if (!lp) return true;
      const t = launchpadScreen.currentTicket(lp);
      if (!t || !launchpadScreen.isSelectable(t, S.runs, S.queueState)) return true;
      const id = t.identifier;
      if (!S.queueState) {
        S.queueState = queue.createQueue([id], 1, ctx.launcher.launchCommand);
        S.queueSessionId = crypto.randomUUID();
      } else {
        S.queueState = queue.enqueueOne(S.queueState, id) || S.queueState;
      }
      // No direct spawn call here — the existing queue.tick() call site at
      // the top of watch.js's draw() (already gated by queue.shouldTick)
      // performs the actual launch and persistence write on the very next
      // poll, unchanged, exactly as it already does for 'quickstart-add' and
      // 'confirm-launch'.
      return true;
    }

    case 'set-mode':
      if (S.launchPad) S.launchPad.mode = action.mode;
      return true;

    // The P key (launchpad.js's handleKey) only describes the keypress —
    // this is the one place it actually takes effect. Without this case the
    // action would fall through and be silently dropped, exactly as
    // design.md Decision 3 calls out.
    case 'toggle-ticket-sort':
      if (S.launchPad) S.launchPad.ticketSort = S.launchPad.ticketSort === 'priority' ? 'identifier' : 'priority';
      return true;

    case 'refresh-launchpad':
      ctx.refreshLaunchPad(); // fire-and-forget; see its own comment in watch.js
      return true;

    case 'open-ticketview': {
      const lp = S.launchPad;
      if (!lp) return true;
      const t = launchpadScreen.ticketsForEpic(lp)[lp.ticketIndex];
      if (t) {
        lp.viewingTicket = t.identifier;
        S.ticketviewReturnMode = 'launchpad';
        S.mode = 'ticketview';
      }
      return true;
    }

    // CON-54: opens the ticket detail view for a QUEUED or RUNNING/DONE
    // fleet row — fleet.js's handleKey already resolved `action.ticket` to a
    // real identifier (queueState.pending[queueFocus] or
    // runs[selected].ticket, both already live in `state`), so this handler
    // only has to make sure `launchPad.cache` exists for ticketview.js's own
    // findTicket() to search (ensureLaunchPad(), design.md Decision 4) and
    // route into 'ticketview' WITHOUT also switching to 'launchpad' — the
    // one thing ensureLaunchPad() buys over the pre-existing openLaunchPad().
    case 'view-ticket': {
      if (!action.ticket) return true;
      ctx.ensureLaunchPad();
      S.launchPad.viewingTicket = action.ticket;
      S.ticketviewReturnMode = 'fleet';
      S.mode = 'ticketview';
      return true;
    }

    // CON-54: QUICK START's own version of 'view-ticket' — `action.index`
    // arrives UNRESOLVED (fleet.js's handleKey has no access to the eligible
    // ticket list — see its own header comment), so this is the one place
    // that resolves it, re-deriving quickStartEligible() FRESH (never a
    // value cached from a previous draw()), mirroring 'quickstart-add'
    // exactly, including its no-op-if-nothing-resolves branch.
    case 'view-ticket-quickstart': {
      const eligible = ctx.quickStartEligible();
      const t = eligible[action.index];
      if (!t) return true; // nothing resolved — stale/empty/shrunk list
      ctx.ensureLaunchPad();
      S.launchPad.viewingTicket = t.identifier;
      S.ticketviewReturnMode = 'fleet';
      S.mode = 'ticketview';
      return true;
    }

    // CON-54, design.md Decision 5: origin-aware — 'fleet' (set by the three
    // entry points above) returns to the fleet view; anything else
    // (including the pre-existing `null` default, so a mid-session process
    // upgrade degrades safely) falls back to the existing backToLaunchPad()
    // behavior, unchanged. Either branch resets ticketviewReturnMode so a
    // later, unrelated visit can never inherit a stale destination.
    case 'back-to-launchpad':
      if (S.ticketviewReturnMode === 'fleet') {
        ctx.backToFleet();
      } else {
        ctx.backToLaunchPad();
      }
      S.ticketviewReturnMode = null;
      return true;

    case 'ticketview-scroll':
      S.ticketviewScroll = Math.max(0, action.offset);
      return true;

    // The confirm gate. Ports, base commit and the ordered ticket list are
    // all computed HERE, once, from the current config/cache/git state — the
    // plan screen itself stays pure and just renders this snapshot (see
    // launchplan.js's own header comment on why ports can be shown with
    // nothing run yet).
    case 'open-launchplan': {
      const lp = S.launchPad;
      if (!lp || !lp.selected.size) return true;
      const byId = new Map((lp.cache.tickets || []).map((t) => [t.identifier, t]));
      // Second refusal, not just the first: `toggle-select`/`select-all`
      // already keep an already-running ticket OUT of lp.selected, but a
      // ticket selected earlier can have started running by hand (or via
      // another queue) in the time since — re-check against the latest
      // `runs` snapshot right here, at the confirm gate's own entry point,
      // rather than trust a selection made possibly many polls ago.
      const tickets = Array.from(lp.selected)
        .map((id) => byId.get(id))
        .filter(Boolean)
        .filter((t) => launchpadScreen.isSelectable(t, S.runs, S.queueState));
      if (!tickets.length) return true;

      const configuredHarnesses = (Array.isArray(ctx.config && ctx.config.harnesses) && ctx.config.harnesses.length)
        ? ctx.config.harnesses.map((h) => (h === 'claude-code' ? 'claude' : h))
        : ['claude'];
      // A launchCommand override has no per-harness variants to cycle
      // through — the actual command is pinned regardless of which harness
      // label is showing (see cycle-harness below, which only ever touches
      // plan.launchCommand when there is NO override). Pinning `harnesses`
      // itself down to the one actually in effect, right here, is what makes
      // 'h' correctly refuse itself in BOTH places that need to agree —
      // cycle-harness's own `length < 2` guard and launchplan.js's footer
      // hint (`harnesses.length > 1`) — from a single source of truth,
      // rather than adding a second, easy-to-forget override check inside
      // cycle-harness alone.
      const harnesses = ctx.cfg.launchCommand ? [configuredHarnesses[0]] : configuredHarnesses;
      const seqMode = lp.mode === 'sequential';
      const concurrency = seqMode ? 1 : Math.max(1, ctx.cfg.maxConcurrent || 2);

      // Seeded from the config default, mirroring how `harness` seeds from
      // `config.harnesses` just above — resolved once, here, then editable
      // via 'm' exactly like harness is via 'h'. Disabled
      // (agentMergeEditable = false) under the identical condition that
      // disables harness-cycling: a custom launchCommand override has no
      // flag slot to safely rewrite (see launchplan.js's own comment).
      const agentMerge = !!(ctx.config && ctx.config.agentMerge && ctx.config.agentMerge.enabled);
      const agentMergeEditable = !ctx.cfg.launchCommand;

      // Whether the project routes a given harness to Ollama by default —
      // the same `providers.ollama.harnesses` membership test
      // resolveTicketProvider applies, hoisted here so both this plan's
      // initial value and every later harness cycle read one definition.
      const providerDefaultFor = (h) => {
        const ollama = ctx.config && ctx.config.providers && ctx.config.providers.ollama;
        return (ollama && (ollama.harnesses || []).includes(harnessCmd.canonicalHarness(h)))
          ? 'ollama' : 'default';
      };

      let commitSha = null;
      try {
        // `stdio: ['ignore','pipe','ignore']` is deliberate, not
        // decoration: execFileSync's default stdio inherits the CHILD's
        // stderr straight onto this process's own stderr even when the call
        // throws and is caught here — verified by running it against a
        // non-repo directory. Silently degrading to "no commit shown" must
        // not mean leaking `fatal: not a git repository...` onto the
        // terminal underneath a screen that is otherwise pure.
        commitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'],
          { cwd: ctx.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch (e) { /* not a git repo, or no commits yet — render without it */ }

      // CON-22: seeded to 'default' (every project has at least this one
      // speed to cycle away from — see launchplan.js's unconditional 's'
      // hint), resolved once here for the pre-flight models preview.
      // `canonicalHarness()` is required — `harnesses[0]` is the CLI-binary
      // label ('claude'), never the canonical id resolve-speed.sh's own `$2`
      // expects.
      const speed = 'default';
      const resolvedModels = ctx.resolveModels(speed, harnessCmd.canonicalHarness(harnesses[0]),
        providerDefaultFor(harnesses[0]) === 'ollama' ? 'ollama' : null);

      // Per-ticket `harness:<value>` overrides, resolved once here (the same
      // moment ports/commit are snapshotted) in CLI-label space so
      // launchplan.js can compare against plan.harness directly without
      // requiring lib/ui/harness.js (which requires launchplan.js — a
      // cycle). Only tickets that would genuinely dispatch differently at
      // spawn time appear (resolveTicketHarness's own configured/valid
      // filtering) — the row annotation must never promise a harness
      // commandFor() would not actually launch.
      const ticketHarness = {};
      // CON-65: identifier -> 'ollama'|'default', only for tickets whose
      // `provider:<value>` label genuinely re-routes the spawn (the same
      // "never promise what commandFor()/launch() would not actually do"
      // rule ticketHarness follows). Resolved against the harness the
      // ticket will ACTUALLY launch under — its own harness override when
      // present, the batch harness otherwise — since provider validity is
      // harness-dependent (claude-code: either the direct or gateway route
      // works, CON-75 — only an incomplete gateway still refuses; see
      // resolveTicketProvider's own null cases).
      const ticketProvider = {};
      for (const t of tickets) {
        // launcher.projectHarnesses (canonical ids), NOT this case's own
        // CLI-label-space configuredHarnesses local just above.
        const th = harnessCmd.resolveTicketHarness(t.labels, ctx.launcher.projectHarnesses);
        if (th) ticketHarness[t.identifier] = harnessCmd.cliLabel(th);
        const effectiveHarness = th || harnessCmd.canonicalHarness(harnesses[0]);
        const tp = harnessCmd.resolveTicketProvider(t.labels, ctx.config, effectiveHarness);
        if (tp) ticketProvider[t.identifier] = tp;
      }

      S.launchPlan = {
        tickets,
        mode: lp.mode,
        concurrency,
        harness: harnesses[0],
        harnesses,
        // identifier -> CLI label, only for tickets whose label really
        // re-dispatches them (see the loop above). Rendered per-row by
        // launchplan.js so a mixed-harness batch is visible pre-flight.
        ticketHarness,
        // CON-65: identifier -> provider, same contract (see the loop above).
        ticketProvider,
        baseBranch: (ctx.config && ctx.config.project && ctx.config.project.baseBranch) || 'main',
        commitSha,
        worktreeBase: (ctx.config && ctx.config.worktree && ctx.config.worktree.base) || '.concertino/worktrees',
        agentMerge,
        agentMergeEditable,
        speed,
        resolvedModels,
        // A custom launchCommand override has no per-harness variants to
        // cycle through — 'h' is simply not offered in that case (see
        // launchplan.js's handleKey, gated on harnesses.length > 1) — and
        // likewise no agent-merge flag slot to bake in or rewrite ('m' is
        // gated on agentMergeEditable the same way).
        // `|| launchCommand`: an unvalidated config can name a harness
        // launchTemplate() has no template for — degrade to the
        // process-wide default rather than throwing mid-keypress.
        launchCommand: ctx.cfg.launchCommand || launchplanScreen.withAgentMergeFlag(
          harnessCmd.launchTemplate(harnesses[0]) || ctx.launcher.launchCommand, agentMerge),
        portsCfg: (ctx.config && ctx.config.worktree && ctx.config.worktree.ports) || {},
        // Defaults to true (unchanged pre-existing behaviour: confirming
        // launches up to `concurrency` tickets immediately) — 'n' toggles it
        // on the launch plan screen; see 'confirm-launch' below for what
        // false actually does.
        startNow: true,
        // CON-69: the per-row layer. `rowIndex` is the cursor H/S/P act on;
        // `rowOverrides` is identifier -> { harness (CLI label) | speed |
        // provider }, sparse, null values meaning "follow the batch/label".
        // Per-row editing shares the operator-override gate with 'h'/'m':
        // a custom launchCommand pins every ticket's command, so there is
        // nothing per-row choices could safely rewrite.
        rowIndex: 0,
        rowOverrides: {},
        perRowEditable: !ctx.cfg.launchCommand,
        providerConfigured: !!(ctx.config && ctx.config.providers && ctx.config.providers.ollama),
        // CON-65: what the batch's CURRENT harness resolves to with no
        // per-row override — 'ollama' when the project routes that harness
        // locally, 'default' otherwise. Recomputed on every harness cycle
        // (see cycle-harness), the same "a preview is per-harness" rule
        // resolvedModels already follows.
        providerDefault: providerDefaultFor(harnesses[0]),
        // The batch's explicit provider choice ('p'), null until made — the
        // header falls back to providerDefault for display.
        provider: null,
        // CON-111: a point-in-time snapshot of the saved presets, resolved
        // once here (design.md Decision 7 — same "resolved once when the
        // plan opens" precedent resolvedModels/commitSha already follow),
        // NOT re-read on every 'w' press. `presetIndex` stays null until the
        // first 'w' press (see the 'apply-preset' case above).
        presets: (ctx.deps.presetsCache.read(ctx.root).presets) || [],
        presetIndex: null,
      };
      S.launchPlanTicketScroll = 0;
      S.mode = 'launchplan';
      return true;
    }

    case 'cancel-launchplan':
      ctx.backToLaunchPad();
      return true;

    // Lazygit-layout pass: scrolls launchplan.js's own ticket-list box —
    // upper-bound clamping to the batch's real (possibly re-filtered) size
    // happens lazily at render time (docview.windowBody's own clampScroll),
    // same discipline as drill-down's panel scrolls.
    case 'scroll-launchplan-tickets':
      S.launchPlanTicketScroll = Math.max(0, S.launchPlanTicketScroll + action.delta);
      return true;

    case 'cycle-concurrency':
      if (S.launchPlan) S.launchPlan.concurrency = launchplanScreen.cycleConcurrency(S.launchPlan.concurrency);
      return true;

    // launchplan.js's own 'n' — flips whether 'confirm-launch' (below)
    // builds a queue that starts admitting immediately or one that sits
    // paused until the operator's own separate confirm on the fleet view.
    case 'toggle-start-now':
      if (S.launchPlan) S.launchPlan.startNow = S.launchPlan.startNow === false;
      return true;

    case 'cycle-harness': {
      const plan = S.launchPlan;
      if (!plan || !plan.harnesses || plan.harnesses.length < 2) return true;
      const idx = plan.harnesses.indexOf(plan.harness);
      // CON-111: the per-field mutation itself (harness + the providerDefault
      // recompute + dropping an unreachable provider — CON-65/CON-75) now
      // lives in applyHarness(), reused unchanged by 'apply-preset' below —
      // see this file's own comment just above applyHarness's definition.
      applyHarness(plan, plan.harnesses[(idx + 1) % plan.harnesses.length], ctx.config);
      // CON-22: a models preview is per-(speed, harness) — a harness cycle
      // must invalidate the PREVIOUS harness's stale preview, or switching
      // from claude-code to codex would keep showing claude-code's models
      // under the codex label. Rebuilds plan.launchCommand from the NEW
      // harness's own template (re-applying whatever agent-merge/speed/
      // provider are already staged on this plan, never dropping them) —
      // applyBatchProviderFlags' own base command already resolves the
      // harness's template unconditionally, so this is the one, single
      // rebuild (no separate intermediate reassignment needed).
      if (!ctx.cfg.launchCommand) plan.launchCommand = applyBatchProviderFlags(plan, ctx.config);
      plan.resolvedModels = ctx.resolveModels(
        plan.speed, harnessCmd.canonicalHarness(plan.harness), plan.provider);
      return true;
    }

    case 'cycle-agent-merge': {
      const plan = S.launchPlan;
      if (!plan || !plan.agentMergeEditable) return true;
      applyAgentMerge(plan, !plan.agentMerge);
      plan.launchCommand = launchplanScreen.withAgentMergeFlag(plan.launchCommand, plan.agentMerge);
      return true;
    }

    // Lowercase p — cycles the BATCH provider through what the batch's
    // current harness can actually reach (harnessCmd.providerChoices owns
    // that validity — CON-75: claude-code offers 'ollama' on either route,
    // only an incomplete gateway makes this a no-op). Re-applies the
    // provider's launch flags and
    // re-resolves the models preview, the same "a preview is per-(speed,
    // harness, provider)" rule cycle-harness/cycle-speed already follow —
    // this is what makes the header's `models` row show LOCAL ids the
    // moment the batch is routed locally.
    case 'cycle-provider': {
      const plan = S.launchPlan;
      if (!plan || !plan.perRowEditable || !plan.providerConfigured) return true;
      const choices = harnessCmd.providerChoices(ctx.config, plan.harness);
      if (choices.length < 2) return true;
      const idx = choices.indexOf(plan.provider || null);
      applyProvider(plan, choices[(idx + 1) % choices.length]);
      plan.launchCommand = applyBatchProviderFlags(plan, ctx.config);
      plan.resolvedModels = ctx.resolveModels(
        plan.speed, harnessCmd.canonicalHarness(plan.harness), plan.provider);
      return true;
    }

    // --- CON-69: per-row overrides -----------------------------------

    // j/k/arrows on the launch plan — moves the row cursor the H/S/P
    // cycles below act on; the screen's own render keeps the cursor row
    // inside the scrolled viewport (see launchplan.js).
    case 'move-launchplan-row': {
      const plan = S.launchPlan;
      if (!plan) return true;
      const len = plan.tickets.length;
      plan.rowIndex = Math.max(0, Math.min((plan.rowIndex || 0) + action.delta, len - 1));
      return true;
    }

    // Shift-H — cycles the FOCUSED ROW's harness: batch default (null) →
    // each other configured harness → back to batch. CLI-label space, same
    // as plan.harness/plan.harnesses, so launchplan.js compares directly.
    case 'cycle-row-harness': {
      const plan = S.launchPlan;
      if (!plan || !plan.perRowEditable || !plan.harnesses || plan.harnesses.length < 2) return true;
      const t = plan.tickets[plan.rowIndex || 0];
      if (!t) return true;
      const ro = plan.rowOverrides[t.identifier] || (plan.rowOverrides[t.identifier] = {});
      const choices = [null].concat(plan.harnesses.filter((h) => h !== plan.harness));
      const idx = choices.indexOf(ro.harness || null);
      ro.harness = choices[(idx + 1) % choices.length];
      return true;
    }

    // Shift-S — cycles the FOCUSED ROW's speed: batch default (null) →
    // fast → slow → default → back to batch. The explicit 'default' entry
    // is not redundant with null: a batch cycled to `fast` needs a way to
    // pin one row back to `default` specifically.
    case 'cycle-row-speed': {
      const plan = S.launchPlan;
      if (!plan || !plan.perRowEditable) return true;
      const t = plan.tickets[plan.rowIndex || 0];
      if (!t) return true;
      const ro = plan.rowOverrides[t.identifier] || (plan.rowOverrides[t.identifier] = {});
      const choices = [null, 'fast', 'slow', 'default'];
      const idx = choices.indexOf(ro.speed || null);
      ro.speed = choices[(idx + 1) % choices.length];
      return true;
    }

    // Shift-P — cycles the FOCUSED ROW's provider through what its
    // EFFECTIVE harness (row override, else label, else batch) can actually
    // reach — harnessCmd.providerChoices owns that validity, mirroring the
    // label path's own refusals (claude-code: either route works, CON-75 —
    // only an incomplete gateway still refuses; 'default' only means
    // something on a project-routed harness).
    case 'cycle-row-provider': {
      const plan = S.launchPlan;
      if (!plan || !plan.perRowEditable || !plan.providerConfigured) return true;
      const t = plan.tickets[plan.rowIndex || 0];
      if (!t) return true;
      const ro = plan.rowOverrides[t.identifier] || (plan.rowOverrides[t.identifier] = {});
      const effectiveHarness = ro.harness
        || (plan.ticketHarness && plan.ticketHarness[t.identifier])
        || plan.harness;
      const choices = harnessCmd.providerChoices(ctx.config, effectiveHarness);
      if (choices.length < 2) return true;
      const idx = choices.indexOf(ro.provider || null);
      ro.provider = choices[(idx + 1) % choices.length];
      return true;
    }

    // CON-22: cycles the batch's speed default -> fast -> slow -> default
    // (mirroring cycle-agent-merge's own toggle shape), refreshes the models
    // preview for the (new speed, CURRENT harness) pair, and re-applies
    // withSpeedFlag to the launch command — same "re-apply, don't drop"
    // discipline cycle-harness above already gives the agent-merge flag.
    case 'cycle-speed': {
      const plan = S.launchPlan;
      if (!plan) return true;
      const ORDER = ['default', 'fast', 'slow'];
      const idx = ORDER.indexOf(plan.speed);
      applySpeed(plan, ORDER[(idx + 1) % ORDER.length]);
      plan.launchCommand = launchplanScreen.withSpeedFlag(plan.launchCommand, plan.speed);
      plan.resolvedModels = ctx.resolveModels(
        plan.speed, harnessCmd.canonicalHarness(plan.harness), plan.provider);
      return true;
    }

    // CON-111, design.md Decision 3: applies the NEXT saved preset (the
    // array `open-launchplan` snapshotted when this plan was built —
    // plan.presets — cycled with wraparound, mirroring how repeated 'w'
    // presses sweep through the option space exactly like h/s/p already do
    // for their own single dimension). Every dimension the preset carries is
    // SET (not cycled) in the same dependency order the existing per-field
    // handlers above already encode — harness first (so providerDefault/an
    // unreachable provider drop reflect the NEW harness before agent-merge/
    // speed/provider are even considered), then agent-merge, then speed,
    // then provider — reusing the SAME apply<Dimension> helpers those four
    // handlers call with their own cycled value, called here instead with
    // the preset's STORED value. A dimension the preset does not specify
    // (`null`) or cannot reach for this batch/project is left UNCHANGED,
    // never errored — the identical graceful-degradation precedent
    // cycle-harness's own provider-drop already sets.
    case 'apply-preset': {
      const plan = S.launchPlan;
      if (!plan || !plan.presets || !plan.presets.length) return true;
      plan.presetIndex = plan.presetIndex == null ? 0 : (plan.presetIndex + 1) % plan.presets.length;
      const preset = plan.presets[plan.presetIndex];

      // harness: only when the preset names one AND it is reachable from
      // THIS batch's configured harnesses (plan.harnesses, CLI-label space —
      // the preset stores the CANONICAL id, so it is converted via
      // harnessCmd.cliLabel() before the membership check).
      if (preset.harness != null) {
        const label = harnessCmd.cliLabel(preset.harness);
        if (plan.harnesses && plan.harnesses.includes(label)) applyHarness(plan, label, ctx.config);
      }

      // agent-merge: only when editable for this batch (a dashboard.
      // launchCommand override has no flag slot to safely rewrite — the
      // identical gate cycle-agent-merge's own top-of-case check applies).
      if (plan.agentMergeEditable) applyAgentMerge(plan, preset.agentMerge);

      // speed: always applied — every project has at least 'default' to
      // apply, the same reasoning the launch plan's own unconditional 's'
      // key/footer hint already follow.
      applySpeed(plan, preset.speed);

      // provider: the IDENTICAL two-part guard cycle-provider's own top-of-
      // case check already requires (plan.perRowEditable && providerConfigured
      // — never providerConfigured alone), PLUS reachability from the
      // harness now in effect — 'w' must never set a value the batch's own
      // 'p' key would itself refuse to set.
      if (plan.perRowEditable && plan.providerConfigured) {
        const choices = harnessCmd.providerChoices(ctx.config, plan.harness);
        if (choices.includes(preset.provider)) applyProvider(plan, preset.provider);
      }

      // Rebuild the launch command / models preview ONCE, after every field
      // above has been applied — never once per field (design.md Decision
      // 3). Mirrors cycle-harness/cycle-provider's own `!ctx.cfg.launchCommand`
      // gate around applyBatchProviderFlags() exactly: that helper's base
      // command resolves the CURRENT harness's own template unconditionally,
      // which would silently replace an operator's pinned
      // `dashboard.launchCommand` override — under an override only speed
      // can have changed above (harness/agent-merge/provider are all gated
      // off by perRowEditable/agentMergeEditable being false in that case),
      // so this falls back to the same direct, override-safe
      // withSpeedFlag(...) rebuild cycle-speed itself always uses.
      plan.launchCommand = !ctx.cfg.launchCommand
        ? applyBatchProviderFlags(plan, ctx.config)
        : launchplanScreen.withSpeedFlag(plan.launchCommand, plan.speed);
      plan.resolvedModels = ctx.resolveModels(
        plan.speed, harnessCmd.canonicalHarness(plan.harness), plan.provider);
      return true;
    }

    // Builds the queue and hands off to it — see queue.js and app-state.js's
    // `queueState` comment for how the queue is persisted (CON-29). The
    // first tick (which actually launches up to `concurrency` tickets
    // through the launcher) happens in watch.js's draw(), called right after
    // this returns true — not here — so there is exactly one place in the
    // dashboard that calls queue.tick(). UNLESS `plan.startNow === false`:
    // createQueue's `confirmed: false` makes shouldTick() refuse that very
    // first tick (and every one after, until the operator's own confirm), so
    // a held batch reaches draw() but admits nothing.
    case 'confirm-launch': {
      const plan = S.launchPlan;
      if (!plan || !plan.tickets.length) return true;
      // Third and final refusal before anything reaches queue.tick: the
      // launch plan can sit on screen across many poll cycles while a human
      // reads it (same reasoning as drilldown.js's own re-check on 'y') — a
      // ticket selected and planned minutes ago can be live by the time
      // Enter is actually pressed. queue.tick (queue.js) would drop it
      // anyway on its very first tick, but filtering here means it is never
      // even reported as "dropped" — the confirm screen itself is the more
      // honest place to have refused it.
      const startable = plan.tickets.filter((t) => launchpadScreen.isSelectable(t, S.runs, S.queueState));
      const skipped = plan.tickets.filter((t) => !launchpadScreen.isSelectable(t, S.runs, S.queueState));
      if (startable.length) {
        // CON-69: bake each row's effective (harness, speed, provider) into
        // the queue record whenever it differs from the plain batch — row
        // override first, ticket label second, batch default last, the same
        // precedence the plan's own `⇒` annotation renders. Pre-resolving
        // here (rather than at spawn time) is what lets a restored queue
        // reproduce the operator's per-row choices exactly; tickets with no
        // entry keep the spawn-time label dispatch path unchanged.
        let perTicket = null;
        if (plan.perRowEditable) {
          const batchHarness = harnessCmd.canonicalHarness(plan.harness);
          for (const t of startable) {
            const ro = (plan.rowOverrides || {})[t.identifier] || {};
            const labelHarness = harnessCmd.resolveTicketHarness(t.labels, ctx.launcher.projectHarnesses);
            const harness = ro.harness
              ? harnessCmd.canonicalHarness(ro.harness)
              : (labelHarness || batchHarness);
            const speed = ro.speed || plan.speed;
            // Precedence: an explicit row choice, then the ticket's own
            // label, then the batch's `p` setting. The label beats the batch
            // for the same reason it beats it for harness — it is the more
            // specific statement about THIS ticket.
            const provider = ro.provider
              || harnessCmd.resolveTicketProvider(t.labels, ctx.config, harness)
              || plan.provider;
            // A provider always bakes, even when it matches the batch: the
            // routing rides a per-window ENV var, and the queue record's
            // single shared launchCommand has nowhere to carry one.
            if (harness === batchHarness && speed === plan.speed && !provider) continue;
            const spec = harnessCmd.launchSpecForChoices(
              { harness, speed, agentMerge: plan.agentMerge, provider }, ctx.config);
            if (!spec) continue;
            (perTicket = perTicket || {})[t.identifier] = spec;
          }
        }
        S.queueState = queue.createQueue(
          startable.map((t) => t.identifier),
          plan.concurrency,
          plan.launchCommand,
          plan.startNow,
          perTicket,
        );
        // Minted once per createQueue() call (design.md Decision 2) — this
        // queue's identity for as long as it lives, threaded through every
        // queueCache.write() call at the tick site in draw().
        S.queueSessionId = crypto.randomUUID();
      }
      S.queueNotice = skipped.length
        ? 'already running, skipped: ' + skipped.map((t) => t.identifier).join(', ')
        : null;
      S.launchPlan = null;
      S.launchPlanTicketScroll = 0;
      if (S.launchPad) S.launchPad.selected = new Set();
      S.mode = 'fleet';
      return true;
    }

    default:
      return false;
  }
}

module.exports = { handle };
