'use strict';

// Section shape for the fleet screen: status bucketing (bucketRuns), the
// canonical section list (buildSections), and the header/footer lines
// printed around the sections (buildHeadTail).

const f = require('../../format');
const icons = require('../../icons');
const { metricsColumnLines } = require('./metrics');
const { confirmLines } = require('../../widgets/confirm');
const { inputLines } = require('../../widgets/textinput');
const { sectionHeader } = require('../../widgets/header');
const { emptyState } = require('../../widgets/empty');

// Every content row a section box draws costs 2 columns to the border
// characters (one on each side) and 2 more to `box()`'s default horizontal
// padding — see design.md Decision 1/3. Sized once here so both the box
// call and the content-generation width agree with each other exactly.
const BOX_BORDER_PADDING_COLS = 4;

// `.concertino/runs/` is never pruned — cleanup.sh deliberately keeps the log so
// a run's history outlives its worktree. So the finished groups are unbounded
// history, and rendering all of it scrolls the header and NEEDS YOU off the TOP
// of the terminal. Cap them here rather than in the store: the store returning
// full history is correct, and the drill-down will want it.
const MAX_FINISHED = 5;

// CON-40: the QUICK START widget lists the top N open tickets by priority,
// flattened across every epic — a fixed constant, not a config knob (the
// ticket's own "next 3-5 tickets" language is a range, not a tunable; see
// design.md Decision 6), matching MAX_FINISHED's own precedent just above.
const QUICK_START_COUNT = 5;

// CON-29: the key that confirms a paused queue (queueState.confirmed ===
// false) — originally only a queue restored from a previous session, later
// joined by a fresh batch the operator deliberately held via the launch
// plan's own "start now: no" toggle (launchplan.js's `startNow` / queue.js's
// createQueue `confirmed` param); watch.js's 'confirm-restored-queue' action
// and this key are unchanged either way — only buildHeadTail's wording below
// tells the two apart. Chosen from fleet mode's current key map with no
// collision: n/N (prompt/launch pad), q/Ctrl-C (quit), j/k and their arrow
// aliases (move), Enter and l/right-arrow (attach/drilldown) are all already
// claimed — see handleKey below. CON-39 later claims digit keys 1-9 (section
// jump) and, while focus is on QUEUED, `f` (force-start) and bare Escape
// (exit queue focus) — none of these collide with `c` either.
const CONFIRM_RESTORED_QUEUE_KEY = 'c';

// Capital, deliberately distinct from the lowercase CONFIRM_RESTORED_QUEUE_KEY
// just above (same "n vs N" idiom as the launch pad's own single/batch keys)
// — drops every ticket still in queueState.pending (never anything already
// inFlight; see queue.js's clearPending()). Bound identically on the launch
// pad (launchpad.js's own CLEAR_QUEUE_KEY, same value — the two are kept as
// separate constants rather than one shared import so each screen's key map
// stays self-contained, matching how CONFIRM_RESTORED_QUEUE_KEY itself is
// only ever read here).
const CLEAR_QUEUE_KEY = 'C';

// Splits `runs` into the four status buckets every section is built from.
// Shared by renderFleet and visibleWindow so both see the exact same
// partition of the same `runs` array (design.md Decision 2).
function bucketRuns(runs) {
  return {
    needsYou: runs.filter((r) => r.status === 'needs-you'),
    active:   runs.filter((r) => r.status === 'running' || r.status === 'unknown'),
    failed:   runs.filter((r) => r.status === 'failed'),
    done:     runs.filter((r) => r.status === 'done'),
  };
}

// Builds the section list in render/index order: NEEDS YOU, FAILED, RUNNING,
// QUICK START (always included, CON-56), [QUEUED if non-empty], DONE. Section order is
// the reducer's own sort order, so the Nth rendered (selectable) row is
// runs[N] — which is the index watch.js attaches to. FAILED right after
// NEEDS YOU groups the two "something needs your attention" categories
// together, ahead of RUNNING/history (fleet-metrics-grid design — see the
// comment on the `sections` array below for why this also matters for
// grid-mode rendering).
// `statusKey` reads the section's colour from the shared STATUS_COLOUR table
// (design.md Decision 4) instead of each section picking its own
// f.yellow/f.dim/f.red ad hoc. `kind` (CON-40, design.md Decision 3) is a
// SEPARATE, stable discriminator every section carries — unlike `statusKey`
// (a colour lookup key) or `title` (QUEUED's is a dynamic string carrying a
// live pending count, never safe to match on), `kind` never changes shape
// and is what both the digit-jump branch (handleKey, below) and the
// per-row render dispatch (renderFleet, below) key off to tell an
// `unselectable` QUICK START section apart from an `unselectable` QUEUED one
// now that both can be on screen at once.
//
// Every entry sets `linesPerRow` explicitly (design.md Decision 2) so no
// section's height cost depends on an unstated default: 2 for a run row
// (ticket line + bar/status line), 1 for QUEUED's/QUICK START's single-line
// rows. Neither QUEUED nor QUICK START has a run object behind any of its
// rows — see renderQueuedRow's/renderQuickStartRow's own header comments —
// so neither may ever consume a slot in the row-index space `watch.js`'s
// `runs[selected]` relies on. `unselectable: true` is the one flag that
// both keeps a section out of that index space and routes its rows to
// renderQueuedRow/renderQuickStartRow instead of renderRun (design.md
// Decisions 1 and 5).
//
// The QUICK START entry is always built — CON-56: no longer gated behind a
// visibility flag, mirroring METRICS' own unconditional inclusion just below
// (the `o.metrics` truthy-check). It is included REGARDLESS of how many
// tickets `opts.quickStartTickets` actually holds (`forceRender`/
// `emptyHint`, read by visibleWindow's sectionHeight and renderFleet's own
// per-section loop below), the one deliberate divergence from every other
// section's "only non-empty groups render" convention. `opts.quickStartCold`
// picks WHICH hint text applies when the list is empty — cold cache (never
// fetched) vs. populated-but-fully-filtered — a distinction this function
// has no other way to make on its own (it has no access to the cache
// module), so the caller (watch.js's draw()) computes it once via
// `cache.isCold(cache.read(root))` and threads it through here exactly like
// `quickStartTickets` itself. Neither `visibleWindow`'s nor
// `sectionJumpTargets`'s own calls below need `quickStartCold` — only
// renderFleet's call ever reads `s.emptyHint`'s text.
//
// Shared by renderFleet and visibleWindow — a single source of truth for the
// section shape (design.md Decision 3's own risk mitigation, applied here
// as well as to the window arithmetic itself).
function buildSections(buckets, queueState, opts) {
  const o = opts || {};
  // fleet-metrics-grid design: FAILED sits right after NEEDS YOU — both are
  // "something needs your attention" categories, grouped together so the
  // grid-mode renderer (a later task) can lay them out as adjacent
  // full-width banners without any index-space translation between this
  // canonical order and where things actually render on screen. This is
  // also why FAILED moved here: it used to sit between QUEUED and DONE.
  const sections = [
    { title: 'NEEDS YOU', group: buckets.needsYou, statusKey: 'needs-you', cap: Infinity, pinned: true, linesPerRow: 2, kind: 'needs-you' },
    { title: 'FAILED', group: buckets.failed, statusKey: 'failed', cap: MAX_FINISHED, linesPerRow: 1, kind: 'failed' },
    { title: 'RUNNING',   group: buckets.active,   statusKey: 'running',   cap: Infinity, linesPerRow: 2, kind: 'running' },
  ];
  // CON-40: positioned after RUNNING, before the (already-conditional)
  // QUEUED entry (design.md Decision 2) — "what's wrong" -> "what's
  // happening" -> "what you could start" -> "what's about to start" ->
  // history.
  {
    const quickStartTickets = o.quickStartTickets || [];
    const forceRender = quickStartTickets.length === 0;
    sections.push({
      title: sectionHeader({ icon: icons.quickStart, label: 'QUICK START' }),
      group: quickStartTickets,
      statusKey: 'quickstart',
      cap: QUICK_START_COUNT,
      unselectable: true,
      linesPerRow: 1,
      kind: 'quickstart',
      forceRender,
      emptyHint: forceRender
        ? (o.quickStartCold ? 'no tickets cached yet — press N to fetch' : 'nothing left to quick-start')
        : undefined,
    });
  }
  // Positioned after RUNNING (and QUICK START, if shown): pending, not
  // finished, but not yet actionable either (nothing to attach to).
  if (queueState && queueState.pending && queueState.pending.length) {
    sections.push({
      title: `${sectionHeader({ icon: icons.queue, label: 'QUEUED' })} (${queueState.pending.length}, running ${queueState.maxConcurrent} at a time)`,
      group: queueState.pending,
      statusKey: 'queued',
      cap: MAX_FINISHED,
      unselectable: true,
      linesPerRow: 1,
      kind: 'queued',
    });
  }
  sections.push(
    { title: 'DONE',   group: buckets.done,   statusKey: 'done',   cap: MAX_FINISHED, linesPerRow: 1, kind: 'done' },
  );
  // Lazygit-layout pass: a fleet-wide roll-up, positioned last (after
  // history) — reuses the exact same forceRender mechanism QUICK START
  // established above (always shown, no selectable rows) rather than
  // inventing a second "always render an empty section" path. Unlike QUICK
  // START's single `emptyHint` line, METRICS is a fixed 5-line summary
  // (avg/delivered/escalations, success rate, throughput, verdicts, gates)
  // via `emptyLines` below — see sectionHeight's own comment on the
  // `emptyHint`-vs-`emptyLines` generalization. `o.metrics` is null/undefined
  // only in the two call sites
  // (sectionJumpTargets, indirectly) that only need to know whether the
  // section is INCLUDED, not what it says — see that function's own comment.
  if (o.metrics) {
    const boxCols = Math.max(40, o.cols || 80);
    const innerCols = Math.max(0, boxCols - BOX_BORDER_PADDING_COLS);
    sections.push({
      title: sectionHeader({ icon: icons.metrics, label: 'METRICS' }),
      group: [],
      statusKey: 'metrics',
      cap: 1,
      unselectable: true,
      linesPerRow: 1,
      kind: 'metrics',
      forceRender: true,
      emptyLines: metricsColumnLines(o.metrics, { cols: innerCols }),
    });
  }
  return sections;
}

// The lines printed before the first section (head) and after the last one
// (tail) — everything renderFleet prints that is NOT one of the sections
// above. Line COUNT here (not the truncated text) is what visibleWindow's
// height budget needs to reason about, so it calls this same function
// rather than re-deriving the count some other way — one implementation,
// used both to print the real header/footer and to size the budget around
// it (design.md Decision 3's shared-implementation mitigation, applied here
// too).
function buildHeadTail(runs, opts) {
  const cols = Math.max(40, (opts && opts.cols) || 80);
  const prompt = (opts && opts.prompt) || null;
  const queueNotice = (opts && opts.queueNotice) || null;
  const restoreNotice = (opts && opts.restoreNotice) || null;
  const queueState = (opts && opts.queueState) || null;
  const quitConfirm = (opts && opts.quitConfirm) || false;
  // CON-39: force-start's own confirmation gate — `{ ticket } | null`. Kept
  // as a distinct field from `quitConfirm` (rather than reusing it) since
  // the two are independent, narrower/broader gates that must never both
  // claim the same keypress — see handleKey's own ordering comment.
  const forceStartConfirm = (opts && opts.forceStartConfirm) || null;
  // Clear Queue's own confirmation gate — a plain boolean (unlike
  // forceStartConfirm's `{ ticket }`, there is nothing to name but "the
  // queue"). Checked ahead of forceStartConfirm/quitConfirm below, mirroring
  // handleKey's own ordering: the newest-opened gate intercepts first.
  const clearQueueConfirm = (opts && opts.clearQueueConfirm) || false;
  const project = (runs[0] && runs[0].project) || '';

  const needsYou = runs.filter((r) => r.status === 'needs-you');
  const countLabel = `${runs.length} run${runs.length === 1 ? '' : 's'}` +
    (needsYou.length ? ` · ${needsYou.length} needs you` : '');
  const head = [
    f.bold('concertino') + f.dim(' · ' + project) + '  ' + f.dim(countLabel),
    '',
  ];
  if (!runs.length) for (const line of emptyState({ message: '  no active runs' })) head.push(line);

  const tail = [];
  const malformed = runs.reduce((n, r) => n + (r.malformed || 0), 0);
  if (malformed) tail.push('  ' + f.yellow(`▲ ${malformed} malformed events`));
  // An active batch is otherwise invisible once you leave the launch pad: the
  // queue itself is in-memory only (see watch.js's own comment on why that is
  // an accepted trade-off) but its PRESENCE must never be — launching a
  // five-ticket sequential batch and returning to the fleet must still show
  // that four more are queued, persistently, for as long as the queue is
  // active (not just on a failure — that is queueNotice, right below).
  if (queueState) {
    const inFlightCount = queueState.inFlight ? queueState.inFlight.size : 0;
    const pendingCount = queueState.pending ? queueState.pending.length : 0;
    if (inFlightCount || pendingCount) {
      tail.push('  ' + f.dim(`▲ queue: ${inFlightCount} running · ${pendingCount} queued`));
    }
    // CON-29: a queue restored from a previous session (queueState.confirmed
    // === false) must never look like an ordinary in-session queue — it is
    // NOT ticking (see watch.js's shouldTick() guard at the queue.tick()
    // call site) and nothing in it launches until the operator explicitly
    // confirms, so this line is the one place that says so. Distinct from
    // the plain "▲ queue: ..." summary line just above, which renders
    // identically for a restored or same-session queue alike — this is the
    // affordance, not a status count. Covers the pending-empty/inFlight-only
    // edge case too (an already-in-flight ticket with nothing left pending —
    // design.md Decision 5a): the section below only ever lists PENDING
    // rows, so without this line an inFlight-only restore would have no
    // visible confirm affordance at all.
    //
    // `confirmed: false` has a second cause now (the launch plan's own
    // "start now: no" toggle — see launchplan.js/queue.js's createQueue) that
    // is NOT a restore — wording that would otherwise claim a session crashed
    // when the operator deliberately held a fresh batch. `restoredFrom` is
    // only ever set by createRestoredQueue() (CON-29's own startup path), so
    // its presence/absence is exactly the distinguishing fact; the confirm
    // key and mechanism (fleet.js's CONFIRM_RESTORED_QUEUE_KEY, watch.js's
    // 'confirm-restored-queue') are identical either way — only the wording
    // differs.
    if (queueState.confirmed === false && (inFlightCount || pendingCount)) {
      const msg = queueState.restoredFrom
        ? `▲ resumed from a previous session — press ${CONFIRM_RESTORED_QUEUE_KEY} to continue`
        : `▲ held — press ${CONFIRM_RESTORED_QUEUE_KEY} to start`;
      tail.push('  ' + f.yellow(msg));
    }
  }
  // CON-37: ticket ids the startup restore reconciliation dropped because
  // their run completed DURING the downtime (see queue.js's
  // reconcileRestored/completedDuringDowntime) — an independent fact from
  // the "resumed from a previous session" affordance just above, so this is
  // gated ONLY on the notice itself, never on `queueState` being present or
  // on `queueState.confirmed` (design.md Decision 4): a queue file whose
  // every pending ticket finished overnight restores nothing at all
  // (queueState stays null), and this is the only place that says so.
  // Truncated the same way queueNotice is, just below — the id list is
  // unbounded in principle.
  if (restoreNotice) {
    tail.push('  ' + f.yellow(f.truncate(`▲ ${restoreNotice}`, cols - 4)));
  }
  // A queued batch launch that failed to spawn (see queue.js — a slot frees
  // itself naturally next tick since there is no run to track) is otherwise
  // invisible: nothing else on the fleet view watches the launch-pad queue.
  if (queueNotice) tail.push('  ' + f.red(f.truncate(queueNotice, cols - 4)));
  // Advertise only what this slice actually binds. `k` is selection-up here, so
  // labelling it "kill" would be worse than omitting it — kill and restart
  // arrive with the control plane in slice 2. `n` is listed only in fleet mode:
  // while the prompt is open it does nothing but type an "n".
  if (clearQueueConfirm) {
    // Names the exact count that would be dropped, same "no vague are-you-
    // sure" discipline as forceStartConfirm just below — checked BEFORE it
    // (and quitConfirm), matching handleKey's own ordering: the newest-
    // opened gate never lets an older one's key steal the keypress.
    const pendingCount = queueState && queueState.pending ? queueState.pending.length : 0;
    for (const line of confirmLines({
      warning: f.yellow(`▲ this will drop ${pendingCount} queued ticket${pendingCount === 1 ? '' : 's'} — they will never start. proceed?`),
      confirmHint: 'y confirm clear   (any other key) cancel',
    })) tail.push(line);
  } else if (forceStartConfirm) {
    // CON-39, design.md Decision 3: the load-bearing warning — force-start
    // is a deliberate break of the maxConcurrent contract the operator
    // configured, so this names the exact resulting count rather than a
    // vague "are you sure?". Checked BEFORE quitConfirm below (matching
    // handleKey's own ordering — the two gates never both claim a keypress).
    const maxConcurrent = queueState ? queueState.maxConcurrent : 1;
    const inFlightCount = queueState && queueState.inFlight ? queueState.inFlight.size : 0;
    const resultingCount = inFlightCount + 1;
    for (const line of confirmLines({
      warning: f.yellow(`▲ this will run ${resultingCount} concurrently, exceeding your maxConcurrent:${maxConcurrent} setting — proceed?`),
      confirmHint: 'y confirm force-start   (any other key) cancel',
    })) tail.push(line);
  } else if (quitConfirm) {
    // A deliberate quit with tickets still queued would otherwise silently
    // discard the un-started tail — same "ask before destroying" property as
    // kill/restart on the drill-down (see drilldown.js's own 'y' gate). Any
    // key other than a repeated q/Ctrl-C cancels rather than acting on
    // whatever it would otherwise have meant, so the warning never lingers
    // looking like a live, ordinary screen.
    const inFlightCount = queueState && queueState.inFlight ? queueState.inFlight.size : 0;
    const pendingCount = queueState && queueState.pending ? queueState.pending.length : 0;
    const remaining = inFlightCount + pendingCount;
    for (const line of confirmLines({
      warning: f.yellow(`▲ quit with ${remaining} ticket${remaining === 1 ? '' : 's'} still queued/running?`),
      confirmHint: 'q confirm quit   (any other key) cancel',
    })) tail.push(line);
  } else if (prompt) {
    for (const line of inputLines({ label: 'new run', value: prompt.value, cols, error: prompt.error })) tail.push(line);
    // CON-21: a non-ticket-shaped submit kicks off the headless drafting
    // invocation (design.md's own "drafting…" mitigation for the risk that
    // the LLM round trip can take several seconds) — shown here rather than
    // opening a new screen, since there is no draft to show yet.
    if (prompt.drafting) {
      tail.push(f.dim('  drafting…   esc cancel'));
    } else {
      tail.push(f.dim('  ↵ start   esc cancel'));
    }
  } else {
    // Kill/restart are NOT bound here even though the final design's footer
    // shows them on the fleet: `k` already means "move selection up" (see the
    // comment on the malformed-events line above), so binding it to kill on
    // this screen would be the exact defect this project treats as a wall —
    // a footer hint whose key does something else. They live on the
    // drill-down instead, where `k`/`r` are unclaimed. `l` opens it.
    // CON-39: `1-9 jump` is always advertised (digit-jump binds regardless of
    // which sections are populated — an out-of-range digit is just a no-op).
    // `f force-start` is advertised ONLY when a QUEUED section is actually on
    // screen this frame (same "only advertise a key that currently does
    // something" discipline this comment already names) — outside QUEUED
    // focus `f` is unbound, so hinting it unconditionally would itself be
    // the defect this file's own discipline exists to avoid.
    // `t ticket` and `s settings` are bound below (handleKey) and were
    // previously never advertised — the exact hint/key mismatch this
    // comment block calls a wall, in the other direction. f.hintLines wraps
    // onto additional footer rows instead of truncating: buildHeadTail's
    // callers budget on tail.length (see visibleWindow), so extra rows are
    // accounted for automatically, whereas the old single joined line was
    // clamped to cols downstream and silently lost its tail — on an 80-col
    // terminal everything from `n new run` onward vanished whenever the
    // queue hints were present.
    const hints = ['↵ attach', 'l details', 't ticket', 'j/k move', '1-9 jump'];
    if (queueState && queueState.pending && queueState.pending.length) {
      hints.push('f force-start', CLEAR_QUEUE_KEY + ' clear queue');
    }
    hints.push('n new run', 'N launch pad', 's settings', 'q quit');
    for (const line of f.hintLines(hints, cols)) tail.push(line);
  }

  return { head, tail };
}

module.exports = {
  BOX_BORDER_PADDING_COLS, QUICK_START_COUNT,
  CONFIRM_RESTORED_QUEUE_KEY, CLEAR_QUEUE_KEY,
  bucketRuns, buildSections, buildHeadTail,
};
