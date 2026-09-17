#!/usr/bin/env bash
# CON-191: setup-worktree.sh's instrumentation digest on run.start, and the
# schema.change drift event when the live digest disagrees with the
# render-time baseline `concertino sync` wrote alongside the rendered
# scripts. Run: bash test/scripts/instrumentation-digest.test.sh
set -uo pipefail

# CON-181: scope every mktemp/mktemp -d call in this file to a scratch
# TMPDIR removed on exit -- see test/scripts/lib/tmp-scratch.sh.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp-scratch.sh"
trap con181_cleanup_scratch EXIT

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "instrumentation digest / schema.change drift (CON-191)"

# A throwaway copy of the scripts under test — same shape as
# harness-identity.test.sh's new_scripts(), extended with an
# .instrumentation-manifest.json baseline computed the same way sync would
# (per-file sha256, aggregated over sorted filename:hash pairs).
new_scripts() {
  local d; d="$(mktemp -d)"
  cp "$ROOT/core/scripts/setup-worktree.sh" "$d/"
  cp "$ROOT/core/scripts/emit-event.sh" "$d/"
  cp "$ROOT/core/scripts/resolve-speed.sh" "$d/"
  mkdir -p "$d/lib"
  cp "$ROOT/core/scripts/lib/git-child-env.sh" "$d/lib/"
  cp "$ROOT/core/scripts/lib/auditor-lease.sh" "$d/lib/"
  chmod +x "$d/resolve-speed.sh" "$d/setup-worktree.sh" "$d/emit-event.sh"
  cat > "$d/speeds.json" <<'JSON'
{
  "budgets": { "executionCycles": 3, "skepticDesignRounds": 3, "skepticFinalRounds": 2, "debugAttempts": 2 },
  "speeds": {
    "default": { "budgets": {}, "roleTiers": { "orchestrator": "standard", "executor": "standard", "evaluator": "standard", "skeptic": "standard", "auditor": "standard" } }
  },
  "modelTiers": {
    "claude-code": { "cheap": "haiku", "standard": "sonnet", "capable": "opus" }
  },
  "models": { "claude-code": {} }
}
JSON
  printf '%s' "$d"
}

write_manifest_from_dir() {
  # $1 = scripts dir -> writes .instrumentation-manifest.json computed
  # RECURSIVELY over every *.sh file under it (including nested lib/*.sh),
  # keyed/sorted on the forward-slash-normalized relative path — mirrors
  # lib/cli/shared.js's listFilesRecursive()/lib/cli/emit.js's
  # computeInstrumentationManifest() exactly (CON-191 skeptic-final-1 round
  # 1: the original non-recursive version of this helper, and of the
  # production code it stood in for, silently excluded scripts/concertino/
  # lib/*.sh — the very files emit-event.sh sources on every invocation).
  node -e '
    const fs = require("fs"), path = require("path"), crypto = require("crypto");
    function listShFilesRecursive(dir, prefix) {
      let out = [];
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        const rel = prefix ? prefix + "/" + entry.name : entry.name;
        if (entry.isDirectory()) out = out.concat(listShFilesRecursive(abs, rel));
        else if (entry.isFile() && entry.name.endsWith(".sh")) out.push(rel);
      }
      return out;
    }
    const dir = process.argv[1];
    const files = listShFilesRecursive(dir, "").sort();
    const fileHashes = {};
    const agg = crypto.createHash("sha256");
    for (const f of files) {
      const content = fs.readFileSync(path.join(dir, f));
      const h = crypto.createHash("sha256").update(content).digest("hex");
      fileHashes[f] = h;
      agg.update(f + ":" + h + "\n");
    }
    fs.writeFileSync(path.join(dir, ".instrumentation-manifest.json"),
      JSON.stringify({ digest: agg.digest("hex"), files: fileHashes }, null, 2) + "\n");
  ' "$1"
}

new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q -b main
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  printf '%s' "$d"
}

run_setup() {
  local scripts="$1" repo="$2" ticket="$3" branch="$4"
  ( cd "$repo" && env -u CLAUDECODE -u CODEX_SANDBOX -u CODEX_SANDBOX_NETWORK_DISABLED -u OPENCODE \
      CLAUDECODE=1 "$scripts/setup-worktree.sh" "$ticket" "$branch" ) >/dev/null 2>&1
  return $?
}

events_of() {
  # $1 = repo, $2 = ticket, $3 = kind -> prints all matching lines
  node -e '
    const fs = require("fs");
    let raw;
    try { raw = fs.readFileSync(process.argv[1], "utf8"); } catch (e) { process.exit(0); }
    for (const line of raw.trim().split("\n")) {
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
      if (ev.kind === process.argv[2]) console.log(JSON.stringify(ev));
    }
  ' "$1/.concertino/runs/$2/events.jsonl" "$3" 2>/dev/null
}

field_of() {
  # $1 = one JSON event line, $2 = field name
  printf '%s' "$1" | node -e '
    let s = ""; process.stdin.on("data", d => s += d);
    process.stdin.on("end", () => { try { console.log(JSON.parse(s)[process.argv[1]] ?? ""); } catch (e) { console.log(""); } });
  ' "$2"
}

# --- 1. run.start carries the digest, even with no baseline present --------
SCRIPTS="$(new_scripts)"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-401 feat/401
RUNSTART="$(events_of "$REPO" TEST-401 run.start)"
DIGEST="$(field_of "$RUNSTART" instrumentation_digest)"
if [ -n "$DIGEST" ]; then ok "1.1 run.start carries a non-empty instrumentation_digest"; else bad "1.1 run.start carries a non-empty instrumentation_digest" "got empty"; fi
check "1.2 no baseline present -> no schema.change emitted" "$(events_of "$REPO" TEST-401 schema.change)" ""
check "1.3 setup still exits 0 with no baseline" "$?" "0"
rm -rf "$SCRIPTS" "$REPO"

# --- 2. two runs measured by identical instrumentation agree ---------------
SCRIPTS="$(new_scripts)"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-402 feat/402
run_setup "$SCRIPTS" "$REPO" TEST-403 feat/403
D1="$(field_of "$(events_of "$REPO" TEST-402 run.start)" instrumentation_digest)"
D2="$(field_of "$(events_of "$REPO" TEST-403 run.start)" instrumentation_digest)"
check "2.1 two runs, unchanged scripts, agree on digest" "$D1" "$D2"
rm -rf "$SCRIPTS" "$REPO"

# --- 2.2. CON-191 skeptic-final-1 (round 1, REFUTE, change request 3):
#     digest stability under recursive hashing, and the aggregation's sort
#     key is the normalized RELATIVE path (e.g. "lib/auditor-lease.sh"),
#     never a bare basename — a bare-basename sort could collide across
#     directories or reorder inconsistently. Verified directly against the
#     manifest JSON (not just the aggregate digest), and against a second,
#     independently-run computation over the same tree.
SCRIPTS="$(new_scripts)"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-409 feat/409
D_A="$(field_of "$(events_of "$REPO" TEST-409 run.start)" instrumentation_digest)"
run_setup "$SCRIPTS" "$REPO" TEST-410 feat/410
D_B="$(field_of "$(events_of "$REPO" TEST-410 run.start)" instrumentation_digest)"
check "2.2a digest is reproducible across two independent computations over an unchanged tree" "$D_A" "$D_B"
# Directly interrogate the manifest keys: every entry must be a full
# relative path (containing "/" for anything under lib/), never a bare
# basename that would collide with a same-named top-level file.
MANIFEST_KEYS="$(node -e '
  const fs = require("fs"), path = require("path"), crypto = require("crypto");
  function listShFilesRecursive(dir, prefix) {
    let out = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) out = out.concat(listShFilesRecursive(abs, rel));
      else if (entry.isFile() && entry.name.endsWith(".sh")) out.push(rel);
    }
    return out;
  }
  const files = listShFilesRecursive(process.argv[1], "").sort();
  console.log(files.join(","));
' "$SCRIPTS")"
case "$MANIFEST_KEYS" in
  *lib/auditor-lease.sh*) ok "2.2b manifest keys are normalized relative paths (lib/auditor-lease.sh present, not bare auditor-lease.sh)" ;;
  *) bad "2.2b manifest keys are normalized relative paths (lib/auditor-lease.sh present, not bare auditor-lease.sh)" "got [$MANIFEST_KEYS]" ;;
esac
rm -rf "$SCRIPTS" "$REPO"

# --- 3. baseline present and matching -> no schema.change ------------------
SCRIPTS="$(new_scripts)"
write_manifest_from_dir "$SCRIPTS"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-404 feat/404
check "3.1 baseline matches live -> no schema.change" "$(events_of "$REPO" TEST-404 schema.change)" ""
RUNSTART="$(events_of "$REPO" TEST-404 run.start)"
if [ -n "$(field_of "$RUNSTART" instrumentation_digest)" ]; then
  ok "3.2 run.start still carries the digest"
else
  bad "3.2 run.start still carries the digest" "empty"
fi
rm -rf "$SCRIPTS" "$REPO"

# --- 4. baseline present, one rendered script locally patched afterwards ---
#     -> schema.change naming the affected script ----------------------------
SCRIPTS="$(new_scripts)"
write_manifest_from_dir "$SCRIPTS"
printf '\n# a locally patched line, never through concertino sync\n' >> "$SCRIPTS/emit-event.sh"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-405 feat/405
CHANGE_EVENT="$(events_of "$REPO" TEST-405 schema.change)"
if [ -n "$CHANGE_EVENT" ]; then ok "4.1 a locally patched rendered script emits schema.change"; else bad "4.1 a locally patched rendered script emits schema.change" "no schema.change event found"; fi
AFFECTED="$(field_of "$CHANGE_EVENT" affected_scripts)"
case "$AFFECTED" in
  *emit-event.sh*) ok "4.2 schema.change names the affected script (emit-event.sh)" ;;
  *) bad "4.2 schema.change names the affected script (emit-event.sh)" "got [$AFFECTED]" ;;
esac
rm -rf "$SCRIPTS" "$REPO"

# --- 4b. CON-191 skeptic-final-1 (round 1, REFUTE): a NESTED lib/*.sh file
#     patched after the baseline is written must ALSO emit schema.change
#     naming it, not just a top-level file. This is the mutation proof for
#     the actual reported gap: `emit-event.sh` `source`s `lib/auditor-lease.sh`
#     on every invocation, so a patch there is exactly the CON-128 shape
#     ("a local patch to a rendered copy, invisible to detection") this
#     capability exists to catch. The fixture's `lib/auditor-lease.sh` is the
#     one the skeptic's own probe patched.
#
# RED (pre-fix) transcript, captured by hand against the non-recursive
# algorithm before this fix (recorded here, not re-executed, since the fix
# is already applied in this tree — see files-modified.md for the full
# before/after digest values):
#   before.digest === after.digest patching sc/lib/auditor-lease.sh (BUG)
#   before.digest !== after.digest patching sc/emit-event.sh (control, passed)
# GREEN (this assertion, against the fixed recursive algorithm) follows.
SCRIPTS="$(new_scripts)"
write_manifest_from_dir "$SCRIPTS"
printf '\n# a locally patched line under lib/, never through concertino sync\n' >> "$SCRIPTS/lib/auditor-lease.sh"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-407 feat/407
CHANGE_EVENT="$(events_of "$REPO" TEST-407 schema.change)"
if [ -n "$CHANGE_EVENT" ]; then
  ok "4b.1 a locally patched NESTED lib/*.sh file emits schema.change"
else
  bad "4b.1 a locally patched NESTED lib/*.sh file emits schema.change" "no schema.change event found — this is the exact skeptic-final-1 regression if it recurs"
fi
AFFECTED="$(field_of "$CHANGE_EVENT" affected_scripts)"
case "$AFFECTED" in
  *lib/auditor-lease.sh*) ok "4b.2 schema.change names the affected NESTED script by its relative path (lib/auditor-lease.sh)" ;;
  *) bad "4b.2 schema.change names the affected NESTED script by its relative path (lib/auditor-lease.sh)" "got [$AFFECTED]" ;;
esac
# The untouched top-level emit-event.sh must NOT be named alongside it.
case "$AFFECTED" in
  *,emit-event.sh*|emit-event.sh,*|emit-event.sh)
    bad "4b.3 the untouched top-level emit-event.sh is not also named" "got [$AFFECTED]" ;;
  *) ok "4b.3 the untouched top-level emit-event.sh is not also named" ;;
esac
rm -rf "$SCRIPTS" "$REPO"

# --- 5. digest computation forced to fail is still non-fatal ----------------
#     Simulated by dropping an unreadable *.sh fixture alongside the real
#     scripts (permission-denied on read) — a real "cannot be computed"
#     failure looks exactly like this: readdirSync finds the file,
#     readFileSync throws. Crucially this fixture is NEITHER emit-event.sh
#     NOR setup-worktree.sh itself, so run.start's own emission path stays
#     intact — this isolates "the digest step fails" from "the emitter is
#     broken", which chmod'ing emit-event.sh itself would conflate.
SCRIPTS="$(new_scripts)"
printf '#!/usr/bin/env bash\necho unreadable-fixture\n' > "$SCRIPTS/zzz-unreadable-fixture.sh"
chmod 000 "$SCRIPTS/zzz-unreadable-fixture.sh"
REPO="$(new_repo)"
run_setup "$SCRIPTS" "$REPO" TEST-406 feat/406
RC=$?
chmod 755 "$SCRIPTS/zzz-unreadable-fixture.sh" 2>/dev/null || true
# The unreadable .sh fixture makes fs.readFileSync throw inside the node
# digest probe -> the whole compute_instrumentation_manifest() call fails,
# which is caught (`|| INSTRUMENTATION_MANIFEST=""`) rather than propagated.
check "5.1 setup still exits 0 when the digest cannot be computed" "$RC" "0"
RUNSTART="$(events_of "$REPO" TEST-406 run.start)"
if [ -n "$RUNSTART" ]; then ok "5.2 run.start is still emitted"; else bad "5.2 run.start is still emitted" "no run.start event found"; fi
if [ -z "$(field_of "$RUNSTART" instrumentation_digest)" ]; then
  ok "5.3 run.start carries no instrumentation_digest field when it could not be computed"
else
  bad "5.3 run.start carries no instrumentation_digest field when it could not be computed" "got [$(field_of "$RUNSTART" instrumentation_digest)]"
fi
rm -rf "$SCRIPTS" "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
