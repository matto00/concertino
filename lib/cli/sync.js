'use strict';

const path = require('path');

// loadConfig itself now lives in lib/config.js (shared with the settings
// screen) — alongside withDefaults/resolveModel/deepSet/coerce/
// collectConfigIssues.
const { loadConfig } = require('../config');
const { REPO, dim, green, red, write, resolveOut, resolveConfigPath, hasHelpFlag, parseHarnessList } = require('./shared');
const { resolveCore } = require('./resolve-core');
const { renderEnv, renderSpeedsJson } = require('./render');
const { emitClaude, emitCodex, emitOpencode, copyAssets } = require('./emit');
const { cmdValidate } = require('./validate');
const { printUsage } = require('./help');

// `resolvedCore` lets a caller that already resolved its own core (cmdInit)
// pass it straight through instead of having cmdSync re-resolve independently
// — see design.md Decision 6 / tasks.md 1.4.
async function cmdSync(args, resolvedCore) {
  if (hasHelpFlag(args)) { printUsage('sync'); return; }
  const out = resolveOut(args);
  const cfgPath = resolveConfigPath(args, out);
  // Run validate first (errors block sync; warnings are informational).
  // `await`ed since cmdValidate is itself async (CON-62's --ticket live
  // fetch) — kept correct even though sync/update never pass --ticket
  // themselves, rather than relying on that never happening.
  await cmdValidate({ ...args, config: cfgPath, out });
  console.log('');
  const c = loadConfig(args, out);
  const core = resolvedCore || resolveCore(REPO, out, args.core);
  const dry = !!args['dry-run'];
  const { harnesses, error } = parseHarnessList(args.harness, c.harnesses);
  if (error) { console.error(red('error: ') + error); process.exit(1); }
  console.log('concertino sync → ' + out + (dry ? dim('  (dry run)') : ''));
  console.log(dim('  harnesses: ') + harnesses.join(', '));
  copyAssets(out, core, dry, true);
  write(path.join(out, 'scripts', 'concertino', '.concertino.env'), renderEnv(c), dry);
  write(path.join(out, 'scripts', 'concertino', 'speeds.json'), renderSpeedsJson(c), dry);
  if (harnesses.includes('claude-code')) emitClaude(c, out, core, dry);
  if (harnesses.includes('codex')) emitCodex(c, out, core, dry);
  if (harnesses.includes('opencode')) emitOpencode(c, out, core, dry);
  console.log(green('done.'));
}

module.exports = { cmdSync };
