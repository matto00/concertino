#!/usr/bin/env bash
# Shell tests for scripts/concertino/check-gate-chain-change.sh (CON-132):
# mechanical classification of a branch's diff as touching the target
# repo's commit-gate chain. Every case runs the REAL script against a
# throwaway `mktemp -d` fixture repo, never a reimplementation.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/check-gate-chain-change.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()  { if printf '%s' "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "expected to find [$3] in: $2"; fi; }
lacks(){ if printf '%s' "$2" | grep -qF "$3"; then bad "$1" "did NOT expect [$3] in: $2"; else ok "$1"; fi; }

echo "check-gate-chain-change.sh (CON-132)"

# A base fixture repo shaped like a real target repo's commit-gate chain: a
# .husky/pre-commit hook that runs `npm run check:foo`, a package.json
# resolving that script name to scripts/check-foo.mjs, and an unrelated
# README the "ordinary diff" case touches instead.
new_base_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q -b main
  mkdir -p "$d/.husky" "$d/scripts"
  cat > "$d/.husky/pre-commit" <<'EOF'
#!/usr/bin/env sh
npm run check:foo
EOF
  cat > "$d/package.json" <<'EOF'
{"scripts": {"check:foo": "node scripts/check-foo.mjs"}}
EOF
  cat > "$d/scripts/check-foo.mjs" <<'EOF'
console.log("ok");
EOF
  echo "hello" > "$d/README.md"
  git -C "$d" add -A
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q -m init
  printf '%s' "$d"
}

# --- Case 1: .husky/**-touching diff -> flagged -----------------------------
REPO="$(new_base_repo)"
git -C "$REPO" checkout -q -b feature-husky
cat > "$REPO/.husky/pre-commit" <<'EOF'
#!/usr/bin/env sh
npm run check:foo
npm run check:bar
EOF
git -C "$REPO" add -A
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "add gate"
OUT1="$("$SCRIPT" "$REPO" main 2>&1)"
has "husky-touching diff flagged" "$OUT1" "GATECHAIN yes"
has "husky-touching diff names .husky/pre-commit" "$OUT1" "HUSKY .husky/pre-commit"

# --- Case 2: hook-invoked-script-touching diff -> flagged -------------------
REPO2="$(new_base_repo)"
git -C "$REPO2" checkout -q -b feature-script
cat > "$REPO2/scripts/check-foo.mjs" <<'EOF'
console.log("changed");
EOF
git -C "$REPO2" add -A
git -C "$REPO2" -c user.email=t@t.test -c user.name=t commit -q -m "modify hook-invoked script"
OUT2="$("$SCRIPT" "$REPO2" main 2>&1)"
has "hook-invoked script diff flagged" "$OUT2" "GATECHAIN yes"
has "hook-invoked script diff names the script" "$OUT2" "SCRIPT scripts/check-foo.mjs"
lacks "hook-invoked script diff (no .husky/ path touched) has no HUSKY line" "$OUT2" "HUSKY "

# --- Case 3: ordinary diff -> not flagged -----------------------------------
REPO3="$(new_base_repo)"
git -C "$REPO3" checkout -q -b feature-ordinary
echo "more docs" >> "$REPO3/README.md"
git -C "$REPO3" add -A
git -C "$REPO3" -c user.email=t@t.test -c user.name=t commit -q -m "docs only"
OUT3="$("$SCRIPT" "$REPO3" main 2>&1)"
has "ordinary diff not flagged" "$OUT3" "GATECHAIN no"
lacks "ordinary diff has no HUSKY line" "$OUT3" "HUSKY "
lacks "ordinary diff has no SCRIPT line" "$OUT3" "SCRIPT "

rm -rf "$REPO" "$REPO2" "$REPO3"

echo ""
echo "check-gate-chain-change.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
