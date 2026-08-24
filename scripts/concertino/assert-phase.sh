#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# assert-phase.sh — postcondition gate for each orchestrator phase.
#
# The autonomous equivalent of a human glancing and confirming "yep, that
# worked." The orchestrator runs this before leaving a phase; a non-zero exit
# means the phase did NOT actually complete and it must not advance.
#
# Usage:
#   assert-phase.sh setup    <WORKTREE_PATH> [TICKET_ID]
#   assert-phase.sh servers  <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]
#   assert-phase.sh delivery <WORKTREE_PATH> <BRANCH> [TICKET_ID]
#   assert-phase.sh cleanup  <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]
#
# [TICKET_ID], when passed, is used verbatim to tag every gate.result/
# gate.warning event this script emits (CON-80, mirroring cleanup.sh's CON-64
# shape). When omitted, the ticket id is inferred from the worktree path's
# basename as a documented fallback — see GATE_TICKET below.
#
# Prints "PASS <phase>" on success, "FAIL <reason>" (one per line) + non-zero
# exit on failure.
# ===========================================================================

PHASE="${1:?usage: assert-phase.sh <phase> <worktree> [args]}"
WORKTREE_PATH="${2:?missing WORKTREE_PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/git-child-env.sh"
# shellcheck disable=SC1091
[ -f "${SCRIPT_DIR}/.concertino.env" ] && source "${SCRIPT_DIR}/.concertino.env"

# utf8_safe_char_prefix <char-budget>
#
# Reads UTF-8 text on stdin and writes to stdout the first <char-budget>
# Unicode code points, never a partial multi-byte sequence. Iterates by code
# point (`Array.from`/`for...of`, the same pattern `visibleLength()` in
# lib/ui/format.js already uses for the analogous surrogate-pair-safety
# reason) rather than relying on bash's `${msg:0:200}`, which is
# character-safe only when the ambient locale names a multibyte encoding —
# silently byte-oriented (splitting a multi-byte character) under `C`/`POSIX`,
# the default for many minimal CI/container images. A no-op for all-ASCII
# input, where 200 characters is also 200 bytes. Duplicated from
# emit-event.sh's analogous helper rather than sourced — these procedure
# scripts stay standalone (see now_ms() above for the same pattern).
utf8_safe_char_prefix() {
  local n="$1"
  node -e '
    const s = require("fs").readFileSync(0, "utf8");
    const n = Math.max(0, parseInt(process.argv[1], 10) || 0);
    process.stdout.write(Array.from(s).slice(0, n).join(""));
  ' "$n"
}

fail() {
  local msg="$*"
  echo "FAIL $msg" >&2
  FAILED=1
  # Record only the first failure message, trimmed at the source so an
  # oversized reason can't blow emit-event.sh's whole-line byte cap and drop
  # every other field on the gate.result line. fail() is always called as the
  # RHS of a `check || fail ...`, so under `set -e` its own return status must
  # stay 0 on every branch — otherwise a second-or-later call (where the `&&`
  # short-circuits because FIRST_ERROR is already set) would be the last
  # command in that AND-OR list and would kill the script right there.
  if [ -z "$FIRST_ERROR" ]; then
    FIRST_ERROR="$(printf '%s' "$msg" | utf8_safe_char_prefix 200)"
  fi
  return 0
}
FAILED=0
FIRST_ERROR=""

# Millisecond epoch. GNU date supports %3N; BSD/macOS date does not, so fall
# back to node (already a hard requirement for Concertino). Duplicated from
# emit-event.sh's now_ms() rather than sourced — these procedure scripts stay
# standalone.
now_ms() {
  local d
  d="$(date +%s%3N 2>/dev/null)"
  case "$d" in
    *N*|'') node -e 'process.stdout.write(String(Date.now()))' ;;
    *) printf '%s' "$d" ;;
  esac
}

# Resolve a health URL template ($DEV_PORT / $BACKEND_PORT in scope).
resolve_url() { eval "echo \"$1\""; }

START_TS="$(now_ms)"

looks_like_ticket() { [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; }

# main_checkout <worktree-path>
#
# Resolves the main checkout root from within a linked worktree, exactly as
# the `delivery` case's gate-chain evidence check has always done. Hoisted
# above the `case` block (CON-136) since `setup`'s own premise-validation
# evidence check now needs it too — the worktree exists by the time this
# script runs (assert-phase.sh setup runs at Setup step 5, after
# setup-worktree.sh has already run at step 4), so resolving against
# $WORKTREE_PATH is safe here even though the premise-validation *write*
# itself happens earlier, against the main checkout directly (design.md
# Decision 1).
main_checkout() {
  local wt="$1" common
  common="$(git_child -C "$wt" rev-parse --git-common-dir 2>/dev/null)" || return 1
  [ -z "$common" ] && return 1
  case "$common" in
    /*) ;;
     *) common="$(cd "$wt" 2>/dev/null && cd "$common" 2>/dev/null && pwd)" || return 1 ;;
  esac
  ( cd "$(dirname "$common")" 2>/dev/null && pwd ) || return 1
}

case "$PHASE" in
  setup)
    TICKET_ID="${3:-}"
    # The canonical ticket id arrives as the explicit trailing argument
    # (CON-80, mirroring cleanup.sh's CON-64 shape); worktree-basename
    # inference stays only as a fallback for call sites rendered before the
    # argument existed. Inference is not reliable — a branch without the
    # <type>/<desc>/<TICKET-ID> suffix makes the basename a non-ticket, and a
    # branch whose ticket suffix is lowercase (Linear's own `gitBranchName`
    # convention) makes the basename a different-cased, differently-addressed
    # run directory (the defect this ticket exists to close).
    GATE_TICKET="${TICKET_ID:-${WORKTREE_PATH##*/}}"
    [ -d "$WORKTREE_PATH" ]                 || fail "worktree dir missing: $WORKTREE_PATH"
    [ -d "$WORKTREE_PATH/.git" ] || [ -f "$WORKTREE_PATH/.git" ] \
                                            || fail "worktree not a git work tree: $WORKTREE_PATH"
    for f in ${CONCERTINO_ENV_FILES:-}; do
      [ -f "$WORKTREE_PATH/$f" ] || fail "env file not present in worktree: $f (servers will fail)"
    done

    # -------------------------------------------------------------------
    # CON-136: a run that skipped the premise-validation step must not
    # reach Planning/Execution. Resolved against the main checkout, the
    # same way the delivery gate's gate-chain evidence check resolves it
    # (main_checkout() above) — persist-evidence.sh always writes there,
    # never into the worktree. Runs unconditionally on every setup
    # invocation, not gated behind any diff classification.
    # -------------------------------------------------------------------
    PV_ROOT="$(main_checkout "$WORKTREE_PATH")" || PV_ROOT=""
    if [ -z "${PV_ROOT:-}" ]; then
      fail "premise-validation check: could not resolve main checkout to look up evidence"
    else
      PV_EVIDENCE="${PV_ROOT}/.concertino/runs/${GATE_TICKET}/evidence/premise-validation.md"
      if [ ! -f "$PV_EVIDENCE" ]; then
        fail "premise-validation evidence missing: ${PV_EVIDENCE} (Setup must validate the ticket's premise before branch derivation)"
      else
        PV_CHECK_OUT="$(node -e '
          const fs = require("fs");
          const text = fs.readFileSync(process.argv[1], "utf8");
          const HEADING = "## Premise Validation";
          const idx = text.indexOf(HEADING);
          if (idx === -1) { console.log("FAIL missing heading"); process.exit(0); }
          const rest = text.slice(idx + HEADING.length);
          const nextHeading = rest.search(/\n##\s/);
          const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
          const fields = [
            "Claims checked:",
            "Already-done scope:",
            "Sibling collisions:"
          ];
          const placeholders = new Set(["tbd", "n/a", "na", "todo", ""]);
          const missing = [];
          for (const f of fields) {
            const marker = `**${f}**`;
            const at = section.indexOf(marker);
            if (at === -1) { missing.push(f); continue; }
            const lineEnd = section.indexOf("\n", at);
            const answer = (lineEnd === -1 ? section.slice(at + marker.length) : section.slice(at + marker.length, lineEnd)).trim();
            if (placeholders.has(answer.toLowerCase())) missing.push(f);
          }
          if (missing.length) { console.log("FAIL unanswered: " + missing.join(" | ")); process.exit(0); }

          const verdictMatch = section.match(/\*\*Verdict:\*\*\s*([^\n]*)/);
          const verdict = verdictMatch ? verdictMatch[1].trim() : "";
          const validVerdicts = new Set(["no-drift", "minor-staleness", "material-drift"]);
          if (!validVerdicts.has(verdict)) { console.log("FAIL invalid verdict: " + JSON.stringify(verdict)); process.exit(0); }
          console.log("PASS " + verdict);
        ' "$PV_EVIDENCE" 2>&1)"
        case "$PV_CHECK_OUT" in
          "PASS "*)
            PV_VERDICT="${PV_CHECK_OUT#PASS }"
            if [ "$PV_VERDICT" = "material-drift" ]; then
              # -----------------------------------------------------------
              # A recorded material-drift verdict is necessary but not
              # sufficient (design.md Decision 3, CON-30 precedent): also
              # require a matching escalation.raised event. No `kind` field
              # survives emit-event.sh's structural drop, so the
              # discriminator is a prefix match on `context` against the
              # fixed TICKET-DRIFT-ESCALATION marker
              # (gather-escalation-context.sh's ticket-drift kind, task 1).
              # A degraded raise (gather-escalation-context.sh itself
              # failed, escalation raised without context=) still fails
              # this check — intended fail-closed behavior, not a bug.
              # -----------------------------------------------------------
              PV_EVENTS="${PV_ROOT}/.concertino/runs/${GATE_TICKET}/events.jsonl"
              if [ ! -f "$PV_EVENTS" ]; then
                fail "premise-validation verdict is material-drift but no events.jsonl found for escalation evidence (${PV_EVENTS})"
              else
                PV_ESC_OUT="$(node -e '
                  const fs = require("fs");
                  const raw = fs.readFileSync(process.argv[1], "utf8");
                  const ticket = process.argv[2];
                  const marker = "TICKET-DRIFT-ESCALATION";
                  let found = false;
                  for (const line of raw.split("\n")) {
                    if (!line.trim()) continue;
                    let ev;
                    try { ev = JSON.parse(line); } catch { continue; }
                    if (!ev || ev.kind !== "escalation.raised" || ev.ticket !== ticket) continue;
                    if (ev.role !== "orchestrator") continue;
                    if (typeof ev.context === "string" && ev.context.startsWith(marker)) { found = true; break; }
                  }
                  console.log(found ? "PASS" : "FAIL");
                ' "$PV_EVENTS" "$GATE_TICKET" 2>&1)"
                [ "$PV_ESC_OUT" = "PASS" ] \
                  || fail "premise-validation verdict is material-drift but no matching ticket-drift escalation.raised event found (role=orchestrator, context starting with TICKET-DRIFT-ESCALATION) in ${PV_EVENTS}"
              fi
            fi
            ;;
          *)
            fail "premise-validation evidence incomplete in ${PV_EVIDENCE}: ${PV_CHECK_OUT}"
            ;;
        esac
      fi
    fi
    ;;

  servers)
    DEV_PORT="${3:?servers assert needs <DEV_PORT> <BACKEND_PORT>}"
    BACKEND_PORT="${4:?servers assert needs <DEV_PORT> <BACKEND_PORT>}"
    TICKET_ID="${5:-}"
    GATE_TICKET="${TICKET_ID:-${WORKTREE_PATH##*/}}"
    if [ -n "${CONCERTINO_BACKEND_HEALTH:-}" ]; then
      curl -sf "$(resolve_url "$CONCERTINO_BACKEND_HEALTH")" >/dev/null 2>&1 \
          || fail "backend not healthy on ${BACKEND_PORT}"
    fi
    if [ -n "${CONCERTINO_FRONTEND_HEALTH:-}" ]; then
      curl -sf "$(resolve_url "$CONCERTINO_FRONTEND_HEALTH")" >/dev/null 2>&1 \
          || fail "frontend not serving on ${DEV_PORT}"
    fi
    ;;

  delivery)
    BRANCH="${3:?delivery assert needs <BRANCH>}"
    TICKET_ID="${4:-}"
    GATE_TICKET="${TICKET_ID:-${WORKTREE_PATH##*/}}"
    git_child -C "$WORKTREE_PATH" rev-parse --verify --quiet "refs/remotes/origin/${BRANCH}" >/dev/null \
        || fail "branch ${BRANCH} not pushed to origin"
    [ -z "$(git_child -C "$WORKTREE_PATH" status --porcelain)" ] \
        || fail "worktree has uncommitted changes"

    # -----------------------------------------------------------------------
    # CON-132: a diff touching the commit-gate chain must not reach Delivery
    # without recorded evidence. check-gate-chain-change.sh only CLASSIFIES
    # the diff (design.md Decision 1/2); the evidence check itself lives
    # here, fail-closed on any classification/read error (design.md Risks —
    # "evidence file absent" is FAIL, not PASS).
    # -----------------------------------------------------------------------
    GC_BASE_REMOTE="${CONCERTINO_BASE_REMOTE:-origin}"
    GC_BASE_BRANCH="${CONCERTINO_BASE_BRANCH:-main}"
    if GC_OUT="$("${SCRIPT_DIR}/check-gate-chain-change.sh" "$WORKTREE_PATH" "${GC_BASE_REMOTE}/${GC_BASE_BRANCH}" "$GATE_TICKET" 2>&1)"; then
      GC_RC=0
    else
      GC_RC=$?
    fi
    if [ "$GC_RC" -ne 0 ]; then
      fail "gate-chain classification failed (fail-closed): $(printf '%s' "$GC_OUT" | tr '\n' ' ' | cut -c1-200)"
    elif printf '%s\n' "$GC_OUT" | grep -q '^GATECHAIN yes$'; then
      GC_ROOT="$(main_checkout "$WORKTREE_PATH")"
      if [ -z "${GC_ROOT:-}" ]; then
        fail "gate-chain diff detected but could not resolve main checkout to look up evidence"
      else
        GC_EVIDENCE_DIR="${GC_ROOT}/.concertino/runs/${GATE_TICKET}/evidence"

        # --- (a) the answered implications checklist, persisted design.md ---
        GC_DESIGN_MD=""
        for f in "${GC_EVIDENCE_DIR}"/openspec/changes/*/design.md; do
          [ -f "$f" ] && GC_DESIGN_MD="$f" && break
        done
        if [ -z "$GC_DESIGN_MD" ]; then
          fail "gate-chain diff detected: no persisted design.md found under ${GC_EVIDENCE_DIR}/openspec/changes/*/design.md — the Gate-Chain Implications Checklist evidence is missing"
        else
          GC_CHECKLIST_OUT="$(node -e '
            const fs = require("fs");
            const text = fs.readFileSync(process.argv[1], "utf8");
            const HEADING = "## Gate-Chain Implications Checklist";
            const idx = text.indexOf(HEADING);
            if (idx === -1) { console.log("FAIL missing heading"); process.exit(0); }
            const rest = text.slice(idx + HEADING.length);
            const nextHeading = rest.search(/\n##\s/);
            const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
            const prompts = [
              "What does it execute?",
              "What environment does it inherit, and from where?",
              "Does it write anything outside its own sandbox?",
              "Does it behave differently from a linked worktree than from a main checkout?",
              "What happens on its first run?"
            ];
            const placeholders = new Set(["tbd", "n/a", "na", "todo", ""]);
            const missing = [];
            for (const p of prompts) {
              const marker = `**${p}**`;
              const at = section.indexOf(marker);
              if (at === -1) { missing.push(p); continue; }
              const lineEnd = section.indexOf("\n", at);
              const answer = (lineEnd === -1 ? section.slice(at + marker.length) : section.slice(at + marker.length, lineEnd)).trim();
              if (placeholders.has(answer.toLowerCase())) missing.push(p);
            }
            if (missing.length) console.log("FAIL unanswered: " + missing.join(" | "));
            else console.log("PASS");
          ' "$GC_DESIGN_MD" 2>&1)"
          case "$GC_CHECKLIST_OUT" in
            PASS) ;;
            *) fail "gate-chain diff detected: Gate-Chain Implications Checklist incomplete in $(basename "$(dirname "$GC_DESIGN_MD")")/design.md — ${GC_CHECKLIST_OUT}" ;;
          esac
        fi

        # --- (b) a passing isolation-test transcript for EVERY gate-chain- --
        # --- touching script path the diff actually contains ---------------
        while IFS= read -r gc_line; do
          case "$gc_line" in
            SCRIPT\ *)
              gc_script_path="${gc_line#SCRIPT }"
              gc_flat="$(printf '%s' "$gc_script_path" | sed 's#/#__#g')"
              gc_transcript="${GC_EVIDENCE_DIR}/.concertino/gate-chain-isolation-evidence/${gc_flat}.md"
              if [ ! -f "$gc_transcript" ]; then
                fail "gate-chain diff detected: no isolation-test evidence for changed script ${gc_script_path} (expected ${gc_transcript})"
              elif ! grep -qF '**PASS**' "$gc_transcript"; then
                fail "gate-chain diff detected: isolation-test evidence for ${gc_script_path} does not record a PASS verdict (${gc_transcript})"
              fi
              ;;
          esac
        done <<< "$GC_OUT"
      fi
    fi

    # -----------------------------------------------------------------------
    # CON-31: best-effort, non-blocking stale-base warning. Fetches the
    # configured base remote/branch and compares it to this branch's
    # merge-base with it. Purely additive: never sets FAILED, never changes
    # the exit code or the `PASS delivery` stdout line. Every git call is
    # individually guarded (`... || VAR=""` / `if ...; then`) so a fetch
    # failure, an unresolvable ref, or any other unexpected git error
    # degrades to "skip this check silently" rather than tripping
    # `set -euo pipefail` and aborting the whole script (design.md
    # Decision 2, Goals).
    # -----------------------------------------------------------------------
    STALE_REMOTE="${CONCERTINO_BASE_REMOTE:-origin}"
    STALE_BRANCH="${CONCERTINO_BASE_BRANCH:-main}"
    if git_child -C "$WORKTREE_PATH" fetch --quiet "$STALE_REMOTE" "$STALE_BRANCH" 2>/dev/null; then
      STALE_REMOTE_TIP="$(git_child -C "$WORKTREE_PATH" rev-parse "${STALE_REMOTE}/${STALE_BRANCH}" 2>/dev/null)" || STALE_REMOTE_TIP=""
      if [ -n "$STALE_REMOTE_TIP" ]; then
        STALE_MERGE_BASE="$(git_child -C "$WORKTREE_PATH" merge-base HEAD "$STALE_REMOTE_TIP" 2>/dev/null)" || STALE_MERGE_BASE=""
        if [ -n "$STALE_MERGE_BASE" ] && [ "$STALE_MERGE_BASE" != "$STALE_REMOTE_TIP" ]; then
          STALE_BEHIND="$(git_child -C "$WORKTREE_PATH" rev-list --count "${STALE_MERGE_BASE}..${STALE_REMOTE_TIP}" 2>/dev/null)" || STALE_BEHIND=""
          if [[ "$STALE_BEHIND" =~ ^[0-9]+$ ]] && [ "$STALE_BEHIND" -gt 0 ]; then
            STALE_LOG="$(git_child -C "$WORKTREE_PATH" log --oneline -5 "${STALE_MERGE_BASE}..${STALE_REMOTE_TIP}" 2>/dev/null)" || STALE_LOG=""
            if [ -n "$STALE_LOG" ]; then
              echo "WARN base ${STALE_REMOTE}/${STALE_BRANCH} has moved — this branch is ${STALE_BEHIND} commit(s) behind:" >&2
              while IFS= read -r stale_line; do
                echo "  $stale_line" >&2
              done <<< "$STALE_LOG"
              if [ "$STALE_BEHIND" -gt 5 ]; then
                echo "  (+$((STALE_BEHIND - 5)) more)" >&2
              fi

              STALE_SHAS="$(printf '%s\n' "$STALE_LOG" | awk '{print $1}' | paste -sd, -)" || STALE_SHAS=""
              looks_like_ticket "$GATE_TICKET" && CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.warning \
                "ticket=${GATE_TICKET}" "gate=phase:delivery" "behind=${STALE_BEHIND}" \
                "base=${STALE_BRANCH}" "remote=${STALE_REMOTE}" "commits=${STALE_SHAS}" || true
            fi
          fi
        fi
      fi
    fi
    ;;

  cleanup)
    DEV_PORT="${3:-}"
    BACKEND_PORT="${4:-}"
    TICKET_ID="${5:-}"
    GATE_TICKET="${TICKET_ID:-${WORKTREE_PATH##*/}}"
    if [ -n "$DEV_PORT" ] && [ -n "${CONCERTINO_FRONTEND_HEALTH:-}" ]; then
      curl -sf "$(resolve_url "$CONCERTINO_FRONTEND_HEALTH")" >/dev/null 2>&1 \
          && fail "frontend still serving on ${DEV_PORT}" || true
    fi
    if [ -n "$BACKEND_PORT" ] && [ -n "${CONCERTINO_BACKEND_HEALTH:-}" ]; then
      curl -sf "$(resolve_url "$CONCERTINO_BACKEND_HEALTH")" >/dev/null 2>&1 \
          && fail "backend still healthy on ${BACKEND_PORT}" || true
    fi
    [ ! -d "$WORKTREE_PATH" ] || fail "worktree dir still present: $WORKTREE_PATH"
    ;;

  *)
    echo "FAIL unknown phase '$PHASE' (expected: setup|servers|delivery|cleanup)" >&2
    exit 2
    ;;
esac

DURATION_MS=$(( $(now_ms) - START_TS ))

if [ "$FAILED" -ne 0 ]; then
  looks_like_ticket "$GATE_TICKET" && CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.result \
    "ticket=${GATE_TICKET}" "gate=phase:${PHASE}" "status=fail" "duration_ms=${DURATION_MS}" "first_error=${FIRST_ERROR}" || true
  exit 1
fi

looks_like_ticket "$GATE_TICKET" && CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.result \
  "ticket=${GATE_TICKET}" "gate=phase:${PHASE}" "status=pass" "duration_ms=${DURATION_MS}" || true
echo "PASS $PHASE"
