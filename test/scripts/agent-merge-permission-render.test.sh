#!/usr/bin/env bash
# Shell tests for CON-88 (agent-merge-permission-preflight): `concertino sync`
# additively merging the Claude Code permission grant `agentMerge.enabled:
# true` requires into `.claude/settings.json`.
#
# SAFETY: every invocation below runs against a throwaway --out directory,
# never this checkout's own .claude/.
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
# Counts literal occurrences of $1 within $2 — used to catch a doubled
# instruction/prefix, which `has`/`hasnt` (presence-only) can't distinguish
# from a single correct occurrence.
count_substr() { grep -o -F "$1" "$2" 2>/dev/null | wc -l | tr -d ' '; }
# Extracts just the Agent-merge section's own line(s) from a doctor/validate
# output file — the header plus everything up to the next blank line or
# section divider — so a doubling/newline assertion isn't confused by an
# unrelated "run `concertino sync`" mention doctor's OTHER sections (e.g.
# "Rendered artifacts") may also legitimately print in the same run.
agent_merge_section() {
  awk '/─── Agent-merge/{found=1; next} found && (/───/ || NF==0){exit} found{print}' "$1"
}

echo "agent-merge permission grant rendering (CON-88 agent-merge-permission-preflight)"

write_config() {
  # $1 = out dir, $2 = extra JS mutating `cfg` before it's written
  node -e '
    const fs = require("fs");
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    cfg.harnesses = ["claude-code"];
    '"$2"'
    fs.writeFileSync(process.argv[2], JSON.stringify(cfg, null, 2));
  ' "$ROOT/config/examples/generic.json" "$1/concertino.config.json"
}

# ===========================================================================
# (a) sync with agentMerge.enabled: true + claude-code creates
#     .claude/settings.json with both rules, when none existed before
# ===========================================================================
OUT="$(mktemp -d)"
write_config "$OUT" 'cfg.agentMerge = { enabled: true, mergeMethod: "squash" };'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" > "$OUT/sync-out.txt" 2>&1
RC=$?
check "a.1 sync exits zero" "$RC" "0"
SETTINGS="$OUT/.claude/settings.json"
[ -f "$SETTINGS" ] && ok "a.2 .claude/settings.json is created" || bad "a.2 .claude/settings.json is created" "missing: $SETTINGS"
has "a.3 settings.json contains the Bash(gh pr merge:*) rule" 'Bash(gh pr merge:*)' "$SETTINGS"
has "a.4 settings.json contains the Task(concertino-auditor) rule" 'Task(concertino-auditor)' "$SETTINGS"
node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.exit(Array.isArray(s.permissions && s.permissions.allow) ? 0 : 1);
' "$SETTINGS" && ok "a.5 permissions.allow is an array" || bad "a.5 permissions.allow is an array" "not an array"
rm -rf "$OUT"

# ===========================================================================
# (b) sync preserves a pre-existing hand-authored settings.json's other
#     keys/entries, adding only the missing rules
# ===========================================================================
OUT="$(mktemp -d)"
write_config "$OUT" 'cfg.agentMerge = { enabled: true, mergeMethod: "squash" };'
mkdir -p "$OUT/.claude"
cat > "$OUT/.claude/settings.json" <<'EOF'
{
  "permissions": {
    "allow": ["Bash(npm test:*)"],
    "deny": ["Bash(rm -rf /:*)"]
  },
  "someOtherTopLevelKey": "human-added-value"
}
EOF
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" > "$OUT/sync-out.txt" 2>&1
SETTINGS="$OUT/.claude/settings.json"
has "b.1 pre-existing allow entry survives" 'Bash(npm test:*)' "$SETTINGS"
has "b.2 pre-existing deny array survives" 'Bash(rm -rf /:*)' "$SETTINGS"
has "b.3 unrelated top-level key survives" 'human-added-value' "$SETTINGS"
has "b.4 the missing rule is added" 'Bash(gh pr merge:*)' "$SETTINGS"
has "b.5 the other missing rule is added" 'Task(concertino-auditor)' "$SETTINGS"
rm -rf "$OUT"

# ===========================================================================
# (c) sync with agentMerge.enabled: false never touches an existing
#     settings.json — byte-identical before/after
# ===========================================================================
OUT="$(mktemp -d)"
write_config "$OUT" 'cfg.agentMerge = { enabled: false, mergeMethod: "squash" };'
mkdir -p "$OUT/.claude"
printf '%s' '{"permissions":{"allow":["Bash(npm test:*)"]}}' > "$OUT/.claude/settings.json"
BEFORE="$(cat "$OUT/.claude/settings.json")"
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" > "$OUT/sync-out.txt" 2>&1
AFTER="$(cat "$OUT/.claude/settings.json")"
check "c.1 settings.json is byte-identical after a disabled sync" "$AFTER" "$BEFORE"
rm -rf "$OUT"

# ===========================================================================
# (d) sync with agentMerge.enabled: false never CREATES a settings.json
#     when none existed before
# ===========================================================================
OUT="$(mktemp -d)"
write_config "$OUT" 'cfg.agentMerge = { enabled: false, mergeMethod: "squash" };'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" > "$OUT/sync-out.txt" 2>&1
[ ! -f "$OUT/.claude/settings.json" ] && ok "d.1 no settings.json created when agentMerge is disabled" || bad "d.1 no settings.json created when agentMerge is disabled" "unexpectedly present: $OUT/.claude/settings.json"
rm -rf "$OUT"

# ===========================================================================
# (e) a prior grant survives a later sync with agentMerge.enabled: false —
#     the grant is append-only, never removed
# ===========================================================================
OUT="$(mktemp -d)"
write_config "$OUT" 'cfg.agentMerge = { enabled: true, mergeMethod: "squash" };'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" > "$OUT/sync-out-1.txt" 2>&1
has "e.1 first sync (enabled) adds the grant" 'Task(concertino-auditor)' "$OUT/.claude/settings.json"
write_config "$OUT" 'cfg.agentMerge = { enabled: false, mergeMethod: "squash" };'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" > "$OUT/sync-out-2.txt" 2>&1
has "e.2 grant survives a later sync with agentMerge disabled" 'Task(concertino-auditor)' "$OUT/.claude/settings.json"
rm -rf "$OUT"

# ===========================================================================
# (f) doctor and validate warn when the grant is missing, silent otherwise
#
# checkAgentMergePermission() shells out to a script that resolves the main
# checkout via `git rev-parse --git-common-dir` — OUT must be a real git repo
# for this section (unlike (a)-(e), which never exercise that check).
# ===========================================================================
OUT="$(mktemp -d)"
git -C "$OUT" init -q -b main
git -C "$OUT" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
write_config "$OUT" 'cfg.agentMerge = { enabled: true, mergeMethod: "squash" };'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" > "$OUT/sync-out.txt" 2>&1
rm -f "$OUT/.claude/settings.json"
DOCTOR_OUT="$OUT/doctor-out.txt"
node "$ROOT/bin/concertino" doctor --out="$OUT" --config="$OUT/concertino.config.json" > "$DOCTOR_OUT" 2>&1
has "f.1 doctor warns on a missing agent-merge grant" 'to add the missing grant' "$DOCTOR_OUT"
VALIDATE_OUT="$OUT/validate-out.txt"
node "$ROOT/bin/concertino" validate --out="$OUT" --config="$OUT/concertino.config.json" > "$VALIDATE_OUT" 2>&1
has "f.2 validate warns on a missing agent-merge grant" 'to add the missing grant' "$VALIDATE_OUT"

# Re-sync to add the grant back, then confirm both go silent again.
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" > "$OUT/sync-out-2.txt" 2>&1
DOCTOR_OUT2="$OUT/doctor-out-2.txt"
node "$ROOT/bin/concertino" doctor --out="$OUT" --config="$OUT/concertino.config.json" > "$DOCTOR_OUT2" 2>&1
hasnt "f.3 doctor is silent (no warning) once the grant is present" 'missing permission rule' "$DOCTOR_OUT2"
has "f.4 doctor reports the Agent-merge section as ok once the grant is present" 'agentMerge.permissions' "$DOCTOR_OUT2"
rm -rf "$OUT"

# ===========================================================================
# (h) CON-88 skeptic-final-1.md Change Request 1: a project that turned
#     agentMerge.enabled on but has NEVER run `concertino sync` at all yet —
#     scripts/concertino/check-agent-merge-permission.sh genuinely doesn't
#     exist, not just its .claude/settings.json. Before the fix, this raised
#     a raw `spawnSync ... ENOENT` into the warning text instead of a clean,
#     on-brand reason; doctor/validate must both name what's missing instead.
# ===========================================================================
OUT="$(mktemp -d)"
git -C "$OUT" init -q -b main
git -C "$OUT" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
write_config "$OUT" 'cfg.agentMerge = { enabled: true, mergeMethod: "squash" };'
# Deliberately no `concertino sync` call here — scripts/concertino/ does not exist.
DOCTOR_OUT="$OUT/doctor-out.txt"
node "$ROOT/bin/concertino" doctor --out="$OUT" --config="$OUT/concertino.config.json" > "$DOCTOR_OUT" 2>&1
has "h.1 doctor names the missing check script, never-synced project" 'check-agent-merge-permission.sh not found' "$DOCTOR_OUT"
has "h.2 doctor tells the user how to fix it, never-synced project" 'concertino sync' "$DOCTOR_OUT"
hasnt "h.3 doctor's Agent-merge warning does not leak a raw ENOENT" 'ENOENT' "$DOCTOR_OUT"
hasnt "h.4 doctor's Agent-merge warning does not leak spawnSync internals" 'spawnSync' "$DOCTOR_OUT"
VALIDATE_OUT="$OUT/validate-out.txt"
node "$ROOT/bin/concertino" validate --out="$OUT" --config="$OUT/concertino.config.json" > "$VALIDATE_OUT" 2>&1
has "h.5 validate names the missing check script, never-synced project" 'check-agent-merge-permission.sh not found' "$VALIDATE_OUT"
hasnt "h.6 validate's Agent-merge warning does not leak a raw ENOENT" 'ENOENT' "$VALIDATE_OUT"

# --- CON-88 skeptic-final-2.md Change Request 2: the round-1 fix's own
#     "script not found" reason must not ALSO get the call site's
#     "run `concertino sync` to add the missing grant" suffix appended on
#     top of an instruction it already carries — exactly one mention, in
#     the Agent-merge section specifically (not the whole doctor/validate
#     output, which legitimately says "run `concertino sync`" elsewhere too,
#     e.g. under "Rendered artifacts" for this same never-synced project).
DOCTOR_AM="$(agent_merge_section "$DOCTOR_OUT")"
DOCTOR_AM_HITS="$(printf '%s' "$DOCTOR_AM" | grep -o -F 'concertino sync' | wc -l | tr -d ' ')"
check "h.7 doctor's Agent-merge line says 'concertino sync' exactly once, never-synced project" "$DOCTOR_AM_HITS" "1"
VALIDATE_AM="$(agent_merge_section "$VALIDATE_OUT")"
VALIDATE_AM_HITS="$(printf '%s' "$VALIDATE_AM" | grep -o -F 'concertino sync' | wc -l | tr -d ' ')"
check "h.8 validate's Agent-merge line says 'concertino sync' exactly once, never-synced project" "$VALIDATE_AM_HITS" "1"
rm -rf "$OUT"

# ===========================================================================
# (i) CON-88 skeptic-final-2.md Change Request 1: BOTH required permission
#     rules missing at once (an empty/irrelevant permissions.allow) — at
#     least as likely a first-touch scenario as either state (f)/(h) cover.
#     check-agent-merge-permission.sh writes one FAIL <msg> line per missing
#     rule to stderr; before the fix that unjoined two-line reason broke the
#     single-line warn()/r.warn() renderers — the second line printed bare,
#     unindented, detached from the section's own "!" marker.
# ===========================================================================
OUT="$(mktemp -d)"
git -C "$OUT" init -q -b main
git -C "$OUT" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
write_config "$OUT" 'cfg.agentMerge = { enabled: true, mergeMethod: "squash" };'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" > "$OUT/sync-out.txt" 2>&1
# An empty allow array — .claude/settings.json exists (sync wrote it with
# the grant), but hand-edited afterward to simulate a stale/irrelevant list.
printf '%s' '{"permissions":{"allow":[]}}' > "$OUT/.claude/settings.json"
DOCTOR_OUT="$OUT/doctor-out.txt"
node "$ROOT/bin/concertino" doctor --out="$OUT" --config="$OUT/concertino.config.json" > "$DOCTOR_OUT" 2>&1
has "i.1 doctor names the first missing rule" 'Bash(gh pr merge:*)' "$DOCTOR_OUT"
has "i.2 doctor names the second missing rule" 'Task(concertino-auditor)' "$DOCTOR_OUT"
DOCTOR_AM="$(agent_merge_section "$DOCTOR_OUT")"
DOCTOR_AM_LINES="$(printf '%s\n' "$DOCTOR_AM" | grep -c '.')"
check "i.3 doctor's Agent-merge section is exactly one line (both rules named on it)" "$DOCTOR_AM_LINES" "1"
[ "$(printf '%s' "$DOCTOR_AM" | grep -c '^FAIL ')" = "0" ] && ok "i.4 doctor's Agent-merge line carries no bare/unindented continuation with a leading FAIL token" || bad "i.4 doctor's Agent-merge line carries no bare/unindented continuation with a leading FAIL token" "found a line starting with 'FAIL ' in: $DOCTOR_AM"
VALIDATE_OUT="$OUT/validate-out.txt"
node "$ROOT/bin/concertino" validate --out="$OUT" --config="$OUT/concertino.config.json" > "$VALIDATE_OUT" 2>&1
has "i.5 validate names the first missing rule" 'Bash(gh pr merge:*)' "$VALIDATE_OUT"
has "i.6 validate names the second missing rule" 'Task(concertino-auditor)' "$VALIDATE_OUT"
VALIDATE_AM="$(agent_merge_section "$VALIDATE_OUT")"
VALIDATE_AM_LINES="$(printf '%s\n' "$VALIDATE_AM" | grep -c '.')"
check "i.7 validate's Agent-merge section is exactly one line (both rules named on it)" "$VALIDATE_AM_LINES" "1"
rm -rf "$OUT"

# ===========================================================================
# (g) disabled agentMerge: doctor/validate report nothing new for it
# ===========================================================================
OUT="$(mktemp -d)"
git -C "$OUT" init -q -b main
git -C "$OUT" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
write_config "$OUT" 'cfg.agentMerge = { enabled: false, mergeMethod: "squash" };'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" > "$OUT/sync-out.txt" 2>&1
DOCTOR_OUT="$OUT/doctor-out.txt"
node "$ROOT/bin/concertino" doctor --out="$OUT" --config="$OUT/concertino.config.json" > "$DOCTOR_OUT" 2>&1
hasnt "g.1 doctor prints no Agent-merge section when disabled" 'Agent-merge' "$DOCTOR_OUT"
rm -rf "$OUT"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
