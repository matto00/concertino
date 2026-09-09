#!/usr/bin/env bash
# CON-172: the rendered self-hosted copies under scripts/concertino/ must
# not diverge from the core/scripts/ templates they are generated from.
#
# Enumerates from core/scripts/** only (never from scripts/concertino/), so
# config-derived render products with no core counterpart (.concertino.env,
# speeds.json) are out of scope by construction rather than by exclusion
# list. For each enumerated file: byte-compares it against its rendered
# counterpart, and separately (for .sh files) asserts the render is
# executable -- NOT that the two modes are equal, since
# lib/cli/emit.js:450 forces every rendered .sh to 0755 regardless of
# core's own mode (core/scripts/lib/git-child-env.sh is committed 644
# against a 755 render with an identical blob; a mode-equality gate would
# be red on arrival for that file with a remedy that cannot clear it).
#
# Missing counterparts are reported separately from content mismatches,
# and honour a narrow exemption list -- currently EMPTY -- that suppresses
# ONLY the missing-counterpart case, never a content mismatch.
# The exemption table is readable from the environment
# (RENDERED_SCRIPTS_DRIFT_EXEMPT_EXTRA, newline-separated relative paths)
# so the mechanism can be tested without editing this script.
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CORE="$ROOT/core/scripts"
RENDERED="$ROOT/scripts/concertino"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

# When sourced with RENDERED_SCRIPTS_DRIFT_SOURCE_ONLY=1 (used by the manual
# mutation-transcript runs against the real tree), define run_drift_check
# and CORE/RENDERED and return before running the test body below.
SOURCE_ONLY="${RENDERED_SCRIPTS_DRIFT_SOURCE_ONLY:-}"

echo "rendered-scripts-drift.test.sh (CON-172 rendered-script-drift-gate)"

# --- the check itself, as a reusable function --------------------------------
# $1 = core dir, $2 = rendered dir, $3 = extra exemption entries (newline-
# separated, optional). Prints the report and returns 0/1 on stdout via
# echo "RC=<n>" as the final line, so tests can drive it against scratch
# trees without forking a whole new process.
run_drift_check() {
  local core_dir="$1" rendered_dir="$2" extra_exempt="${3:-}"

  # Built-in exemption table: deliberately EMPTY. Every entry must carry a
  # written reason naming a tracked open question, and there is no such open
  # question right now -- CON-173 was resolved by rendering and committing
  # pricing-table.json and report-cost.sh rather than by exempting them.
  # Keep it empty: an exemption is a suppressed defect, so the bar for adding
  # one is a named, tracked, answerable question, not a convenience.
  local -A exempt=()
  if [ -n "$extra_exempt" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      exempt["$line"]="environment-supplied (test-only)"
    done <<< "$extra_exempt"
  fi

  local differs=() not_exec=() missing=()
  local rel
  while IFS= read -r rel; do
    local core_file="$core_dir/$rel"
    local rendered_file="$rendered_dir/$rel"
    if [ ! -e "$rendered_file" ]; then
      if [ -n "${exempt[$rel]+x}" ]; then
        continue
      fi
      missing+=("$rel")
      continue
    fi
    if ! cmp -s "$core_file" "$rendered_file"; then
      differs+=("$rel")
    fi
    case "$rel" in
      *.sh)
        if [ ! -x "$rendered_file" ]; then
          not_exec+=("$rel")
        fi
        ;;
    esac
  done < <(cd "$core_dir" && find . -type f | sed 's#^\./##' | sort)

  local rc=0
  if [ "${#differs[@]}" -gt 0 ] || [ "${#not_exec[@]}" -gt 0 ] || [ "${#missing[@]}" -gt 0 ]; then
    rc=1
    echo "rendered-scripts-drift: scripts/concertino/ has drifted from core/scripts/"
    if [ "${#differs[@]}" -gt 0 ]; then
      echo "content differs:"
      printf '  %s\n' "${differs[@]}"
    fi
    if [ "${#not_exec[@]}" -gt 0 ]; then
      echo "not executable:"
      printf '  %s\n' "${not_exec[@]}"
    fi
    if [ "${#missing[@]}" -gt 0 ]; then
      echo "never rendered:"
      printf '  %s\n' "${missing[@]}"
    fi
    echo "remedy: run 'concertino sync' and commit the resulting render as its own reviewable diff. Do not hand-edit files under scripts/concertino/."
  fi
  return "$rc"
}

if [ -n "$SOURCE_ONLY" ]; then
  return 0 2>/dev/null || exit 0
fi

# =============================================================================
# 1. Green on the real, unmutated tree. NOT sufficient evidence alone -- see
#    the mutation checks below, which is why this repo's own npm test run
#    isn't cited as proof by itself.
# =============================================================================
echo
echo "-- against the real repo tree (informational; not proof by itself) --"
if run_drift_check "$CORE" "$RENDERED"; then
  ok "1.1 real tree: drift check exits zero"
else
  bad "1.1 real tree: drift check exits zero" "the real tree has unresolved drift -- see output above"
fi

# =============================================================================
# 2. Mutation coverage against scratch trees, so the property under test is
#    demonstrated rather than merely asserted, and no owner-protected path
#    in the main checkout is ever touched.
# =============================================================================
new_scratch_trees() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/core" "$d/rendered/lib"
  cat > "$d/core/a.sh" <<'EOF'
#!/usr/bin/env bash
echo a
EOF
  chmod 755 "$d/core/a.sh"
  cp "$d/core/a.sh" "$d/rendered/a.sh"
  chmod 755 "$d/rendered/a.sh"

  cat > "$d/core/README.md" <<'EOF'
readme
EOF
  cp "$d/core/README.md" "$d/rendered/README.md"

  printf '%s' "$d"
}

# --- 2.1 content mismatch on a rendered copy ---------------------------------
D="$(new_scratch_trees)"
run_drift_check "$D/core" "$D/rendered" >/dev/null
check "2.1 scratch: clean trees, drift check exits zero" "$?" "0"

printf 'X' >> "$D/rendered/a.sh"
OUT="$(run_drift_check "$D/core" "$D/rendered")"; RC=$?
check "2.2 mutated rendered copy: exits non-zero" "$RC" "1"
case "$OUT" in
  *"content differs:"*"a.sh"*) ok "2.3 mutated rendered copy: reported under content differs" ;;
  *) bad "2.3 mutated rendered copy: reported under content differs" "$OUT" ;;
esac
# restore
cp "$D/core/a.sh" "$D/rendered/a.sh"; chmod 755 "$D/rendered/a.sh"
run_drift_check "$D/core" "$D/rendered" >/dev/null
check "2.4 restored rendered copy: green again" "$?" "0"
rm -rf "$D"

# --- 2.5 non-executable render, content matches ------------------------------
D="$(new_scratch_trees)"
chmod 644 "$D/rendered/a.sh"
OUT="$(run_drift_check "$D/core" "$D/rendered")"; RC=$?
check "2.5 non-executable render (content matches): exits non-zero" "$RC" "1"
case "$OUT" in
  *"not executable:"*"a.sh"*) ok "2.6 non-executable render: reported under not executable" ;;
  *) bad "2.6 non-executable render: reported under not executable" "$OUT" ;;
esac
case "$OUT" in
  *"content differs:"*"a.sh"*) bad "2.7 non-executable render: NOT also reported as content differs" "$OUT" ;;
  *) ok "2.7 non-executable render: NOT also reported as content differs" ;;
esac
chmod 755 "$D/rendered/a.sh"
run_drift_check "$D/core" "$D/rendered" >/dev/null
check "2.8 restored executable bit: green again" "$?" "0"
rm -rf "$D"

# --- 2.9 mode-inequality-but-executable is NOT reported (the real-world
#     git-child-env.sh case: core 644, render 755, identical blob) -----------
D="$(new_scratch_trees)"
chmod 644 "$D/core/a.sh"
chmod 755 "$D/rendered/a.sh"
run_drift_check "$D/core" "$D/rendered" >/dev/null
check "2.9 core non-executable, render executable, same content: not reported (green)" "$?" "0"
rm -rf "$D"

# --- 2.10 missing counterpart, no exemption ----------------------------------
D="$(new_scratch_trees)"
cat > "$D/core/never-rendered.sh" <<'EOF'
#!/usr/bin/env bash
echo new
EOF
chmod 755 "$D/core/never-rendered.sh"
OUT="$(run_drift_check "$D/core" "$D/rendered")"; RC=$?
check "2.11 unrendered core file, no exemption: exits non-zero" "$RC" "1"
case "$OUT" in
  *"never rendered:"*"never-rendered.sh"*) ok "2.12 unrendered core file: reported under never rendered" ;;
  *) bad "2.12 unrendered core file: reported under never rendered" "$OUT" ;;
esac
rm -f "$D/core/never-rendered.sh"
run_drift_check "$D/core" "$D/rendered" >/dev/null
check "2.13 removed the throwaway file: green again" "$?" "0"
rm -rf "$D"

# --- 2.14 an exemption suppresses the missing case ---------------------------
#     Driven by a synthetic env-supplied entry, not by the built-in table,
#     which is empty by design. This keeps the mechanism under test without
#     requiring a real suppressed defect to exist for the test to mean
#     anything -- and it stays honest if the built-in table is ever repopulated.
D="$(new_scratch_trees)"
cat > "$D/core/only-in-core.json" <<'EOF'
{}
EOF
run_drift_check "$D/core" "$D/rendered" >/dev/null
check "2.15a unexempt file, no rendered counterpart: red (the exemption is load-bearing)" "$?" "1"
run_drift_check "$D/core" "$D/rendered" "only-in-core.json" >/dev/null
check "2.15b same file, exempted: green" "$?" "0"
rm -rf "$D"

# --- 2.16 exemption does NOT suppress a content mismatch (via a synthetic
#     env-supplied entry over an ordinary rendered file) --------------------
D="$(new_scratch_trees)"
printf 'X' >> "$D/rendered/a.sh"
OUT="$(run_drift_check "$D/core" "$D/rendered" "a.sh")"; RC=$?
check "2.17 synthetic exemption over a mutated rendered file: still exits non-zero" "$RC" "1"
case "$OUT" in
  *"content differs:"*"a.sh"*) ok "2.18 synthetic exemption cannot suppress a content mismatch" ;;
  *) bad "2.18 synthetic exemption cannot suppress a content mismatch" "$OUT" ;;
esac
rm -rf "$D"

# --- 2.19 the remedy is named, and no hand-edit of scripts/concertino/ is
#     suggested ---------------------------------------------------------------
D="$(new_scratch_trees)"
printf 'X' >> "$D/rendered/a.sh"
OUT="$(run_drift_check "$D/core" "$D/rendered")"
case "$OUT" in
  *"concertino sync"*"reviewable diff"*) ok "2.20 failure output names 'concertino sync' and a reviewable diff as the remedy" ;;
  *) bad "2.20 failure output names 'concertino sync' and a reviewable diff as the remedy" "$OUT" ;;
esac
case "$OUT" in
  *"Do not hand-edit files under scripts/concertino/"*) ok "2.21 failure output does not invite a hand-edit of scripts/concertino/" ;;
  *) bad "2.21 failure output does not invite a hand-edit of scripts/concertino/" "$OUT" ;;
esac
rm -rf "$D"

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
