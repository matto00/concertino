#!/usr/bin/env bash
# Shell tests for CON-2's harness-identity plumbing. Run:
#   bash test/scripts/harness-identity.test.sh
#
# Covers two halves of the feature:
#   (a) bin/concertino's renderEnv() — the static CONCERTINO_HARNESS default
#       `concertino sync` writes into .concertino.env: the single configured
#       harness, or empty when more than one is configured.
#   (b) core/scripts/setup-worktree.sh's runtime detect_harness() — the
#       CLAUDECODE / CODEX_SANDBOX(_NETWORK_DISABLED) process-env signals that
#       override the static default at run time, including the
#       both-signals-set-simultaneously case where CLAUDECODE wins, and the
#       fallback chain down to the static default and then "unknown".
#
# SAFETY: part (a) syncs into a throwaway --out directory (never this
# checkout's own scripts/concertino/). Part (b) runs against throwaway copies
# of setup-worktree.sh + emit-event.sh in a scratch dir, invoked inside a
# freshly created scratch git repo — never this checkout's own repo or its
# own core/scripts/.concertino.env (which does not exist; only the synced
# project copy at scripts/concertino/.concertino.env does).
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
has()  { if grep -qF "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1" "expected to find [$2] in $3"; fi; }

echo "harness identity (CON-2)"

# ===========================================================================
# (a) renderEnv — static CONCERTINO_HARNESS default at sync time
# ===========================================================================

write_config() {
  # $1 = target dir, $2 = JSON array literal for "harnesses", e.g. '["claude-code"]'
  node -e '
    const fs = require("fs");
    const base = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    base.harnesses = JSON.parse(process.argv[3]);
    fs.writeFileSync(process.argv[2], JSON.stringify(base, null, 2));
  ' "$ROOT/config/examples/generic.json" "$1/concertino.config.json" "$2"
}

# --- single harness configured -> the one value, never empty ---------------
OUT="$(mktemp -d)"
write_config "$OUT" '["claude-code"]'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" >"$OUT/sync-out.txt" 2>&1
RC=$?
check "a.1 single-harness sync exits zero" "$RC" "0"
has   "a.1 renders CONCERTINO_HARNESS='claude-code'" "CONCERTINO_HARNESS='claude-code'" "$OUT/scripts/concertino/.concertino.env"
has   "a.1 validate reports static resolution" "harness telemetry" "$OUT/sync-out.txt"
has   "a.1 validate names the static value" "static: claude-code" "$OUT/sync-out.txt"
rm -rf "$OUT"

# --- multiple harnesses configured -> empty, never a guess ------------------
OUT="$(mktemp -d)"
write_config "$OUT" '["claude-code","codex"]'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" >"$OUT/sync-out.txt" 2>&1
RC=$?
check "a.2 multi-harness sync exits zero" "$RC" "0"
has   "a.2 renders CONCERTINO_HARNESS=''" "CONCERTINO_HARNESS=''" "$OUT/scripts/concertino/.concertino.env"
has   "a.2 validate reports runtime-detected resolution" "runtime-detected" "$OUT/sync-out.txt"
rm -rf "$OUT"

# ===========================================================================
# (b) setup-worktree.sh — runtime detect_harness() overriding the static
#     default, with the honest unknown fallback
# ===========================================================================

# A throwaway copy of the scripts under test, so writing a scratch
# .concertino.env next to them never touches this checkout's own core/scripts/
# (which carries no .concertino.env of its own) or scripts/concertino/'s real,
# project-owned one. Includes resolve-speed.sh + a fixtured speeds.json
# (CON-22) since setup-worktree.sh now resolves speed unconditionally as part
# of its own run.start emission — every scenario below that expects a
# successful run.start needs both to resolve.
new_scripts() {
  local d; d="$(mktemp -d)"
  cp "$ROOT/core/scripts/setup-worktree.sh" "$d/"
  cp "$ROOT/core/scripts/emit-event.sh" "$d/"
  cp "$ROOT/core/scripts/resolve-speed.sh" "$d/"
  chmod +x "$d/resolve-speed.sh"
  cat > "$d/speeds.json" <<'JSON'
{
  "budgets": { "executionCycles": 3, "skepticDesignRounds": 3, "skepticFinalRounds": 2, "debugAttempts": 2 },
  "speeds": {
    "default": { "budgets": {}, "roleTiers": { "orchestrator": "standard", "executor": "standard", "evaluator": "standard", "skeptic": "standard", "auditor": "standard" } }
  },
  "modelTiers": {
    "claude-code": { "cheap": "haiku", "standard": "sonnet", "capable": "opus" },
    "codex": { "cheap": "codex-mini-latest", "standard": "codex-mini-latest", "capable": "gpt-5.1-codex" }
  },
  "models": { "claude-code": {}, "codex": {} }
}
JSON
  printf '%s' "$d"
}

# A fresh scratch git repo with a "main" branch and one commit, standing in
# for the REPO_ROOT setup-worktree.sh operates against.
new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q -b main
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  printf '%s' "$d"
}

# Runs setup-worktree.sh for TICKET/BRANCH inside REPO, with SCRIPTS' own
# .concertino.env as the static default, and env vars as given, always
# clearing the two real detection signals first so this test's own ambient
# environment (running under Claude Code — CLAUDECODE=1 — or under Codex) can
# never leak into a "no runtime signal" scenario.
run_setup() {
  local scripts="$1" repo="$2" ticket="$3" branch="$4"; shift 4
  ( cd "$repo" && env -u CLAUDECODE -u CODEX_SANDBOX -u CODEX_SANDBOX_NETWORK_DISABLED \
      "$@" "$scripts/setup-worktree.sh" "$ticket" "$branch" ) >/dev/null 2>&1
  return $?
}

harness_of() {
  # $1 = repo, $2 = ticket
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
    const line = lines.map(l => JSON.parse(l)).find(e => e.kind === "run.start");
    console.log(line ? line.harness : "<no run.start event>");
  ' "$1/.concertino/runs/$2/events.jsonl" 2>/dev/null
}

# --- CLAUDECODE set, no static default -> claude-code -----------------------
SCRIPTS="$(new_scripts)"
printf "CONCERTINO_HARNESS=''\n" > "$SCRIPTS/.concertino.env"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-101 feat/101 CLAUDECODE=1
check "b.1 CLAUDECODE set -> claude-code" "$(harness_of "$REPO" TEST-101)" "claude-code"
rm -rf "$SCRIPTS" "$REPO"

# --- CODEX_SANDBOX set, no static default -> codex ---------------------------
SCRIPTS="$(new_scripts)"
printf "CONCERTINO_HARNESS=''\n" > "$SCRIPTS/.concertino.env"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-102 feat/102 CODEX_SANDBOX=1
check "b.2 CODEX_SANDBOX set -> codex" "$(harness_of "$REPO" TEST-102)" "codex"
rm -rf "$SCRIPTS" "$REPO"

# --- CODEX_SANDBOX_NETWORK_DISABLED set, no static default -> codex ---------
SCRIPTS="$(new_scripts)"
printf "CONCERTINO_HARNESS=''\n" > "$SCRIPTS/.concertino.env"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-103 feat/103 CODEX_SANDBOX_NETWORK_DISABLED=1
check "b.3 CODEX_SANDBOX_NETWORK_DISABLED set -> codex" "$(harness_of "$REPO" TEST-103)" "codex"
rm -rf "$SCRIPTS" "$REPO"

# --- both signals set simultaneously -> CLAUDECODE wins ---------------------
SCRIPTS="$(new_scripts)"
printf "CONCERTINO_HARNESS=''\n" > "$SCRIPTS/.concertino.env"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-104 feat/104 CLAUDECODE=1 CODEX_SANDBOX=1
check "b.4 both signals set -> claude-code wins" "$(harness_of "$REPO" TEST-104)" "claude-code"
rm -rf "$SCRIPTS" "$REPO"

# --- no runtime signal, static default present -> static value used ---------
SCRIPTS="$(new_scripts)"
printf "CONCERTINO_HARNESS='codex'\n" > "$SCRIPTS/.concertino.env"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-105 feat/105
check "b.5 no runtime signal -> falls back to static default" "$(harness_of "$REPO" TEST-105)" "codex"
rm -rf "$SCRIPTS" "$REPO"

# --- no runtime signal, no static default -> HARNESS itself still resolves
# to the honest "unknown" (detect_harness()'s own fallback chain, unchanged
# by CON-22) — but speeds.json (fixtured above) carries modelTiers data only
# for claude-code/codex, never "unknown", so resolve-speed.sh now correctly
# fails for it, and setup-worktree.sh's own "FAIL <reason>" contract means
# the whole script bails BEFORE ever creating a worktree or emitting
# run.start — no half-set-up run, no telemetry recording a harness the
# resolver itself just refused to price a model for. This is a deliberate
# CON-22 tightening, not a regression: the orchestrator treats
# resolve-speed.sh's non-zero exit as a BLOCKER (design.md Decision 3),
# exactly like the existing "Server start" circuit breaker — a run that
# cannot even be identified now stops for a human rather than proceeding on
# an admittedly-guessed identity.
SCRIPTS="$(new_scripts)"
printf "CONCERTINO_HARNESS=''\n" > "$SCRIPTS/.concertino.env"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-106 feat/106
RC=$?
check "b.6 no signal, no static default -> setup-worktree.sh now FAILs (unknown harness has no modelTiers data)" "$RC" "1"
# The events LOG ITSELF is never created (setup-worktree.sh bails before any
# emit-event.sh call happens at all) — harness_of's node helper throws
# reading a nonexistent file, printing nothing to stdout (stderr suppressed),
# distinct from the "<no run.start event>" string it prints when the file
# exists but simply has no matching line.
check "b.6 no run.start emitted for a run whose harness could not be resolved" "$(harness_of "$REPO" TEST-106)" ""
rm -rf "$SCRIPTS" "$REPO"

# --- runtime signal overrides a CONFLICTING static default ------------------
# Spec's "Run started under Claude Code" scenario is explicit that this holds
# "regardless of ... the static CONCERTINO_HARNESS default" — a project
# configured only for codex but actually run under Claude Code (e.g. a human
# testing locally) must still record the truth, not the stale static value.
SCRIPTS="$(new_scripts)"
printf "CONCERTINO_HARNESS='codex'\n" > "$SCRIPTS/.concertino.env"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-107 feat/107 CLAUDECODE=1
check "b.7 runtime signal overrides a conflicting static default" "$(harness_of "$REPO" TEST-107)" "claude-code"
rm -rf "$SCRIPTS" "$REPO"

# ===========================================================================
# (c) CON-22 — setup-worktree.sh's run.start/READY output now carries
#     speed=/models=/budgets=, resolved via resolve-speed.sh from the
#     already-fixtured speeds.json (new_scripts(), above).
# ===========================================================================

run_setup_capture() {
  # Same as run_setup, but captures stdout (the READY lines) instead of
  # discarding it — a separate helper rather than changing run_setup's own
  # contract, since every (b) test above relies on run_setup's return-code-
  # only behavior and discards stdout deliberately.
  local scripts="$1" repo="$2" ticket="$3" branch="$4" speed="$5"; shift 5
  ( cd "$repo" && env -u CLAUDECODE -u CODEX_SANDBOX -u CODEX_SANDBOX_NETWORK_DISABLED \
      "$@" "$scripts/setup-worktree.sh" "$ticket" "$branch" "$speed" ) 2>/dev/null
}

has_str() {
  # $1 = label, $2 = haystack string, $3 = needle — has() above greps a FILE
  # ($3 is a path), which the multi-line READY capture below is not; this is
  # the string-content equivalent.
  if printf '%s' "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "expected to find [$3] in [$2]"; fi
}

run_field() {
  # $1 = repo, $2 = ticket, $3 = event field name
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
    const line = lines.map(l => JSON.parse(l)).find(e => e.kind === "run.start");
    console.log(line ? String(line[process.argv[2]]) : "<no run.start event>");
  ' "$1/.concertino/runs/$2/events.jsonl" "$3" 2>/dev/null
}

# --- SPEED argument threads through to READY and run.start ------------------
SCRIPTS="$(new_scripts)"
REPO="$(new_repo)"
READY="$(run_setup_capture "$SCRIPTS" "$REPO" TEST-201 feat/201 default CLAUDECODE=1)"
has_str "c.1 READY carries speed=" "$READY" "READY speed=default"
has_str "c.1 READY carries budgets=" "$READY" "READY budgets={"
has_str "c.1 READY carries models=" "$READY" "READY models={"
check "c.1 run.start carries speed=default" "$(run_field "$REPO" TEST-201 speed)" "default"
has_str "c.1 run.start carries models JSON" "$(run_field "$REPO" TEST-201 models)" "orchestrator"
rm -rf "$SCRIPTS" "$REPO"

# --- omitting SPEED resolves "default" (same as resolve-speed.sh itself) ---
SCRIPTS="$(new_scripts)"
REPO="$(new_repo)"
( cd "$REPO" && env -u CLAUDECODE -u CODEX_SANDBOX -u CODEX_SANDBOX_NETWORK_DISABLED \
    CLAUDECODE=1 "$SCRIPTS/setup-worktree.sh" TEST-202 feat/202 ) >/dev/null 2>&1
check "c.2 omitted SPEED resolves default" "$(run_field "$REPO" TEST-202 speed)" "default"
rm -rf "$SCRIPTS" "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
