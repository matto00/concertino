#!/usr/bin/env bash
# Shell tests for bin/concertino's core-resolution logic (CON-13). Run:
#   bash test/scripts/sync-core-resolution.test.sh
#
# `concertino sync` used to always render from the core next to the
# *executing* copy of bin/concertino (`path.resolve(__dirname, '..')`). That
# is right for an npm-installed package but wrong for Concertino developing
# itself: a globally npm-linked CLI, invoked from inside one of its own
# delivery worktrees, rendered the MAIN checkout's core/ into the worktree —
# silently reverting any in-flight edit to core/scripts/* the worktree had
# made. These tests cover the fix: a two-part git-ancestry check (Decision 1
# in design.md) that renders from the target's own core only when the
# executing script's own repo is itself a git working-tree root AND the
# target shares the same superproject — plus the false-positive cases that
# check is specifically designed to reject.
#
# SAFETY: every `concertino sync`/`doctor`/`init`/`eject`/`diff` invocation
# below runs against a throwaway COPY of bin/+adapters/+core/+config/ (built
# fresh per test by new_main()), never against this checkout's own
# bin/concertino. This test never invokes this repo's own CLI on itself.
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
has()  { if grep -qF "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1" "expected to find [$2] in $3"; fi; }
hasnt(){ if grep -qF "$2" "$3" 2>/dev/null; then bad "$1" "unexpectedly found [$2] in $3"; else ok "$1"; fi; }

echo "bin/concertino (core resolution)"

# A throwaway "installed package" checkout — bin/ + adapters/ + core/ +
# config/ + package.json, copied fresh from this project and git-initialized
# so it is itself a bona fide git working-tree root. This plays the role of
# the executing script's own REPO in every scenario below.
new_main() {
  local d; d="$(mktemp -d)"
  cp -r "$ROOT/bin" "$d/bin"
  cp -r "$ROOT/adapters" "$d/adapters"
  cp -r "$ROOT/core" "$d/core"
  cp -r "$ROOT/config" "$d/config"
  cp "$ROOT/package.json" "$d/package.json"
  git -C "$d" init -q
  git -C "$d" -c user.email=t@t.test -c user.name=t add -A
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q -m init
  printf '%s' "$d"
}

# A project config good enough for `sync`/`doctor`/`init` to run to
# completion without errors (extra fields like $schema are harmless).
write_config() { cp "$1/config/examples/generic.json" "$2/concertino.config.json"; }

# --- 3.1: worktree case — edited core/scripts renders from the worktree's ---
# own (edited) core, not the main checkout's. This is the ticket's central AC.
MAIN="$(new_main)"
git -C "$MAIN" worktree add -q "$MAIN/wt" -b feat-3-1
WT="$MAIN/wt"
write_config "$MAIN" "$WT"
printf '\n# WORKTREE-EDIT-MARKER\n' >> "$WT/core/scripts/start-servers.sh"

OUT="$WT/sync-out.txt"
node "$MAIN/bin/concertino" sync --out="$WT" > "$OUT" 2>&1
RC=$?
check "3.1 sync exits zero"                          "$RC" "0"
has   "3.1 renders the worktree's own edited core"    "WORKTREE-EDIT-MARKER"              "$WT/scripts/concertino/start-servers.sh"
has   "3.1 prints a divergence note"                  "differs from the executing script"  "$OUT"
has   "3.1 note names the worktree's own core path"   "$WT/core"                           "$OUT"
has   "3.1 note names the executing script's core"    "$MAIN/core"                         "$OUT"
rm -rf "$MAIN"

# --- 3.2: npm-installed case — no core/ of its own, no ancestry detection ---
MAIN="$(new_main)"
TARGET="$(mktemp -d)"   # plain directory: no .git at all, no core/ of its own
write_config "$MAIN" "$TARGET"
OUT="$TARGET/sync-out.txt"
node "$MAIN/bin/concertino" sync --out="$TARGET" > "$OUT" 2>&1
RC=$?
check "3.2 sync exits zero" "$RC" "0"
check "3.2 renders byte-identical to the package's own core" \
  "$(cat "$TARGET/scripts/concertino/start-servers.sh")" \
  "$(cat "$MAIN/core/scripts/start-servers.sh")"
hasnt "3.2 no divergence note printed" "differs from the executing script" "$OUT"
rm -rf "$MAIN" "$TARGET"

# --- 3.3: unrelated independent repo with its own coincidental core/ -------
MAIN="$(new_main)"
TARGET="$(mktemp -d)"
git -C "$TARGET" init -q
git -C "$TARGET" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
mkdir -p "$TARGET/core/scripts"
printf '#!/bin/sh\necho UNRELATED-CORE\n' > "$TARGET/core/scripts/start-servers.sh"
write_config "$MAIN" "$TARGET"
OUT="$TARGET/sync-out.txt"
node "$MAIN/bin/concertino" sync --out="$TARGET" > "$OUT" 2>&1
RC=$?
check "3.3 sync exits zero" "$RC" "0"
check "3.3 renders from the executing script's own core" \
  "$(cat "$TARGET/scripts/concertino/start-servers.sh")" \
  "$(cat "$MAIN/core/scripts/start-servers.sh")"
hasnt "3.3 the unrelated repo's own core is never used" "UNRELATED-CORE" "$TARGET/scripts/concertino/start-servers.sh"
hasnt "3.3 no divergence note printed"                   "differs from the executing script" "$OUT"
rm -rf "$MAIN" "$TARGET"

# --- 3.4: realistic npm-nested-dependency false positive (design-gate ------
# round 2, finding 3) — a git-tracked consumer with node_modules/concertino
# (no .git of its own) nested inside it, and the consumer itself happens to
# have its own top-level core/ for unrelated reasons.
CONSUMER="$(mktemp -d)"
git -C "$CONSUMER" init -q
MAIN="$(new_main)"
mkdir -p "$CONSUMER/node_modules/concertino"
cp -r "$MAIN/bin" "$CONSUMER/node_modules/concertino/bin"
cp -r "$MAIN/adapters" "$CONSUMER/node_modules/concertino/adapters"
cp -r "$MAIN/core" "$CONSUMER/node_modules/concertino/core"
cp "$MAIN/package.json" "$CONSUMER/node_modules/concertino/package.json"
# node_modules/concertino has NO .git of its own — the ordinary npm-install topology.
mkdir -p "$CONSUMER/core/scripts"
printf '#!/bin/sh\necho CONSUMER-COINCIDENTAL-CORE\n' > "$CONSUMER/core/scripts/start-servers.sh"
git -C "$CONSUMER" -c user.email=t@t.test -c user.name=t add -A
git -C "$CONSUMER" -c user.email=t@t.test -c user.name=t commit -q -m init
write_config "$MAIN" "$CONSUMER"

NESTED_TOPLEVEL="$(cd "$CONSUMER/node_modules/concertino" && git rev-parse --show-toplevel 2>/dev/null)"
check "3.4 ancestry check's first part correctly fails (repo is not its own toplevel)" \
  "$([ "$(cd "$NESTED_TOPLEVEL" && pwd)" != "$(cd "$CONSUMER/node_modules/concertino" && pwd)" ] && echo yes || echo no)" \
  "yes"

OUT="$CONSUMER/sync-out.txt"
node "$CONSUMER/node_modules/concertino/bin/concertino" sync --out="$CONSUMER" > "$OUT" 2>&1
RC=$?
check "3.4 sync exits zero" "$RC" "0"
check "3.4 renders from the nested package's own core" \
  "$(cat "$CONSUMER/scripts/concertino/start-servers.sh")" \
  "$(cat "$CONSUMER/node_modules/concertino/core/scripts/start-servers.sh")"
hasnt "3.4 consumer's coincidental core/ is never touched" "CONSUMER-COINCIDENTAL-CORE" "$CONSUMER/scripts/concertino/start-servers.sh"
hasnt "3.4 no divergence note printed"                      "differs from the executing script" "$OUT"
rm -rf "$MAIN" "$CONSUMER"

# --- 3.5: --core=PATH forces a specific core, bypassing detection ----------
MAIN="$(new_main)"
git -C "$MAIN" worktree add -q "$MAIN/wt" -b feat-3-5
WT="$MAIN/wt"
write_config "$MAIN" "$WT"
printf '\n# WORKTREE-EDIT-MARKER\n' >> "$WT/core/scripts/start-servers.sh"
ALTCORE="$(mktemp -d)"
cp -r "$MAIN/core/." "$ALTCORE/"
printf '\n# ALT-CORE-MARKER\n' >> "$ALTCORE/scripts/start-servers.sh"

OUT="$WT/sync-out.txt"
node "$MAIN/bin/concertino" sync --out="$WT" --core="$ALTCORE" > "$OUT" 2>&1
RC=$?
check "3.5 sync --core exits zero"                                "$RC" "0"
has   "3.5 --core overrides the worktree's own core"              "ALT-CORE-MARKER"      "$WT/scripts/concertino/start-servers.sh"
hasnt "3.5 --core is not mixed with the worktree's own edit"      "WORKTREE-EDIT-MARKER" "$WT/scripts/concertino/start-servers.sh"
hasnt "3.5 no divergence note when --core is given"               "differs from the executing script" "$OUT"

TARGET="$(mktemp -d)"
write_config "$MAIN" "$TARGET"
node "$MAIN/bin/concertino" sync --out="$TARGET" --core="$ALTCORE" > "$TARGET/sync-out.txt" 2>&1
check "3.5 --core also overrides the plain fallback path" "$?" "0"
has "3.5 fallback-path render also comes from --core" "ALT-CORE-MARKER" "$TARGET/scripts/concertino/start-servers.sh"
rm -rf "$MAIN" "$TARGET" "$ALTCORE"

# --- 3.6: `concertino init` smoke test post-refactor (no ReferenceError) ---
MAIN="$(new_main)"
git -C "$MAIN" worktree add -q "$MAIN/wt" -b feat-3-6
WT="$MAIN/wt"
printf '\n# WORKTREE-EDIT-MARKER\n' >> "$WT/core/scripts/start-servers.sh"
OUT="$WT/init-out.txt"
node "$MAIN/bin/concertino" init --out="$WT" --example=generic --no-spec-setup > "$OUT" 2>&1
RC=$?
check "3.6 init exits zero"                                       "$RC" "0"
hasnt "3.6 init: no ReferenceError (CORE is no longer a module constant)" "ReferenceError" "$OUT"
has   "3.6 init renders from the worktree's own resolved core"    "WORKTREE-EDIT-MARKER" "$WT/scripts/concertino/start-servers.sh"
rm -rf "$MAIN"

# --- 3.6b: `concertino init --core=PATH` — both the directly-copied assets --
# (copyAssets, called by cmdInit itself) AND the role/agent files (produced
# by cmdInit's internal cmdSync(...) call) must come from PATH, never a mix
# of PATH and auto-detected core (design.md Decision 6 / tasks.md 1.4).
MAIN="$(new_main)"
TARGET="$(mktemp -d)"
ALTCORE="$(mktemp -d)"
cp -r "$MAIN/core/." "$ALTCORE/"
printf '\nCUSTOM-CORE-LAW-MARKER\n' >> "$ALTCORE/laws/systematic-debugging.md"
printf '\nCUSTOM-CORE-ROLE-MARKER\n' >> "$ALTCORE/roles/executor.md"

OUT="$TARGET/init-out.txt"
node "$MAIN/bin/concertino" init --out="$TARGET" --example=generic --no-spec-setup --core="$ALTCORE" > "$OUT" 2>&1
RC=$?
check "3.6b init --core exits zero" "$RC" "0"
has "3.6b directly-copied assets (copyAssets) come from --core" \
  "CUSTOM-CORE-LAW-MARKER" "$TARGET/.concertino/laws/systematic-debugging.md"
has "3.6b internally-synced role file (cmdInit's own cmdSync call) comes from the SAME --core" \
  "CUSTOM-CORE-ROLE-MARKER" "$TARGET/.claude/agents/concertino-executor.md"
rm -rf "$MAIN" "$TARGET" "$ALTCORE"

# --- 3.7: eject/diff smoke test against a worktree target ------------------
MAIN="$(new_main)"
git -C "$MAIN" worktree add -q "$MAIN/wt" -b feat-3-7
WT="$MAIN/wt"
write_config "$MAIN" "$WT"
printf '\nWORKTREE-ROLE-MARKER\n' >> "$WT/core/roles/executor.md"

EJECT_OUT="$WT/eject-out.txt"
node "$MAIN/bin/concertino" eject --role=executor --out="$WT" --config="$WT/concertino.config.json" > "$EJECT_OUT" 2>&1
RC=$?
check "3.7 eject exits zero"                                    "$RC" "0"
hasnt "3.7 eject: no ReferenceError"                            "ReferenceError"       "$EJECT_OUT"
has   "3.7 eject reads role content from the resolved core"     "WORKTREE-ROLE-MARKER" "$EJECT_OUT"

DIFF_OUT="$WT/diff-out.txt"
node "$MAIN/bin/concertino" diff --out="$WT" --config="$WT/concertino.config.json" > "$DIFF_OUT" 2>&1
RC=$?
check "3.7 diff exits zero"                     "$RC" "0"
hasnt "3.7 diff: no ReferenceError"              "ReferenceError"    "$DIFF_OUT"
has   "3.7 diff runs against the resolved core"  "concertino diff"   "$DIFF_OUT"
rm -rf "$MAIN"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
