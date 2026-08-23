#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# test-gate-in-isolation.sh — exercise a target commit-gate script exactly
# once against a disposable fixture repo, under a hook-shaped environment,
# and record a pass/fail corruption verdict (CON-132, design.md Decision 5).
#
# Usage:
#   test-gate-in-isolation.sh <TICKET_ID> <PATH_TO_GATE_SCRIPT> [NPM_SCRIPT_NAME]
#
# <PATH_TO_GATE_SCRIPT> may be absolute, or relative to the current
# directory; it is resolved to an absolute path, and the git working tree
# containing it (its `--show-toplevel`) is treated as WORKTREE_PATH — the
# same "real, surrounding repo" this run is happening inside, and the same
# repo the transcript's destination path (see below) is written under.
# [NPM_SCRIPT_NAME] is accepted for the transcript's own record-keeping
# (which `npm run <name>` a real hook invocation would use) but is NOT what
# this helper executes — see step 3 below for why the target script is
# invoked directly rather than through `npm run`.
#
# What this does, and does NOT do, to the real repo it runs inside
# --------------------------------------------------------------------------
# This helper NEVER runs `git init` (or any command whose behavior depends
# on the ambient GIT_* environment) against the real, surrounding repo. Every
# git-state-mutating operation happens inside a `mktemp -d` throwaway
# directory, fabricated below. If the fixture-isolation implemented below
# had a bug — e.g. the exported GIT_DIR accidentally pointed at the real
# repo's own `.git`, or the fixture's worktree were created INSIDE the real
# repo's working tree rather than under `mktemp -d` — the exact failure mode
# this ticket exists to prevent would recur here: the target script's `git
# init` (for a genuinely hazardous target) would re-initialise the real
# repo's `.git` as bare, exactly as happened in the CON-132 incident this
# script was built to guard against. That is why step 6 below independently
# snapshots the real repo's own bareness/HEAD/worktree-list before and after
# every run and fails loudly on any change, regardless of the fixture
# verdict — a second, independent tripwire that does not trust the fixture
# construction to be bug-free.
#
# Design (corrected, round 3 — see design.md Decision 5): this helper does
# NOT run the target script twice (once "unhardened", once with a forced
# hardening wrapper) to produce a red/green diff — that was rejected as
# unobtainable for a target script that is already safe (the desired,
# common case: no observable difference exists to diff against). Instead it
# runs the target exactly once, under a hook-shaped environment, and asserts
# a pass/fail corruption verdict from that single run. A script that fails
# this is not yet safe to wire into `.husky/pre-commit` — that is the
# correct, intended outcome, not a bug in this helper.
# ===========================================================================

TICKET_ID="${1:?usage: test-gate-in-isolation.sh <TICKET_ID> <PATH_TO_GATE_SCRIPT> [NPM_SCRIPT_NAME]}"
TARGET_ARG="${2:?usage: test-gate-in-isolation.sh <TICKET_ID> <PATH_TO_GATE_SCRIPT> [NPM_SCRIPT_NAME]}"
NPM_SCRIPT_NAME="${3:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

looks_like_ticket() { [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; }
if ! looks_like_ticket "$TICKET_ID"; then
  echo "FAIL invalid TICKET_ID: ${TICKET_ID}" >&2
  exit 1
fi

if [ ! -f "$TARGET_ARG" ]; then
  echo "FAIL target gate script not found: ${TARGET_ARG}" >&2
  exit 1
fi
TARGET_DIR="$(cd "$(dirname "$TARGET_ARG")" && pwd)"
TARGET_ABS="${TARGET_DIR}/$(basename "$TARGET_ARG")"

WORKTREE_PATH="$(git -C "$TARGET_DIR" rev-parse --show-toplevel 2>/dev/null)"
if [ -z "${WORKTREE_PATH:-}" ]; then
  echo "FAIL target script is not inside any git working tree: ${TARGET_ARG}" >&2
  exit 1
fi
case "$TARGET_ABS" in
  "$WORKTREE_PATH"/*) TARGET_REL="${TARGET_ABS#"$WORKTREE_PATH"/}" ;;
  *)
    echo "FAIL target script is not under its own git working tree top-level: ${TARGET_ARG}" >&2
    exit 1
    ;;
esac

# --- Step 1: state scope before doing anything ------------------------------
echo "test-gate-in-isolation.sh: about to test '${TARGET_REL}' (ticket ${TICKET_ID})."
echo "  This will create a disposable fixture git repo under \$(mktemp -d) and"
echo "  run the target script against it exactly once, under an environment"
echo "  shaped like a Husky pre-commit hook invoked from a linked worktree."
echo "  Nothing outside that mktemp -d fixture is ever git-initialised,"
echo "  re-initialised, or otherwise mutated by this run."

# --- Step 6a: snapshot the REAL repo's invariants BEFORE the run -----------
real_snapshot() {
  {
    git -C "$WORKTREE_PATH" rev-parse --is-bare-repository 2>&1
    git -C "$WORKTREE_PATH" rev-parse HEAD 2>&1
    git -C "$WORKTREE_PATH" worktree list 2>&1
  }
}
REAL_BEFORE="$(real_snapshot)"

# --- Step 2: fabricate a linked-worktree-shaped fixture ---------------------
FIXTURE_ROOT="$(mktemp -d)"
MAIN_REPO="${FIXTURE_ROOT}/main-repo"
git init -q -b main "$MAIN_REPO"
git -C "$MAIN_REPO" -c user.email=fixture@test -c user.name=fixture commit -q --allow-empty -m "fixture init"

# `git worktree add` builds a real linked-worktree shape: a `.git` FILE at
# the worktree root pointing (via `gitdir:`) at
# <main-repo>/.git/worktrees/<name> — the exact shape a Husky hook run from
# a linked worktree inherits GIT_DIR from. Using the real command (rather
# than hand-fabricating the .git file/dir structure) means this fixture is
# only ever as "fake" as git's own worktree feature, not a reimplementation
# of it.
WT_NAME="fixture-wt"
git -C "$MAIN_REPO" worktree add -q -b "$WT_NAME" "../${WT_NAME}" >/dev/null 2>&1
FIXTURE_WT="${FIXTURE_ROOT}/${WT_NAME}"
FIXTURE_GIT_DIR="${MAIN_REPO}/.git/worktrees/${WT_NAME}"

if [ ! -d "$FIXTURE_GIT_DIR" ]; then
  echo "FAIL could not fabricate linked-worktree fixture (missing ${FIXTURE_GIT_DIR})" >&2
  rm -rf "$FIXTURE_ROOT"
  exit 1
fi

# --- Step 3: before-state of the FIXTURE (not the real repo) ---------------
fixture_bare()   { git -C "$MAIN_REPO" rev-parse --is-bare-repository 2>&1; }
fixture_status() { git -C "$MAIN_REPO" status --porcelain 2>&1; }
fixture_manifest() { ls -la "${MAIN_REPO}/.git" 2>&1; }

FIX_BEFORE_BARE="$(fixture_bare)"
FIX_BEFORE_STATUS="$(fixture_status)"
FIX_BEFORE_MANIFEST="$(fixture_manifest)"

# --- Step 3 (continued): the single hook-shaped run -------------------------
# GIT_DIR / GIT_INDEX_FILE exported, GIT_WORK_TREE deliberately left UNSET,
# cwd set to the fixture's linked-worktree directory — this is what a git
# hook subprocess from a linked worktree actually inherits (verified by
# direct reproduction, not assumed): git hooks only ever export GIT_DIR and
# GIT_INDEX_FILE, relying on cwd for the work tree. Exporting GIT_WORK_TREE
# explicitly (which an earlier draft of this helper did) makes GIT_DIR's
# basename-not-".git" ambiguity resolvable and PREVENTS the incident's own
# bare-reinit reproduction — confirmed by a manual probe (`git init` under
# GIT_DIR-only vs. GIT_DIR+GIT_WORK_TREE+GIT_INDEX_FILE against the same
# fixture) before this helper's logic was written, per the ticket's own
# verification standard. GIT_INDEX_FILE alone does not prevent the flip.
# Invoked directly (node for .mjs/.js, bash for .sh, otherwise executed
# as-is) rather than through `npm run` — npm merely forks a child that
# inherits the same ambient GIT_* environment either way, and direct
# invocation keeps this helper independent of the target repo's own
# npm/package.json wiring being reproducible inside the fixture.
run_target() {
  case "$TARGET_ABS" in
    *.mjs|*.js) node "$TARGET_ABS" ;;
    *.sh)       bash "$TARGET_ABS" ;;
    *)          "$TARGET_ABS" ;;
  esac
}

RUN_CMD_DESC="(cd ${FIXTURE_WT} && GIT_DIR=${FIXTURE_GIT_DIR} GIT_INDEX_FILE=${FIXTURE_GIT_DIR}/index <invoke ${TARGET_REL}>)  # GIT_WORK_TREE deliberately unset — see script header"
RUN_OUTPUT="$(
  cd "$FIXTURE_WT" && \
  unset GIT_WORK_TREE; \
  GIT_DIR="$FIXTURE_GIT_DIR" \
  GIT_INDEX_FILE="${FIXTURE_GIT_DIR}/index" \
  run_target 2>&1
)"
RUN_EXIT=$?

# --- Step 4: after-state + pass/fail corruption verdict on the fixture -----
FIX_AFTER_BARE="$(fixture_bare)"
FIX_AFTER_STATUS="$(fixture_status)"
FIX_AFTER_MANIFEST="$(fixture_manifest)"

VERDICT="PASS"
CORRUPTION_NOTES=""
if [ "$FIX_BEFORE_BARE" != "$FIX_AFTER_BARE" ]; then
  VERDICT="FAIL"
  CORRUPTION_NOTES="${CORRUPTION_NOTES}- fixture bareness changed: '${FIX_BEFORE_BARE}' -> '${FIX_AFTER_BARE}'"$'\n'
fi
if [ ! -d "${MAIN_REPO}/.git" ] && [ ! -f "${MAIN_REPO}/.git" ]; then
  VERDICT="FAIL"
  CORRUPTION_NOTES="${CORRUPTION_NOTES}- fixture .git entry no longer exists at ${MAIN_REPO}/.git"$'\n'
fi

# --- Step 6b: snapshot the REAL repo's invariants AFTER the run ------------
REAL_AFTER="$(real_snapshot)"
REAL_TRIPWIRE="PASS"
if [ "$REAL_BEFORE" != "$REAL_AFTER" ]; then
  REAL_TRIPWIRE="FAIL"
fi

# --- Step 5: write + persist the transcript ---------------------------------
EVIDENCE_DIR="${WORKTREE_PATH}/.concertino/gate-chain-isolation-evidence"
mkdir -p "$EVIDENCE_DIR"
FLATTENED="$(printf '%s' "$TARGET_REL" | sed 's#/#__#g')"
TRANSCRIPT="${EVIDENCE_DIR}/${FLATTENED}.md"

{
  echo "# Gate-in-isolation transcript: ${TARGET_REL}"
  echo ""
  echo "- Ticket: ${TICKET_ID}"
  echo "- Target script: \`${TARGET_REL}\`"
  [ -n "$NPM_SCRIPT_NAME" ] && echo "- Wired as npm script: \`${NPM_SCRIPT_NAME}\`"
  echo "- Fixture: disposable \`mktemp -d\` linked-worktree shape (\`git worktree add\`), never the real repo"
  echo ""
  echo "## Command"
  echo ""
  echo '```'
  echo "$RUN_CMD_DESC"
  echo '```'
  echo ""
  echo "Exit code of the target script's own run: \`${RUN_EXIT}\` (informational — the"
  echo "corruption verdict below does not depend on this exit code; a gate"
  echo "script legitimately failing its own check is not fixture corruption)."
  echo ""
  echo "## Target script output"
  echo ""
  echo '```'
  printf '%s\n' "$RUN_OUTPUT"
  echo '```'
  echo ""
  echo "## Fixture state — before"
  echo ""
  echo "- \`git rev-parse --is-bare-repository\`: \`${FIX_BEFORE_BARE}\`"
  echo '- `git status --porcelain`:'
  echo '```'
  printf '%s\n' "$FIX_BEFORE_STATUS"
  echo '```'
  echo '- `.git` manifest:'
  echo '```'
  printf '%s\n' "$FIX_BEFORE_MANIFEST"
  echo '```'
  echo ""
  echo "## Fixture state — after"
  echo ""
  echo "- \`git rev-parse --is-bare-repository\`: \`${FIX_AFTER_BARE}\`"
  echo '- `git status --porcelain`:'
  echo '```'
  printf '%s\n' "$FIX_AFTER_STATUS"
  echo '```'
  echo '- `.git` manifest:'
  echo '```'
  printf '%s\n' "$FIX_AFTER_MANIFEST"
  echo '```'
  echo ""
  echo "## Real, surrounding repo invariants (before/after; must be identical)"
  echo ""
  echo '```'
  printf 'BEFORE:\n%s\n\nAFTER:\n%s\n' "$REAL_BEFORE" "$REAL_AFTER"
  echo '```'
  echo ""
  echo "Real-repo tripwire: **${REAL_TRIPWIRE}**"
  echo ""
  echo "## Verdict"
  echo ""
  echo "**${VERDICT}**"
  if [ -n "$CORRUPTION_NOTES" ]; then
    echo ""
    echo "$CORRUPTION_NOTES"
  fi
} > "$TRANSCRIPT"

rm -rf "$FIXTURE_ROOT"

if [ "$REAL_TRIPWIRE" = "FAIL" ]; then
  echo "FAIL real, surrounding repo's invariants changed during this run — this is a" >&2
  echo "     bug in the fixture isolation itself, not a verdict on the target script." >&2
  echo "BEFORE: ${REAL_BEFORE}" >&2
  echo "AFTER:  ${REAL_AFTER}" >&2
  exit 1
fi

PERSIST_OUT="$("${SCRIPT_DIR}/persist-evidence.sh" "$TICKET_ID" "$TRANSCRIPT" 2>&1)"
PERSIST_RC=$?
echo "$PERSIST_OUT"
if [ "$PERSIST_RC" -ne 0 ]; then
  echo "FAIL could not persist isolation-test transcript: ${PERSIST_OUT}" >&2
  exit 1
fi

if [ "$VERDICT" != "PASS" ]; then
  echo "FAIL target script '${TARGET_REL}' corrupted the fixture under a hook-shaped" >&2
  echo "     environment — not yet safe to wire into .husky/pre-commit. See:" >&2
  echo "     ${TRANSCRIPT}" >&2
  echo "$CORRUPTION_NOTES" >&2
  exit 1
fi

echo "PASS ${TARGET_REL}"
