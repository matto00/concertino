'use strict';

// The poll loop. Everything stateful lives here so the reducer and the screens
// stay pure: keyboard handling needs raw mode, and which screen is on top is
// itself state — the router only dispatches on it, never remembers it. Idle
// tracking (see idleMsFromActivity below) needs no memory across polls at
// all — it is a pure function of tmux's own per-window activity timestamp,
// recomputed fresh every poll (CON-5).

const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const escalationScreen = require('./screens/escalation');
const { reduce } = require('./reducer');
const { createSession, hasTmux } = require('./session');
const router = require('./router');
const { submitTicket } = require('./prompt');
const control = require('./control');
const linear = require('./linear');
// CON-21: the headless ticket-drafting helper (design.md Decision 2) — kept
// as the whole module object (never destructured) so tests can monkeypatch
// `draftHelper.draftTicket` the same way `linear`'s functions are faked
// elsewhere in this file, without watch.js needing its own injectable seam.
const draftHelper = require('./draft');
const cache = require('./cache');
const ticketText = require('./ticket-text');
const retention = require('./retention');
const reap = require('./reap');
const queue = require('./queue');
const queueCache = require('./queue-cache');
const format = require('./format');
const markdown = require('./markdown');
const textwrap = require('./textwrap');
const ticketDetail = require('./ticketDetail');
const icons = require('./icons');
const launchpadScreen = require('./screens/launchpad');
const launchplanScreen = require('./screens/launchplan');
const bannerScreen = require('./banner');
const topbar = require('./topbar');
// The top bar's own screen-name label — deliberately distinct from
// router.js's SCREENS keys (those are internal mode strings; these are the
// human-facing names topbar.js prints, matching each screen's own on-
// screen title where one exists, e.g. drilldown's own header rows vs. this
// short label).
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
};
// Only visibleWindow is needed directly here — everything else reaches
// fleet.js through the router's render(state, opts) seam, same as before
// (design.md Decision 3).
const fleetScreen = require('./screens/fleet');
// CON-19: evidenceItems (to clamp drillEvidenceIndex/resolve the selected
// entry) and docview/ticketview's own computeViewportRows (to precompute the
// SAME viewport budget their own render() calls use, ahead of the next
// keypress — router.handleKey's seam carries no `opts`; see docview.js's and
// ticketview.js's own comments on why this cannot be recomputed live).
const drilldownScreen = require('./screens/drilldown');
const docviewScreen = require('./screens/docview');
const ticketviewScreen = require('./screens/ticketview');
// CON-57: the settings screen's own field-building helpers (buildFieldMeta/
// fieldsForSection) and lib/config.js's schema/validation logic
// (loadSchema/schemaSectionOrder/collectConfigIssues/deepSet/coerce/
// getAtPath) — see openSettings()/backToFleet() and the 'settings-*'
// applyAction cases, below.
const settingsScreen = require('./screens/settings');
const configLib = require('../config');

// Every box costs 2 columns to its border characters and 2 more to
// box()'s default horizontal padding — see fleet.js/drilldown.js/
// ticketview.js's identical constant. Used here only to size the evidence
// reader's own word-wrap width from the terminal's column count (task 4.3).
const DOC_BOX_BORDER_PADDING_COLS = 4;

const POLL_MS = 1000;

// Idle time as a pure, stateless function of tmux's own per-window
// `#{window_activity}` timestamp (epoch seconds, as returned by
// session.listWindows()) and the current poll's `now` (epoch ms). No
// per-ticket memory is needed: `window_activity` is tracked by the tmux
// server itself from pty writes, so it advances on every poll where the
// window's process has written anything — including a redraw that happens
// to reproduce byte-identical pane content (verified directly against a
// real detached tmux session; see design.md) — which is exactly the case
// the previous pane-content-hash approach misreported as idle. Falls back
// to `0` (matching the old seed path's behavior) when tmux has no activity
// timestamp yet for this window.
//
// Exported purely for tests (mirrors the buildFrame/attachAndRestore
// precedent below) — sampleWindows() itself stays a private closure.
function idleMsFromActivity(activity, now) {
  return activity != null ? Math.max(0, now - activity * 1000) : 0;
}

// CON-22: reverse-maps the CLI-binary label ('claude', used to build the
// actual shell launch command — see `open-launchplan`'s own
// `configuredHarnesses` mapping below) back to the CANONICAL harness id
// ('claude-code') that resolve-speed.sh's own `$2` and the
// `models.<harness>`/`modelTiers.<harness>` config keys use. Every call site
// below that passes a harness to resolve-speed.sh MUST apply this first —
// passing the CLI label straight through resolves "models unknown" for every
// Claude Code launch-plan preview (design.md Decision 3's round-3 finding).
// `codex`'s label is already canonical (no CLI-vs-canonical split there), so
// this is a no-op for it.
function canonicalHarness(h) {
  return h === 'claude' ? 'claude-code' : h;
}

// Resolves the (speed, harness) -> budgets/models/flags preview via
// resolve-speed.sh, synchronously, following the exact one-time,
// plan-creation-time child-process precedent `commitSha` already sets in
// `open-launchplan` below (same `stdio: ['ignore','pipe','ignore']`
// discipline — never leak the child's stderr onto a screen that is
// otherwise pure). Returns the parsed JSON, or `null` on ANY error (missing
// script, bad harness/tier, a project predating this feature) — never
// thrown up to the human as a crash; `launchplan.js` renders `null` as
// "models unknown". `harness` here must already be canonical (call
// `canonicalHarness()` first) — this function does not do that translation
// itself, so it stays a thin, testable wrapper around the one child-process
// call, mirroring `commitSha`'s own shape.
function resolveModelsForPlan(rootDir, speed, harness) {
  try {
    const script = path.join(rootDir, 'scripts', 'concertino', 'resolve-speed.sh');
    const out = execFileSync(script, [speed || 'default', harness],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out);
  } catch (e) { return null; }
}

// CON-55 (design.md Decision 4): opens `url` in the OS default browser via
// `xdg-open` — Linux, this tool's only supported platform (see design.md's
// Non-Goals). Synchronous, matching every other `execFileSync` call in this
// file (commitSha above, resolveModelsForPlan above) — the sub-second
// duration `xdg-open` itself takes to hand off to the desktop's URL handler
// and return is not observably different from those. Deliberately does NOT
// catch — a missing binary, a non-zero exit, or any other throw propagates
// to the caller (`open-external-url`'s handler, below), which is what turns
// it into a visible `drillNotice` rather than a caught-and-silently-ignored
// failure. `stdio: 'ignore'` so a talkative browser/opener never bleeds
// output onto this dashboard's own screen.
function openInBrowser(url) {
  execFileSync('xdg-open', [url], { stdio: 'ignore' });
}

// Terminal-control byte sequences this module writes. Named and centralised
// here (rather than inlined at each call site) so the "textually paired"
// guarantee CON-17's design doc relies on — exactly one \x1b[?1049h at
// startup, one \x1b[?1049l in quit(), and one suspend/restore pair around
// attach — is something a test can grep for by name, and so `\x1b[2J` (the
// old full-screen clear this whole change removes) never reappears anywhere
// in this file under a different spelling.
const CURSOR_HOME = '\x1b[H';
const ALT_SCREEN_ENTER = '\x1b[?1049h';
const ALT_SCREEN_EXIT = '\x1b[?1049l';
// The differential writer parks the real terminal cursor at the end of the
// last row after every frame (Decision 8, below) so redraw-diffing has a
// fixed resting position — but a visible cursor sitting there reads as a
// stray blinking block at the bottom-right of the screen. Hidden/shown in
// lockstep with the alternate-buffer pair above: hide on every ALT_SCREEN_
// ENTER (dashboard owns the terminal), show on every ALT_SCREEN_EXIT
// (something else — the shell, tmux — is about to own it and must get a
// normal cursor back).
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
// CON-27: absolute placement of the cursor at the start of a given 1-based
// terminal row — the differential writer's per-row prefix. Named here for
// the same reason as the constants above: buildFrame emits it from three
// places (the shrink-blanking loop, the diff loop, and the cursor-park
// write), and those three are meant to be, and must stay, byte-identical.
const rowAt = (row) => '\x1b[' + row + ';1H';

// Differential (line-diff) rendering — never a full-screen clear (CON-27,
// design.md Decisions 2, 6 and 8; CON-17's own Decision 1 established the
// no-clear guarantee this builds on). There are two writer modes:
//
//   1. The DIFF path (every frame that fits the terminal). Each new padded
//      line is compared by strict string equality against `prevLines[i]` —
//      the same row's already-padded content from the previous frame. Only
//      the rows that differ are written, each preceded by its own absolute
//      cursor placement (`\x1b[<row>;1H`), so an unchanged row costs zero
//      bytes and a fully unchanged tick produces `bytes === ''` (Decision
//      5 — draw()'s call site then skips the stdout write entirely). Rows
//      the new, shorter frame no longer has are blanked, exactly as before.
//      Whenever this path writes anything at all, it finishes by rewriting
//      the frame's LAST row (Decision 8): that parks the cursor at the same
//      fixed resting position a full-frame rewrite already left it at, so it
//      does not visibly hop to whichever row happened to change this tick,
//      AND it repairs the one case where the shrink loop's blanking can
//      clamp onto the last real row (a resize sentinel can leave
//      `prevLines.length` above the current `rows` — see Decision 8).
//
//   2. The FULL-REWRITE fallback (`CURSOR_HOME` + newline flow), used only
//      when the frame is taller than the terminal (`rows > 0 && lines.length
//      > rows`). Absolute row addressing cannot reproduce a scroll — a
//      `\x1b[<row>;1H` beyond the terminal's height clamps onto the last row
//      — so an over-tall frame keeps relying on the terminal's own
//      newline-driven auto-scroll, exactly as it did before this change.
//      That is what preserves screens/fleet.js's deliberate "NEEDS YOU stays
//      visible, the header scrolls off" trade-off (Decision 6). When `rows`
//      is 0/falsy (no TTY — a redirected stdout, as the smoke gate and the
//      unit tests run under) this fallback never triggers.
//
// `buildFrame` strips exactly one trailing '\n' before splitting into lines
// (CON-26), so `draw()`'s appended newline never contributes an extra row —
// the lines this function pads from and the lines it returns stay in
// one-to-one correspondence with actual rendered content. Under the diff
// path that strip matters more than it did under the full rewrite: a
// phantom trailing blank row would not only be written, it would also be
// where the cursor-park write below leaves the cursor resting. Padding
// reuses format.js's own visible-column-width `padTo`, not a raw `.length`
// scheme — outer-frame lines carry ANSI SGR colour escapes
// (f.bold/f.dim/f.yellow/...) that `.length` would wrongly count as columns
// they do not occupy.
//
// Returns `{ bytes, lines }`, where `lines` is what the caller must store as
// the next call's `prevLines`. On the diff path that is simply the new
// frame's own padded lines; on the overflow fallback it is only the TAIL the
// terminal's scroll actually leaves visible (`lines.slice(length - rows)`),
// because that — not the whole over-tall frame — is what physical rows
// `1..rows` hold once the scroll settles, and restoring that invariant is
// what lets a later, back-within-bounds frame resume trustworthy per-row
// diffing (Decision 6).
//
// Pure: no process.stdout access, which is what makes it unit-testable
// (test/watch.test.js) without a real TTY. `rows` is the WHOLE terminal
// height (`process.stdout.rows || 0`), not draw()'s `screenRows`
// sub-budget — the terminal's auto-scroll behaves on total rows, and the
// text passed here already includes the banner.
function buildFrame(text, cols, rows, prevLines) {
  const lines = text.replace(/\n$/, '').split('\n').map((line) => format.padTo(line, cols));
  const prev = prevLines || [];
  const blank = ' '.repeat(Math.max(0, cols));
  // A frame shorter than its predecessor leaves the rows below its own last
  // line untouched — blank them explicitly, each preceded by its own cursor
  // position rather than relying on line-feed sequencing. `\x1b[J`
  // (erase-to-end-of-screen) was considered and rejected for this: it is
  // exactly the same class of "erase, don't overwrite" operation as
  // `\x1b[2J`, just scoped to the tail, and reopens the blank-frame window
  // CON-17 exists to close for precisely the rows it touches.
  const blankTrailingRows = () => {
    let out = '';
    for (let row = lines.length + 1; row <= prev.length; row++) {
      out += rowAt(row) + blank;
    }
    return out;
  };

  // Mode 2 — the over-tall fallback. This is the ONLY fallback condition
  // (Decision 6): a `prevLines.length > rows` disjunct was considered and
  // rejected as both redundant (the tail-truncation below already restores
  // `prevLines.length <= rows` after every overflow write) and, at
  // `rows === 0`, self-contradictory with "never triggers when rows is
  // unknown".
  const overflow = rows > 0 && lines.length > rows;
  if (overflow) {
    const bytes = CURSOR_HOME + lines.join('\n') + blankTrailingRows();
    return { bytes, lines: lines.slice(Math.max(0, lines.length - rows)) };
  }

  // Mode 1 — the diff. `lines[i] !== prev[i]` is true for a genuinely
  // changed row, for a row the previous frame did not have at all
  // (`undefined`), and for a row the resize listener invalidated with a
  // sentinel (`null`) — all three want the same thing: write this row.
  let bytes = '';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== prev[i]) bytes += rowAt(i + 1) + lines[i];
  }
  bytes += blankTrailingRows();
  // Decision 8's cursor park. Unconditional whenever anything was written —
  // deliberately NOT skipped when the last row is already in the changed
  // set, because it is also what repairs a shrink-blank that clamped onto
  // the last real row. Never added on a fully unchanged tick, so Decision
  // 5's "an unchanged tick touches stdout not at all" is unaffected.
  if (bytes) bytes += rowAt(lines.length) + lines[lines.length - 1];
  return { bytes, lines };
}

// The set of escalations the cross-screen banner (CON-25 / lib/ui/banner.js)
// can actually do something about, sorted oldest-`raisedAt`-first — deliberately
// NOT the same filter fleet.js's `needsYou` uses (`status === 'needs-you'`
// also matches a BLOCKER-verdict run with no live `run.escalation` at all,
// i.e. nothing `answer.json` could resolve). Pure and exported so it is
// testable without a real poll loop (see test/watch.test.js).
function computeLiveEscalations(runs) {
  return (runs || [])
    .filter((r) => r.escalation && !r.escalationStale)
    .slice()
    .sort((a, b) => a.escalation.raisedAt - b.escalation.raisedAt);
}

// Runs `fn`, then unconditionally runs `restore` — even if `fn` throws,
// which is then rethrown after `restore` completes. This is the exact
// try/finally shape `doAttach()` needs around handing the terminal to tmux
// (design.md Decision 4: "if attach throws we must still hand the terminal
// back"), factored out so that guarantee is unit-testable against a fake,
// throwing `fn` without a real tmux session or stdin.
function attachAndRestore(fn, restore) {
  try {
    return fn();
  } finally {
    restore();
  }
}

// What `n` runs. Config wins; otherwise it follows the harness the project is
// already rendered for, so a fresh project needs no dashboard config at all.
function defaultLaunchCommand(config) {
  const harnesses = Array.isArray(config.harnesses) ? config.harnesses : [];
  const bin = (harnesses.includes('codex') && !harnesses.includes('claude-code'))
    ? 'codex' : 'claude';
  return bin + ' "/concertino-deliver {{TICKET}}"';
}

// CON-20: the exact wording `refreshLaunchPad` and `openLaunchPad` both need
// — a live refresh that just confirmed the team doesn't resolve, and a fresh
// process rebuilding that same conclusion from a persisted cache row,
// respectively (see openLaunchPad's own comment for why the latter exists at
// all). One function so the two call sites can never drift apart in wording.
function teamNotFoundMessage(teamKey) {
  return 'no team with key "' + teamKey + '" — check ticketProvider.teamKey';
}

// One stdin chunk is not one key. In raw mode it usually is, but a paste — or
// any piped stdin, where the whole script arrives in a single read — delivers
// several at once, and an exact compare against the chunk then matches nothing.
// Split into keys so both paths run the same handler.
//
// An escape sequence must survive as ONE key: arrow keys arrive as `\x1b[A`, and
// splitting per character would deliver a bare `\x1b` — which cancels the
// prompt — followed by a literal `[A` typed into it.
function splitKeys(chunk) {
  const keys = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === '\x1b' && (chunk[i + 1] === '[' || chunk[i + 1] === 'O')) {
      let j = i + 2;
      // CSI/SS3 runs to its final byte, @ through ~.
      while (j < chunk.length && !(chunk.charCodeAt(j) >= 0x40 && chunk.charCodeAt(j) <= 0x7e)) j++;
      keys.push(chunk.slice(i, Math.min(j + 1, chunk.length)));
      i = j + 1;
    } else {
      keys.push(chunk[i]);
      i++;
    }
  }
  return keys;
}

async function watch(opts) {
  const root = opts.root;
  const cfg = (opts.config && opts.config.dashboard) || {};
  const session = createSession(cfg.tmuxSession || 'concertino');

  if (!hasTmux()) {
    console.error('concertino watch: tmux not found on PATH.');
    console.error('Install it (e.g. `pacman -S tmux`, `brew install tmux`, `apt install tmux`) and retry.');
    process.exitCode = 1;
    return;
  }

  session.ensure();

  // Best-effort, once, before the poll loop ever starts — a pruning failure
  // (permissions, races) must never block the dashboard from coming up.
  // Pruning never runs again on the per-second poll path (design.md
  // Decision 4); `concertino prune` is the explicit, repeatable entry point.
  try {
    retention.prune(root, opts.config || {});
  } catch (e) { /* hygiene, not a dashboard dependency */ }

  const launchCommand = cfg.launchCommand || defaultLaunchCommand(opts.config || {});

  // One cache instance for the process lifetime, passed into every poll's
  // store.readAll() call — this is what makes the per-second poll cost
  // O(bytes appended since the last poll) instead of O(total log size)
  // (design.md Decision 3).
  const eventsCache = store.createEventsCache();

  let runs = [];
  let selected = 0;
  // How many selectable rows (design.md Decision 2's flat NEEDS YOU/RUNNING/
  // FAILED/DONE index space) are hidden from the start of the scrollable
  // region (everything after the pinned, always-fully-shown NEEDS YOU) —
  // the fleet screen's own scroll position. Owned here, next to `selected`,
  // for the same reason `selected` is: the renderer stays a pure (runs,
  // opts) -> string function, and only watch.js decides *when* to scroll
  // (CON-6, design.md Decision 3).
  let scrollOffset = 0;
  let running = true;
  // The previous frame's own already-padded lines — the content buildFrame()
  // diffs the next frame against, row by row (CON-27 design.md Decision 1).
  // Deliberately ONE array rather than a count plus a parallel array: the
  // array's own `.length` already is the count the shrink-cleanup loop needs,
  // so there is no second piece of state that can drift out of sync with it.
  // Starts empty, which is exactly what makes every row of the session's very
  // first frame diff as "changed" with no special-case code (Decision 3).
  let prevFrameLines = [];

  // Every piece of screen state lives here, never in a screen module — that is
  // the whole point of the router seam (see lib/ui/router.js). `mode` picks
  // which screen is on top; the rest are the sub-states individual screens
  // read out of it.
  let mode = 'fleet';
  let prompt = null;                // null, or { value, error } while `n` is open
  let escalationTicket = null;      // which run's escalation the screen shows
  let escalationReply = null;       // null, or { value, error } while typing 't'
  let escalationNotice = null;      // a write failure ("already answered", ...)
  // The lazygit-layout pass's own scroll offset for escalation.js's context
  // block — reset alongside escalationTicket whenever a different (or no)
  // escalation is shown.
  let escalationContextScroll = 0;
  // CON-46: which wizard step a multi-part escalation is showing. Reset
  // alongside escalationTicket, but NOT unconditionally to `0` on
  // `open-escalation` — design.md Decision 7: it is recomputed from any
  // already-recorded sub-answers (store.readSubAnswers) so backing out and
  // reopening a still-live, partially-answered wizard resumes at the first
  // unanswered step rather than silently risking an overwrite. Meaningless
  // (and ignored) for a single-question escalation.
  let escalationSubIndex = 0;
  let drillTicket = null;           // which run the drill-down screen shows
  let drillConfirm = null;          // null, or 'kill'|'restart' awaiting a 'y'
  let drillNotice = null;           // a restart-spawn failure, surfaced on screen
  // CON-19, extended by the lazygit-layout pass's four-panel focus model
  // (drilldown.js's DRILL_PANELS): `drillFocus` is always one of 'ticket'
  // (default — the first panel), 'timeline', 'gates', or 'evidence' — never
  // null. Digit keys 1-4 jump directly; \t cycles through all four.
  // `drillEvidenceIndex` is meaningful only while `drillFocus === 'evidence'`,
  // but kept around (not reset) while focus is elsewhere, so cycling away
  // from EVIDENCE and back never forgets the last selection.
  let drillFocus = 'ticket';
  let drillEvidenceIndex = 0;
  // The lazygit-layout pass's own free-scroll offsets for the three
  // non-selection panels — TICKET/TIMELINE/GATES each scroll independently
  // via 'drill-panel-scroll' (drilldown.js's own handleKey), unlike
  // EVIDENCE's selection-driven `drillEvidenceIndex` above. Reset to 0
  // alongside drillFocus/drillEvidenceIndex whenever the drill-down opens
  // on a (possibly different) run — a fresh run always starts scrolled to
  // the top of every panel.
  let drillTicketScroll = 0;
  let drillTimelineScroll = 0;
  let drillGatesScroll = 0;
  // The evidence reader's own state (mode = 'docview', entered ONLY via
  // 'open-evidence-doc' — design.md Decision 3a). `docTitle`/`docBody` are
  // the opened entry's resolved { title, body } (body already markdown-
  // stripped and word-wrapped — see the 'open-evidence-doc' case in
  // applyAction, below); `docScroll` is this reader's own scroll offset.
  // `docViewportRows` is recomputed every draw() from the current terminal
  // rows (docview.computeViewportRows) — the SAME budget render() itself
  // uses, precomputed here because router.handleKey's own seam carries no
  // `opts` and so cannot recompute it live at keypress time (see
  // docview.js's own comment on this).
  let docTitle = null;
  let docBody = null;
  let docScroll = 0;
  let docViewportRows = Infinity;
  // ticketview.js's own scroll state, now that its box is bounded/scrollable
  // rather than always growing to fit (design.md Decision 2) — independent
  // of, and never confused with, the evidence reader's own scroll state
  // above. `ticketviewViewportRows`/`ticketviewBodyLineCount` are the same
  // "precomputed ahead of the next keypress" values docViewportRows is,
  // recomputed every draw() while ticketview.js is on screen.
  let ticketviewScroll = 0;
  let ticketviewViewportRows = Infinity;
  let ticketviewBodyLineCount = 0;

  // The cross-screen escalation banner's own reply sub-state (CON-25) —
  // mirrors escalationTicket/escalationReply's SHAPE but is a fully
  // independent pair, never aliased to it: the banner can be open for a
  // DIFFERENT run than whatever the dedicated escalation screen (if any) is
  // currently showing. Recomputed each poll from `runs`; see
  // computeLiveEscalations() and draw()'s own comment on why the oldest live
  // one is always what this targets.
  let globalEscalationTicket = null;
  let globalEscalationReply = null; // null, or { value, error } while typing 'g'
  // The whole set the banner could name — recomputed on every draw(); read
  // by onKey() to decide whether 'g' should do anything at all.
  let liveEscalations = [];

  // The launch pad's own state. Deliberately NOT reset by backToFleet(): the
  // cache, the current epic/ticket selection and the sequential/parallel
  // choice all survive a trip back to the fleet and a later re-entry on `N`,
  // which is what "instant, offline browsing" (design doc, "Ticket cache")
  // actually means in practice — re-opening the launch pad mid-session must
  // not lose your in-progress selection or force a re-read of a cache that
  // has not gone stale. `launchPad` itself stays null until `N` is pressed
  // for the first time, so a session that never opens it pays nothing.
  let launchPad = null;
  // A point-in-time snapshot built fresh every time `L` is pressed (ports,
  // base commit, concurrency, harness) — unlike launchPad, this is cheap to
  // throw away and rebuild, so cancelling or confirming both null it out.
  let launchPlan = null;
  // The lazygit-layout pass's own scroll offset for launchplan.js's ticket
  // list — reset to 0 alongside `launchPlan` itself (a freshly-built plan
  // always starts scrolled to the top).
  let launchPlanTicketScroll = 0;
  // The queue runner (lib/ui/queue.js). null whenever nothing is queued.
  //
  // CON-29: persisted to `.concertino/cache/queue.json` on every tick (see
  // the queue.tick() call site in draw(), below) via lib/ui/queue-cache.js —
  // the same durable-cache pattern this file already uses for tickets
  // (cache.js/linear.json) — and removed once the queue goes idle. Read
  // back at startup, below, reconciled against a one-off fleet snapshot
  // through queue.createRestoredQueue()/reconcileRestored() (the same
  // isRunLive predicate tick() itself uses), and restored into a
  // PAUSED/UNCONFIRMED queue (`confirmed: false`) rather than resumed
  // silently: queue.shouldTick() — the guard at the tick() call site below —
  // refuses to call tick() at all until the operator presses the confirm
  // key fleet.js's QUEUED section advertises for a restored queue (see
  // 'confirm-restored-queue' in applyAction). A queue built fresh via
  // queue.createQueue() (the 'confirm-launch' action) always sets
  // `confirmed: true` explicitly instead, so that guard is unambiguous for
  // every queue object either path produces. See design.md for the full
  // reconciliation design (why the fleet snapshot has to be computed once,
  // synchronously, before the poll loop starts, and why `inFlight` — not
  // just `pending` — has to be reconstructed too).
  let queueState = null;
  // Threaded through to every queueCache.write() call for the lifetime of
  // one queue: minted fresh (crypto.randomUUID()) when 'confirm-launch'
  // creates a same-session queue, or carried over from the restored
  // record's own sessionId when a queue is restored at startup — either
  // way, null exactly when queueState is null (CON-29). Not used for
  // locking; see queue-cache.js's own header comment on why age, not
  // session identity, is the actual staleness gate.
  let queueSessionId = null;
  let queueNotice = null;           // a queued ticket's submitTicket failure
  // CON-37: sticky notice naming any pending ticket ids the startup restore
  // block dropped because their run completed DURING the downtime (not
  // before the queue file was even written — see queue.js's
  // reconcileRestored). Same "set once, persists until overwritten" lifecycle
  // as queueNotice above, but deliberately independent of queueState: it must
  // still be shown even when reconciliation leaves nothing to restore at all
  // (createRestoredQueue returns null in exactly that case) — see design.md
  // Decision 4.
  let restoreNotice = null;
  // Set by the fleet screen's own 'request-quit' action (see fleet.js's
  // handleKey) the first time `q`/Ctrl-C is pressed while queueState still
  // has anything pending or in flight — the un-started tail of a batch would
  // otherwise be discarded by a deliberate quit exactly as silently as by a
  // crash. A second 'q' (handled while this is true) actually quits; any
  // other key clears it via 'cancel-quit' without quitting.
  let quitConfirm = false;
  // CON-39: the QUEUED-local focus cursor (design.md Decision 1). `focus`
  // defaults to 'runs' — the ordinary run selection, unaffected by any of
  // this — and flips to 'queue' only via the digit-jump-into-QUEUED action
  // ('focus-queue', below) or the launch-pad's own force-start entry point.
  // `queueFocus` is an index into `queueState.pending`, meaningful only
  // while `focus === 'queue'`; re-clamped every draw() (mirroring
  // `scrollOffset`'s own re-clamp just below) so a queue that shrinks or
  // empties out from under it never leaves a stale, out-of-range cursor on
  // screen (design.md's "Risks" note).
  let focus = 'runs';
  let queueFocus = null;
  // `{ ticket } | null` — force-start's own y/anything-else confirmation
  // gate (design.md Decision 3), independent of `quitConfirm` above: the two
  // must never both try to claim the same keypress (see fleet.js's
  // handleKey, which checks this one FIRST).
  let forceStartConfirm = null;
  // CON-56: QUICK START is always shown now (no visibility flag) — this is
  // just its own local focus cursor, an index into the eligible-ticket list
  // `draw()` recomputes every poll (quickStartEligible(), below), meaningful
  // only while `focus === 'quickstart'`, same relationship `queueFocus`/
  // `focus === 'queue'` already have. Defaults to `0`: the section is on
  // screen from the first frame, so there is no "not yet shown" state for
  // this to model.
  let quickStartFocus = 0;
  // Clear Queue's own y/anything-else confirmation gate — a plain boolean
  // (there is nothing to name but "the queue"), reachable from BOTH the
  // fleet view and the launch pad (fleet.js's and launchpad.js's own
  // CLEAR_QUEUE_KEY bindings), so it lives here at the app level like every
  // other cross-screen sub-state rather than inside either screen's own
  // local state. Checked ahead of forceStartConfirm/quitConfirm in both
  // screens' handleKey — see their own matching comments.
  let clearQueueConfirm = false;
  // CON-21: the ticket-draft screen's own state (mode = 'ticketdraft').
  // `ticketDraft` is `null` until the headless drafting invocation resolves
  // — see the 'open-ticket-draft' applyAction case, which owns `prompt`
  // (not this) while the invocation is in flight. `draftCancel` is that
  // invocation's own cancel() handle (design.md's "drafting…" risk
  // mitigation, tasks.md 2.3), meaningful only while `prompt.drafting` is
  // true. `draftSeq`/`draftCreateSeq` are bumped on every cancel/new attempt
  // so a superseded promise's late resolution can recognise itself as stale
  // and no-op rather than clobbering whatever state has moved on to since
  // (mirrors the launch pad's own generation-free "read the latest snapshot,
  // never trust a captured one" discipline, applied here because these two
  // calls are genuinely async and outlive a single keypress).
  let ticketDraft = null;
  let draftCancel = null;
  let draftSeq = 0;
  let draftCreateSeq = 0;

  // CON-57: the settings screen's own session state (mode = 'settings').
  // `null` until `s` is first pressed; rebuilt FRESH by openSettings() every
  // time the screen is entered (design.md Decision 4 — deliberately NOT
  // reused across visits the way `launchPad` is, since config on disk can
  // change between visits and re-reading a local JSON file plus the static
  // schema is cheap). Cleared back to `null` by backToFleet(), same as
  // every other screen's own per-visit state.
  let settings = null;

  // CON-54, design.md Decision 5: tracks which screen the ticket detail view
  // (mode = 'ticketview') was most recently opened FROM — 'launchpad' | 'fleet'
  // | null. `ticketview.js`'s own `esc` action keeps emitting the identical
  // `{ type: 'back-to-launchpad' }` shape it always has (its pure
  // handleKey contract, and the tests pinning it, are unchanged); this field
  // is what `back-to-launchpad`'s handler below reads to decide the actual
  // destination. Defaults to `null` so a mid-session process upgrade (or any
  // path that reaches 'ticketview' without going through one of the three
  // entry points that set this) degrades safely to the pre-existing
  // backToLaunchPad() behavior. Reset to `null` whenever consumed, and
  // defensively in backToFleet() — same "leaked per-visit state must never
  // survive into an unrelated screen" discipline docTitle/ticketDraft/settings
  // already follow in that function.
  let ticketviewReturnMode = null;

  function currentState() {
    return {
      mode, runs, selected, scrollOffset, prompt, escalationTicket, escalationReply, escalationNotice,
      escalationContextScroll, escalationSubIndex,
      drillTicket, drillConfirm, drillNotice, launchPad, launchPlan, launchPlanTicketScroll, queueNotice, restoreNotice,
      queueState, quitConfirm, globalEscalationTicket, globalEscalationReply, liveEscalations,
      drillFocus, drillEvidenceIndex, drillTicketScroll, drillTimelineScroll, drillGatesScroll,
      docTitle, docBody, docScroll, docViewportRows,
      ticketviewScroll, ticketviewViewportRows, ticketviewBodyLineCount,
      focus, queueFocus, forceStartConfirm, quickStartFocus, clearQueueConfirm,
      ticketDraft,
      settings,
      ticketviewReturnMode,
    };
  }

  function backToFleet() {
    mode = 'fleet';
    escalationTicket = null;
    escalationReply = null;
    escalationNotice = null;
    escalationContextScroll = 0;
    escalationSubIndex = 0;
    drillTicket = null;
    drillConfirm = null;
    drillNotice = null;
    drillFocus = 'ticket';
    drillEvidenceIndex = 0;
    drillTicketScroll = 0;
    drillTimelineScroll = 0;
    drillGatesScroll = 0;
    // Defensive — mode = 'docview' always routes back to 'drilldown' (never
    // straight to 'fleet'; see 'back-to-drilldown-from-doc' below), but
    // clearing the reader's own state here too means it can never leak into
    // a later, unrelated screen.
    docTitle = null;
    docBody = null;
    docScroll = 0;
    // Defensive, same reasoning — mode = 'ticketdraft' always routes back to
    // 'fleet' via its own 'cancel-draft'/'confirm-draft' handling below,
    // which already clears this, but a leaked draft must never survive into
    // a later, unrelated screen either way.
    ticketDraft = null;
    // CON-57: mode = 'settings' always routes back to 'fleet' too (Escape
    // discards, a successful save also returns here — see 'settings-save'
    // below) — cleared here so a leaked settings session can never survive
    // into a later, unrelated screen (same discipline as ticketDraft/
    // docTitle/etc. just above).
    settings = null;
    // CON-54: defensive reset, same discipline as settings/ticketDraft just
    // above — 'back-to-launchpad' already resets this on every consumption,
    // but a leaked value must never survive into an unrelated screen either
    // way.
    ticketviewReturnMode = null;
  }

  function backToLaunchPad() {
    mode = 'launchpad';
    launchPlan = null;
    launchPlanTicketScroll = 0;
  }

  // Gate status is computed once, the first time `launchPad` is created
  // (inside the `if (!launchPad)` below) — NOT re-derived on every later
  // re-open, since `launchPad` deliberately survives a trip back to the
  // fleet (see its own declaration above). That is safe only because
  // config/env do not change mid-session; ensureLaunchPad() is still the one
  // place that decides "enabled or not", it just decides it once per
  // session rather than once per keypress.
  //
  // CON-54: the lazy cache-init half of the old openLaunchPad() — split out
  // so the three fleet-originated 'view-ticket'/'view-ticket-quickstart'
  // handlers below can populate `launchPad.cache` (so ticketview.js's own
  // findTicket() has something to search) WITHOUT also flipping
  // `mode = 'launchpad'`, which openLaunchPad() (below) still does for its
  // own callers, unchanged.
  function ensureLaunchPad() {
    if (!launchPad) {
      const initialCache = cache.read(root);
      launchPad = {
        status: linear.launchPadStatus(opts.config || {}, process.env),
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
        error: initialCache.teamFound === false ? teamNotFoundMessage(initialCache.teamKey) : null,
        viewingTicket: null,
        project: (opts.config && opts.config.project && opts.config.project.name) || '',
        defaultConcurrency: cfg.maxConcurrent || 2,
      };
    }
  }

  function openLaunchPad() {
    ensureLaunchPad();
    mode = 'launchpad';
  }

  // CON-57, design.md Decision 4: builds a FRESH settings session every
  // time — never reuses a prior one, unlike openLaunchPad() just above.
  // Reads `concertino.config.json` directly off disk (the same default path
  // `bin/concertino`'s own cmdWatch resolves when no `--config` override is
  // given — `opts.config` here is already-parsed and carries no path of its
  // own, so this is the one place in this file that re-reads the file
  // itself rather than trusting the in-memory `opts.config` loaded once at
  // startup) so a hand-edit, another `concertino update`, or a PRIOR
  // settings-screen save between visits is always reflected. A missing or
  // unparseable file degrades to `{}` rather than crashing the dashboard —
  // collectConfigIssues will report the same missing-required-field errors
  // `concertino validate` would, right there in the detail pane, once a
  // save is attempted.
  function openSettings() {
    const cfgPath = path.join(root, 'concertino.config.json');
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { raw = {}; }
    const schema = configLib.loadSchema();
    settings = {
      cfgPath,
      raw,
      // The working copy every staged edit mutates in place (deepSet) — the
      // raw, pre-withDefaults() on-disk shape plus in-session edits, never
      // the withDefaults()-expanded object (design.md Decision 3's own
      // "never materialize schema defaults back to disk" reasoning).
      candidate: JSON.parse(JSON.stringify(raw)),
      schema,
      fieldMeta: settingsScreen.buildFieldMeta(schema, raw),
      sections: configLib.schemaSectionOrder(schema),
      sectionIndex: 0,
      fieldIndex: 0,
      focus: 'sections',
      prompt: null,
      saveError: null,
    };
    mode = 'settings';
  }

  // Fire-and-forget: sets `refreshing` synchronously (before its first
  // `await`, so the very next draw() — including the one applyAction
  // triggers immediately after this returns — already shows "fetching…"),
  // then updates the cache once the network call settles. The 1-second poll
  // timer picks up the result on its own; nothing here needs to force an
  // extra redraw.
  async function refreshLaunchPad() {
    const lp = launchPad;
    if (!lp) return;
    lp.refreshing = true;
    lp.error = null;
    try {
      const team = linear.teamKeyFromConfig(opts.config || {}, process.env);
      if (!team.key) throw new Error('no ticketProvider.teamKey configured — see config-reference.md');
      // Resolved once and reused for both calls below (rather than reading
      // process.env.LINEAR_API_KEY a second time for resolveTeam) so the two
      // requests are never able to disagree about which key authenticated
      // the fetch they're a pair for — fetchTickets defaults to this same
      // env var internally, but only when apiKey is omitted from opts.
      const apiKey = process.env.LINEAR_API_KEY;
      const result = await linear.fetchTickets({
        teamKey: team.key,
        apiKey,
        stateTypes: linear.stateTypesFromConfig(opts.config),
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
      // resolved" (openLaunchPad rebuilds `lp.error` from exactly this field
      // on a fresh process — see its own comment).
      let teamFound = true;
      if (result.tickets.length === 0) {
        const resolved = await linear.resolveTeam(undefined, apiKey, team.key);
        teamFound = resolved.found;
        if (!resolved.found) {
          lp.error = teamNotFoundMessage(team.key);
        }
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
    // value a prior process would have (see idleMsFromActivity's own header
    // comment and design.md).
    return windows.map((w) => {
      if (!w.alive) return { ticket: w.ticket, alive: false, idleMs: null };
      return { ticket: w.ticket, alive: true, idleMs: idleMsFromActivity(w.activity, now) };
    });
  }

  // The actual rows available to the router's render(state, opts) once the
  // cross-screen escalation banner (if any) has taken its own lines off the
  // top — the same computation draw() itself needs every poll, factored out
  // so the `move` action handler (CON-6, design.md Decision 3) can call the
  // exact same thing before draw() ever runs, rather than approximating it
  // and letting the two disagree about what "the visible window" is.
  function computeScreenRows() {
    const cols = process.stdout.columns || 80;
    // Suppressed only when the screen already on top IS that exact
    // escalation — showing it there would literally duplicate what the
    // dedicated escalation screen (lib/ui/screens/escalation.js) already
    // renders (design.md Decision 6 / spec.md's "suppressed on its own
    // escalation's screen" scenario).
    const bannerText = bannerScreen.suppressedOnOwnScreen(mode, escalationTicket, liveEscalations)
      ? null
      : bannerScreen.renderBanner(liveEscalations, { cols, now: Date.now(), reply: globalEscalationReply });
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
  // panel), 'move-quickstart-focus' (to clamp the cursor) and
  // 'quickstart-add' (to resolve `action.index` to a real ticket) all call
  // this rather than sharing one cached array, so none of the three can ever
  // disagree with what the fleet/queue currently actually contain — the same
  // "cheap enough to recompute every frame" precedent `queuedTitles` already
  // sets for this file (design.md's own "Trade-offs" note).
  function quickStartEligible() {
    const inQueue = (id) => !!queueState && (
      queueState.pending.includes(id) || (queueState.inFlight && queueState.inFlight.has(id))
    );
    return launchpadScreen
      .sortByPriority(cache.read(root).tickets || [])
      .filter((t) => launchpadScreen.isSelectable(t, runs))
      .filter((t) => !inQueue(t.identifier))
      .slice(0, fleetScreen.QUICK_START_COUNT);
  }

  function draw() {
    const now = Date.now();

    // The queue runner advances on every poll, independent of which screen
    // is on top — a batch launched from the launch pad must keep feeding the
    // fleet whether or not the human is still looking at it. tick() decides
    // WHICH tickets to start now (see queue.js) against the FLEET SNAPSHOT
    // FROM THE PREVIOUS DRAW — this has to run before reduce() below, not
    // after: submitTicket's session.spawn is synchronous, so any window it
    // opens is already live by the time sampleWindows() looks at tmux a few
    // lines down, and the newly-launched ticket appears in THIS frame rather
    // than waiting a full extra poll to show up (the `n` prompt gets this for
    // free since its spawn happens before the draw() that follows it; the
    // queue has to earn it explicitly since its spawn happens INSIDE draw()).
    // shouldTick() (queue.js) refuses a restored-but-not-yet-confirmed queue
    // (`confirmed: false`) — CON-29's core safety property: nothing a
    // restored queue would launch reaches submitTicket until the operator
    // has explicitly pressed the confirm key (see the 'confirm-restored-
    // queue' action below and fleet.js's own affordance).
    if (queueState && queue.shouldTick(queueState)) {
      const result = queue.tick(queueState, runs);
      // A pending ticket queue.tick refused to admit (it is already live —
      // see queue.js's own "dropped, not held" decision) is otherwise
      // invisible: it never reaches submitTicket, so nothing else on this
      // poll would explain why the fleet never grew by one. Set first so a
      // same-tick spawn failure (more immediately actionable) can still
      // override it below.
      if (result.dropped.length) {
        queueNotice = 'already running, skipped from queue: ' + result.dropped.join(', ');
      }
      for (const ticket of result.toLaunch) {
        const launched = submitTicket(ticket, result.queue.launchCommand || launchCommand, session);
        if (!launched.spawned) queueNotice = launched.error;
      }
      queueState = queue.isIdle(result.queue) ? null : result.queue;
      // Written on every tick, removed once idle — mirrors the queueState
      // assignment on the line right above so the on-disk file's lifetime
      // matches the in-memory queue's exactly (design.md Decision 3), the
      // one exception being the not-yet-confirmed restore window, which
      // never reaches this branch at all (shouldTick() above refuses it).
      if (queueState) {
        queueCache.write(root, queueState, queueSessionId, now);
      } else {
        queueCache.clear(root);
        queueSessionId = null;
      }
    }

    runs = reduce(store.readAll(root, eventsCache), sampleWindows(now), now);

    // Reap any run whose window is BOTH terminal (run.end observed) and
    // already dead — same poll cadence as the rest of draw(), right after
    // reduce() so it always sees this poll's own runs/window snapshot, not
    // gated behind any config (design.md/tasks.md 3.1). This frame still
    // renders the pre-kill window state (`runs` was already computed above);
    // the window disappearing from `session.listWindows()` is picked up by
    // the NEXT poll's sampleWindows(), same as any other tmux-side change.
    reap.reapFinished(root, session, runs);

    if (selected >= runs.length) selected = Math.max(0, runs.length - 1);
    // A `runs` list that shrinks (a run finishes and rolls out of
    // FAILED/DONE faster than a human scrolls, or the terminal is resized
    // shorter) can leave `scrollOffset` pointing past the end — re-clamp it
    // every draw(), mirroring the `selected` clamp immediately above
    // (design.md Decision 3, tasks.md 2.3/2.5). maxScrollOffset is
    // structural (independent of `rows`), so `rows: 0` here is deliberate —
    // this clamp needs no height-budget computation at all.
    scrollOffset = Math.max(0, Math.min(scrollOffset,
      fleetScreen.visibleWindow(runs, { rows: 0, selected, scrollOffset, queueState }).maxScrollOffset));

    // CON-39: the QUEUED-local cursor's own re-clamp, same discipline as
    // `scrollOffset`'s immediately above (design.md's "Risks" note,
    // tasks.md 4.4) — a queue that shrinks (an ordinary tick() admits the
    // very ticket `queueFocus` was pointing at) or empties out entirely
    // between keypresses must never leave a stale, out-of-range cursor on
    // screen. Falls back to the ordinary run selection when there is
    // nothing left in QUEUED to focus.
    if (focus === 'queue') {
      const pendingLen = queueState && queueState.pending ? queueState.pending.length : 0;
      if (!pendingLen || queueFocus == null || queueFocus < 0 || queueFocus >= pendingLen) {
        focus = 'runs';
        queueFocus = null;
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
    if (focus === 'quickstart') {
      const len = quickStartTickets ? quickStartTickets.length : 0;
      if (quickStartFocus == null || quickStartFocus < 0 || quickStartFocus >= len) {
        quickStartFocus = 0;
      }
    }

    // The escalation screen tracks its run by ticket, not by a snapshot taken
    // when it was opened, so it always reflects the latest poll. If that run's
    // escalation has cleared — answered, timed out, or the run itself is gone
    // — there is nothing left to show here; fall back to the fleet rather than
    // render a dead screen. This is also what makes "the row clears" visible:
    // once `emit-event.sh --await` notices `answer.json` and logs
    // `escalation.answered`, the very next poll walks the human back out.
    if (mode === 'escalation') {
      const run = runs.find((r) => r.ticket === escalationTicket);
      if (!run || !run.escalation) backToFleet();
    }

    // The cross-screen escalation banner (CON-25): recomputed every poll,
    // same as the fleet's own NEEDS YOU section. If the reply box is open for
    // a ticket that has dropped out of this set — answered, timed out, or the
    // run itself gone — there is no longer a live escalation to write an
    // answer against, so close it exactly as draw() already walks the
    // dedicated escalation screen back to the fleet above.
    liveEscalations = computeLiveEscalations(runs);
    if (globalEscalationReply && !liveEscalations.some((r) => r.ticket === globalEscalationTicket)) {
      globalEscalationReply = null;
      globalEscalationTicket = null;
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
    const bannerText = bannerScreen.suppressedOnOwnScreen(mode, escalationTicket, liveEscalations)
      ? null
      : bannerScreen.renderBanner(liveEscalations, { cols, now, reply: globalEscalationReply });
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
    if (mode === 'drilldown' && drillTicket) {
      const run = runs.find((r) => r.ticket === drillTicket);
      const items = run ? drilldownScreen.evidenceItems(run) : [];
      drillEvidenceIndex = Math.max(0, Math.min(drillEvidenceIndex, Math.max(0, items.length - 1)));
    }
    if (mode === 'docview') {
      docViewportRows = docviewScreen.computeViewportRows(screenRows);
      docScroll = docviewScreen.clampScroll((docBody || []).length, docViewportRows, docScroll);
    }
    if (mode === 'ticketview') {
      const ticket = ticketviewScreen.findTicket(launchPad, launchPad && launchPad.viewingTicket);
      if (ticket) {
        const innerWidth = Math.max(0, (process.stdout.columns || 80) - DOC_BOX_BORDER_PADDING_COLS);
        ticketviewBodyLineCount = ticketDetail.buildDetailLines(ticket, innerWidth).length;
        ticketviewViewportRows = ticketviewScreen.computeViewportRows(screenRows, !!ticket.url);
        ticketviewScroll = docviewScreen.clampScroll(ticketviewBodyLineCount, ticketviewViewportRows, ticketviewScroll);
      }
    }

    // A queued ticket carries only its id (see queue.createQueue) — no
    // title. The launch pad can only have created this queue from tickets
    // already fetched into the on-disk cache (`confirm-launch` builds
    // queueState from launchPad.cache, which is itself written from a fetch),
    // so the same tickets are durably on disk in .concertino/cache/linear.json
    // independent of whether `launchPad` itself is still populated this
    // session (design.md Decision 3). Read fresh each poll — the exact same
    // cheap sync read `openLaunchPad()` already performs — and gated on a
    // non-empty queue so an idle/no-queue poll pays nothing extra.
    const queuedTitles = (queueState && queueState.pending.length)
      ? new Map((cache.read(root).tickets || []).map((t) => [t.identifier, t.title]))
      : null;

    // CON-18: the drill-down's TICKET panel/header title — same seam as
    // queuedTitles just above (a small, gated, per-poll disk read passed
    // through opts to the router, never folded into reduce()'s pure fold —
    // see design.md Decision 2). There is exactly one ticket the current
    // frame can possibly show text for, so this is skipped entirely unless
    // the drill-down is actually open.
    const drillTicketText = (mode === 'drilldown' && drillTicket)
      ? ticketText.resolve(root, drillTicket, cache.read(root))
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
    const topBarLine = topbar.buildTopBarLine(currentState(), SCREEN_LABELS[mode] || String(mode).toUpperCase(), { cols });
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
    const frame = buildFrame(rendered, cols, totalRows, prevFrameLines);
    if (frame.bytes) process.stdout.write(frame.bytes);
    prevFrameLines = frame.lines;
    return runs;
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
        queueState = restored;
        queueSessionId = queueRecord.sessionId;
      }
      // Independent of whether `restored` is null (design.md Decision 4) —
      // a queue file whose every pending ticket completed during the
      // downtime restores nothing at all, but the operator must still be
      // told what happened to those ids, not just silence.
      if (reconciled.completedDuringDowntime.length) {
        const ids = reconciled.completedDuringDowntime;
        restoreNotice = `${ids.length} ticket(s) completed while you were away and were not restored: ` +
          ids.join(', ');
      }
    }
  }

  // Enter the alternate screen buffer once, before the first frame is ever
  // drawn (design.md Decision 3) — this is also what stops the dashboard
  // from trampling the user's scrollback, not just the flicker fix.
  process.stdout.write(ALT_SCREEN_ENTER + CURSOR_HIDE);
  runs = draw();
  const timer = setInterval(() => { if (running) runs = draw(); }, POLL_MS);
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
    if (running) runs = draw();
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
      if (queueState) {
        const remaining = queueState.pending.length + queueState.inFlight.size;
        if (remaining > 0) {
          console.error('concertino: quitting with ' + remaining +
            ' queued ticket(s) not yet started — they will not resume automatically.');
        }
      }
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
      // shape itself is factored into attachAndRestore() (below) so it is
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

    // Writes answer.json and reports what happened — never throws (see
    // store.writeAnswer). A confirmed write heads back to the fleet: there is
    // nothing left to do on this screen, and the row itself clears once
    // `emit-event.sh --await` notices the file and logs `escalation.answered`
    // (the dashboard deliberately does not emit that event a second time —
    // see store.js). A refusal stays on the escalation screen and is shown,
    // not swallowed — but what happens to a typed reply depends on *why* it
    // was refused. "already answered" (reason: 'answered') means this
    // decision is genuinely moot, so clearing it is correct. Any other
    // failure (reason: 'error' — a permissions/IO problem) has nothing to do
    // with what the human typed; discarding it there would make someone who
    // wrote a long free-text reply retype it after a transient failure, so
    // when there is a reply in flight, keep its value and surface the error
    // inline on that reply instead of clearing it. (An option-key answer, e.g.
    // pressing 'a' for approve, has no typed text to lose — that path has no
    // `escalationReply` at all, so the error still needs the banner.)
    function answerEscalation(ticket, value) {
      const result = store.writeAnswer(root, ticket, value);
      if (result.ok) {
        backToFleet();
      } else if (result.reason === 'answered') {
        escalationReply = null;
        escalationNotice = result.error;
      } else if (escalationReply) {
        escalationReply.error = result.error;
      } else {
        escalationNotice = result.error;
      }
    }

    // CON-46's `answer-sub` write path — mirrors answerEscalation()'s own
    // shape and error handling (task 5.3: the "already answered" race is
    // surfaced as a notice, not a crash) for a single wizard step instead of
    // the whole escalation. Only the last sub-question's write (the one that
    // makes `store.writeSubAnswer`'s result `complete: true`) returns to the
    // fleet — design.md task 5.2, exactly mirroring `answerEscalation`'s
    // existing single-question behaviour with no separate "waiting" interim
    // screen state. Any other successful write stays on the escalation
    // screen and advances `escalationSubIndex` by exactly one; no action
    // type here accepts an arbitrary target index (design.md Decision 6).
    function answerEscalationSub(ticket, index, value, total) {
      const result = store.writeSubAnswer(root, ticket, index, value, total);
      if (result.ok && result.complete) {
        backToFleet();
      } else if (result.ok) {
        escalationReply = null;
        escalationSubIndex = Math.min(index + 1, Math.max(0, total - 1));
      } else if (result.reason === 'answered') {
        escalationReply = null;
        escalationNotice = result.error;
      } else if (escalationReply) {
        escalationReply.error = result.error;
      } else {
        escalationNotice = result.error;
      }
    }

    // The banner's own write path (CON-25) — reuses store.writeAnswer, the
    // exact function answerEscalation() above calls, so the write side is
    // genuinely unchanged. Deliberately does NOT call backToFleet() on
    // success: the whole point of the banner is that answering it must leave
    // whatever screen you were on exactly as it was (design.md Decision 6).
    // An "already answered" race (someone else answered first, e.g. from the
    // dedicated escalation screen) is treated the same as success here — the
    // decision is moot either way, so there is nothing left for this reply
    // box to hold onto.
    function answerBannerEscalation(ticket, value) {
      const result = store.writeAnswer(root, ticket, value);
      if (result.ok || result.reason === 'answered') {
        globalEscalationReply = null;
        globalEscalationTicket = null;
      } else if (globalEscalationReply) {
        globalEscalationReply.error = result.error;
      }
    }

    // CON-39, design.md Decision 2: the scroll-into-view adjustment `move`
    // has always applied, factored out so the new `jump` action (an
    // absolute target instead of a relative delta) can share it rather than
    // duplicate it. Uses the same visibleWindow() the renderer itself calls,
    // so this decision and the next draw()'s actual render can never
    // disagree about what "visible" means.
    function scrollToShow(targetSelected) {
      const win = fleetScreen.visibleWindow(runs, {
        cols: process.stdout.columns || 80,
        rows: computeScreenRows(),
        selected: targetSelected, scrollOffset, prompt, queueNotice, restoreNotice, queueState, quitConfirm,
      });
      if (targetSelected < win.firstVisibleIndex) {
        scrollOffset = Math.max(0, scrollOffset - (win.firstVisibleIndex - targetSelected));
      } else if (targetSelected > win.lastVisibleIndex) {
        scrollOffset = Math.min(win.maxScrollOffset, scrollOffset + (targetSelected - win.lastVisibleIndex));
      }
    }

    // Interprets an action returned by a screen's (pure) handleKey. Screens
    // never mutate state themselves — this is the one place state changes,
    // which is what keeps every screen testable as (state, opts) -> string.
    function applyAction(action) {
      if (!action) return false;
      switch (action.type) {
        case 'move': {
          selected = Math.max(0, Math.min(selected + action.delta, runs.length - 1));
          scrollToShow(selected);
          return true;
        }

        // CON-39, design.md Decision 2: the digit-jump counterpart to
        // `move` above — an absolute target row instead of a relative
        // delta, same scroll-into-view treatment. Also returns focus to
        // 'runs' (clearing any stale QUEUED-local cursor): a runs-backed
        // jump target is, by construction, never QUEUED itself (see
        // fleet.js's handleKey — QUEUED emits 'focus-queue', never 'jump').
        case 'jump': {
          selected = Math.max(0, Math.min(action.index, runs.length - 1));
          focus = 'runs';
          queueFocus = null;
          scrollToShow(selected);
          return true;
        }

        // CON-39, design.md Decision 1: jumping INTO QUEUED never touches
        // `selected`/`scrollOffset` at all — it only ever sets the separate,
        // QUEUED-local cursor, preserving the row-index hazard CON-28
        // avoided by making QUEUED unselectable in the first place.
        case 'focus-queue':
          focus = 'queue';
          queueFocus = action.index;
          return true;

        // j/k while focus is 'queue' — moves ONLY queueFocus, clamped to
        // the current pending list (design.md Decision 1). Never touches
        // selected/scrollOffset.
        case 'move-queue-focus': {
          const pendingLen = queueState && queueState.pending ? queueState.pending.length : 0;
          if (!pendingLen) return true; // draw()'s own re-clamp resets focus next frame
          const cur = queueFocus == null ? 0 : queueFocus;
          queueFocus = Math.max(0, Math.min(cur + action.delta, pendingLen - 1));
          return true;
        }

        // Escape while focus is 'queue' — returns to the ordinary run
        // selection, `selected` untouched throughout the round trip.
        case 'exit-queue-focus':
          focus = 'runs';
          queueFocus = null;
          return true;

        // `f` on a focused pending ticket (design.md Decision 3) — puts the
        // load-bearing overage warning up; nothing starts until the very
        // next keypress confirms it (see 'confirm-force-start' below).
        case 'open-force-start-confirm':
          forceStartConfirm = { ticket: action.ticket };
          return true;

        case 'cancel-force-start':
          forceStartConfirm = null;
          return true;

        // The force-start confirmation's own 'y' — see queue.js's
        // forceStart() for the bookkeeping this performs (identical to
        // tick()'s own pending -> inFlight admission, minus the
        // maxConcurrent gate, and WITHOUT tick()'s hard-coded
        // `confirmed: true` — design.md Decision 4). Mirrors the existing
        // tick()-driven launch path in draw() above: submitTicket, update
        // queueState, persist via queue-cache.js. A ticket that already left
        // `pending` between the confirm-open and this keypress (admitted
        // normally, or already force-started) is a no-op — forceStart()
        // itself returns `toLaunch: []` for that case, so nothing here ever
        // calls submitTicket a second time.
        case 'confirm-force-start': {
          forceStartConfirm = null;
          if (queueState) {
            const result = queue.forceStart(queueState, action.ticket);
            if (result.toLaunch.length) {
              const launched = submitTicket(action.ticket, result.queue.launchCommand || launchCommand, session);
              if (!launched.spawned) queueNotice = launched.error;
              queueState = result.queue;
              queueCache.write(root, queueState, queueSessionId, Date.now());
              focus = 'runs';
              queueFocus = null;
            }
          }
          return true;
        }

        // --- CON-40: QUICK START (design.md) ------------------------------

        // CON-39/CON-40, design.md Decision 3: jumping INTO QUICK START
        // never touches `selected`/`scrollOffset` — mirrors 'focus-queue'
        // just above exactly, only for the QUICK START-local cursor instead.
        case 'focus-quickstart':
          focus = 'quickstart';
          quickStartFocus = action.index;
          return true;

        // j/k while focus is 'quickstart' — moves ONLY quickStartFocus,
        // clamped to the CURRENT eligible list (re-derived fresh here, same
        // "never trust a value from a previous draw()" discipline
        // 'quickstart-add' below applies). Never touches selected/
        // scrollOffset. Mirrors 'move-queue-focus' above.
        case 'move-quickstart-focus': {
          const len = quickStartEligible().length;
          if (!len) return true; // draw()'s own re-clamp keeps the cursor at 0
          const cur = quickStartFocus == null ? 0 : quickStartFocus;
          quickStartFocus = Math.max(0, Math.min(cur + action.delta, len - 1));
          return true;
        }

        // Escape while focus is 'quickstart' — returns to the ordinary run
        // selection WITHOUT hiding the panel (CON-56: the panel is always
        // visible now — there is no toggle to hide it). Mirrors
        // 'exit-queue-focus' above.
        case 'exit-quickstart-focus':
          focus = 'runs';
          return true;

        // `a` on the highlighted QUICK START ticket (design.md Decision 5) —
        // `action.index` arrives UNRESOLVED (fleet.js's handleKey has no
        // access to the eligible ticket list, so it emits this
        // unconditionally whenever quickstart focus is active — see its own
        // header comment). This handler is therefore the one place that
        // actually resolves `index` to a ticket: re-derive the eligible list
        // fresh (not a value cached from a previous draw() — the highlighted
        // ticket may have started running by hand, or the list may simply
        // never have had anything eligible in it, in the interim) and no-op
        // (no state change) if `action.index` does not resolve to a real
        // entry in THAT list.
        case 'quickstart-add': {
          const eligible = quickStartEligible();
          const t = eligible[action.index];
          if (!t) return true; // nothing resolved — stale/empty/shrunk list
          const ticket = t.identifier;
          if (!queueState) {
            // No active queue: create one for this single ticket —
            // maxConcurrent: 1 (a lone ticket has no concurrency to speak
            // of, and keeps any LATER quickstart-add appended to this same
            // queue sequential unless the operator separately opens the
            // full launch pad), the same default `launchCommand` the plain
            // `n` prompt and restart already use.
            queueState = queue.createQueue([ticket], 1, launchCommand);
            queueSessionId = crypto.randomUUID();
          } else {
            // An active queue already exists (confirmed or not —
            // enqueueOne does not gate on `confirmed`; see its own header
            // comment) — append, preserving its own maxConcurrent/
            // launchCommand rather than starting a second, competing queue.
            queueState = queue.enqueueOne(queueState, ticket) || queueState;
          }
          // No direct submitTicket call here — the existing queue.tick()
          // call site at the top of draw() (already gated by
          // queue.shouldTick) performs the actual launch and persistence
          // write on the very next poll, unchanged, exactly as it already
          // does for a queue built via the full launch pad's 'confirm-launch'.
          return true;
        }

        // Clear Queue's own open/cancel/confirm trio — reachable from either
        // fleet.js or launchpad.js's identical CLEAR_QUEUE_KEY binding, both
        // routed here the same way force-start's are. 'open' just puts the
        // warning up (queue.js's clearPending() runs only once 'confirm'
        // actually arrives, matching every other y/anything-else gate in
        // this file).
        case 'open-clear-queue-confirm':
          clearQueueConfirm = true;
          return true;

        case 'cancel-clear-queue':
          clearQueueConfirm = false;
          return true;

        // Drops every still-pending ticket (queue.js's clearPending() —
        // never touches inFlight; a run already launched keeps running).
        // Mirrors the tick()/forceStart() call sites just above: write the
        // reduced queue back to queue-cache.js, or clear the cache file
        // entirely once nothing (pending or inFlight) is left to track.
        // `queueFocus`/`focus` are reset the same way confirm-force-start
        // resets them on success — the QUEUED section this cursor pointed
        // into may have just emptied out from under it.
        case 'confirm-clear-queue': {
          clearQueueConfirm = false;
          if (queueState) {
            queueState = queue.clearPending(queueState);
            if (queue.isIdle(queueState)) {
              queueState = null;
              queueCache.clear(root);
              queueSessionId = null;
            } else {
              queueCache.write(root, queueState, queueSessionId, Date.now());
            }
            focus = 'runs';
            queueFocus = null;
          }
          return true;
        }

        // See fleet.js's handleKey — issued instead of an immediate 'quit'
        // when the queue still has something pending/in flight. Puts the
        // warning on screen; the actual quit only happens on a repeated
        // q/Ctrl-C (which fleet.js turns into a real 'quit' action).
        case 'request-quit':
          quitConfirm = true;
          return true;

        case 'cancel-quit':
          quitConfirm = false;
          return true;

        case 'open-prompt':
          prompt = { value: '', error: null };
          return true;

        case 'cancel-prompt':
          // CON-21: a draft invocation in flight must be killed, not merely
          // abandoned in memory — otherwise the child process keeps running
          // to completion and, without the seq bump below, its late
          // resolution would still open the draft screen behind the human's
          // back after they had already cancelled.
          if (prompt && prompt.drafting) {
            if (draftCancel) draftCancel();
            draftCancel = null;
            draftSeq++;
          }
          prompt = null;
          return true;

        case 'prompt-backspace':
          prompt.value = prompt.value.slice(0, -1);
          return true;

        case 'prompt-type':
          // Stale error text from a previous failed submit must not linger
          // once the user starts correcting their input.
          prompt.value += action.char;
          prompt.error = null;
          return true;

        case 'submit-prompt': {
          // submitTicket validates the ticket shape before it ever reaches
          // session.spawn — see lib/ui/ticket.js for why that matters — then
          // attempts the spawn. Either way, a failure is reported on the
          // prompt and left open rather than taking the dashboard down.
          const result = submitTicket(action.value, launchCommand, session);
          if (result.spawned) prompt = null;
          else prompt.error = result.error;
          return true;
        }

        // CON-21, design.md: free text at the `n` prompt (anything
        // parseTicketInput rejects — see fleet.js's promptKey) reaches here
        // instead of an immediate submit. Gated on ticketProvider.kind,
        // matching the launch pad's own provider gate (linear.js's
        // launchPadStatus) — the draft flow is Linear-only for v1, and a
        // non-Linear provider is told so inline rather than the prompt
        // silently doing nothing.
        case 'open-ticket-draft': {
          const provider = (opts.config && opts.config.ticketProvider) || {};
          if (provider.kind !== 'linear') {
            if (prompt) {
              prompt.error = 'ticket drafting needs ticketProvider.kind "linear" — this project uses "' +
                (provider.kind || 'none') + '"';
            }
            return true;
          }
          if (!prompt) return true; // defensive — this action only ever fires from an open prompt

          prompt.drafting = true;
          prompt.error = null;
          const seed = action.seed;
          const seq = ++draftSeq;
          const handle = draftHelper.draftTicket(seed);
          draftCancel = handle.cancel;
          // Fire-and-forget, mirroring refreshLaunchPad's own discipline
          // just above: the 1-second poll timer picks up whichever of these
          // two settles first on its own, nothing here needs to force an
          // extra redraw. `seq` guards against a superseded draft (cancelled,
          // or a second one started before this one settled) still mutating
          // state after the fact.
          handle.promise.then((result) => {
            if (seq !== draftSeq) return;
            draftCancel = null;
            ticketDraft = {
              seed,
              title: result.title,
              description: result.description,
              acceptanceCriteria: result.acceptanceCriteria,
              field: null,
              error: null,
              creating: false,
            };
            prompt = null;
            mode = 'ticketdraft';
          }).catch((e) => {
            if (seq !== draftSeq) return;
            draftCancel = null;
            // A cancelled draft's own rejection is deliberately swallowed —
            // 'cancel-prompt' already bumped draftSeq (and nulled `prompt`
            // itself) BEFORE this ever runs, so `seq !== draftSeq` is what
            // actually distinguishes "human cancelled" from "drafting
            // genuinely failed" here; there is no separate cancelled flag to
            // check.
            if (prompt) {
              prompt.drafting = false;
              prompt.error = String((e && e.message) || e).split('\n')[0];
            }
          });
          return true;
        }

        // CON-21, design.md Decision 3: opens a field for editing, seeded
        // with its current value — mirrors escalation.js's 'open-reply'.
        // Deliberately does NOT clear a prior creation error the way
        // 'draft-field-type' (below) does — merely looking at a field is not
        // yet a correction, and a failed-creation error is exactly the
        // context a human opening a field to fix it needs to still see.
        case 'open-draft-field':
          if (ticketDraft) {
            ticketDraft.field = { name: action.field, value: String(ticketDraft[action.field] || '') };
          }
          return true;

        case 'draft-field-type':
          if (ticketDraft && ticketDraft.field) {
            ticketDraft.field.value += action.char;
            // Stale error text from a previous failed creation must not
            // linger once the human starts actually correcting something —
            // same discipline as 'prompt-type' clearing prompt.error.
            ticketDraft.error = null;
          }
          return true;

        case 'draft-field-backspace':
          if (ticketDraft && ticketDraft.field) ticketDraft.field.value = ticketDraft.field.value.slice(0, -1);
          return true;

        // Escape while editing a field SAVES it and returns to the overview
        // — unlike escalation.js's reply (a single ephemeral value that
        // Escape discards), each of these three fields is persistent and
        // independently re-editable, so there is nothing to "cancel" here
        // that isn't better served by the top-level 'cancel-draft' below.
        case 'commit-draft-field':
          if (ticketDraft && ticketDraft.field) {
            ticketDraft[ticketDraft.field.name] = ticketDraft.field.value;
            ticketDraft.field = null;
          }
          return true;

        // "Abandon without creating anything" — the ticket.md acceptance
        // criterion. No provider call has been made yet at any point before
        // this (creation only ever happens in 'confirm-draft', below), so
        // there is nothing to undo — clearing the in-memory draft and
        // returning to the fleet IS the whole of "zero side effects".
        case 'cancel-draft':
          ticketDraft = null;
          mode = 'fleet';
          return true;

        // design.md Decisions 1/5, tasks.md 5.1-5.4: composes the final
        // markdown body, creates the ticket via the one narrowly-scoped
        // Linear write this project makes, then launches the run against the
        // REAL provider-issued id through the existing, unmodified
        // submitTicket path (same {{TICKET}} substitution site as ever), and
        // finally refreshes the launch pad's cache so the new ticket is
        // visible there without a manual refresh. On failure the draft
        // screen stays open with the human's edited content intact and an
        // inline error — no run is ever launched off a failed creation.
        case 'confirm-draft': {
          const draft = ticketDraft;
          if (!draft || draft.creating || draft.field) return true;

          const team = linear.teamKeyFromConfig(opts.config || {}, process.env);
          if (!team.key) {
            draft.error = 'no ticketProvider.teamKey configured — see config-reference.md';
            return true;
          }

          draft.creating = true;
          draft.error = null;
          const apiKey = process.env.LINEAR_API_KEY;
          // design.md Decision 1: composed once, here, at confirm time —
          // never inside linear.js, which stays a thin transport layer with
          // no knowledge of ticket-body structure. Matches the same
          // "## Acceptance Criteria" heading convention the orchestrator's
          // own Setup phase writes into ticket.md.
          const body = draft.description + '\n\n## Acceptance Criteria\n' + draft.acceptanceCriteria;
          const seq = ++draftCreateSeq;

          linear.createTicket({ apiKey, teamKey: team.key, title: draft.title, description: body })
            .then((issue) => {
              if (seq !== draftCreateSeq) return;
              const result = submitTicket(issue.identifier, launchCommand, session);
              ticketDraft = null;
              mode = 'fleet';
              if (!result.spawned) {
                // No prompt is open at this point to carry the error on —
                // surfaced the same sticky-notice way queueNotice already
                // reports a queued launch that failed to spawn.
                queueNotice = 'created ' + issue.identifier + ' but could not start it: ' + result.error;
              }
              refreshLaunchPad();
            })
            .catch((e) => {
              if (seq !== draftCreateSeq) return;
              draft.creating = false;
              draft.error = 'could not create ticket: ' + String((e && e.message) || e).split('\n')[0];
            });
          return true;
        }

        case 'open-escalation': {
          mode = 'escalation';
          escalationTicket = action.ticket;
          escalationReply = null;
          escalationNotice = null;
          escalationContextScroll = 0;
          // design.md Decision 7: a multi-part escalation must not
          // unconditionally start the wizard at step 0 — a human can back
          // out and reopen the SAME still-live escalation after already
          // answering one or more steps, or the dashboard process itself can
          // restart mid-wizard. Read back any already-recorded sub-answers
          // and resume at the first `null` slot (or 0 when no file exists
          // yet — nothing answered). This is a read, not a second write
          // path — it changes nothing about how an answer is recorded, only
          // which step the wizard opens on.
          const openRun = runs.find((r) => r.ticket === action.ticket);
          if (openRun && openRun.escalation && Array.isArray(openRun.escalation.subQuestions)
              && openRun.escalation.subQuestions.length > 0) {
            const recorded = store.readSubAnswers(root, action.ticket);
            escalationSubIndex = escalationScreen.resumeSubIndex(
              recorded, openRun.escalation.subQuestions.length,
            );
          } else {
            escalationSubIndex = 0;
          }
          return true;
        }

        // Lazygit-layout pass: scrolls escalation.js's own context block —
        // upper-bound clamping to the block's real (possibly re-wrapped)
        // size happens lazily at render time (docview.windowBody's own
        // clampScroll), same discipline as every other panel scroll in this
        // file.
        case 'scroll-escalation-context':
          escalationContextScroll = Math.max(0, escalationContextScroll + action.delta);
          return true;

        case 'back':
          backToFleet();
          return true;

        case 'open-reply':
          escalationReply = { value: '', error: null };
          return true;

        case 'cancel-reply':
          escalationReply = null;
          return true;

        case 'reply-backspace':
          escalationReply.value = escalationReply.value.slice(0, -1);
          return true;

        case 'reply-type':
          escalationReply.value += action.char;
          escalationReply.error = null;
          return true;

        case 'submit-reply':
          answerEscalation(action.ticket, action.value);
          return true;

        case 'answer':
          answerEscalation(action.ticket, action.value);
          return true;

        case 'answer-sub':
          answerEscalationSub(action.ticket, action.index, action.value, action.total);
          return true;

        case 'open-drilldown':
          mode = 'drilldown';
          drillTicket = action.ticket;
          drillConfirm = null;
          drillNotice = null;
          // Each fresh drill-down (even re-entering the same run) starts
          // focused on TICKET (the first panel), scrolled to the top of
          // every panel — mirrors drillConfirm/drillNotice's own reset just
          // above.
          drillFocus = 'ticket';
          drillEvidenceIndex = 0;
          drillTicketScroll = 0;
          drillTimelineScroll = 0;
          drillGatesScroll = 0;
          return true;

        case 'confirm-action':
          drillConfirm = action.action;
          return true;

        case 'cancel-confirm':
          drillConfirm = null;
          return true;

        // --- CON-19: evidence panel focus/selection, and the doc reader ---

        case 'switch-drill-focus':
          drillFocus = action.focus;
          return true;

        case 'move-drill-evidence': {
          const run = runs.find((r) => r.ticket === drillTicket);
          const items = run ? drilldownScreen.evidenceItems(run) : [];
          drillEvidenceIndex = Math.max(0, Math.min(drillEvidenceIndex + action.delta, Math.max(0, items.length - 1)));
          return true;
        }

        // Lazygit-layout pass: TICKET/TIMELINE/GATES each scroll
        // independently via their own offset — upper-bound clamping to the
        // panel's real (possibly-shrunk) content happens lazily at render
        // time (docview.windowBody's own clampScroll, called from
        // drilldown.js), the same "never trust a value from a previous
        // draw()" discipline drillEvidenceIndex's own clamp above already
        // follows in spirit, just deferred to the read side instead of the
        // write side here.
        case 'drill-panel-scroll': {
          if (action.panel === 'ticket') {
            drillTicketScroll = Math.max(0, drillTicketScroll + action.delta);
          } else if (action.panel === 'timeline') {
            // TIMELINE is a log-tail (drilldown.js's own comment on
            // `timelineScroll`): it defaults to showing the most RECENT
            // entries, unlike TICKET/GATES' top-anchored offset — so the
            // raw up/down delta (negative = "up", toward earlier content)
            // is inverted here: pressing up must INCREASE how far back from
            // the tail we've scrolled, not decrease a top-anchored offset.
            drillTimelineScroll = Math.max(0, drillTimelineScroll - action.delta);
          } else if (action.panel === 'gates') {
            drillGatesScroll = Math.max(0, drillGatesScroll + action.delta);
          }
          return true;
        }

        // Reads the entry's persisted ref synchronously (try/catch,
        // mirroring ticket-text.js#resolve's existing pattern) at the point
        // this action fires — not inside any screen's pure render path (see
        // design.md Decision 4). A missing/unreadable file degrades to an
        // explicit "file not found" body rather than blocking the open or
        // throwing (design.md Decision 5) — pressing ↵ on a selected entry
        // always transitions to the doc-reader mode.
        case 'open-evidence-doc': {
          let content = null;
          try {
            content = fs.readFileSync(action.ref, 'utf8');
          } catch (e) { content = null; }
          const cols = process.stdout.columns || 80;
          const innerWidth = Math.max(20, cols - DOC_BOX_BORDER_PADDING_COLS);
          docBody = content != null
            ? textwrap.wrap(markdown.toPlainText(content), innerWidth)
            : [format.yellow('file not found: ' + action.ref)];
          // icons.evidence is prefixed here, at the caller, rather than
          // inside docview.js's generic renderDocView — docview.js's own
          // spec ("docview's exports are generic and reusable") forbids
          // either of its exports from referencing caller-specific concepts
          // like "evidence" (see docview.js's own header comment). Prefixing
          // here still lands the icon inside renderDocView's existing
          // `f.truncate(title, cols)` budget, since the icon is now part of
          // the title string renderDocView receives and truncates as a whole.
          docTitle = icons.evidence + ' ' + (action.label || action.ref || '(untitled)');
          docScroll = 0;
          mode = 'docview';
          return true;
        }

        // CON-55 (design.md Decision 3/4): a `pr`-kind evidence entry opens
        // externally (the OS default browser) rather than transitioning into
        // `docview` — `openInBrowser()` is the one child-process call this
        // adds, called here (not inside any screen's pure render path) and
        // wrapped in try/catch so a missing/failing `xdg-open` degrades to a
        // visible `drillNotice` instead of crashing the TUI. `mode` is left
        // untouched on both success and failure — unlike 'open-evidence-doc',
        // this action never transitions the dashboard into another screen.
        case 'open-external-url': {
          try {
            openInBrowser(action.url);
            drillNotice = null;
          } catch (e) {
            drillNotice = 'could not open ' + action.url + ' in a browser: ' + e.message;
          }
          return true;
        }

        case 'doc-scroll':
          docScroll = Math.max(0, action.offset);
          return true;

        // Fired only from mode = 'docview' — i.e. only ever the evidence
        // reader (design.md Decision 3a: ticketview.js's own esc dispatches
        // 'back-to-launchpad' directly and never reaches this handler).
        // drillFocus/drillEvidenceIndex are left untouched, so the same
        // entry is still selected on return.
        case 'back-to-drilldown-from-doc':
          mode = 'drilldown';
          docTitle = null;
          docBody = null;
          docScroll = 0;
          return true;

        case 'ticketview-scroll':
          ticketviewScroll = Math.max(0, action.offset);
          return true;

        // Process actions — go straight to tmux, no agent cooperation needed,
        // so they work even on a run with zero telemetry (see the design
        // doc's "Control plane" section). Once killed, the window dies and
        // the next poll's reducer pass reports the run as failed on its own —
        // this handler does not need to fake that transition itself.
        //
        // Both cases delegate to control.js, which re-derives the run from
        // the current `runs` (this poll's latest observation, not a stale
        // snapshot from when the confirmation opened) and refuses to act at
        // all once it is no longer live — the second of two independent
        // liveness checks (drilldown.js's handleKey is the first). Restart
        // additionally refuses before killing anything when the ticket isn't
        // spawnable, so a window the dashboard never spawned (adopted on
        // startup, fails TICKET_RE) is never destroyed without a replacement
        // being possible.
        case 'kill-confirmed':
          control.killConfirmed(action.ticket, runs, session);
          drillConfirm = null;
          drillNotice = null;
          return true;

        // Restart reuses submitTicket — the exact path the `n` prompt uses,
        // template substitution included — rather than re-deriving the launch
        // command here. A failed respawn is reported on screen, not swallowed.
        case 'restart-confirmed': {
          const result = control.restartConfirmed(action.ticket, runs, session, launchCommand, submitTicket);
          drillConfirm = null;
          drillNotice = result.spawned ? null : result.error;
          return true;
        }

        case 'attach':
          doAttach(action.ticket);
          return true;

        // --- cross-screen escalation banner (CON-25) ----------------------
        // Its own action namespace — see banner.js's own header comment for
        // why these must never collide with escalation.js's bare
        // reply-type/submit-reply/... verbs above.

        case 'banner-open-reply':
          globalEscalationTicket = action.ticket;
          globalEscalationReply = { value: '', error: null };
          return true;

        case 'banner-reply-backspace':
          globalEscalationReply.value = globalEscalationReply.value.slice(0, -1);
          return true;

        case 'banner-reply-type':
          globalEscalationReply.value += action.char;
          globalEscalationReply.error = null;
          return true;

        // No backToFleet() here, unlike 'cancel-reply' — cancelling the
        // banner's reply box must leave `mode` and every other screen's
        // state exactly as it was (design.md Decision 6).
        case 'banner-cancel-reply':
          globalEscalationReply = null;
          globalEscalationTicket = null;
          return true;

        case 'banner-submit-reply':
          answerBannerEscalation(action.ticket, action.value);
          return true;

        // --- launch pad --------------------------------------------------

        case 'open-launchpad':
          openLaunchPad();
          return true;

        case 'move-launchpad': {
          const lp = launchPad;
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
          if (launchPad) launchPad.pane = action.pane;
          return true;

        // A ticket the launch pad is already showing as `▲ running` may be
        // DEselected (clearing a stale selection someone made before it went
        // live is harmless) but never selected in the first place — see
        // launchpad.js's isSelectable for the tmux-addressing failure this
        // prevents. This is layer one of two (queue.tick is layer two).
        case 'toggle-select': {
          const lp = launchPad;
          if (!lp) return true;
          const t = launchpadScreen.ticketsForEpic(lp)[lp.ticketIndex];
          if (t) {
            if (lp.selected.has(t.identifier)) lp.selected.delete(t.identifier);
            else if (launchpadScreen.isSelectable(t, runs, queueState)) lp.selected.add(t.identifier);
          }
          return true;
        }

        case 'select-all': {
          const lp = launchPad;
          if (!lp) return true;
          for (const id of launchpadScreen.selectableIdentifiers(launchpadScreen.ticketsForEpic(lp), runs, queueState)) {
            lp.selected.add(id);
          }
          return true;
        }

        // 'q' on the tickets pane (CON-41, design.md Decision 3) — queues
        // only the currently-highlighted ticket, mirroring 'quickstart-add'
        // above exactly: resolve the target fresh from current state (never
        // a value cached from a previous draw()), no-op if it doesn't
        // resolve or isn't currently selectable (covers both "already
        // running" and "already queued" — the same isSelectable refusal
        // 'toggle-select'/'select-all' above re-check), and hand the queue
        // primitives the ticket's IDENTIFIER STRING, never the ticket object
        // — queue.js's pending/inFlight collections are identifier-string
        // collections throughout (inlineStatus's and isSelectable's own
        // queueState.pending/inFlight membership checks are keyed on
        // ticket.identifier; a queue entry holding a ticket object instead
        // would silently stop matching them).
        case 'add-to-queue': {
          const lp = launchPad;
          if (!lp) return true;
          const t = launchpadScreen.currentTicket(lp);
          if (!t || !launchpadScreen.isSelectable(t, runs, queueState)) return true;
          const id = t.identifier;
          if (!queueState) {
            queueState = queue.createQueue([id], 1, launchCommand);
            queueSessionId = crypto.randomUUID();
          } else {
            queueState = queue.enqueueOne(queueState, id) || queueState;
          }
          // No direct submitTicket call here — the existing queue.tick()
          // call site at the top of draw() (already gated by
          // queue.shouldTick) performs the actual launch and persistence
          // write on the very next poll, unchanged, exactly as it already
          // does for 'quickstart-add' and 'confirm-launch'.
          return true;
        }

        case 'set-mode':
          if (launchPad) launchPad.mode = action.mode;
          return true;

        // The P key (launchpad.js's handleKey) only describes the keypress —
        // this is the one place it actually takes effect. Without this case
        // the action would fall through to `default:` below and be silently
        // dropped, exactly as design.md Decision 3 calls out.
        case 'toggle-ticket-sort':
          if (launchPad) launchPad.ticketSort = launchPad.ticketSort === 'priority' ? 'identifier' : 'priority';
          return true;

        case 'refresh-launchpad':
          refreshLaunchPad(); // fire-and-forget; see its own comment
          return true;

        case 'open-ticketview': {
          const lp = launchPad;
          if (!lp) return true;
          const t = launchpadScreen.ticketsForEpic(lp)[lp.ticketIndex];
          if (t) {
            lp.viewingTicket = t.identifier;
            ticketviewReturnMode = 'launchpad';
            mode = 'ticketview';
          }
          return true;
        }

        // CON-54: opens the ticket detail view for a QUEUED or RUNNING/DONE
        // fleet row — fleet.js's handleKey already resolved `action.ticket`
        // to a real identifier (queueState.pending[queueFocus] or
        // runs[selected].ticket, both already live in `state`), so this
        // handler only has to make sure `launchPad.cache` exists for
        // ticketview.js's own findTicket() to search (ensureLaunchPad(),
        // design.md Decision 4) and route into 'ticketview' WITHOUT also
        // switching to 'launchpad' — the one thing ensureLaunchPad() buys
        // over the pre-existing openLaunchPad().
        case 'view-ticket': {
          if (!action.ticket) return true;
          ensureLaunchPad();
          launchPad.viewingTicket = action.ticket;
          ticketviewReturnMode = 'fleet';
          mode = 'ticketview';
          return true;
        }

        // CON-54: QUICK START's own version of 'view-ticket' — `action.index`
        // arrives UNRESOLVED (fleet.js's handleKey has no access to the
        // eligible ticket list — see its own header comment), so this is the
        // one place that resolves it, re-deriving quickStartEligible() FRESH
        // (never a value cached from a previous draw()), mirroring
        // 'quickstart-add' above exactly, including its no-op-if-nothing-
        // resolves branch.
        case 'view-ticket-quickstart': {
          const eligible = quickStartEligible();
          const t = eligible[action.index];
          if (!t) return true; // nothing resolved — stale/empty/shrunk list
          ensureLaunchPad();
          launchPad.viewingTicket = t.identifier;
          ticketviewReturnMode = 'fleet';
          mode = 'ticketview';
          return true;
        }

        // CON-54, design.md Decision 5: origin-aware — 'fleet' (set by the
        // three entry points above) returns to the fleet view; anything else
        // (including the pre-existing `null` default, so a mid-session
        // process upgrade degrades safely) falls back to the existing
        // backToLaunchPad() behavior, unchanged. Either branch resets
        // ticketviewReturnMode so a later, unrelated visit can never inherit
        // a stale destination.
        case 'back-to-launchpad':
          if (ticketviewReturnMode === 'fleet') {
            backToFleet();
          } else {
            backToLaunchPad();
          }
          ticketviewReturnMode = null;
          return true;

        // The confirm gate. Ports, base commit and the ordered ticket list
        // are all computed HERE, once, from the current config/cache/git
        // state — the plan screen itself stays pure and just renders this
        // snapshot (see launchplan.js's own header comment on why ports can
        // be shown with nothing run yet).
        case 'open-launchplan': {
          const lp = launchPad;
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
            .filter((t) => launchpadScreen.isSelectable(t, runs, queueState));
          if (!tickets.length) return true;

          const configuredHarnesses = (Array.isArray(opts.config && opts.config.harnesses) && opts.config.harnesses.length)
            ? opts.config.harnesses.map((h) => (h === 'claude-code' ? 'claude' : h))
            : ['claude'];
          // A launchCommand override has no per-harness variants to cycle
          // through — the actual command is pinned regardless of which
          // harness label is showing (see cycle-harness below, which only
          // ever touches plan.launchCommand when there is NO override).
          // Pinning `harnesses` itself down to the one actually in effect,
          // right here, is what makes 'h' correctly refuse itself in BOTH
          // places that need to agree — cycle-harness's own `length < 2`
          // guard and launchplan.js's footer hint (`harnesses.length > 1`)
          // — from a single source of truth, rather than adding a second,
          // easy-to-forget override check inside cycle-harness alone.
          const harnesses = cfg.launchCommand ? [configuredHarnesses[0]] : configuredHarnesses;
          const seqMode = lp.mode === 'sequential';
          const concurrency = seqMode ? 1 : Math.max(1, cfg.maxConcurrent || 2);

          // Seeded from the config default, mirroring how `harness` seeds
          // from `config.harnesses` just above — resolved once, here, then
          // editable via 'm' exactly like harness is via 'h'. Disabled
          // (agentMergeEditable = false) under the identical condition that
          // disables harness-cycling: a custom launchCommand override has no
          // flag slot to safely rewrite (see launchplan.js's own comment).
          const agentMerge = !!(opts.config && opts.config.agentMerge && opts.config.agentMerge.enabled);
          const agentMergeEditable = !cfg.launchCommand;

          let commitSha = null;
          try {
            // `stdio: ['ignore','pipe','ignore']` is deliberate, not
            // decoration: execFileSync's default stdio inherits the CHILD's
            // stderr straight onto this process's own stderr even when the
            // call throws and is caught here — verified by running it
            // against a non-repo directory. Silently degrading to "no commit
            // shown" must not mean leaking `fatal: not a git repository...`
            // onto the terminal underneath a screen that is otherwise pure.
            commitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'],
              { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          } catch (e) { /* not a git repo, or no commits yet — render without it */ }

          // CON-22: seeded to 'default' (every project has at least this one
          // speed to cycle away from — see launchplan.js's unconditional 's'
          // hint), resolved once here for the pre-flight models preview.
          // `canonicalHarness()` is required — `harnesses[0]` is the
          // CLI-binary label ('claude'), never the canonical id
          // resolve-speed.sh's own `$2` expects.
          const speed = 'default';
          const resolvedModels = resolveModelsForPlan(root, speed, canonicalHarness(harnesses[0]));

          launchPlan = {
            tickets,
            mode: lp.mode,
            concurrency,
            harness: harnesses[0],
            harnesses,
            baseBranch: (opts.config && opts.config.project && opts.config.project.baseBranch) || 'main',
            commitSha,
            worktreeBase: (opts.config && opts.config.worktree && opts.config.worktree.base) || '.concertino/worktrees',
            agentMerge,
            agentMergeEditable,
            speed,
            resolvedModels,
            // A custom launchCommand override has no per-harness variants to
            // cycle through — 'h' is simply not offered in that case (see
            // launchplan.js's handleKey, gated on harnesses.length > 1) — and
            // likewise no agent-merge flag slot to bake in or rewrite ('m' is
            // gated on agentMergeEditable the same way).
            launchCommand: cfg.launchCommand || launchplanScreen.withAgentMergeFlag(
              harnesses[0] + ' "/concertino-deliver {{TICKET}}"', agentMerge),
            portsCfg: (opts.config && opts.config.worktree && opts.config.worktree.ports) || {},
            // Defaults to true (unchanged pre-existing behaviour: confirming
            // launches up to `concurrency` tickets immediately) — 'n' toggles
            // it on the launch plan screen; see 'confirm-launch' below for
            // what false actually does.
            startNow: true,
          };
          launchPlanTicketScroll = 0;
          mode = 'launchplan';
          return true;
        }

        case 'cancel-launchplan':
          backToLaunchPad();
          return true;

        // Lazygit-layout pass: scrolls launchplan.js's own ticket-list box —
        // upper-bound clamping to the batch's real (possibly re-filtered)
        // size happens lazily at render time (docview.windowBody's own
        // clampScroll), same discipline as drill-down's panel scrolls.
        case 'scroll-launchplan-tickets':
          launchPlanTicketScroll = Math.max(0, launchPlanTicketScroll + action.delta);
          return true;

        case 'cycle-concurrency':
          if (launchPlan) launchPlan.concurrency = launchplanScreen.cycleConcurrency(launchPlan.concurrency);
          return true;

        // launchplan.js's own 'n' — flips whether 'confirm-launch' (below)
        // builds a queue that starts admitting immediately or one that sits
        // paused until the operator's own separate confirm on the fleet view.
        case 'toggle-start-now':
          if (launchPlan) launchPlan.startNow = launchPlan.startNow === false;
          return true;

        case 'cycle-harness': {
          const plan = launchPlan;
          if (!plan || !plan.harnesses || plan.harnesses.length < 2) return true;
          const idx = plan.harnesses.indexOf(plan.harness);
          plan.harness = plan.harnesses[(idx + 1) % plan.harnesses.length];
          // Re-applies (rather than drops) any agent-merge flag already
          // toggled onto this plan — cycling harness must not silently
          // revert an 'm' toggle made earlier in the same session.
          if (!cfg.launchCommand) {
            plan.launchCommand = launchplanScreen.withSpeedFlag(
              launchplanScreen.withAgentMergeFlag(
                plan.harness + ' "/concertino-deliver {{TICKET}}"', plan.agentMerge),
              plan.speed);
          }
          // CON-22: a models preview is per-(speed, harness) — a harness
          // cycle must invalidate the PREVIOUS harness's stale preview the
          // same way it already refreshes plan.launchCommand above, or
          // switching from claude-code to codex would keep showing
          // claude-code's models under the codex label.
          plan.resolvedModels = resolveModelsForPlan(root, plan.speed, canonicalHarness(plan.harness));
          return true;
        }

        case 'cycle-agent-merge': {
          const plan = launchPlan;
          if (!plan || !plan.agentMergeEditable) return true;
          plan.agentMerge = !plan.agentMerge;
          plan.launchCommand = launchplanScreen.withAgentMergeFlag(plan.launchCommand, plan.agentMerge);
          return true;
        }

        // CON-22: cycles the batch's speed default -> fast -> slow -> default
        // (mirroring cycle-agent-merge's own toggle shape), refreshes the
        // models preview for the (new speed, CURRENT harness) pair, and
        // re-applies withSpeedFlag to the launch command — same "re-apply,
        // don't drop" discipline cycle-harness above already gives the
        // agent-merge flag.
        case 'cycle-speed': {
          const plan = launchPlan;
          if (!plan) return true;
          const ORDER = ['default', 'fast', 'slow'];
          const idx = ORDER.indexOf(plan.speed);
          plan.speed = ORDER[(idx + 1) % ORDER.length];
          plan.launchCommand = launchplanScreen.withSpeedFlag(plan.launchCommand, plan.speed);
          plan.resolvedModels = resolveModelsForPlan(root, plan.speed, canonicalHarness(plan.harness));
          return true;
        }

        // Builds the queue and hands off to it — see queue.js and the
        // `queueState` comment above for how the queue is persisted
        // (CON-29). The first tick (which actually launches up to
        // `concurrency` tickets through submitTicket) happens in draw(),
        // called right after this returns true — not here — so there is
        // exactly one place in the whole file that calls queue.tick().
        // UNLESS `plan.startNow === false`: createQueue's `confirmed: false`
        // makes shouldTick() refuse that very first tick (and every one
        // after, until the operator's own confirm), so a held batch reaches
        // draw() but admits nothing.
        case 'confirm-launch': {
          const plan = launchPlan;
          if (!plan || !plan.tickets.length) return true;
          // Third and final refusal before anything reaches queue.tick:
          // the launch plan can sit on screen across many poll cycles while
          // a human reads it (same reasoning as drilldown.js's own re-check
          // on 'y') — a ticket selected and planned minutes ago can be live
          // by the time Enter is actually pressed. queue.tick (queue.js)
          // would drop it anyway on its very first tick, but filtering here
          // means it is never even reported as "dropped" — the confirm
          // screen itself is the more honest place to have refused it.
          const startable = plan.tickets.filter((t) => launchpadScreen.isSelectable(t, runs, queueState));
          const skipped = plan.tickets.filter((t) => !launchpadScreen.isSelectable(t, runs, queueState));
          if (startable.length) {
            queueState = queue.createQueue(
              startable.map((t) => t.identifier),
              plan.concurrency,
              plan.launchCommand,
              plan.startNow,
            );
            // Minted once per createQueue() call (design.md Decision 2) —
            // this queue's identity for as long as it lives, threaded
            // through every queueCache.write() call at the tick site above.
            queueSessionId = crypto.randomUUID();
          }
          queueNotice = skipped.length
            ? 'already running, skipped: ' + skipped.map((t) => t.identifier).join(', ')
            : null;
          launchPlan = null;
          launchPlanTicketScroll = 0;
          if (launchPad) launchPad.selected = new Set();
          mode = 'fleet';
          return true;
        }

        // CON-29: a queue restored from a previous session sits paused
        // (`confirmed: false`, see the `queueState` comment above) until
        // the operator presses the key fleet.js's QUEUED-section affordance
        // names — this is that keypress's handler. Flips exactly one field;
        // pending/inFlight are untouched, so the very next poll's tick()
        // call (now unblocked by shouldTick()) proceeds against exactly
        // the reconciled contents the operator was shown, no more and no
        // less. Gated defensively even though fleet.js's own handleKey
        // already only emits this action when a restored-and-unconfirmed
        // queue is on screen.
        case 'confirm-restored-queue':
          if (queueState && queueState.confirmed === false) queueState.confirmed = true;
          return true;

        // --- CON-57: settings screen -------------------------------------

        case 'open-settings':
          openSettings();
          return true;

        case 'settings-move-section': {
          if (!settings) return true;
          const len = settings.sections.length;
          settings.sectionIndex = Math.max(0, Math.min(settings.sectionIndex + action.delta, len - 1));
          settings.fieldIndex = 0;
          settings.saveError = null;
          return true;
        }

        case 'settings-move-field': {
          if (!settings) return true;
          const section = settings.sections[settings.sectionIndex];
          const fields = settingsScreen.fieldsForSection(settings.fieldMeta, section);
          if (!fields.length) return true;
          settings.fieldIndex = Math.max(0, Math.min(settings.fieldIndex + action.delta, fields.length - 1));
          settings.saveError = null;
          return true;
        }

        case 'settings-focus-fields':
          if (settings) settings.focus = 'fields';
          return true;

        case 'settings-focus-sections':
          if (settings) settings.focus = 'sections';
          return true;

        // Enter/Space on a boolean field (design.md Decision 5) — flips the
        // staged value directly, no text prompt. Reads the CURRENT value the
        // same way the field pane displays it (candidate, falling back to
        // the schema default) so toggling a still-unset field starts from
        // what is actually on screen, not from `undefined`.
        case 'settings-toggle-field': {
          if (!settings) return true;
          const entry = settings.fieldMeta.get(action.path);
          if (!entry) return true;
          const { value } = settingsScreen.currentValue(settings.candidate, entry);
          configLib.deepSet(settings.candidate, action.path, !value);
          settings.saveError = null;
          return true;
        }

        // Enter/Space on an enum field — cycles to the next allowed value,
        // wrapping back to the first after the last (spec.md's own
        // scenario) — never free text, so an edit here can never produce a
        // value outside the enum.
        case 'settings-cycle-field': {
          if (!settings) return true;
          const entry = settings.fieldMeta.get(action.path);
          if (!entry || !entry.enum || !entry.enum.length) return true;
          const { value } = settingsScreen.currentValue(settings.candidate, entry);
          const idx = entry.enum.indexOf(value);
          const next = entry.enum[(idx + 1 + entry.enum.length) % entry.enum.length];
          configLib.deepSet(settings.candidate, action.path, next);
          settings.saveError = null;
          return true;
        }

        // Enter on a string/number/integer field with no enum — opens the
        // single-line text prompt, seeded with the field's CURRENT value
        // (design.md Decision 5 — unlike fleet.js's own `n` prompt, which
        // always starts empty).
        case 'settings-open-field-prompt': {
          if (!settings) return true;
          const entry = settings.fieldMeta.get(action.path);
          if (!entry) return true;
          const { value } = settingsScreen.currentValue(settings.candidate, entry);
          settings.prompt = { path: action.path, value: value != null ? String(value) : '', error: null };
          return true;
        }

        case 'settings-prompt-type':
          if (settings && settings.prompt) {
            settings.prompt.value += action.char;
            settings.prompt.error = null;
          }
          return true;

        case 'settings-prompt-backspace':
          if (settings && settings.prompt) settings.prompt.value = settings.prompt.value.slice(0, -1);
          return true;

        // Escape while a field's edit prompt is open — cancels just that
        // field's in-progress edit, returning to the field list with the
        // value unchanged (spec.md's own scenario); does NOT leave the
        // settings screen (that is the bare-Escape 'back' case, only
        // reachable when no prompt is open — see settings.js's handleKey).
        case 'settings-cancel-prompt':
          if (settings) settings.prompt = null;
          return true;

        // Commits the typed text into the in-memory candidate at the
        // field's dotted path, coercing to number/integer via the same
        // coerce() helper `concertino update` already uses (design.md
        // Decision 5) — "5" typed for an integer field becomes `5`, not
        // "5". Validation happens once, on save, against the whole
        // candidate (Decision 5's own reasoning) — not here.
        case 'settings-commit-prompt': {
          if (!settings || !settings.prompt) return true;
          const entry = settings.fieldMeta.get(settings.prompt.path);
          const typed = settings.prompt.value;
          const value = entry && (entry.type === 'integer' || entry.type === 'number') ? configLib.coerce(typed) : typed;
          configLib.deepSet(settings.candidate, settings.prompt.path, value);
          settings.prompt = null;
          settings.saveError = null;
          return true;
        }

        // Capital S — validates the full in-memory candidate (the raw
        // on-disk shape plus every staged edit, NOT the withDefaults()-
        // expanded object) via the SAME collectConfigIssues `concertino
        // validate` itself runs (design.md Decision 2/6). On success, writes
        // it to disk (identical serialization to cmdUpdate's own write) and
        // returns to the fleet; on failure, shows the specific error(s)
        // inline and keeps the screen open with the invalid edits still
        // staged (spec.md's "An invalid edit is rejected, not written").
        case 'settings-save': {
          if (!settings) return true;
          const { errors } = configLib.collectConfigIssues(settings.candidate, { out: root });
          if (errors.length) {
            settings.saveError = errors.map((e) => e.path + ': ' + e.message);
            return true;
          }
          fs.writeFileSync(settings.cfgPath, JSON.stringify(settings.candidate, null, 2) + '\n');
          backToFleet();
          return true;
        }

        default:
          return false;
      }
    }

    function onKey(key) {
      // The banner's reply box (CON-25), when open, owns every keystroke —
      // the same "reply box owns every keystroke while open" precedence
      // escalation.js already gives its own reply box locally, just applied
      // one level higher, BEFORE router.handleKey is ever called at all
      // (design.md Decision 6 / tasks.md task 6.5).
      if (globalEscalationReply) {
        const action = bannerScreen.handleKey(key, {
          reply: globalEscalationReply, ticket: globalEscalationTicket,
        });
        if (applyAction(action)) runs = draw();
        return;
      }
      // The reserved key opens the banner's reply box for the oldest live
      // escalation — but only when no screen-local reply/prompt already owns
      // the keyboard, so 'g' typed into the `n` prompt, a reply already open
      // on the dedicated escalation screen, or a drilldown kill/restart
      // confirmation still does what it always did.
      if (key === bannerScreen.RESERVED_KEY && liveEscalations.length &&
          !prompt && !escalationReply && !drillConfirm) {
        if (applyAction({ type: 'banner-open-reply', ticket: liveEscalations[0].ticket })) runs = draw();
        return;
      }

      const action = router.handleKey(key, currentState());
      if (action && action.type === 'quit') { quit(); return; }
      if (applyAction(action)) runs = draw();
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
// CON-22, CON-55) — watch() itself runs an interval loop against real
// stdin/stdout, so the pure logic is what gets unit tests; watch()'s own
// runtime behavior is unchanged and still covered end to end by
// test/scripts/watch-smoke.test.sh.
module.exports = {
  watch, buildFrame, attachAndRestore, computeLiveEscalations, idleMsFromActivity,
  canonicalHarness, resolveModelsForPlan, openInBrowser,
  CURSOR_HOME, ALT_SCREEN_ENTER, ALT_SCREEN_EXIT, CURSOR_HIDE, CURSOR_SHOW,
};
