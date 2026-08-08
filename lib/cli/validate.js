'use strict';

const { collectConfigIssues, classifyHarnessOverride } = require('../config');
// `concertino validate --ticket <ID>` (CON-62, design.md Decision 6; CON-93
// item 4) reuses the TUI's existing single-issue fetch rather than a second
// GraphQL client/on-disk reader — only required here, in the one command
// module that needs it, not at module scope in lib/config.js, since
// lib/config.js stays side-effect-free / dependency-free by design. Goes
// through ticket-provider.js's dispatch (not lib/ui/linear.js directly) so
// this is the alias-resolved kind, and both `linear` and `local` (and its
// deprecated `manual` alias) are supported the same way.
const ticketProvider = require('../ui/ticket-provider');
const { green, yellow, gray, red, dim, section, read, exists, resolveOut, resolveConfigPath, hasHelpFlag } = require('./shared');
const { printUsage } = require('./help');

// CON-62 (design.md Decision 6 / tasks.md 4.3), extended by CON-93 item 4 to
// also support `local`/`manual`: live-fetches `ticketId` and classifies its
// harness-override state into the shape `collectConfigIssues` (lib/config.js)
// renders in the Integrations section. The fetch itself (network for
// `linear`, a synchronous disk read for `local`) happens here (the
// untestable-without-mocking part); the actual label-parsing/classification
// is `classifyHarnessOverride` (lib/config.js), pure and unit-tested
// directly, no network required.
async function buildTicketHarnessCheck(cfg, ticketId, root) {
  const kind = ticketProvider.kindFor(cfg);
  if (kind !== 'linear' && kind !== 'local') {
    const tp = cfg.ticketProvider || {};
    return { ticketId, kind: 'unsupported-provider', providerKind: tp.kind || 'none' };
  }
  const ticket = await ticketProvider.fetchOneTicket(cfg, { id: ticketId, root });
  return Object.assign({ ticketId }, classifyHarnessOverride(ticket.labels));
}

// A thin wrapper around lib/config.js's collectConfigIssues (design.md
// Decision 2 / tasks.md 1.4): the section-by-section checking logic itself
// now lives there (shared with lib/ui/screens/settings.js's save-time
// validation), and this function's own job is just the CLI's I/O — reading
// the file (or exiting on a missing/unparseable one, same as before), then
// printing the returned errors/warnings through the SAME ok/warn/fail
// console helpers, in the same order, with the same summary line and exit
// code as pre-refactor. Every check that existed before this ticket prints
// byte-identical output; the two new sections (Budgets/Dashboard,
// collectConfigIssues' own header comment) are additive lines only.
//
// `async` since CON-62's `--ticket <ID>` (tasks.md 4.1/4.3) live-fetches
// over the network before collectConfigIssues runs — omitting `--ticket` is
// a complete no-op (tasks.md 4.5): no fetch happens, byte-identical output.
async function cmdValidate(args) {
  if (hasHelpFlag(args)) { printUsage('validate'); return; }
  const out = resolveOut(args);
  const cfgPath = resolveConfigPath(args, out);
  console.log('concertino validate → ' + cfgPath);

  const ok   = (label, val) => console.log(`  ${green('✓')} ${gray(String(label).padEnd(18))} ${val ?? ''}`);
  const warn = (msg)        => console.log(`  ${yellow('!')} ${msg}`);
  const fail = (msg)        => console.log(`  ${red('✗')} ${msg}`);

  // ── Structure ────────────────────────────────────────────────────────────
  // Existence/JSON-parse are the CLI's own pre-checks — collectConfigIssues
  // takes an already-parsed `cfg`, so these two necessarily stay here.
  section('Structure');
  if (!exists(cfgPath)) {
    console.error(red('error: ') + 'no config at ' + cfgPath + ' — run `concertino init` first.');
    process.exit(1);
  }
  let cfg;
  try { cfg = JSON.parse(read(cfgPath)); ok('json', 'valid'); }
  catch (e) { fail('invalid JSON: ' + e.message); process.exit(1); }

  // `--ticket <ID>` (tasks.md 4.1/4.3): resolved BEFORE collectConfigIssues
  // runs (that function stays sync/pure — design.md Decision 6), then handed
  // in as `opts.ticketHarnessCheck` so it renders inside the same
  // Integrations section as the static/runtime harness-telemetry lines.
  let ticketHarnessCheck;
  if (args.ticket) {
    ticketHarnessCheck = await buildTicketHarnessCheck(cfg, args.ticket, out);
  }

  const { errors, warnings } = collectConfigIssues(cfg, { out, ticketHarnessCheck, emit: { section, ok, warn, fail } });

  // ── Summary ──────────────────────────────────────────────────────────────
  const verdict = errors.length ? red('✗ invalid') : green('✓ valid');
  const counts = [];
  if (errors.length)   counts.push(red(errors.length + ' error' + (errors.length !== 1 ? 's' : '')));
  if (warnings.length) counts.push(yellow(warnings.length + ' warning' + (warnings.length !== 1 ? 's' : '')));
  if (!counts.length) counts.push(dim('all checks passed'));
  console.log('\n  ' + verdict + '  ' + counts.join(dim('  ·  ')));

  if (errors.length) process.exit(1);
}

module.exports = { cmdValidate };
