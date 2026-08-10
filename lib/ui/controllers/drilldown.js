'use strict';

// Drill-down actions: opening a run's detail screen, the five-panel focus
// model and its scrolls (CON-104 added the CHANGES panel as the fifth), the
// evidence reader/diff reader (docview) round trips, external URL opens
// (CON-55), and the kill/restart confirmation gates. Dispatched from
// watch.js's applyAction — see controllers/index.js for the shared contract.
//
// `control` arrives via ctx.deps (watch.js requires it, so require-cache
// fakes flow); `openInBrowser`/`doAttach` arrive via ctx because they touch
// the process/terminal. Screen modules and text helpers are pure requires.

const fs = require('fs');
const drilldownScreen = require('../screens/drilldown');
const launchplanScreen = require('../screens/launchplan');
const harnessCmd = require('../harness');
const markdown = require('../markdown');
const textwrap = require('../textwrap');
const format = require('../format');
const icons = require('../icons');
// CON-104: the CHANGES panel's own `git diff -- <file>` read — see
// lib/ui/git-diff.js's own header comment for why this shells out from
// here (a controller-level seam) rather than from any pure render path.
const gitDiff = require('../git-diff');
const { sectionHeader } = require('../widgets/header');

// Every box costs 2 columns to its border characters and 2 more to box()'s
// default horizontal padding — see fleet.js/drilldown.js/ticketview.js's
// identical constant. Used here only to size the evidence reader's own
// word-wrap width from the terminal's column count (task 4.3).
const DOC_BOX_BORDER_PADDING_COLS = 4;

function handle(action, ctx) {
  const S = ctx.S;
  switch (action.type) {
    case 'open-drilldown':
      S.mode = 'drilldown';
      S.drillTicket = action.ticket;
      S.drillConfirm = null;
      S.drillNotice = null;
      // Each fresh drill-down (even re-entering the same run) starts focused
      // on TICKET (the first panel), scrolled to the top of every panel —
      // mirrors drillConfirm/drillNotice's own reset just above.
      S.drillFocus = 'ticket';
      S.drillEvidenceIndex = 0;
      S.drillTicketScroll = 0;
      S.drillTimelineScroll = 0;
      S.drillGatesScroll = 0;
      // CON-104: reset alongside the rest of the drill-down's own scoped
      // state — a fresh drill-down (even re-entering the same run) starts
      // with no CHANGES selection and no stale diff data from whatever run
      // was last viewed; watch.js's draw() recomputes S.drillDiffStat fresh
      // on the very next poll tick.
      S.drillChangesIndex = 0;
      S.drillDiffStat = null;
      return true;

    case 'confirm-action':
      S.drillConfirm = action.action;
      return true;

    case 'cancel-confirm':
      S.drillConfirm = null;
      return true;

    // --- CON-19: evidence panel focus/selection, and the doc reader ---

    case 'switch-drill-focus':
      S.drillFocus = action.focus;
      return true;

    case 'move-drill-evidence': {
      const run = S.runs.find((r) => r.ticket === S.drillTicket);
      const items = run ? drilldownScreen.evidenceItems(run) : [];
      S.drillEvidenceIndex = Math.max(0, Math.min(S.drillEvidenceIndex + action.delta, Math.max(0, items.length - 1)));
      return true;
    }

    // CON-104: mirrors move-drill-evidence above exactly, for the CHANGES
    // panel's own diff-stat selection — clamped against S.drillDiffStat
    // (watch.js's draw() keeps this fresh every poll while the drill-down is
    // open), never against a snapshot taken when CHANGES was first focused.
    case 'move-drill-changes': {
      const files = drilldownScreen.changesItems(S.drillDiffStat);
      S.drillChangesIndex = Math.max(0, Math.min(S.drillChangesIndex + action.delta, Math.max(0, files.length - 1)));
      return true;
    }

    // Lazygit-layout pass: TICKET/TIMELINE/GATES each scroll independently
    // via their own offset — upper-bound clamping to the panel's real
    // (possibly-shrunk) content happens lazily at render time
    // (docview.windowBody's own clampScroll, called from drilldown.js), the
    // same "never trust a value from a previous draw()" discipline
    // drillEvidenceIndex's own clamp above already follows in spirit, just
    // deferred to the read side instead of the write side here.
    case 'drill-panel-scroll': {
      if (action.panel === 'ticket') {
        S.drillTicketScroll = Math.max(0, S.drillTicketScroll + action.delta);
      } else if (action.panel === 'timeline') {
        // TIMELINE is a log-tail (drilldown.js's own comment on
        // `timelineScroll`): it defaults to showing the most RECENT entries,
        // unlike TICKET/GATES' top-anchored offset — so the raw up/down
        // delta (negative = "up", toward earlier content) is inverted here:
        // pressing up must INCREASE how far back from the tail we've
        // scrolled, not decrease a top-anchored offset.
        S.drillTimelineScroll = Math.max(0, S.drillTimelineScroll - action.delta);
      } else if (action.panel === 'gates') {
        S.drillGatesScroll = Math.max(0, S.drillGatesScroll + action.delta);
      }
      return true;
    }

    // Reads the entry's persisted ref synchronously (try/catch, mirroring
    // ticket-text.js#resolve's existing pattern) at the point this action
    // fires — not inside any screen's pure render path (see design.md
    // Decision 4). A missing/unreadable file degrades to an explicit "file
    // not found" body rather than blocking the open or throwing (design.md
    // Decision 5) — pressing ↵ on a selected entry always transitions to the
    // doc-reader mode.
    case 'open-evidence-doc': {
      let content = null;
      try {
        content = fs.readFileSync(action.ref, 'utf8');
      } catch (e) { content = null; }
      const cols = process.stdout.columns || 80;
      const innerWidth = Math.max(20, cols - DOC_BOX_BORDER_PADDING_COLS);
      S.docBody = content != null
        ? textwrap.wrap(markdown.toPlainText(content), innerWidth)
        : [format.yellow('file not found: ' + action.ref)];
      // icons.evidence is prefixed here, at the caller, rather than inside
      // docview.js's generic renderDocView — docview.js's own spec
      // ("docview's exports are generic and reusable") forbids either of its
      // exports from referencing caller-specific concepts like "evidence"
      // (see docview.js's own header comment). Prefixing here still lands
      // the icon inside renderDocView's existing `f.truncate(title, cols)`
      // budget, since the icon is now part of the title string renderDocView
      // receives and truncates as a whole.
      S.docTitle = sectionHeader({ icon: icons.evidence, label: action.label || action.ref || '(untitled)' });
      S.docScroll = 0;
      S.mode = 'docview';
      return true;
    }

    // CON-104: the CHANGES panel's full-diff expansion (design.md Decision
    // 3/4) — shells `git diff -- <file>` (lib/ui/git-diff.js's fileDiff(),
    // execFileSync/bounded-timeout/try-caught there, never here) and opens
    // the result in the same shared `docview` reader 'open-evidence-doc'
    // above already uses (S.docBody/S.docTitle/S.docScroll, S.mode =
    // 'docview') — not a second doc-rendering implementation. Unlike
    // 'open-evidence-doc', the body is NOT word-wrapped: a unified diff's
    // `+`/`-` prefixes are meaningful at the start of each line, and
    // docview's own bodyBox already truncates (never wraps) overlong lines
    // at render time, the same treatment every code-shaped content in this
    // dashboard gets. Truncation (a fixed line cap, design.md Decision 4) is
    // already applied inside fileDiff() itself, with its own trailing marker
    // line — nothing further to do here.
    case 'open-diff-doc': {
      const result = gitDiff.fileDiff(action.worktree, action.file);
      S.docBody = result.error != null
        ? [format.yellow('diff unavailable: ' + result.error)]
        : (result.lines || []);
      S.docTitle = sectionHeader({ icon: icons.changes, label: action.label || action.file || '(untitled)' });
      S.docScroll = 0;
      S.mode = 'docview';
      return true;
    }

    // CON-55 (design.md Decision 3/4): a `pr`-kind evidence entry opens
    // externally (the OS default browser) rather than transitioning into
    // `docview` — `openInBrowser()` is the one child-process call this adds,
    // called here (not inside any screen's pure render path) and wrapped in
    // try/catch so a missing/failing `xdg-open` degrades to a visible
    // `drillNotice` instead of crashing the TUI. `mode` is left untouched on
    // both success and failure — unlike 'open-evidence-doc', this action
    // never transitions the dashboard into another screen.
    case 'open-external-url': {
      try {
        ctx.openInBrowser(action.url);
        S.drillNotice = null;
      } catch (e) {
        S.drillNotice = 'could not open ' + action.url + ' in a browser: ' + e.message;
      }
      return true;
    }

    case 'doc-scroll':
      S.docScroll = Math.max(0, action.offset);
      return true;

    // Fired only from mode = 'docview' — i.e. only ever the evidence reader
    // or (CON-104) the CHANGES diff reader (design.md Decision 3a:
    // ticketview.js's own esc dispatches 'back-to-launchpad' directly and
    // never reaches this handler). drillFocus/drillEvidenceIndex/
    // drillChangesIndex are all left untouched, so whichever panel/entry was
    // focused/selected when the reader opened still is on return — CHANGES
    // needs no handler of its own here, unlike 'open-diff-doc' above.
    case 'back-to-drilldown-from-doc':
      S.mode = 'drilldown';
      S.docTitle = null;
      S.docBody = null;
      S.docScroll = 0;
      return true;

    // Process actions — go straight to tmux, no agent cooperation needed, so
    // they work even on a run with zero telemetry (see the design doc's
    // "Control plane" section). Once killed, the window dies and the next
    // poll's reducer pass reports the run as failed on its own — this
    // handler does not need to fake that transition itself.
    //
    // Both cases delegate to control.js, which re-derives the run from the
    // current `runs` (this poll's latest observation, not a stale snapshot
    // from when the confirmation opened) and refuses to act at all once it
    // is no longer live — the second of two independent liveness checks
    // (drilldown.js's handleKey is the first). Restart additionally refuses
    // before killing anything when the ticket isn't spawnable, so a window
    // the dashboard never spawned (adopted on startup, fails TICKET_RE) is
    // never destroyed without a replacement being possible.
    case 'kill-confirmed':
      ctx.deps.control.killConfirmed(action.ticket, S.runs, ctx.session);
      S.drillConfirm = null;
      S.drillNotice = null;
      return true;

    // Restart reuses the launcher — the exact path the `n` prompt uses,
    // template substitution included — rather than re-deriving the launch
    // command here. A failed respawn is reported on screen, not swallowed.
    //
    // The base command prefers the run's own recorded identity over the
    // process-wide default: run.harness/run.speed come from run.start
    // (setup-worktree.sh's telemetry), so a ticket launched under codex at
    // `fast` restarts under codex at `fast` — previously it silently came
    // back under the global default harness at default speed. commandFor()
    // still runs on top, so a `harness:` label wins over even the recorded
    // identity, exactly as it would on a fresh launch.
    case 'restart-confirmed': {
      let restartBase = ctx.launcher.launchCommand;
      if (!ctx.cfg.launchCommand) {
        const run = (S.runs || []).find((r) => r.ticket === action.ticket);
        const tmpl = run && run.harness && harnessCmd.launchTemplate(run.harness);
        if (tmpl) restartBase = launchplanScreen.withSpeedFlag(tmpl, run.speed || 'default');
      }
      // specFor (not commandFor): a `provider:<value>` label's per-window
      // env must survive a restart exactly like the harness swap does —
      // the env rides a wrapper around submitTicket since control.js's own
      // seam predates the env parameter and only forwards three arguments.
      const spec = ctx.launcher.specFor(action.ticket, restartBase);
      // A run whose provider came from a per-row launch-plan choice (CON-69)
      // has no label for specFor to re-resolve — but run.start recorded the
      // resolved provider (run.provider), so restarting reproduces it the
      // same way run.harness/run.speed are reproduced above. A label-derived
      // env (spec.env) wins when both exist: the label is still the ticket's
      // declared intent.
      const restartRun = (S.runs || []).find((r) => r.ticket === action.ticket);
      if (!spec.env && restartRun && restartRun.provider) {
        spec.env = harnessCmd.providerSpawnEnv(
          restartRun.provider, ctx.config, harnessCmd.harnessOfCommand(spec.command) || 'claude-code');
      }
      const submitWithEnv = (t, c, s) => ctx.deps.submitTicket(t, c, s, spec.env);
      const result = ctx.deps.control.restartConfirmed(action.ticket, S.runs, ctx.session,
        spec.command, submitWithEnv);
      S.drillConfirm = null;
      S.drillNotice = result.spawned ? null : result.error;
      return true;
    }

    default:
      return false;
  }
}

module.exports = { handle };
