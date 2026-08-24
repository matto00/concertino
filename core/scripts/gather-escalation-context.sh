#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# gather-escalation-context.sh — format a structured context block for one of
# the seven escalation kinds CON-11 (and CON-50's ticket-ambiguity addition,
# and CON-136's ticket-drift addition) enumerate, so the context an
# escalation carries is a committed procedure rather than prose the
# orchestrator improvises at raise time.
#
# Usage: gather-escalation-context.sh <KIND> [k=v ...]
#
# KIND is one of: dependency, api-change, budget, blocker, contradiction,
# ticket-ambiguity, ticket-drift. Each kind requires specific k=v fields (see
# the case block below). ticket-drift's output additionally opens with a
# fixed literal marker line, TICKET-DRIFT-ESCALATION, before its structured
# block — escalation.raised events carry no caller-settable `kind` field
# (emit-event.sh drops it), so a consumer (assert-phase.sh setup's
# material-drift check) identifies a ticket-drift escalation via a prefix
# match on `context` alone. On
# success, prints a structured, human-readable plain-text block to stdout and
# exits 0 — the caller passes that block through as `context=` on the
# `emit-event.sh escalation --await` call that follows it.
#
# On a missing required field, or a kind not in the set above: prints
# `FAIL <reason>` to stderr, exits non-zero, and prints nothing to stdout —
# the same no-dangling-half-result discipline persist-evidence.sh already
# established. The caller must not let a malformed call here block the
# escalation itself: if this script fails, raise the escalation without
# `context=` rather than skip raising it — missing context is a known,
# honest degradation the escalation screen already handles.
#
# This script is a pure formatter. It does not know about emit-event.sh's
# 4000-byte line cap and does not call persist-evidence.sh itself — that
# budget/persistence logic stays in the one place that already owns it.
# ===========================================================================

VALID_KINDS="dependency api-change budget blocker contradiction ticket-ambiguity ticket-drift"

fail() {
  echo "FAIL $1" >&2
  exit 1
}

KIND="${1:-}"
[ "$#" -gt 0 ] && shift

[ -z "$KIND" ] && fail "no escalation kind given (valid kinds: ${VALID_KINDS})"

case " ${VALID_KINDS} " in
  *" ${KIND} "*) ;;
  *) fail "unrecognized escalation kind '${KIND}' (valid kinds: ${VALID_KINDS})" ;;
esac

# Parse k=v args the same way emit-event.sh does: split on the FIRST '=' only,
# so a value containing '=' (a signature diff, a shell command) survives
# intact.
declare -A F=()
for kv in "$@"; do
  key="${kv%%=*}"
  val="${kv#*=}"
  [ "$key" = "$kv" ] && continue   # no '=' — ignore
  F["$key"]="$val"
done

# A field counts as missing whether it was never passed or was passed empty —
# either way there is nothing for a human to read, so it fails the same way.
require() {
  local missing="" f
  for f in "$@"; do
    if [ -z "${F[$f]:-}" ]; then
      missing="${missing}${missing:+, }${f}"
    fi
  done
  [ -n "$missing" ] && fail "missing required field(s) for kind '${KIND}': ${missing}"
  return 0
}

case "$KIND" in
  dependency)
    require package version purpose file
    ALTERNATIVE="${F[alternative]:-none identified}"
    cat <<EOF
New external dependency
  package:     ${F[package]}
  version:     ${F[version]}
  purpose:     ${F[purpose]}
  imported by: ${F[file]}
  alternative already in the project: ${ALTERNATIVE}
EOF
    ;;

  api-change)
    require current proposed callsites
    cat <<EOF
Breaking API change
  current signature:  ${F[current]}
  proposed signature: ${F[proposed]}
  call sites affected: ${F[callsites]}
EOF
    ;;

  budget)
    require counter last_verdict change_request
    cat <<EOF
Budget exhausted
  cycle counter:            ${F[counter]}
  last evaluator/skeptic verdict: ${F[last_verdict]}
  change request that survived being "fixed": ${F[change_request]}
EOF
    ;;

  blocker)
    require command exit_code output
    cat <<EOF
BLOCKER (environmental)
  failing command: ${F[command]}
  exit code:       ${F[exit_code]}
  output (first lines):
${F[output]}
EOF
    ;;

  contradiction)
    require requirement_a requirement_b
    cat <<EOF
Contradiction — these two requirements cannot both hold
  requirement A: ${F[requirement_a]}
  requirement B: ${F[requirement_b]}
EOF
    ;;

  ticket-ambiguity)
    require signal detail draft_excerpt
    cat <<EOF
Ticket-drafting ambiguity — an unresolved fork was about to be finalized
  signal:        ${F[signal]}
  detail:        ${F[detail]}
  draft excerpt: ${F[draft_excerpt]}
EOF
    ;;

  ticket-drift)
    require claimed actual options
    cat <<EOF
TICKET-DRIFT-ESCALATION
Ticket premise has drifted from the live tree
  claimed: ${F[claimed]}
  actual:  ${F[actual]}
  options: ${F[options]}
EOF
    ;;
esac
