'use strict';

// Shared plumbing for the CLI command modules under lib/cli/ — path anchors,
// version, ANSI colors, banner/section chrome, and the tiny fs/arg helpers
// every command leans on. Extracted from bin/concertino verbatim; the
// executable itself is now just a command registry + dispatch.

const fs = require('fs');
const path = require('path');

// lib/cli/ sits two levels below the repo root (bin/ sat one) — resolution
// semantics are otherwise identical to bin/concertino's original
// `path.resolve(__dirname, '..')`.
const REPO = path.resolve(__dirname, '..', '..');
const ADAPTERS = path.join(REPO, 'adapters');
// `emit-event.sh --await` blocks inside a single harness command call, which
// has its own outer timeout (Claude Code caps a Bash call at ~10 minutes).
// This has to stay comfortably under that or the harness kills the process
// before --await's own timeout fires, and the run never gets a clean
// `escalation.timeout` event or a chance to fall back to chat. Keep in sync
// with the default in config/concertino.schema.json.
const DEFAULT_ESCALATION_TIMEOUT_MIN = 8;
let VERSION = '0.0.0';
try { VERSION = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version; } catch (_) {}

// ---------- ANSI colors (disabled when not a TTY) -------------------------
const TTY = !!process.stdout.isTTY;
const bold   = (s) => TTY ? `\x1b[1m${s}\x1b[22m` : s;
const dim    = (s) => TTY ? `\x1b[2m${s}\x1b[22m` : s;
const cyan   = (s) => TTY ? `\x1b[36m${s}\x1b[39m` : s;
const green  = (s) => TTY ? `\x1b[32m${s}\x1b[39m` : s;
const yellow = (s) => TTY ? `\x1b[33m${s}\x1b[39m` : s;
const gray   = (s) => TTY ? `\x1b[90m${s}\x1b[39m` : s;
const blue   = (s) => TTY ? `\x1b[34m${s}\x1b[39m` : s;
const red    = (s) => TTY ? `\x1b[31m${s}\x1b[39m` : s;

// ---------- banner + TUI chrome -------------------------------------------
function banner() {
  const W = 44;
  const hr = '─'.repeat(W + 2);
  if (TTY) {
    return [
      '',
      blue('╭' + hr + '╮'),
      blue('│ ') + bold('CONCERTINO') + dim('  ·  the agent orchestra') + ' '.repeat(W - 34) + blue(' │'),
      blue('│ ') + dim('v' + VERSION) + ' '.repeat(W - VERSION.length - 1) + blue(' │'),
      blue('╰' + hr + '╯'),
      ''
    ].join('\n');
  }
  return [
    '',
    '╭' + hr + '╮',
    '│ CONCERTINO  ·  the agent orchestra' + ' '.repeat(W - 34) + ' │',
    '│ v' + VERSION + ' '.repeat(W - VERSION.length - 1) + ' │',
    '╰' + hr + '╯',
    ''
  ].join('\n');
}

function section(title) {
  const prefix = `  ─── ${title} `;
  const fill = '─'.repeat(Math.max(2, 42 - prefix.length));
  console.log('\n' + (TTY ? gray(prefix + fill) : prefix + fill));
}

// ---------- tiny helpers --------------------------------------------------
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
function write(p, s, dry) {
  if (dry) { console.log('  ' + dim('would write') + ' ' + p); return; }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
  console.log('  ' + green('wrote') + ' ' + p);
}
function copy(src, dest, dry) {
  if (dry) { console.log('  ' + dim('would copy') + ' ' + dest); return; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
const bt = (s) => '`' + s + '`';
function readRoleFile(role, out, core) {
  const override = path.join(out, '.concertino', 'roles', role + '.md');
  return exists(override) ? read(override) : read(path.join(core, 'roles', role + '.md'));
}
function findAdded(original, enriched, prefix) {
  const result = [];
  for (const key of Object.keys(enriched)) {
    const dotPath = prefix ? prefix + '.' + key : key;
    if (original == null || !(key in original)) {
      result.push({ path: dotPath, val: enriched[key] });
    } else if (
      typeof enriched[key] === 'object' && enriched[key] !== null &&
      !Array.isArray(enriched[key]) &&
      typeof original[key] === 'object' && original[key] !== null &&
      !Array.isArray(original[key])
    ) {
      result.push(...findAdded(original[key], enriched[key], dotPath));
    }
  }
  return result;
}
function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
    else out._.push(a);
  }
  return out;
}

module.exports = {
  REPO, ADAPTERS, DEFAULT_ESCALATION_TIMEOUT_MIN, VERSION, TTY,
  bold, dim, cyan, green, yellow, gray, blue, red,
  banner, section,
  read, exists, write, copy, bt, readRoleFile, findAdded, parseArgs,
};
