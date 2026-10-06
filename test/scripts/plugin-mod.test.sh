#!/usr/bin/env bash
# Runs the Claude Code mod's own checks (claude plugin validate/test) as part
# of `npm test`. Skips — exit 0 with a note — when the `claude` CLI is not on
# PATH, so CI without Claude Code still passes; a machine with it installed
# gets the full gate. No --strict: it fails on a pre-existing marketplace.json
# "no description" warning unrelated to the mod. See docs/superpowers/specs/2026-10-06-fleet-pane-design.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if ! command -v claude >/dev/null 2>&1; then
  echo "plugin-mod.test.sh: skipped (claude CLI not on PATH)"
  exit 0
fi
cd "$ROOT"
claude plugin validate .
claude plugin test .
echo "plugin-mod.test.sh: ok"
