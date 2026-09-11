#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# squash-branch.sh — canonical, guarded Delivery-phase squash (CON-129).
#
# Fixes the incident where an improvised `git reset --soft origin/main`
# staged an 85-file revert of a sibling run's freshly-merged work: when the
# base ref advances mid-run, resetting against its LIVE TIP stages every
# intervening commit as a deletion. This script instead resets against the
# branch's TRUE MERGE-BASE (never the base ref's current tip), and refuses to
# commit if the staged set contains anything outside the run's own declared
# touched-file set.
#
# Usage:
#   squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> \
#                     <CHANGE_DIR> [--allow-empty-declaration]
#
#   <WORKTREE_PATH>   path to the git worktree to operate in.
#   <BASE_REMOTE>     remote name the base branch lives on (e.g. origin).
#   <BASE_BRANCH>     base branch name (e.g. main).
#   <SUBJECT>         full commit message (subject + trailer) for the squash
#                     commit. Passed as a single argument; this script does
#                     not construct it.
#   <CHANGE_DIR>      the change directory, ALREADY SUBSTITUTED by the caller
#                     (e.g. openspec/changes/<name>, or whatever
#                     specProvider.changeDir resolves to for this project).
#                     NEVER hardcoded here: core/scripts/** is copied
#                     verbatim by lib/cli/emit.js with no variable
#                     substitution, while specProvider.changeDir is itself
#                     configurable (lib/cli/init.js emits a different default
#                     for specProvider.kind: 'none'). Mirrors
#                     next-report-number.sh's caller-passes-the-path
#                     convention.
#   --allow-empty-declaration   opt-in required when files-modified.md is
#                     missing, or parses to zero declared paths, while staged
#                     files outside the change-dir allowlist remain. Without
#                     it, that case is a loud stop, not a silent pass.
#
# Environment:
#   DRY_RUN=1         (CON-164) run every validation the normal path runs --
#                     merge-base computation, base-advancement logging,
#                     staged-file-set computation, the CON-162 staged-blob /
#                     on-disk / divergence checks, declaration parsing, and
#                     the allowlist comparison -- and return the same exit
#                     code the same invocation would have produced without
#                     the flag, for every guard verdict. Performs no `git
#                     reset`, no `git commit`, no HEAD movement, no index
#                     change. Exact string match against "1"; any other
#                     value (including "true") takes the normal, committing
#                     path. Matches helio's scripts/release/cut-release.sh
#                     convention.
#
# Guard (design.md D2/D2a/D2b):
#   1. Reset target is ALWAYS `git merge-base --all HEAD <base-remote>/<base-
#      branch>` (D1) — never the base ref's tip directly. More than one
#      merge-base (criss-cross history) is a loud stop, not a guess.
#   2. Base-advancement is logged (commits between merge-base and base tip)
#      but never blocks or forces a rebase (D3) — D1 already makes the reset
#      safe regardless of how far the base advanced.
#   3. Before HEAD ever moves, the prospective staged file set
#      (`git diff --cached --name-only <merge-base>`) is compared against the
#      union of:
#        (a) the fixed allowlist glob `<CHANGE_DIR>/**`
#        (b) paths parsed from `<CHANGE_DIR>/files-modified.md`, extracting
#            ONLY lines matching `^\s*[-*]\s*` followed by a backtick-quoted
#            path (D2a) — lines carrying no leading bullet are never scanned,
#            so a continuation line declares nothing. On a qualifying bullet
#            EVERY backtick-quoted, path-shaped span counts, not merely the
#            first (D2a-ii), so a grouped bullet declares all of its paths.
#            A span is path-shaped if it contains `/` or a dotted extension;
#            inline code spans on a bullet are therefore never treated as
#            paths.
#      Any staged path outside that union is a loud stop, no commit.
#      A missing/unparseable files-modified.md while staged files remain
#      outside the allowlist is ALSO a loud stop, unless
#      --allow-empty-declaration was passed.
#   4. The staged file count + full list is ALWAYS printed before any commit,
#      unconditionally — not only on guard failure.
#
# On any stop: prints a clear report, exits non-zero, commits nothing. On
# success: creates the squash commit and exits 0.
# ===========================================================================

WORKTREE_PATH="${1:?usage: squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> <CHANGE_DIR> [--allow-empty-declaration]}"
BASE_REMOTE="${2:?usage: squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> <CHANGE_DIR> [--allow-empty-declaration]}"
BASE_BRANCH="${3:?usage: squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> <CHANGE_DIR> [--allow-empty-declaration]}"
SUBJECT="${4:?usage: squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> <CHANGE_DIR> [--allow-empty-declaration]}"
CHANGE_DIR="${5:?usage: squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> <CHANGE_DIR> [--allow-empty-declaration]}"
ALLOW_EMPTY_DECLARATION=0
if [ "${6:-}" = "--allow-empty-declaration" ]; then
  ALLOW_EMPTY_DECLARATION=1
fi
DRY_RUN_MODE=0
if [ "${DRY_RUN:-0}" = "1" ]; then
  DRY_RUN_MODE=1
fi

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "FAIL worktree path does not exist: ${WORKTREE_PATH}" >&2
  exit 1
fi

BASE_REF="${BASE_REMOTE}/${BASE_BRANCH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/git-child-env.sh
source "${SCRIPT_DIR}/lib/git-child-env.sh"

git_wt() { git_child -C "$WORKTREE_PATH" "$@"; }

# --- D1: compute the true merge-base, refuse to guess under criss-cross ---
MERGE_BASES="$(git_wt merge-base --all HEAD "$BASE_REF" 2>/dev/null)"
if [ -z "$MERGE_BASES" ]; then
  echo "FAIL could not compute merge-base between HEAD and ${BASE_REF}" >&2
  exit 1
fi
MERGE_BASE_COUNT="$(printf '%s\n' "$MERGE_BASES" | grep -c .)"
if [ "$MERGE_BASE_COUNT" -gt 1 ]; then
  echo "FAIL ambiguous merge-base (criss-cross history) between HEAD and ${BASE_REF}:" >&2
  printf '%s\n' "$MERGE_BASES" >&2
  echo "Refusing to guess which one is correct. Resolve manually." >&2
  exit 1
fi
MERGE_BASE="$MERGE_BASES"

# --- D3: log base advancement, never gate on it ---
BASE_TIP="$(git_wt rev-parse "$BASE_REF" 2>/dev/null || true)"
if [ -n "$BASE_TIP" ] && [ "$BASE_TIP" != "$MERGE_BASE" ]; then
  ADVANCED_COUNT="$(git_wt rev-list --count "${MERGE_BASE}..${BASE_TIP}" 2>/dev/null || echo "?")"
  echo "INFO base ${BASE_REF} has advanced ${ADVANCED_COUNT} commit(s) past the merge-base since this branch diverged (${MERGE_BASE}). Squashing against the merge-base, not the live tip."
else
  echo "INFO base ${BASE_REF} has not advanced past the merge-base."
fi

# --- Staged file set (prospective: computed against the merge-base without
# moving HEAD, so a refusal never leaves the branch reset) ---
STAGED_FILES="$(git_wt diff --cached --name-only "$MERGE_BASE")"
STAGED_COUNT=0
if [ -n "$STAGED_FILES" ]; then
  STAGED_COUNT="$(printf '%s\n' "$STAGED_FILES" | grep -c .)"
fi

# --- D2: build allowlist = <CHANGE_DIR>/** union files-modified.md paths ---
# Normalize CHANGE_DIR: strip any trailing slash for consistent prefix match.
CHANGE_DIR_NORM="${CHANGE_DIR%/}"

FILES_MODIFIED_PATH="${WORKTREE_PATH%/}/${CHANGE_DIR_NORM}/files-modified.md"
DECLARATION_INDEX_PATH="${CHANGE_DIR_NORM}/files-modified.md"

# --- CON-162 D1/D2/D4/D4a: read the declaration from the STAGED BLOB, not the
# worktree copy, so the bytes the guard validates are the bytes the prospective
# commit will capture. The single on-disk-presence test below is the ONLY
# `[ -f "$FILES_MODIFIED_PATH" ]` branch-routing control in this script (per
# design.md D2/D7 -- on-disk presence is evaluated first and routes control;
# everything downstream reuses this one boolean rather than re-testing).
FILE_ON_DISK=0
if [ -f "$FILES_MODIFIED_PATH" ]; then
  FILE_ON_DISK=1
fi

STAGED_BLOB=""
STAGED_BLOB_PRESENT=0
if STAGED_BLOB="$(git_wt show ":${DECLARATION_INDEX_PATH}" 2>/dev/null)"; then
  STAGED_BLOB_PRESENT=1
fi

if [ "$FILE_ON_DISK" -eq 1 ] && [ "$STAGED_BLOB_PRESENT" -eq 0 ]; then
  # D4: on disk but not staged -- it will not be committed, so treating its
  # contents as the declaration is the same defect in a different costume.
  # This refusal is unconditional: neither ALLOW_EMPTY_DECLARATION nor any
  # other flag suppresses it (D5).
  echo "FAIL files-modified.md exists on disk at ${FILES_MODIFIED_PATH} but has no staged blob in the index (untracked, or staged for deletion)." >&2
  echo "It will not be part of the prospective commit, so its on-disk content cannot be validated as the declaration." >&2
  echo "Remedy: git add ${DECLARATION_INDEX_PATH}" >&2
  echo "        then re-run." >&2
  exit 1
fi

if [ "$FILE_ON_DISK" -eq 1 ] && [ "$STAGED_BLOB_PRESENT" -eq 1 ]; then
  # D2/D7: divergence check, gated on FILE_ON_DISK (per D2's precondition --
  # `git diff --quiet` exits 1 for a worktree deletion, so running this
  # ungated would misfire on the D4a shape below). This refusal is also
  # unconditional: ALLOW_EMPTY_DECLARATION does not suppress it (D5).
  if ! git_wt diff --quiet -- "$DECLARATION_INDEX_PATH"; then
    echo "FAIL files-modified.md differs between the staged index and the worktree copy." >&2
    echo "The guard must validate the same bytes the commit will capture, and cannot silently pick a side (index or worktree) when they disagree." >&2
    echo "Remedy: stage the corrected declaration (git add ${DECLARATION_INDEX_PATH}), or revert the worktree copy to match what is staged, then re-run." >&2
    exit 1
  fi
fi

if [ "$FILE_ON_DISK" -eq 0 ] && [ "$STAGED_BLOB_PRESENT" -eq 1 ]; then
  # D4a: staged blob present, no worktree copy. Not a divergence -- parse and
  # enforce the blob, exactly as D1 requires. Noted here (not silently) so the
  # one exemption in this design is visible in a transcript.
  echo "INFO files-modified.md declaration read from the index; no worktree copy is present."
fi

DECLARED_PATHS=""
# ALL_RAW_SPANS_ANYWHERE: every backtick-quoted span in the ENTIRE staged
# blob, regardless of line position -- kept ONLY for the diagnostic search
# in the FAIL report below (never for declaring). Lets a refusal say
# whether a file's basename appears somewhere in the declaration at all,
# even on a line the parser does not treat as a valid declaration position.
ALL_RAW_SPANS_ANYWHERE=""
if [ "$STAGED_BLOB_PRESENT" -eq 1 ]; then
  ALL_RAW_SPANS_ANYWHERE="$(printf '%s\n' "$STAGED_BLOB" | grep -oE '`[^`]+`' | tr -d '`' || true)"

  # D2a: a path is declared by a backtick-quoted span that comes
  # IMMEDIATELY (after only whitespace) at the start of either (a) a
  # bulleted line ('-'/'*' then the backtick), or (b) a continuation line,
  # ONLY while chained to a preceding line by that preceding line's
  # trailing (whitespace-trimmed) comma. Both anchors require the backtick
  # to be the first non-whitespace content -- prose before it
  # ("* Did not modify `lib/b.ts`", "- Deliberately did NOT touch
  # `secret.ts`") never opens a declaration, and a prose continuation line
  # ("  the unrelated `lib/b.ts` file (not touched).") never extends a
  # chain even when the previous line ended in a comma. This is the fix
  # for a cold-review finding against an earlier draft of this parser: it
  # had loosened the bullet test to "bullet + backtick anywhere on the
  # line" and opened the comma-chain on ANY trailing comma, both of which
  # let prose mentioning an untouched file's name in backticks be read as
  # a declaration. Restoring "backtick immediately, on either anchor" closes
  # both false-accepts while still reading CON-149's real comma-joined,
  # line-wrapped bullet in full.
  #
  # D2a-ii (CON-151): a qualifying line declares EVERY backtick-quoted span
  # on it, not just the first, so a grouped bullet declares all of its
  # paths.
  #
  # Before classifying a span, a trailing line-range annotation is
  # stripped (CON-158): `:<line>`, `:<line>-<line>`, or a comma-list of
  # either (`file.ts:111,184,220`, `file.ts:12-40,55`) all declare the
  # bare path. This is the ONLY line-annotation grammar accepted --
  # `#L12`-style GitHub anchors and a bare trailing `:` with no digits are
  # deliberately NOT stripped (never seen in this repo's own convention;
  # accepting them silently would make an actually-different suffix look
  # declared). The FAIL diagnostic below names these specifically rather
  # than lumping them into "no match".
  #
  # Both the RAW span (exact, unstripped) and its STRIPPED form (if
  # different) are added to DECLARED_PATHS -- so a staged path that
  # happens to contain a literal `:<digits>` in its own filename (rare,
  # but the stripping regex cannot tell it apart from a line annotation
  # without this) still matches via its untouched raw form.
  #
  # A span left with no `/` after stripping is kept as a literal
  # (unchanged pre-CON-149 behavior -- a bare top-level filename that
  # equals a staged path outright still matches directly), AND, if it also
  # ends in a dotted extension (path-shaped, so
  # `--allow-empty-declaration`/`Option[T]` inline-code spans still never
  # qualify), it is additionally resolved by inheriting the directory of
  # the NEAREST full-path span declared earlier in the SAME comma chain
  # (CON-149) -- e.g. `` `scripts/concertino/a.sh`, `b.sh` `` resolves
  # `b.sh` to `scripts/concertino/b.sh`. This is deterministic (last
  # full-path span wins, never a fuzzy "search everywhere and hope for a
  # unique match"), so there is no ambiguity heuristic to get wrong, and
  # it NEVER consults the staged file set -- a second cold-review finding
  # against an earlier draft did exactly that (matched a bare basename
  # against $STAGED_FILES), which let a bullet like "Deliberately did NOT
  # touch `secret.ts`" accidentally declare whatever staged file happened
  # to share that basename. Resolution now depends only on text that is
  # actually, unambiguously part of the declaration itself.
  LIST_OPEN=0
  CURRENT_DIR=""
  DECLARED_LIST=""
  strip_line_suffix() {
    printf '%s' "$1" | sed -E 's/:[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$//'
  }
  while IFS= read -r LINE; do
    TRIMMED="$(printf '%s' "$LINE" | sed -E 's/[[:space:]]+$//')"
    IS_BULLET_OPEN=0
    IS_CONT_OPEN=0
    if printf '%s' "$LINE" | grep -qE '^[[:space:]]*[-*][[:space:]]*`[^`]+`'; then
      IS_BULLET_OPEN=1
    elif printf '%s' "$LINE" | grep -qE '^[[:space:]]*`[^`]+`'; then
      IS_CONT_OPEN=1
    fi
    SCAN=0
    if [ "$IS_BULLET_OPEN" -eq 1 ]; then
      SCAN=1
      CURRENT_DIR=""
    elif [ "$IS_CONT_OPEN" -eq 1 ] && [ "$LIST_OPEN" -eq 1 ]; then
      SCAN=1
    fi
    if [ "$SCAN" -eq 1 ]; then
      LINE_SPANS="$(printf '%s\n' "$LINE" | grep -oE '`[^`]+`' | tr -d '`')"
      if [ -n "$LINE_SPANS" ]; then
        while IFS= read -r RAW; do
          [ -z "$RAW" ] && continue
          STRIPPED="$(strip_line_suffix "$RAW")"
          case "$STRIPPED" in
            */*)
              # full path (possibly with a stripped line annotation)
              DECLARED_LIST="${DECLARED_LIST}${RAW}
${STRIPPED}
"
              CURRENT_DIR="$(dirname -- "$STRIPPED")"
              ;;
            *.[A-Za-z0-9]*)
              # bare, path-shaped span
              DECLARED_LIST="${DECLARED_LIST}${RAW}
"
              if [ -n "$CURRENT_DIR" ]; then
                DECLARED_LIST="${DECLARED_LIST}${CURRENT_DIR}/${STRIPPED}
"
              fi
              ;;
            *)
              # not path-shaped (e.g. an inline-code flag/type) -- never
              # counts, regardless of position.
              ;;
          esac
        done <<< "$LINE_SPANS"
      fi
      case "$TRIMMED" in
        *,) LIST_OPEN=1 ;;
        *)  LIST_OPEN=0 ;;
      esac
    else
      LIST_OPEN=0
    fi
  done <<< "$STAGED_BLOB"

  DECLARED_PATHS="$DECLARED_LIST"
fi
DECLARED_COUNT=0
if [ -n "$DECLARED_PATHS" ]; then
  DECLARED_COUNT="$(printf '%s\n' "$DECLARED_PATHS" | grep -c .)"
fi

is_allowed() {
  local f="$1"
  # (a) change-dir allowlist
  case "$f" in
    "${CHANGE_DIR_NORM}"/*|"${CHANGE_DIR_NORM}") return 0 ;;
  esac
  # (b) declared in files-modified.md
  if [ -n "$DECLARED_PATHS" ]; then
    while IFS= read -r d; do
      [ -z "$d" ] && continue
      if [ "$f" = "$d" ]; then
        return 0
      fi
    done <<< "$DECLARED_PATHS"
  fi
  return 1
}

UNEXPECTED=""
if [ -n "$STAGED_FILES" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if ! is_allowed "$f"; then
      UNEXPECTED="${UNEXPECTED}${f}
"
    fi
  done <<< "$STAGED_FILES"
fi

# --- Always print staged count + list before any commit ---
echo "Staged file count: ${STAGED_COUNT}"
if [ "$STAGED_COUNT" -gt 0 ]; then
  echo "Staged files:"
  printf '%s\n' "$STAGED_FILES" | sed 's/^/  /'
else
  echo "Staged files: (none)"
fi

# describe_unexpected_span_issue: CON-158 -- name the SPECIFIC reason a raw
# declaration span, if any, did not resolve to a given unexpected file,
# rather than a fixed hypothesis or a wrongly-general "ambiguous match".
# Echoes nothing (caller checks $? / captures stdout) when it finds no span
# whose basename corresponds at all.
describe_unexpected_span_issue() {
  local ubase="$1" uf="$2" raw stripped core loose loose_core
  if [ -z "$ALL_RAW_SPANS_ANYWHERE" ]; then
    return 1
  fi
  while IFS= read -r raw; do
    [ -z "$raw" ] && continue
    stripped="$(strip_line_suffix "$raw")"
    case "$stripped" in
      */*) core="$(basename -- "$stripped")" ;;
      *)   core="$stripped" ;;
    esac
    if [ "$core" = "$ubase" ]; then
      # Same basename as the unexpected file, via the STRICT (accepted)
      # grammar -- whether or not a line annotation was actually present,
      # this names a genuinely different path (the different-directory
      # case, or a different-line-annotated path of the same basename
      # elsewhere). Reported this way regardless: it is never ambiguous,
      # just a different file.
      echo "declared as \`${stripped}\` (from raw span \`${raw}\`) -- a different file with the same basename, not this one. Not ambiguous: the two are simply different paths."
      return 0
    fi
    # Strict grammar found no basename match. Try a LOOSE strip
    # (also handles a bare trailing ':' with no digits, and a trailing
    # '#L<n>' anchor) purely to detect a near-match for diagnostic
    # purposes -- this never affects acceptance, only the message.
    loose="$(printf '%s' "$raw" | sed -E 's/#L?[0-9]+(-[0-9]+)?$//; s/:[0-9]*(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$//')"
    case "$loose" in
      */*) loose_core="$(basename -- "$loose")" ;;
      *)   loose_core="$loose" ;;
    esac
    if [ "$loose_core" != "$ubase" ]; then
      continue
    fi
    if printf '%s' "$raw" | grep -qE ':$'; then
      echo "found as \`${raw}\`, but a bare trailing ':' with no line number is not stripped by this parser (accepted: ':<line>', ':<line>-<line>', or a comma-list of either). If this is a line annotation, add the number; if ':' is part of the literal filename, the exact staged path must be written verbatim."
      return 0
    fi
    if printf '%s' "$raw" | grep -qE '#L?[0-9]+(-[0-9]+)?$'; then
      echo "found as \`${raw}\`, but a trailing '#L<n>'-style anchor is not a recognized line annotation here (accepted: ':<line>' / ':<line>-<line>', optionally comma-listed). Rewrite as \`<path>:<line>\` if this was meant to disambiguate a line."
      return 0
    fi
    echo "found as \`${raw}\`, but not in a position this parser treats as a declaration: the backtick must be the first non-whitespace content of either a bulleted line, or a continuation line chained to one by a trailing comma on the line before it."
    return 0
  done <<< "$ALL_RAW_SPANS_ANYWHERE"
  return 1
}

# --- D2a/D2b: unparseable/missing declaration while unexpected files remain ---
if [ "$DECLARED_COUNT" -eq 0 ] && [ -n "$UNEXPECTED" ]; then
  if [ "$ALLOW_EMPTY_DECLARATION" -ne 1 ]; then
    echo "FAIL no usable declaration in files-modified.md while staged files remain outside the allowlist (${CHANGE_DIR_NORM}/**)." >&2
    if [ "$STAGED_BLOB_PRESENT" -eq 1 ]; then
      echo "--- raw files-modified.md content (staged) ---" >&2
      printf '%s\n' "$STAGED_BLOB" >&2
      echo "------------------------------------------------" >&2
      if [ -n "$ALL_RAW_SPANS_ANYWHERE" ]; then
        echo "Note: the file above DOES contain backtick-quoted, path-shaped spans -- none of" >&2
        echo "them are in a position this parser recognizes as a declaration (a bulleted line, or" >&2
        echo "a continuation line chained to one by a trailing comma). Check formatting before" >&2
        echo "assuming this file declares nothing at all." >&2
      fi
    else
      echo "(no staged declaration blob exists at ${DECLARATION_INDEX_PATH})" >&2
    fi
    echo "Staged paths outside the allowlist:" >&2
    printf '%s' "$UNEXPECTED" | sed 's/^/  /' >&2
    echo "Pass --allow-empty-declaration to proceed anyway, or append the real paths to files-modified.md and re-run." >&2
    exit 1
  fi
  # --allow-empty-declaration explicitly opts in for this case: proceed to
  # commit without the generic "unexpected staged file" hard stop below,
  # which exists to guard the case where a declaration WAS parseable.
else
  # --- Any staged path outside the allowed union is a hard stop ---
  if [ -n "$UNEXPECTED" ]; then
    echo "FAIL staged file set exceeds the run's declared touched-file set. Unexpected file(s):" >&2
    while IFS= read -r UF; do
      [ -z "$UF" ] && continue
      UBASE="$(basename "$UF")"
      echo "  ${UF}" >&2
      REASON="$(describe_unexpected_span_issue "$UBASE" "$UF")"
      if [ -n "$REASON" ]; then
        echo "    ${REASON}" >&2
      else
        echo "    no span matching basename '${UBASE}' found anywhere in files-modified.md." >&2
      fi
    done <<< "$UNEXPECTED"
    echo "(allowed: ${CHANGE_DIR_NORM}/** plus paths declared in the staged declaration at ${DECLARATION_INDEX_PATH})" >&2
    echo "Declaration format: a path is declared by a backtick-quoted span whose backtick is the" >&2
    echo "FIRST non-whitespace content of either a bulleted line ('-'/'*'), or a continuation line" >&2
    echo "chained to one by a trailing comma on the line before it -- the chain breaks the moment a" >&2
    echo "scanned line does not end in a comma. An optional trailing ':<line>' or ':<line>-<line>'" >&2
    echo "(comma-listed combinations of either) is stripped before matching. A bare basename in a" >&2
    echo "comma-joined list resolves only by inheriting the directory of the nearest full-path span" >&2
    echo "declared earlier in the SAME chain -- never against the staged file set." >&2
    echo "Refusing to commit. Investigate before re-running." >&2
    exit 1
  fi
fi

# --- Guard passed: reset against the merge-base, never the base ref's live
# tip, then create the squash commit ---
if [ "$DRY_RUN_MODE" = "1" ]; then
  echo "READY dry run: guard passed, nothing committed (DRY_RUN=1)"
  exit 0
fi

# --- CON-170 D2: record the pre-reset HEAD so any non-success exit below
# this point can restore the branch to exactly the state it held when the
# script was invoked. Fail loudly if it cannot be read -- proceeding without
# a restore point would silently reintroduce the stranding defect this
# change exists to fix. ---
if ! PRE_SQUASH_HEAD="$(git_wt rev-parse HEAD 2>/dev/null)" || [ -z "$PRE_SQUASH_HEAD" ]; then
  echo "FAIL could not record pre-squash HEAD before resetting; refusing to proceed" >&2
  exit 1
fi

# restore_pre_squash_head: `--soft` back to the recorded HEAD. `--soft` only
# moves the ref -- it never touches the index or working tree -- so this is
# always a safe, non-destructive undo of the forward `--soft` reset below
# (D2). A hook that mutated the index before failing (e.g. `lint --fix` +
# `git add`) is not undone by this -- the script performs no index mutation
# of its own and restores the ref faithfully; it cannot unilaterally
# guarantee a third party made none.
restore_pre_squash_head() {
  if ! git_wt reset --soft "$PRE_SQUASH_HEAD" >/dev/null 2>&1; then
    CURRENT_HEAD="$(git_wt rev-parse HEAD 2>/dev/null || echo "<unreadable>")"
    echo "FAIL could not restore HEAD to ${PRE_SQUASH_HEAD} (current HEAD: ${CURRENT_HEAD})." >&2
    echo "The branch may be left at an intermediate state. Recover manually via the reflog (git reflog)." >&2
    return 1
  fi
  return 0
}

# --- CON-170 D2: arm an EXIT trap covering the reset->commit interval, so an
# abnormal, catchable termination (SIGTERM/SIGINT/SIGHUP; a harness kill or
# window-reap) between the reset and the commit also restores the branch
# rather than leaving it stranded at the merge-base. SIGKILL is uncatchable
# and is outside this guarantee. Disarmed immediately after a successful
# commit so it can never fire on the success path. ---
trap 'restore_pre_squash_head' EXIT

if ! git_wt reset --soft "$MERGE_BASE" >/dev/null 2>&1; then
  echo "FAIL git reset --soft ${MERGE_BASE} failed" >&2
  exit 1
fi

if ! git_wt commit -q -m "$SUBJECT" >/dev/null 2>&1; then
  echo "FAIL git commit failed after guard passed" >&2
  if restore_pre_squash_head; then
    echo "Branch restored to pre-squash HEAD ${PRE_SQUASH_HEAD}." >&2
  fi
  exit 1
fi

trap - EXIT

echo "READY squash commit created on $(git_wt rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
exit 0
