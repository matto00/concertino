'use strict';

// Shared plumbing for the CLI command modules under lib/cli/ — path anchors,
// version, ANSI colors, banner/section chrome, and the tiny fs/arg helpers
// every command leans on. Extracted from bin/concertino verbatim; the
// executable itself is now just a command registry + dispatch.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
// Recursively lists every file under `dir`, returning relative POSIX paths
// (forward slashes even on Windows, so callers can path.join against them
// consistently across platforms). For a directory with no subdirectories
// this produces the same set of entries as a flat `fs.readdirSync`, just as
// relative paths instead of bare basenames — order is not guaranteed to
// match `fs.readdirSync`'s own (both derive from `readdirSync`, which does
// not guarantee any particular order itself), but callers here only use the
// result to iterate/compare a set of files, never depend on a specific
// order. Returns `[]` for a missing directory (mirrors the flat-enumeration
// call sites this replaces, which also tolerated a missing `core/scripts/`
// via try/catch or simply never existing pre-render).
function listFilesRecursive(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const rel of listFilesRecursive(abs)) out.push(entry.name + '/' + rel);
    } else if (entry.isFile()) {
      out.push(entry.name);
    }
  }
  return out;
}

// ---------- git shell-outs (shared by resolve-core.js and the provenance
// report below, extracted here so both consumers use the exact same
// degrade-safely-on-failure behavior instead of two near-identical copies) --
// Any failure (missing `git` binary, not a repo, non-zero exit) resolves to
// `null` rather than throwing — callers treat `null` as "couldn't determine",
// never as a crash. See resolve-core.js's own header comment and
// design.md's Risks/Trade-offs for why silence-on-failure is the right
// default here.
function gitRun(gitArgs, cwd) {
  try {
    return execSync('git ' + gitArgs, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (_) {
    return null;
  }
}
function gitTopLevel(dir) {
  const raw = gitRun('rev-parse --show-toplevel', dir);
  return raw ? path.resolve(raw) : null;
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
// `-h` isn't matched by parseArgs' `--k[=v]`-only regex above, so it lands in
// `args._` instead of setting `args.help` — this helper checks both so every
// parseArgs-based command recognizes the short form the same as the long one.
const hasHelpFlag = (args) => args.help === true || (Array.isArray(args._) && args._.includes('-h'));
// ---------- --out / --config path resolution -------------------------------
// Shared by every cmd* module that accepts --out/--config, so a future
// change to the resolution rule (e.g. an env-var fallback) is one edit
// instead of ten synchronized ones.
const resolveOut = (args) => path.resolve(args.out || '.');
const resolveConfigPath = (args, out) =>
  args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json');

// ---------- --harness comma-list parsing/validation ------------------------
// Shared by `sync`, `diff`, and `eject` (CON-84 — unify-harness-flag-semantics)
// so the flag's *parsing* semantics are identical regardless of which
// subcommand it's attached to: split on commas, trim each entry, drop empty
// entries (a trailing/repeated comma shouldn't produce a spurious '' entry),
// and validate every entry against the fixed three-harness set. `raw` is
// `args.harness` — a string, or `undefined` when the flag was omitted (NOT
// handled: `--harness` passed with no `=value` sets `args.harness` to the
// boolean `true`, which `.split` would throw on — a pre-existing crash in
// sync/diff today, unchanged by this helper; see design.md's Context note).
// `fallback` is the array to use when `raw` is falsy. Returns
// `{ harnesses, error }` — never calls `process.exit` itself, so callers
// each keep their own existing error-reporting convention and this stays
// unit-testable without a subprocess.
const KNOWN_HARNESSES = ['claude-code', 'codex', 'opencode'];
function parseHarnessList(raw, fallback) {
  if (!raw) return { harnesses: fallback, error: null };
  const entries = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const invalid = entries.filter((h) => !KNOWN_HARNESSES.includes(h));
  if (invalid.length > 0) {
    return {
      harnesses: null,
      error: 'unknown harness "' + invalid.join(',') + '" — valid: ' + KNOWN_HARNESSES.join(', '),
    };
  }
  return { harnesses: entries, error: null };
}

// ---------- provenance report ----------------------------------------------
// sync-provenance-diff-preview (CON-128), design.md Decision 1: printed once
// per `sync`/`diff` invocation, before any write/diff, so which binary and
// which `core/` a render is about to use is visible up front — a linked
// global (npm-linked to a dev checkout) distinguished from a genuinely
// separate plain install. Does NOT re-resolve `core/` itself — `core` is
// passed in by the caller, already computed by resolveCore().
//
// `process.argv[1]` is the path as invoked (Node does not resolve symlinks
// in argv[1] itself), so `fs.lstatSync` on it tells us whether the CLI was
// invoked through a symlink (e.g. `/usr/bin/concertino` → an `npm link`
// target) at all. When it is, `fs.realpathSync` resolves the FULL chain to
// its final target (multi-hop symlinks included — realpathSync always
// returns the final, non-symlink target, never an intermediate hop), and a
// `git rev-parse --show-toplevel` from that final target's directory
// classifies it: succeeds → the target lives inside a git working tree (a
// "linked global"); fails (no git, not a repo, any other error — gitRun/
// gitTopLevel above already swallow all of that into `null`) → a plain,
// non-linked install, reported as such rather than raising an error.
function reportProvenance(core) {
  const invoked = process.argv[1] || '(unknown)';
  console.log(dim('  binary: ') + invoked);

  let isSymlink = false;
  try { isSymlink = fs.lstatSync(invoked).isSymbolicLink(); } catch (_) { isSymlink = false; }

  if (isSymlink) {
    let target = invoked;
    try { target = fs.realpathSync(invoked); } catch (_) { target = invoked; }
    const toplevel = gitTopLevel(path.dirname(target));
    console.log(dim('  symlink → ') + target);
    if (toplevel) {
      console.log(dim('  install: ') + 'linked global ' + dim('(dev checkout at ' + toplevel + ')'));
    } else {
      console.log(dim('  install: ') + 'plain install ' + dim('(no linked dev checkout)'));
    }
  } else {
    console.log(dim('  install: ') + 'plain install ' + dim('(no linked dev checkout)'));
  }

  console.log(dim('  core:   ') + core);
}

module.exports = {
  REPO, ADAPTERS, DEFAULT_ESCALATION_TIMEOUT_MIN, VERSION, TTY,
  bold, dim, cyan, green, yellow, gray, blue, red,
  banner, section,
  read, exists, write, copy, bt, readRoleFile, findAdded, parseArgs, hasHelpFlag,
  resolveOut, resolveConfigPath, parseHarnessList, listFilesRecursive,
  gitRun, gitTopLevel, reportProvenance,
};
