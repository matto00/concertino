'use strict';

// ---------- core resolution ------------------------------------------------
// Which `core/` a render reads from. Default: the core next to the executing
// script's own package (today's behavior — right for an npm-installed
// dependency). When the executing script's own repo is itself a git
// working-tree root, and the target belongs to the same superproject (same
// `git rev-parse --git-common-dir`), and the target's own checkout has a
// `core/` of its own, render from THAT — this is the repo actually being
// operated on (e.g. a delivery worktree with its own, possibly-edited
// core/scripts/*), not a guess. See design.md Decision 1.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { exists, yellow } = require('./shared');

function gitRun(gitArgs, cwd) {
  try {
    return execSync('git ' + gitArgs, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (_) {
    return null;
  }
}
// `git rev-parse --git-common-dir` is relative on some git versions, absolute
// on others (mirrors core/scripts/emit-event.sh's main_checkout() normalization).
function gitCommonDir(dir) {
  const raw = gitRun('rev-parse --git-common-dir', dir);
  if (!raw) return null;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(dir, raw);
}
function gitTopLevel(dir) {
  const raw = gitRun('rev-parse --show-toplevel', dir);
  return raw ? path.resolve(raw) : null;
}
function realpathSafe(p) {
  try { return fs.realpathSync(p); } catch (_) { return p; }
}
function normPath(p) { return p ? realpathSafe(path.resolve(p)) : null; }
function samePath(a, b) { return !!a && !!b && normPath(a) === normPath(b); }

// Compares the set of files checked for divergence in resolveCore(). Covers
// core/scripts/*, core/laws/*, core/roles/*, and core/workflow-state.template.md
// — all files a render actually reads from core/. Note: checkArtifacts() compares
// only scripts/laws/workflow-state (the files it copies), so roles/ is checked
// here but not there: roles are rendered, not copied, so there is no byte-identical
// artifact to compare. The divergence note printed by resolveCore() is the only
// signal available for roles/. Used only to decide whether to print a divergence
// note; never gates whether resolution proceeds.
function coresDiffer(coreA, coreB) {
  const readDirSafe = (d) => { try { return fs.readdirSync(d); } catch (_) { return []; } };
  const fileDiffers = (a, b) => {
    if (exists(a) !== exists(b)) return true;
    if (!exists(a)) return false;
    return !fs.readFileSync(a).equals(fs.readFileSync(b));
  };
  for (const sub of ['scripts', 'laws', 'roles']) {
    const names = new Set([...readDirSafe(path.join(coreA, sub)), ...readDirSafe(path.join(coreB, sub))]);
    for (const f of names) {
      if (fileDiffers(path.join(coreA, sub, f), path.join(coreB, sub, f))) return true;
    }
  }
  return fileDiffers(path.join(coreA, 'workflow-state.template.md'), path.join(coreB, 'workflow-state.template.md'));
}

function resolveCore(repo, out, coreOverride) {
  if (coreOverride) return path.resolve(coreOverride);

  // Part 1: repo must be a git working-tree root in its own right — not
  // merely nested inside a foreign repository it doesn't control (rules out
  // the ordinary node_modules/<pkg> topology, which has no .git of its own).
  const repoToplevel = gitTopLevel(repo);
  if (!samePath(repoToplevel, repo)) return path.join(repo, 'core');

  // Part 2: out belongs to the same superproject as repo — same shared .git,
  // whether out is a worktree of repo, repo is a worktree of out's main
  // checkout, or they're literally the same checkout.
  const scriptCommon = gitCommonDir(repo);
  const targetCommon = gitCommonDir(out);
  if (scriptCommon && targetCommon && samePath(scriptCommon, targetCommon)) {
    // out's OWN checkout root — not the shared main checkout — is the
    // worktree that actually has the possibly-diverged core/ this exists for.
    const targetRoot = gitTopLevel(out);
    if (targetRoot) {
      const targetCore = path.join(targetRoot, 'core');
      if (exists(targetCore)) {
        const repoCore = path.join(repo, 'core');
        if (!samePath(targetRoot, repo) && coresDiffer(targetCore, repoCore)) {
          console.log('  ' + yellow('note: ') + 'rendering from ' + targetCore +
            ' — differs from the executing script\'s own core at ' + repoCore);
        }
        return targetCore;
      }
    }
  }

  // Not the same superproject, out has no core of its own, or git is
  // unavailable — today's behavior, unchanged.
  return path.join(repo, 'core');
}

module.exports = { resolveCore };
