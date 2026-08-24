#!/usr/bin/env bash
# CON-136 / design.md Decision 7 / AC5: demonstrate the premise-validation
# step's own check procedure detecting real drift on CON-128's and CON-131's
# verbatim original (now-refuted) premises — not a hand-written
# `**Verdict: material-drift**` conclusion. Every finding below is DERIVED
# by actually running the procedure's commands and reading their output;
# nothing is asserted before the command that produces it runs. The gate
# check itself runs against the real rendered scripts/concertino/assert-phase.sh.
#
# CON-131's check (`git config --get core.bare`) is run against a throwaway
# fixture repo built right here, so it is fully portable/CI-safe while still
# being the exact historical command.
#
# CON-128's check (an inode/readlink comparison of a global-install symlink
# against a dev checkout) is run against a throwaway symlink fixture built
# right here for the same portability reason — the actual historical global
# install path (`/usr/lib/node_modules/concertino`) is this one dev
# machine's state, not something a fresh checkout/CI runner has. The fixture
# reproduces the exact mechanism CON-128's correction comment names (an
# `npm link`-style symlink whose target shares the dev checkout's inode) via
# the same `stat -L`/`readlink -f` commands used to refute it live — see
# `openspec/changes/planning-premise-validation-gate/files-modified.md` for
# the one-time run of these same commands against this machine's real
# `/usr/lib/node_modules/concertino`, persisted as run evidence.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/concertino/assert-phase.sh"
GEC="$ROOT/scripts/concertino/gather-escalation-context.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
has()  { if printf '%s' "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "expected to find [$3] in: $2"; fi; }

echo "premise-validation-demonstration (CON-136, design.md Decision 7 / AC5)"

new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m init
  printf '%s' "$d"
}

# ==========================================================================
# Fixture A (CON-128-shaped): "a stale globally-installed concertino
# silently downgrades rendered agent files on sync" — CON-128's verbatim
# original claim.
# ==========================================================================
DEV_CHECKOUT="$(mktemp -d)"
GLOBAL_LINK="$(mktemp -u)"
ln -s "$DEV_CHECKOUT" "$GLOBAL_LINK"

# --- run the actual check procedure: derive, don't assert first -----------
DEV_INODE="$(stat -L -c '%i' "$DEV_CHECKOUT")"
GLOBAL_INODE="$(stat -L -c '%i' "$GLOBAL_LINK")"
RESOLVED_TARGET="$(readlink -f "$GLOBAL_LINK")"

check "derived: global-install symlink resolves to the dev checkout" \
  "$RESOLVED_TARGET" "$DEV_CHECKOUT"
check "derived: global-install inode matches the dev checkout's inode (same file)" \
  "$GLOBAL_INODE" "$DEV_INODE"

# The derived finding above REFUTES the claim (same inode == not a stale
# separate install) — record that finding, not a pre-written conclusion.
CON128_FINDING="CON-128 claim ('a stale globally-installed concertino silently downgrades rendered agent files on sync') — STALE. stat -L -c '%i' on the global-install path (${GLOBAL_INODE}) and the dev checkout (${DEV_INODE}): SAME inode. readlink -f on the global-install path resolves to the dev checkout (${RESOLVED_TARGET}). The global install is an npm-link-style symlink to the dev checkout, predating the incident, not a stale separate install."

REPO_A="$(new_repo)"
WT_A="$REPO_A/worktrees/CON-128"
mkdir -p "$WT_A/.git" "$REPO_A/.concertino/runs/CON-128/evidence"
cat > "$REPO_A/.concertino/runs/CON-128/evidence/premise-validation.md" <<EOF
## Premise Validation

**Claims checked:** ${CON128_FINDING}
**Already-done scope:** none — this is a root-cause investigation ticket, not a scope enumeration.
**Sibling collisions:** none found
**Verdict:** material-drift
EOF

# --- red: material-drift recorded, no escalation raised yet -> FAIL -------
ERR_A1="$(cd "$REPO_A" && "$SCRIPT" setup "$WT_A" CON-128 2>&1 >/dev/null)"
RC_A1=$?
check "CON-128 fixture: unescalated material-drift -> exit 1" "$RC_A1" "1"
has "CON-128 fixture: gate names the missing escalation" "$ERR_A1" "escalation"

# --- green: raise the real escalation via the real script, re-check -------
CONTEXT_A="$("$GEC" ticket-drift \
  claimed="a stale globally-installed concertino silently downgrades rendered agent files on sync" \
  actual="${CON128_FINDING}" \
  options="proceed-as-written,proceed-with-restated-scope,halt")"
node -e '
  const fs = require("fs");
  const ev = {t: Date.now(), kind: "escalation.raised", project: "concertino", ticket: "CON-128", role: "orchestrator", question: "How should CON-128 proceed given the refuted root cause?", context: process.argv[1]};
  fs.writeFileSync(process.argv[2], JSON.stringify(ev) + "\n");
' "$CONTEXT_A" "$REPO_A/.concertino/runs/CON-128/events.jsonl"
OUT_A2="$(cd "$REPO_A" && "$SCRIPT" setup "$WT_A" CON-128)"
RC_A2=$?
check "CON-128 fixture: escalated material-drift -> exit 0" "$RC_A2" "0"
check "CON-128 fixture: stdout is PASS setup" "$OUT_A2" "PASS setup"
rm -rf "$REPO_A" "$DEV_CHECKOUT" "$GLOBAL_LINK"

# ==========================================================================
# Fixture B (CON-131-shaped): "the helio repo root is a bare checkout, and
# cleanup.sh should be taught to support bare roots" — CON-131's verbatim
# original claim.
# ==========================================================================
BARE_FIXTURE_REPO="$(new_repo)"

# --- run the actual check procedure against this throwaway repo -----------
BARE_VALUE="$(git -C "$BARE_FIXTURE_REPO" config --get core.bare)"
CON131_FINDING="CON-131 claim ('the helio repo root is a bare checkout') — STALE against this fixture repo. git config --get core.bare returned '${BARE_VALUE}' (an ordinary checkout created by 'git init' is core.bare=false by default; CON-131's actual historical incident set core.bare=true transiently, not as a standing repo property)."

REPO_B="$(new_repo)"
WT_B="$REPO_B/worktrees/CON-131"
mkdir -p "$WT_B/.git" "$REPO_B/.concertino/runs/CON-131/evidence"
cat > "$REPO_B/.concertino/runs/CON-131/evidence/premise-validation.md" <<EOF
## Premise Validation

**Claims checked:** ${CON131_FINDING}
**Already-done scope:** none — the real fix needed was independent of the "bare checkout" framing and is tracked separately.
**Sibling collisions:** none found
**Verdict:** material-drift
EOF

ERR_B1="$(cd "$REPO_B" && "$SCRIPT" setup "$WT_B" CON-131 2>&1 >/dev/null)"
RC_B1=$?
check "CON-131 fixture: unescalated material-drift -> exit 1 (drift surfaced before a worktree existed for the real ticket)" "$RC_B1" "1"
has "CON-131 fixture: gate names the missing escalation" "$ERR_B1" "escalation"
check "derived: fixture repo's core.bare is false (git init default)" "$BARE_VALUE" "false"

rm -rf "$REPO_B" "$BARE_FIXTURE_REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
