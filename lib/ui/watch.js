'use strict';

// The poll loop. What remains here after the controller split is exactly the
// stateful runtime no other module can own: the per-second draw()/reduce()
// cycle, terminal ownership (raw mode, the alternate buffer, attach), stdin
// wiring, and the assembly of the one `ctx` object the controller layer
// works through. Everything else moved along its natural seam:
//
//   lib/ui/frame.js        — the differential frame writer + pure helpers
//   lib/ui/app-state.js    — the state container, currentState(), navigation
//   lib/ui/launcher.js     — the spawn pipeline (per-ticket harness dispatch)
//   lib/ui/controllers/*   — the action handlers (the old applyAction switch)
//
// Idle tracking needs no memory across polls at all — it is a pure function
// of tmux's own per-window activity timestamp, recomputed fresh every poll
// (CON-5; frame.idleMsFromActivity).
//
// Module-loading discipline: test/watch.test.js fakes session/linear/draft/
// reap by swapping their require-cache entries and re-requiring THIS module
// only — so every fakeable dependency is required here and handed to the
// controllers via ctx, never re-required inside them.
//
// CON-44: `linear` below is actually ticket-provider.js's resolver — the
// local binding keeps the name `linear` (renaming would touch `ctx.deps` and
// every controller that reads `ctx.deps.linear` for no behavioural gain).
// require.cache fakes of lib/ui/linear.js still work: the resolver itself
// does `require('./linear')` and calls through the module object, so it
// picks up whatever fake sits in require.cache at load time.

const fs = require('fs');
const { execFileSync } = require('child_process');
const store = require('./store');
const { reduce } = require('./reducer');
// CON-78: attachTarget/killTarget are the sessions view's own generalised
// attach/kill (an arbitrary `session:window_id` pair, not this project's own
// ticket-addressed windows) — re-exported here under distinct local names so
// they flow through ctx.deps/the doAttach-style closure below exactly like
// every other fakeable dependency this module requires (see the header
// comment above).
const { createSession, hasTmux, attachTarget: attachSessionTarget, killTarget: killSessionTarget } = require('./session');
const router = require('./router');
const { submitTicket } = require('./prompt');
const control = require('./control');
const linear = require('./ticket-provider');
// CON-21: the headless ticket-drafting helper (design.md Decision 2) — kept
// as the whole module object (never destructured) so tests can monkeypatch
// `draftHelper.draftTicket` the same way `linear`'s functions are faked
// elsewhere, without the dashboard needing its own injectable seam.
const draftHelper = require('./draft');
const cache = require('./cache');
const ticketText = require('./ticket-text');
const retention = require('./retention');
const reap = require('./reap');
const queue = require('./queue');
const queueCache = require('./queue-cache');
const ticketDetail = require('./ticketDetail');
const launchpadScreen = require('./screens/launchpad');
// The harness -> launch-command seam (per-ticket `harness:<value>` dispatch,
// CLI templates, default command) — see lib/ui/harness.js's own header.
const harnessCmd = require('./harness');
const bannerScreen = require('./banner');
const topbar = require('./topbar');
// Only the windowing/eligibility helpers are needed directly here —
// everything else reaches fleet.js through the router's render(state, opts)
// seam, same as before (design.md Decision 3).
const fleetScreen = require('./screens/fleet');
// CON-19: evidenceItems (to clamp drillEvidenceIndex/resolve the selected
// entry) and docview/ticketview's own computeViewportRows (to precompute the
// SAME viewport budget their own render() calls use, ahead of the next
// keypress — router.handleKey's seam carries no `opts`; see docview.js's and
// ticketview.js's own comments on why this cannot be recomputed live).
const drilldownScreen = require('./screens/drilldown');
const docviewScreen = require('./screens/docview');
const ticketviewScreen = require('./screens/ticketview');
const frame = require('./frame');
const watchLock = require('./watch-lock');
const launcherMod = require('./launcher');
const appState = require('./app-state');
const controllers = require('./controllers');
// CON-78: discovery (process/tmux enumeration) and the sessions controller
// itself — routed through this file for the same require-cache-fake reason
// every other stateful/impure dependency is (discovery touches /proc, spawns
// processes, and shells out to tmux). sessionsController is required
// directly, not just through the generic `controllers` registry, so the
// poll timer's own gated auto-refresh (design.md Decision 1) can call its
// refreshSessions() without duplicating that logic here.
const discovery = require('./discovery');
const sessionsController = require('./controllers/sessions');

const {
  buildFrame, attachAndRestore, computeLiveEscalations, idleMsFromActivity, splitKeys,
  CURSOR_HOME, ALT_SCREEN_ENTER, ALT_SCREEN_EXIT, CURSOR_HIDE, CURSOR_SHOW,
} = frame;
const { resolveModelsForPlan } = launcherMod;

// CON-22: reverse-maps the CLI-binary label ('claude') back to the CANONICAL
// harness id ('claude-code') that resolve-speed.sh's own `$2` and the
// `models.<harness>`/`modelTiers.<harness>` config keys use. Lives in
// lib/ui/harness.js (one seam for all harness/CLI mapping); re-exported
// below unchanged for existing callers and tests.
const canonicalHarness = harnessCmd.canonicalHarness;

// The top bar's own screen-name label — deliberately distinct from
// router.js's SCREENS keys (those are internal mode strings; these are the
// human-facing names topbar.js prints, matching each screen's own on-screen
// title where one exists, e.g. drilldown's own header rows vs. this short
// label).
const SCREEN_LABELS = {
  fleet: 'FLEET',
  escalation: 'ESCALATION',
  drilldown: 'DRILL-DOWN',
  launchpad: 'LAUNCH PAD',
  ticketview: 'TICKET',
  launchplan: 'LAUNCH PLAN',
  docview: 'EVIDENCE',
  ticketdraft: 'NEW TICKET',
  settings: 'SETTINGS',
  sessions: 'SESSIONS',
};

// Every box costs 2 columns to its border characters and 2 more to box()'s
// default horizontal padding — see fleet.js/drilldown.js/ticketview.js's
// identical constant. Used here only to size ticketview's own word-wrap
// width from the terminal's column count (task 4.3).
const DOC_BOX_BORDER_PADDING_COLS = 4;

const POLL_MS = 1000;

// CON-78, design.md Decision 1: whether THIS poll tick should re-run
// sessions discovery — never on an unconditional tick (the whole point of
// gating it at all), only every 3rd tick while the sessions screen is the
// one currently on top. Exported (like buildFrame/canonicalHarness below)
// so this gating logic is directly unit-testable without waiting on a real
// POLL_MS timer — see test/watch.test.js's own flushRefresh() comment on
// why a real wall-clock wait around this file's stdout-capturing harness is
// deliberately avoided (it corrupts node:test's own pass/fail accounting
// for an adjacent test).
function sessionsAutoRefreshDue(mode, tickCount) {
  return mode === 'sessions' && tickCount % 3 === 0;
}

// CON-55 (design.md Decision 4): opens `url` in the OS default browser via
// `xdg-open` — Linux, this tool's only supported platform (see design.md's
// Non-Goals). Synchronous, matching every other `execFileSync` call in this
// layer (commitSha, resolveModelsForPlan) — the sub-second duration
// `xdg-open` itself takes to hand off to the desktop's URL handler and
// return is not observably different from those. Deliberately does NOT
// catch — a missing binary, a non-zero exit, or any other throw propagates
// to the caller (the drilldown controller's 'open-external-url' handler),
// which is what turns it into a visible `drillNotice` rather than a
// caught-and-silently-ignored failure. `stdio: 'ignore'` so a talkative
// browser/opener never bleeds output onto this dashboard's own screen.
function openInBrowser(url) {
  execFileSync('xdg-open', [url], { stdio: 'ignore' });
}

async function watch(opts) {
  const root = opts.root;
  const config = opts.config || {};
  const cfg = config.dashboard || {};
  const session = createSession(cfg.tmuxSession || 'concertino', root);

  if (!hasTmux()) {
    console.error('concertino watch: tmux not found on PATH.');
    console.error('Install it (e.g. `pacman -S tmux`, `brew install tmux`, `apt install tmux`) and retry.');
    process.exitCode = 1;
    return;
  }

  // CON-68: the single-writer guard, BEFORE anything below touches shared
  // state (session.ensure creates tmux windows; retention.prune and the
  // queue restore both write under .concertino/) — a second dashboard on
  // the same repo would clobber the first's queue cache on every tick, so
  // it must refuse here, on stderr, before ever entering the alternate
  // screen. See lib/ui/watch-lock.js for why ownership is pid-liveness, not
  // heartbeat freshness.
  {
    const lock = watchLock.acquire(root, process.pid, Date.now());
    if (!lock.ok) {
      const heldFor = lock.holder.heartbeatAt
        ? Math.round((Date.now() - lock.holder.heartbeatAt) / 1000) + 's since last heartbeat'
        : 'unknown age';
      console.error('concertino watch: another dashboard (pid ' + lock.holder.pid +
        ', ' + heldFor + ') already owns this repo.');
      console.error('Attach to it, or if it is truly gone, remove ' + watchLock.lockPath(root) + ' and retry.');
      process.exitCode = 1;
      return;
    }
  }

  session.ensure();

  // Best-effort, once, before the poll loop ever starts — a pruning failure
  // (permissions, races) must never block the dashboard from coming up.
  // Pruning never runs again on the per-second poll path (design.md
  // Decision 4); `concertino prune` is the explicit, repeatable entry point.
  try {
    retention.prune(root, config);
  } catch (e) { /* hygiene, not a dashboard dependency */ }

  // The spawn pipeline (lib/ui/launcher.js): the process-wide launch command
  // plus per-ticket `harness:<value>` dispatch, shared by every spawn site —
  // the queue tick below, and the controllers' force-start / `n` prompt /
  // draft-launch / restart paths — so a labelled ticket cannot slip through
  // one path and not another.
  // How long a delivered-but-still-open session is left alone before its
  // window is closed (lib/ui/reap.js's second condition). `0` disables the
  // idle reap entirely, leaving only the original dead-window behaviour.
  const reapIdleGraceMs = (typeof cfg.reapDeliveredAfterMinutes === 'number'
    ? cfg.reapDeliveredAfterMinutes
    : reap.DEFAULT_IDLE_GRACE_MIN) * 60 * 1000;

  const launcher = launcherMod.createLauncher({ root, session, cfg, config });
  const launchCommand = launcher.launchCommand;

  // One cache instance for the process lifetime, passed into every poll's
  // store.readAll() call — this is what makes the per-second poll cost
  // O(bytes appended since the last poll) instead of O(total log size)
  // (design.md Decision 3).
  const eventsCache = store.createEventsCache();

  // The whole app-level state container — see lib/ui/app-state.js for the
  // field-by-field design notes. `S` is shared, by reference, with every
  // controller through `ctx`; the loop-internal bits that no controller may
  // touch (the frame diff cache, the running flag) stay closure-local below.
  const S = appState.createAppState();

  let running = true;
  // The previous frame's own already-padded lines — the content buildFrame()
  // diffs the next frame against, row by row (CON-27 design.md Decision 1).
  // Deliberately ONE array rather than a count plus a parallel array: the
  // array's own `.length` already is the count the shrink-cleanup loop needs,
  // so there is no second piece of state that can drift out of sync with it.
  // Starts empty, which is exactly what makes every row of the session's very
  // first frame diff as "changed" with no special-case code (Decision 3).
  let prevFrameLines = [];
  // CON-78: counts every poll timer tick (never reset) — the raw material
  // sessionsAutoRefreshDue() gates on. Deliberately NOT reset when the
  // sessions screen opens/closes: the gate only cares about `tickCount % 3`,
  // so restarting the count on open would just change WHICH ticks happen to
  // land on a multiple of 3, with no behavioural difference.
  let tickCount = 0;

  function currentState() {
    return appState.currentState(S);
  }
  function backToFleet() {
    appState.backToFleet(S);
  }

  // Gate status is computed once, the first time `launchPad` is created
  // (inside the `if (!S.launchPad)` below) — NOT re-derived on every later
  // re-open, since `launchPad` deliberately survives a trip back to the
  // fleet (see app-state.js). That is safe only because config/env do not
  // change mid-session; ensureLaunchPad() is still the one place that
  // decides "enabled or not", it just decides it once per session rather
  // than once per keypress.
  //
  // CON-54: the lazy cache-init half of the old openLaunchPad() — split out
  // so the fleet-originated 'view-ticket'/'view-ticket-quickstart' handlers
  // can populate `launchPad.cache` (so ticketview.js's own findTicket() has
  // something to search) WITHOUT also flipping `mode = 'launchpad'`, which
  // openLaunchPad() (below) still does for its own callers, unchanged.
  function ensureLaunchPad() {
    if (!S.launchPad) {
      const initialCache = cache.read(root);
      // CON-44: `config` here is whatever lib/cli/watch.js's cmdWatch parsed
      // straight off disk — it never runs through lib/config.js's
      // loadConfig/withDefaults (cmdWatch's own comment: "watch works
      // without config"), so ticketProvider.kind may be absent (no config
      // file, or malformed JSON), typo'd, still the deprecated "manual", or
      // "github" (which `concertino validate` accepts but the resolver has
      // no module for). ticket-provider.js's moduleFor() is deliberately
      // loud about all of that — correct for a call made mid-fetch, but
      // ensureLaunchPad's whole job here is producing a GATE status the
      // launch pad screen already renders a message for on `enabled: false`
      // (screens/launchpad.js's own status.message handling) — so a throw is
      // caught and downgraded to exactly that, rather than escaping into the
      // stdin 'data' listener uncaught (onKey/applyAction have no try/catch
      // of their own), which would skip quit()'s terminal restore and leave
      // the user's terminal in raw mode / the alternate screen buffer.
      let status;
      try {
        status = linear.launchPadStatus(config, process.env);
      } catch (e) {
        status = { enabled: false, reason: 'provider', message: String(e.message) };
      }
      // Same hazard, same guard: a persisted `teamFound: false` row is read
      // back through the resolver on every fresh process (see the comment
      // below), so an unresolvable kind would throw here too, before the
      // launch pad ever got a chance to show its own gate message instead.
      let error = null;
      if (initialCache.teamFound === false) {
        try {
          error = linear.teamNotFoundMessage(config, initialCache.teamKey);
        } catch (e) {
          error = String(e.message);
        }
      }
      S.launchPad = {
        status,
        cache: initialCache,
        pane: 'epics',
        epicIndex: 0,
        ticketIndex: 0,
        selected: new Set(),
        mode: 'parallel',
        // 'identifier' (default, cache order) | 'priority' (urgency order —
        // see launchpad.js's sortByPriority). Toggled by the P key; the
        // default keeps every pre-CON-35 test/behavior unchanged until a
        // user opts in.
        ticketSort: 'identifier',
        refreshing: false,
        // CON-20 (skeptic-final-1.md): a prior refresh's "team not found"
        // conclusion must survive a process restart — refreshLaunchPad
        // persists it as `cache.teamFound`, and this is the ONLY other place
        // `lp.error` is ever seeded (every other assignment is inside
        // refreshLaunchPad itself), so a fresh process opening the launch
        // pad reads the SAME persisted row `refreshLaunchPad` would have
        // produced the error from, and shows it immediately — before any
        // `r` keypress — instead of hardcoding `null` and silently
        // forgetting what the last refresh actually found.
        // `teamFound === false` specifically (not `!== true`, which would
        // also catch `null` — "unknown", e.g. a pre-CON-20 cache row this
        // schema version's own migration already treats as cold/empty
        // rather than reaching this field at all) is what distinguishes
        // "confirmed not found" from every other state.
        error,
        viewingTicket: null,
        project: (config.project && config.project.name) || '',
        defaultConcurrency: cfg.maxConcurrent || 2,
      };
    }
  }

  function openLaunchPad() {
    ensureLaunchPad();
    S.mode = 'launchpad';
    // CON-44: a local store is a directory read, not a network round trip, so
    // the "press r to fetch" hint (launchpad.js:317) — which exists to avoid
    // spending a request on open — has nothing to protect against here. Fire
    // and forget, exactly as the `r` handler does.
    if (((config.ticketProvider || {}).kind) === 'local' && S.launchPad.status.enabled) refreshLaunchPad();
  }

  // Fire-and-forget: sets `refreshing` synchronously (before its first
  // `await`, so the very next draw() — including the one applyAction
  // triggers immediately after this returns — already shows "fetching…"),
  // then updates the cache once the network call settles. The 1-second poll
  // timer picks up the result on its own; nothing here needs to force an
  // extra redraw.
  async function refreshLaunchPad() {
    const lp = S.launchPad;
    if (!lp) return;
    lp.refreshing = true;
    lp.error = null;
    try {
      const team = linear.teamKeyFromConfig(config, process.env);
      if (!team.key) throw new Error('no ticketProvider.teamKey configured — see config-reference.md');
      // Resolved once and reused for both calls below (rather than reading
      // process.env.LINEAR_API_KEY a second time for resolveTeam) so the two
      // requests are never able to disagree about which key authenticated
      // the fetch they're a pair for — fetchTickets defaults to this same
      // env var internally, but only when apiKey is omitted from opts.
      const apiKey = process.env.LINEAR_API_KEY;
      const result = await linear.fetchTickets(config, {
        root,
        teamKey: team.key,
        apiKey,
        stateTypes: linear.stateTypesFromConfig(config),
      });
      // design.md Decision 2: a zero-ticket fetch is ambiguous on its own —
      // Linear answers a query against an unknown team key with an empty
      // result, the identical shape a real team with nothing open would
      // return — so only THEN spend a second round trip resolving the team
      // directly. A non-empty result already proves the team exists; this
      // never runs on the common (real team, has tickets) path.
      //
      // CON-20 (skeptic-final-1.md): `teamFound` is persisted onto the cache
      // row itself, not just held in `lp.error` — this in-memory field alone
      // only lasts for the current process, and the very next `concertino
      // watch` restart would otherwise read this same cache row fresh, with
      // no way to tell "confirmed empty, real team" apart from "team never
      // resolved" (ensureLaunchPad rebuilds `lp.error` from exactly this
      // field on a fresh process — see its own comment).
      let teamFound = true;
      if (result.tickets.length === 0) {
        const resolved = await linear.resolveTeam(config, { root, apiKey, teamKey: team.key });
        teamFound = resolved.found;
        if (!resolved.found) {
          lp.error = linear.teamNotFoundMessage(config, team.key);
        }
      }
      // Per-file skips are reported, never swallowed — a board that silently
      // drops two tickets reads as a complete board. In-memory only: under
      // local, openLaunchPad refreshes on every open, so this is always
      // rebuilt rather than needing a cache field of its own.
      if (!lp.error && result.unreadable > 0) {
        lp.error = result.unreadable + ' ticket file(s) unreadable — check frontmatter (title, state, matching id)';
      }
      cache.write(root, Object.assign({}, result, { teamFound }), Date.now());
      lp.cache = cache.read(root);
      lp.epicIndex = 0;
      lp.ticketIndex = 0;
    } catch (e) {
      lp.error = 'refresh failed: ' + String((e && e.message) || e).split('\n')[0];
    } finally {
      lp.refreshing = false;
    }
  }

  function sampleWindows(now) {
    const windows = session.listWindows();

    // Stateless: idleMs is recomputed from tmux's own window_activity on
    // every poll, not seeded once and then refined by a pane-content hash.
    // This also survives a dashboard restart for free — window_activity is
    // tmux's state, not the dashboard's, so a fresh process reads the same
    // value a prior process would have (see frame.idleMsFromActivity's own
    // header comment and design.md).
    return windows.map((w) => {
      if (!w.alive) return { ticket: w.ticket, alive: false, idleMs: null };
      return { ticket: w.ticket, alive: true, idleMs: idleMsFromActivity(w.activity, now) };
    });
  }

  // The actual rows available to the router's render(state, opts) once the
  // cross-screen escalation banner (if any) has taken its own lines off the
  // top — the same computation draw() itself needs every poll, factored out
  // so the fleet controller's scroll-into-view (CON-6, design.md Decision 3)
  // can call the exact same thing before draw() ever runs, rather than
  // approximating it and letting the two disagree about what "the visible
  // window" is.
  function computeScreenRows() {
    const cols = process.stdout.columns || 80;
    // Suppressed only when the screen already on top IS that exact
    // escalation — showing it there would literally duplicate what the
    // dedicated escalation screen (lib/ui/screens/escalation.js) already
    // renders (design.md Decision 6 / spec.md's "suppressed on its own
    // escalation's screen" scenario).
    const bannerText = bannerScreen.suppressedOnOwnScreen(S.mode, S.escalationTicket, S.liveEscalations)
      ? null
      : bannerScreen.renderBanner(S.liveEscalations, { cols, now: Date.now(), reply: S.globalEscalationReply });
    const bannerLines = bannerText ? bannerText.split('\n').length : 0;
    const totalRows = process.stdout.rows || 0;
    const reserved = bannerLines + 1; // +1 for the persistent top bar
    return totalRows > 0 ? Math.max(0, totalRows - reserved) : 0;
  }

  // CON-40: the QUICK START widget's own eligible-ticket list (design.md
  // Decision 4) — the top QUICK_START_COUNT open tickets by priority,
  // flattened across every epic, reusing launchpad.js's own
  // sortByPriority/isSelectable exactly as the launch pad itself does,
  // excluding anything already `▲ running` (isSelectable) OR already on the
  // active queue's `pending`/`inFlight` (a ticket added moments ago, still
  // pending, has no run object yet, so isSelectable alone would not catch
  // it). Recomputed fresh on every call — draw() (to actually render the
  // panel) and the controllers' move/add/view handlers (to clamp the cursor
  // or resolve `action.index` to a real ticket) all call this rather than
  // sharing one cached array, so none of them can ever disagree with what
  // the fleet/queue currently actually contain — the same "cheap enough to
  // recompute every frame" precedent `queuedTitles` already sets (design.md's
  // own "Trade-offs" note).
  function quickStartEligible() {
    const inQueue = (id) => !!S.queueState && (
      S.queueState.pending.includes(id) || (S.queueState.inFlight && S.queueState.inFlight.has(id))
    );
    return launchpadScreen
      .sortByPriority(cache.read(root).tickets || [])
      .filter((t) => launchpadScreen.isSelectable(t, S.runs))
      .filter((t) => !inQueue(t.identifier))
      .slice(0, fleetScreen.QUICK_START_COUNT);
  }

  // The one object the controller layer works through — see
  // controllers/index.js for the contract. `doAttach`/`quit` are terminal/
  // process actions defined inside the input promise below and assigned onto
  // this same object before the first key can possibly arrive (stdin wiring
  // happens after both are set).
  const ctx = {
    S,
    root,
    cfg,
    config,
    session,
    launcher,
    // Stateful modules routed through THIS file so the tests' require-cache
    // fakes keep working — see the header comment.
    deps: {
      store, linear, draftHelper, control, cache, queue, queueCache, submitTicket,
      // CON-78: discovery.discover() and the generalised freelance-kill
      // helper — see this file's own header comment on why every fakeable
      // dependency flows through here rather than being re-required inside
      // the controller that uses it.
      discovery, killSessionTarget,
    },
    computeScreenRows,
    quickStartEligible,
    resolveModels: (speed, harness, provider) => resolveModelsForPlan(root, speed, harness, provider),
    openInBrowser,
    ensureLaunchPad,
    openLaunchPad,
    refreshLaunchPad,
    backToFleet,
    backToLaunchPad: () => appState.backToLaunchPad(S),
    doAttach: null,
    quit: null,
  };

  function draw() {
    const now = Date.now();

    // The queue runner advances on every poll, independent of which screen
    // is on top — a batch launched from the launch pad must keep feeding the
    // fleet whether or not the human is still looking at it. tick() decides
    // WHICH tickets to start now (see queue.js) against the FLEET SNAPSHOT
    // FROM THE PREVIOUS DRAW — this has to run before reduce() below, not
    // after: the launcher's session.spawn is synchronous, so any window it
    // opens is already live by the time sampleWindows() looks at tmux a few
    // lines down, and the newly-launched ticket appears in THIS frame rather
    // than waiting a full extra poll to show up (the `n` prompt gets this for
    // free since its spawn happens before the draw() that follows it; the
    // queue has to earn it explicitly since its spawn happens INSIDE draw()).
    // shouldTick() (queue.js) refuses a restored-but-not-yet-confirmed queue
    // (`confirmed: false`) — CON-29's core safety property: nothing a
    // restored queue would launch reaches the launcher until the operator
    // has explicitly pressed the confirm key fleet.js's QUEUED section
    // advertises (see 'confirm-restored-queue' in the fleet controller).
    if (S.queueState && queue.shouldTick(S.queueState)) {
      const result = queue.tick(S.queueState, S.runs);
      // A pending ticket queue.tick refused to admit (it is already live —
      // see queue.js's own "dropped, not held" decision) is otherwise
      // invisible: it never reaches the launcher, so nothing else on this
      // poll would explain why the fleet never grew by one. Set first so a
      // same-tick spawn failure (more immediately actionable) can still
      // override it below.
      if (result.dropped.length) {
        S.queueNotice = 'already running, skipped from queue: ' + result.dropped.join(', ');
      }
      for (const ticket of result.toLaunch) {
        // CON-69: a ticket with a pre-baked per-row spec (harness/speed/
        // provider chosen on the launch plan) spawns it verbatim; everything
        // else goes through the ordinary label-dispatching launch path.
        const pt = result.queue.perTicket && result.queue.perTicket[ticket];
        const launched = pt
          ? launcher.launchSpec(ticket, pt)
          : launcher.launch(ticket, result.queue.launchCommand);
        if (!launched.spawned) S.queueNotice = launched.error;
      }
      S.queueState = queue.isIdle(result.queue) ? null : result.queue;
      // Written on every tick, removed once idle — mirrors the queueState
      // assignment on the line right above so the on-disk file's lifetime
      // matches the in-memory queue's exactly (design.md Decision 3), the
      // one exception being the not-yet-confirmed restore window, which
      // never reaches this branch at all (shouldTick() above refuses it).
      if (S.queueState) {
        queueCache.write(root, S.queueState, S.queueSessionId, now);
      } else {
        queueCache.clear(root);
        S.queueSessionId = null;
      }
    }

    S.runs = reduce(store.readAll(root, eventsCache), sampleWindows(now), now);

    // Reap any run whose window is BOTH terminal (run.end observed) and
    // already dead — same poll cadence as the rest of draw(), right after
    // reduce() so it always sees this poll's own runs/window snapshot, not
    // gated behind any config (design.md/tasks.md 3.1). This frame still
    // renders the pre-kill window state (`runs` was already computed above);
    // the window disappearing from `session.listWindows()` is picked up by
    // the NEXT poll's sampleWindows(), same as any other tmux-side change.
    // `now` + the configured grace enable the second reap condition: a
    // DELIVERED run whose harness returned to its prompt instead of
    // exiting. Without them only already-dead windows are closed, and an
    // idle delivered session lingers forever (holding a Remote Control
    // registration, so it also stays on the operator's phone).
    reap.reapFinished(root, session, S.runs, now, reapIdleGraceMs);

    if (S.selected >= S.runs.length) S.selected = Math.max(0, S.runs.length - 1);
    // A `runs` list that shrinks (a run finishes and rolls out of
    // FAILED/DONE faster than a human scrolls, or the terminal is resized
    // shorter) can leave `scrollOffset` pointing past the end — re-clamp it
    // every draw(), mirroring the `selected` clamp immediately above
    // (design.md Decision 3, tasks.md 2.3/2.5). maxScrollOffset is
    // structural (independent of `rows`), so `rows: 0` here is deliberate —
    // this clamp needs no height-budget computation at all.
    // fleet-metrics-grid design: mirrors renderFleet's own grid-mode gate
    // exactly (final whole-branch review, Finding 1: shared via
    // fleetScreen.gridModeEligible, not just the GRID_MIN_COLS width
    // check) — this clamp must use the same windowing function the
    // renderer will actually use this frame, or a scrollOffset valid in one
    // mode could be invalid in the other. Eligibility itself is checked
    // against the REAL row count (computeScreenRows()), not this call's own
    // `rows: 0` — gridModeEligible would otherwise always report `false`
    // (see its own header comment), silently forcing single-column
    // accounting even when the renderer is actually about to render in
    // grid mode this frame.
    {
      const gridCols = process.stdout.columns || 80;
      // fleet-metrics-grid final-fix 2: must include every tail-lengthening
      // field (prompt/queueNotice/restoreNotice/quitConfirm/
      // forceStartConfirm/clearQueueConfirm) that buildHeadTail() reads —
      // omitting them makes this opts object systematically OVER-estimate
      // columnAreaHeight relative to what renderFleet actually computes
      // (which always receives the full render opts), so this clamp could
      // pick grid mode's maxScrollOffset while the renderer draws
      // single-column, or vice versa. Same fields, same reasoning, as
      // the fleet controller's scrollToShow winOpts.
      const heightOpts = {
        cols: gridCols, rows: computeScreenRows(), selected: S.selected, scrollOffset: S.scrollOffset,
        queueState: S.queueState,
        prompt: S.prompt, queueNotice: S.queueNotice, restoreNotice: S.restoreNotice,
        quitConfirm: S.quitConfirm, forceStartConfirm: S.forceStartConfirm, clearQueueConfirm: S.clearQueueConfirm,
      };
      const gridMode = fleetScreen.gridModeEligible(S.runs, heightOpts);
      const winFn = gridMode ? fleetScreen.visibleWindowGrid : fleetScreen.visibleWindow;
      S.scrollOffset = Math.max(0, Math.min(S.scrollOffset,
        winFn(S.runs, Object.assign({}, heightOpts, { rows: 0 })).maxScrollOffset));
    }

    // CON-39: the QUEUED-local cursor's own re-clamp, same discipline as
    // `scrollOffset`'s immediately above (design.md's "Risks" note,
    // tasks.md 4.4) — a queue that shrinks (an ordinary tick() admits the
    // very ticket `queueFocus` was pointing at) or empties out entirely
    // between keypresses must never leave a stale, out-of-range cursor on
    // screen. Falls back to the ordinary run selection when there is
    // nothing left in QUEUED to focus.
    if (S.focus === 'queue') {
      const pendingLen = S.queueState && S.queueState.pending ? S.queueState.pending.length : 0;
      if (!pendingLen || S.queueFocus == null || S.queueFocus < 0 || S.queueFocus >= pendingLen) {
        S.focus = 'runs';
        S.queueFocus = null;
      }
    }

    // CON-40/CON-56: the QUICK START widget's own eligible-ticket list,
    // computed once per draw() (design.md Decision 4), unconditionally (the
    // section is always shown) — used both to actually render the panel
    // (threaded through router.render's opts, further below) and,
    // immediately here, to defensively re-clamp `quickStartFocus` the same
    // "shrinks out from under it" way `queueFocus` is just above (tasks.md
    // 4.5). Unlike QUEUED, an empty QUICK START does NOT fall focus back to
    // 'runs' — the section keeps rendering (forceRender, see fleet.js's
    // buildSections) with an explanatory hint rather than disappearing, so
    // there is still something coherent on screen to stay focused on; only
    // the cursor itself is clamped, to 0, so it never points past the end of
    // a list that just shrank (a ticket added, or one that started running
    // by hand).
    const quickStartTickets = quickStartEligible();
    const quickStartCold = cache.isCold(cache.read(root));
    if (S.focus === 'quickstart') {
      const len = quickStartTickets ? quickStartTickets.length : 0;
      if (S.quickStartFocus == null || S.quickStartFocus < 0 || S.quickStartFocus >= len) {
        S.quickStartFocus = 0;
      }
    }

    // The escalation screen tracks its run by ticket, not by a snapshot taken
    // when it was opened, so it always reflects the latest poll. If that run's
    // escalation has cleared — answered, timed out, or the run itself is gone
    // — there is nothing left to show here; fall back to the fleet rather than
    // render a dead screen. This is also what makes "the row clears" visible:
    // once `emit-event.sh --await` notices `answer.json` and logs
    // `escalation.answered`, the very next poll walks the human back out.
    if (S.mode === 'escalation') {
      const run = S.runs.find((r) => r.ticket === S.escalationTicket);
      if (!run || !run.escalation) backToFleet();
    }

    // The cross-screen escalation banner (CON-25): recomputed every poll,
    // same as the fleet's own NEEDS YOU section. If the reply box is open for
    // a ticket that has dropped out of this set — answered, timed out, or the
    // run itself gone — there is no longer a live escalation to write an
    // answer against, so close it exactly as draw() already walks the
    // dedicated escalation screen back to the fleet above.
    S.liveEscalations = computeLiveEscalations(S.runs);
    if (S.globalEscalationReply && !S.liveEscalations.some((r) => r.ticket === S.globalEscalationTicket)) {
      S.globalEscalationReply = null;
      S.globalEscalationTicket = null;
    }

    // `rows` matters as much as `cols`: the screen is rewritten every second,
    // so output taller than the terminal scrolls the header and NEEDS YOU
    // off the TOP — the one thing that must always be visible.
    const cols = process.stdout.columns || 80;
    // Suppressed only when the screen already on top IS that exact
    // escalation — showing it there would literally duplicate what the
    // dedicated escalation screen (lib/ui/screens/escalation.js) already
    // renders (design.md Decision 6 / spec.md's "suppressed on its own
    // escalation's screen" scenario).
    const bannerText = bannerScreen.suppressedOnOwnScreen(S.mode, S.escalationTicket, S.liveEscalations)
      ? null
      : bannerScreen.renderBanner(S.liveEscalations, { cols, now, reply: S.globalEscalationReply });
    const screenRows = computeScreenRows();

    // CON-19: the drill-down's EVIDENCE selection/scroll and the evidence
    // reader's/ticketview.js's own viewport budgets are all recomputed here,
    // every poll — the same "re-clamp on every draw()" discipline
    // `selected`/`scrollOffset` already get above, extended to this
    // change's own new state. `docViewportRows`/`ticketviewViewportRows`
    // (and ticketviewBodyLineCount) are precomputed for the NEXT keypress's
    // routeHandleKey to use (router.handleKey's own seam carries no `opts`,
    // so cols/rows cannot be read live at keypress time — see docview.js's
    // and ticketview.js's own comments on why).
    if (S.mode === 'drilldown' && S.drillTicket) {
      const run = S.runs.find((r) => r.ticket === S.drillTicket);
      const items = run ? drilldownScreen.evidenceItems(run) : [];
      S.drillEvidenceIndex = Math.max(0, Math.min(S.drillEvidenceIndex, Math.max(0, items.length - 1)));
    }
    if (S.mode === 'docview') {
      S.docViewportRows = docviewScreen.computeViewportRows(screenRows);
      S.docScroll = docviewScreen.clampScroll((S.docBody || []).length, S.docViewportRows, S.docScroll);
    }
    if (S.mode === 'ticketview') {
      const ticket = ticketviewScreen.findTicket(S.launchPad, S.launchPad && S.launchPad.viewingTicket);
      if (ticket) {
        const innerWidth = Math.max(0, (process.stdout.columns || 80) - DOC_BOX_BORDER_PADDING_COLS);
        S.ticketviewBodyLineCount = ticketDetail.buildDetailLines(ticket, innerWidth).length;
        S.ticketviewViewportRows = ticketviewScreen.computeViewportRows(screenRows, !!ticket.url);
        S.ticketviewScroll = docviewScreen.clampScroll(S.ticketviewBodyLineCount, S.ticketviewViewportRows, S.ticketviewScroll);
      }
    }

    // A queued ticket carries only its id (see queue.createQueue) — no
    // title. The launch pad can only have created this queue from tickets
    // already fetched into the on-disk cache (`confirm-launch` builds
    // queueState from launchPad.cache, which is itself written from a fetch),
    // so the same tickets are durably on disk in .concertino/cache/tickets.json
    // independent of whether `launchPad` itself is still populated this
    // session (design.md Decision 3). Read fresh each poll — the exact same
    // cheap sync read openLaunchPad() already performs — and gated on a
    // non-empty queue so an idle/no-queue poll pays nothing extra.
    const queuedTitles = (S.queueState && S.queueState.pending.length)
      ? new Map((cache.read(root).tickets || []).map((t) => [t.identifier, t.title]))
      : null;

    // CON-18: the drill-down's TICKET panel/header title — same seam as
    // queuedTitles just above (a small, gated, per-poll disk read passed
    // through opts to the router, never folded into reduce()'s pure fold —
    // see design.md Decision 2). There is exactly one ticket the current
    // frame can possibly show text for, so this is skipped entirely unless
    // the drill-down is actually open.
    const drillTicketText = (S.mode === 'drilldown' && S.drillTicket)
      ? ticketText.resolve(root, S.drillTicket, cache.read(root))
      : null;

    const screenText = router.render(currentState(), {
      cols,
      rows: screenRows,
      now,
      queuedTitles,
      ticketText: drillTicketText,
      // CON-40: built once above (design.md Decision 4) — `quickStartFocus`
      // itself is already reachable off `currentState()` (see fleet.js's
      // render(state, opts), which reads it straight off `state`, exactly
      // like focus/queueFocus).
      quickStartTickets,
      quickStartCold,
    });
    const topBarLine = topbar.buildTopBarLine(currentState(), SCREEN_LABELS[S.mode] || String(S.mode).toUpperCase(), { cols });
    const rendered = topBarLine + '\n' + (bannerText ? bannerText + '\n' : '') + screenText + '\n';

    // Differential redraw, never a full-screen clear: only the rows whose
    // padded content actually changed since the previous frame are written,
    // each positioned by its own `\x1b[<row>;1H` — plus the trailing-row
    // blanking a frame that shrank still needs, and the cursor-park write
    // that keeps the cursor's resting position fixed (see buildFrame's own
    // header comment and CON-27 design.md Decisions 2/6/8). A frame taller
    // than the terminal falls back inside buildFrame to the original
    // cursor-home + newline-flow full rewrite, so the terminal's own scroll
    // still happens for it. That fallback keys on the WHOLE terminal height,
    // read fresh here — deliberately NOT computeScreenRows()'s `screenRows`,
    // which is the router's own sub-budget with the banner's lines already
    // subtracted off (CON-6 factored that helper out). `rendered` INCLUDES
    // the banner, so `screenRows` would under-report the height the
    // terminal's auto-scroll actually behaves on and would trip the
    // fallback on frames that in fact fit (design.md Decision 6).
    // The `if (frame.bytes)` guard is required, not an optimization: an
    // unchanged tick must not call process.stdout.write at all, rather than
    // writing zero bytes to it (design.md Decision 5).
    const totalRows = process.stdout.rows || 0;
    const outFrame = buildFrame(rendered, cols, totalRows, prevFrameLines);
    if (outFrame.bytes) process.stdout.write(outFrame.bytes);
    prevFrameLines = outFrame.lines;
    return S.runs;
  }

  // CON-29: restore a persisted queue tail, if any, BEFORE the poll loop
  // starts and before queueState is otherwise assigned. This needs its own
  // one-off `reduce()` pass — draw()'s own queue.tick() call site
  // deliberately runs BEFORE its own reduce() every poll (see draw()'s
  // comment on why), so `runs` is still `[]` at this point and there is no
  // "first computed runs snapshot" to piggyback on implicitly (design.md
  // Decision 5). This snapshot is used ONLY for this reconciliation — it is
  // not cached or reused by the regular per-poll draw() loop, which
  // recomputes its own `runs` independently on the very next line after
  // this block.
  {
    const startupNow = Date.now();
    const startupRuns = reduce(store.readAll(root, eventsCache), sampleWindows(startupNow), startupNow);
    const queueRecord = queueCache.read(root);
    if (queueRecord && !queueCache.isStale(queueRecord, startupNow)) {
      // CON-37: reconciliation runs exactly ONCE here — its result is passed
      // into createRestoredQueue() below (rather than letting it recompute
      // its own pass over startupRuns) so `completedDuringDowntime` can
      // never diverge from what pending/inFlight were actually reconciled
      // against (design.md Decision 1).
      const reconciled = queue.reconcileRestored(queueRecord, startupRuns);
      const restored = queue.createRestoredQueue(queueRecord, startupRuns, reconciled);
      // createRestoredQueue() already returns null when reconciliation
      // leaves both pending and inFlight empty (task 2.4) — nothing further
      // to check here.
      if (restored) {
        S.queueState = restored;
        S.queueSessionId = queueRecord.sessionId;
      }
      // Independent of whether `restored` is null (design.md Decision 4) —
      // a queue file whose every pending ticket completed during the
      // downtime restores nothing at all, but the operator must still be
      // told what happened to those ids, not just silence.
      if (reconciled.completedDuringDowntime.length) {
        const ids = reconciled.completedDuringDowntime;
        S.restoreNotice = `${ids.length} ticket(s) completed while you were away and were not restored: ` +
          ids.join(', ');
      }
    }
  }

  // Enter the alternate screen buffer once, before the first frame is ever
  // drawn (design.md Decision 3) — this is also what stops the dashboard
  // from trampling the user's scrollback, not just the flicker fix.
  process.stdout.write(ALT_SCREEN_ENTER + CURSOR_HIDE);
  S.runs = draw();
  // The heartbeat rides the poll timer unconditionally (not gated on
  // `running`) — though during an attach spawnSync blocks the event loop
  // anyway, so a long attach stalls it regardless; ownership never depends
  // on it (see watch-lock.js).
  const timer = setInterval(() => {
    watchLock.heartbeat(root, process.pid, Date.now());
    // CON-78, design.md Decision 1: discovery NEVER runs on an unconditional
    // tick — only every 3rd one, and only while the sessions screen is on
    // top. Placed ahead of draw() so a refreshed sessionsData is what this
    // same tick's draw() renders, not one tick behind.
    tickCount++;
    if (running && sessionsAutoRefreshDue(S.mode, tickCount)) {
      sessionsController.refreshSessions(ctx);
    }
    if (running) S.runs = draw();
  }, POLL_MS);
  // A SIGWINCH (Node re-emits it as 'resize') triggers an immediate redraw
  // against the new dimensions rather than waiting up to POLL_MS for the
  // next scheduled tick (design.md Decision 5). draw() already reads
  // process.stdout.columns/.rows fresh on every call, so no separate
  // dimension tracking is needed beyond this listener. Gated on `running`
  // for the same reason the poll timer already is — a resize mid-attach
  // must not draw into the terminal tmux currently owns.
  process.stdout.on('resize', () => {
    // Invalidate the diff cache's CONTENT while preserving its LENGTH
    // (CON-27 design.md Decision 3). A cols change already guarantees every
    // padded row differs, but a rows-ONLY resize (dragging the bottom edge,
    // a tmux pane split) leaves unchanged screen content padding to
    // byte-identical strings — the diff would then skip repainting rows
    // whose backing terminal has, in fact, just changed shape. Mapping every
    // entry to a sentinel `padTo` output can never equal forces the full
    // repaint. Deliberately NOT `prevFrameLines = []`: unlike attach (where
    // \x1b[?1049h genuinely clears the screen, so there is no stale tail),
    // a resize clears nothing, and the shrink-cleanup loop is driven
    // entirely by prevFrameLines.length — discarding that length would
    // leave a rows-shrinking resize's stale trailing rows on screen.
    prevFrameLines = prevFrameLines.map(() => null);
    if (running) S.runs = draw();
  });

  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  await new Promise((resolve) => {
    // One way out, whether it was asked for or forced on us.
    let quitting = false;
    const quit = () => {
      // Piped stdin fires BOTH 'end' and 'close' (confirmed against a real
      // pipe — see the probe in files-modified.md), and both are wired to
      // this same function below. Without this guard a piped quit would run
      // this body twice, double-writing \x1b[?1049l — the alternate-buffer
      // exit is specified to happen exactly once per session (design.md
      // Decision 3).
      if (quitting) return;
      quitting = true;
      clearInterval(timer);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      // Exiting the alternate buffer already restores whatever the primary
      // buffer held before the dashboard started — that IS "restore the
      // terminal as it was" (the ticket's own phrasing). The old
      // \x1b[2J\x1b[H full clear that used to sit here must NOT coexist with
      // this: issuing it after would erase the user's just-restored
      // primary-buffer content immediately after restoring it (design.md
      // Decision 3).
      process.stdout.write(ALT_SCREEN_EXIT + CURSOR_SHOW);
      // An interactive `q` already went through fleet.js's request-quit/
      // quitConfirm warning before reaching here (see applyAction), so a
      // human choosing to quit anyway has already been told. Piped EOF
      // reaches this same function directly, with no chance to ask first —
      // that path must not silently discard the tail either, so it gets a
      // notice on stderr instead of no notice at all. One function, one
      // place this is decided, for both quit paths.
      if (S.queueState) {
        const remaining = S.queueState.pending.length + S.queueState.inFlight.size;
        if (remaining > 0) {
          console.error('concertino: quitting with ' + remaining +
            ' queued ticket(s) not yet started — they will not resume automatically.');
        }
      }
      // CON-68: hand the repo back — only if the lock is still ours (a
      // takeover after this pid was declared dead must not be deleted out
      // from under the new owner).
      watchLock.release(root, process.pid);
      resolve();
    };

    // `concertino watch < /dev/null` hits EOF before any 'data' ever fires, so
    // a quit path that only lives in the keypress handler never runs and the
    // poll loop spins forever. Same failure as the piped-newline hang, reached
    // from the other side: there, the chunk arrived and did not match; here, no
    // chunk arrives at all. A closed stdin can send no further keys, so there
    // is nothing left to wait for.
    stdin.on('end', quit);
    stdin.on('close', quit);

    // Hand the terminal to tmux, then take it back on detach — a process
    // action, independent of whichever screen is on top, so both fleet and
    // escalation route their `attach` action through this same function.
    function doAttach(ticket) {
      // tmux manages the primary/alternate screen itself for the pane it
      // takes over — it does not expect to inherit an already-alternate-
      // buffer terminal from its parent, so this must exit BEFORE
      // session.attach() hands the terminal off (design.md Decision 4).
      process.stdout.write(ALT_SCREEN_EXIT + CURSOR_SHOW);
      running = false;
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      // If attach throws we must still hand the terminal back. Without this
      // the terminal is left in raw mode and `running` stays false, so the
      // dashboard is wedged and only a kill recovers it. Re-entering the
      // alternate buffer happens in the same restore pass as the raw-mode
      // restore, for exactly the same reason (design.md Decision 4) — on
      // both the normal return path and the exception path. The try/finally
      // shape itself is factored into frame.attachAndRestore() so it is
      // unit-testable against a fake, throwing attach without a real
      // session/stdin — see test/watch.test.js.
      attachAndRestore(() => session.attach(ticket), () => {
        process.stdout.write(ALT_SCREEN_ENTER + CURSOR_HIDE);
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();
        running = true;
        // The diff cache describes a screen that no longer exists: tmux has
        // fully owned the terminal, and the ALT_SCREEN_ENTER just above
        // CLEARS the alternate buffer on the way back in. Reset here — in
        // the same restore callback, so both the normal-return and throwing
        // paths get it for free (CON-27 design.md Decision 7). `[]`, not
        // resize's length-preserving sentinel, is right specifically
        // because the buffer is genuinely cleared: there is no stale tail
        // left for the shrink loop to blank, and an empty cache already
        // makes every row of the next frame diff as "changed".
        prevFrameLines = [];
      });
    }

    // CON-78: the freelance-attach twin of doAttach() above — same
    // suspend/restore dance, addressed by an arbitrary `session:window_id`
    // pair (attachSessionTarget, see session.js's own header comment) rather
    // than this project's own ticket-addressed windows. Kept as its own
    // function (not a doAttach(ticket) parameterisation) because doAttach's
    // callers pass a TICKET, which session.attach() resolves through this
    // project's own tmux session by convention — a freelance session may be
    // in a different tmux session entirely.
    function doAttachTarget(sessionName, windowId) {
      process.stdout.write(ALT_SCREEN_EXIT + CURSOR_SHOW);
      running = false;
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      attachAndRestore(() => attachSessionTarget(sessionName, windowId), () => {
        process.stdout.write(ALT_SCREEN_ENTER + CURSOR_HIDE);
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();
        running = true;
        prevFrameLines = [];
      });
    }

    ctx.doAttach = doAttach;
    ctx.quit = quit;

    // Interprets an action returned by a screen's (pure) handleKey. Screens
    // never mutate state themselves — the controller layer is the one place
    // state changes, which is what keeps every screen testable as
    // (state, opts) -> string. The cases kept inline here are the ones that
    // reach into this closure's own terminal/loop internals: 'back' is pure
    // navigation shared by several screens, and 'attach'/'attach-session'
    // hand the terminal itself away.
    function applyAction(action) {
      if (!action) return false;
      if (action.type === 'back') {
        backToFleet();
        return true;
      }
      if (action.type === 'attach') {
        doAttach(action.ticket);
        return true;
      }
      // CON-78: the sessions view's freelance attach — only ever dispatched
      // for a tmux-backed row (sessions.js's own handleKey never emits this
      // for a non-tmux one), design.md Decision 7's freelance bullets.
      if (action.type === 'attach-session') {
        doAttachTarget(action.session, action.windowId);
        return true;
      }
      return controllers.applyAction(action, ctx);
    }

    function onKey(key) {
      // The banner's reply box (CON-25), when open, owns every keystroke —
      // the same "reply box owns every keystroke while open" precedence
      // escalation.js already gives its own reply box locally, just applied
      // one level higher, BEFORE router.handleKey is ever called at all
      // (design.md Decision 6 / tasks.md task 6.5).
      if (S.globalEscalationReply) {
        const action = bannerScreen.handleKey(key, {
          reply: S.globalEscalationReply, ticket: S.globalEscalationTicket,
        });
        if (applyAction(action)) S.runs = draw();
        return;
      }
      // The reserved key opens the banner's reply box for the oldest live
      // escalation — but only when no screen-local reply/prompt already owns
      // the keyboard, so 'g' typed into the `n` prompt, a reply already open
      // on the dedicated escalation screen, or a drilldown kill/restart
      // confirmation still does what it always did.
      if (key === bannerScreen.RESERVED_KEY && S.liveEscalations.length &&
          !S.prompt && !S.escalationReply && !S.drillConfirm) {
        if (applyAction({ type: 'banner-open-reply', ticket: S.liveEscalations[0].ticket })) S.runs = draw();
        return;
      }

      const action = router.handleKey(key, currentState());
      if (action && action.type === 'quit') { quit(); return; }
      if (applyAction(action)) S.runs = draw();
    }

    stdin.on('data', (raw) => {
      // One chunk is not one key. In raw mode it usually is, but a paste — and
      // any piped stdin, where a whole script arrives in a single read —
      // delivers several at once, and an exact compare against the chunk then
      // matches nothing. Piped stdin also appends a trailing newline (`echo q`
      // sends "q\n"), which used to leave the loop polling forever; strip it
      // when we are not a TTY, then dispatch key by key.
      const chunk = stdin.isTTY ? raw : raw.replace(/[\r\n]+$/, '');
      for (const key of splitKeys(chunk)) {
        // quit() has torn the screen down, but the rest of this chunk is
        // already in hand. Delivering it would type into a dead dashboard.
        if (quitting) return;
        onKey(key);
      }
    });
  });
}

// buildFrame, attachAndRestore, computeLiveEscalations, idleMsFromActivity,
// canonicalHarness, resolveModelsForPlan, and openInBrowser are exported
// alongside watch() purely for test/watch.test.js (CON-17, CON-25, CON-5,
// CON-22, CON-55) — the pure logic lives in lib/ui/frame.js and
// lib/ui/launcher.js now, re-exported here unchanged so every pre-existing
// import keeps resolving; watch()'s own runtime behavior is still covered
// end to end by test/scripts/watch-smoke.test.sh.
module.exports = {
  watch, buildFrame, attachAndRestore, computeLiveEscalations, idleMsFromActivity,
  canonicalHarness, resolveModelsForPlan, openInBrowser, sessionsAutoRefreshDue,
  CURSOR_HOME, ALT_SCREEN_ENTER, ALT_SCREEN_EXIT, CURSOR_HIDE, CURSOR_SHOW,
};
