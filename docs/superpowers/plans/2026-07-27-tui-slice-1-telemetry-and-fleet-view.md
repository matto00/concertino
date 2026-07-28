# Concertino TUI — Slice 1: Telemetry + Read-Only Fleet View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `concertino watch` — a terminal fleet view that shows every active orchestrator run, backed by a harness-agnostic event log the procedure scripts and agent roles append to.

**Architecture:** Agents and scripts append JSON lines to `.concertino/runs/<TICKET>/events.jsonl` via a new canonical bash script. tmux owns the actual sessions (one window per run), so process liveness is free and runs outlive the TUI. A pure reducer folds events + tmux state into a `Run[]` model, and a pure renderer turns that into a string. All I/O sits outside the two functions worth testing.

**Tech Stack:** Node ≥16 (CommonJS, `node --test`), bash, tmux. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-07-27-tui-fleet-dashboard-design.md`

## Global Constraints

- **Zero npm dependencies.** `package.json` has none and gains none. Node built-ins only.
- **Node ≥16** (`package.json → engines`). No `??=`, no top-level await, CommonJS `require`.
- **Telemetry must never break the workflow.** Every call to `emit-event.sh` from another script is suffixed `|| true`. A broken event log degrades the dashboard; it must never fail a run.
- **Event lines are capped at 4000 bytes** so `O_APPEND` writes stay atomic under `PIPE_BUF`.
- **Existing script contract is preserved.** `READY <k>=<v>` on stdout, `FAIL <reason>` on stderr, `PASS <phase>` from `assert-phase.sh`. Events are additive; no existing stdout line changes.
- **`dashboard` is the config key, never `ui`.** `ui` already means "does the project under test have a UI" (`bin/concertino:186`, `config/concertino.schema.json:106`).
- **Scripts live in `core/scripts/` and are copied to consumers by `copyAssets()`** at `bin/concertino:460`. New scripts are picked up automatically by `fs.readdirSync`, but must be executable.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `core/scripts/emit-event.sh` | Append one event; `--await` blocks for an escalation answer |
| `lib/ui/store.js` | Filesystem paths + reading/parsing `events.jsonl` |
| `lib/ui/reducer.js` | Pure: `(eventsByTicket, windows, now) → Run[]` |
| `lib/ui/session.js` | tmux backend: ensure/list/capture/spawn/kill/attach |
| `lib/ui/format.js` | Duration, truncation, padding, progress bar |
| `lib/ui/screens/fleet.js` | Pure: `(runs, opts) → string` |
| `lib/ui/watch.js` | The poll loop, idle tracking, keyboard handling |
| `test/*.test.js` | `node --test` suites |
| `test/scripts/emit-event.test.sh` | Shell tests for the emitter |

---

### Task 1: `emit-event.sh` — event emission

**Files:**
- Create: `core/scripts/emit-event.sh`
- Create: `test/scripts/emit-event.test.sh`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: nothing.
- Produces: a CLI contract used by Tasks 2, 8, 9 —
  `emit-event.sh <kind> [--await] k=v [k=v ...]`, requires `ticket=<ID>`,
  appends one JSON line to `<main checkout>/.concertino/runs/<TICKET>/events.jsonl`.
  Always exits 0 in non-`--await` mode, even on internal error.

- [ ] **Step 1: Write the failing test**

Create `test/scripts/emit-event.test.sh`:

```bash
#!/usr/bin/env bash
# Shell tests for core/scripts/emit-event.sh. Run: bash test/scripts/emit-event.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/emit-event.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

# Each test runs in a throwaway git repo so the script's main-checkout
# resolution is exercised for real.
new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" commit -q --allow-empty -m init
  printf '%s' "$d"
}

echo "emit-event.sh"

# --- writes a well-formed line to the right place --------------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" phase.enter ticket=HEL-1 phase=Execution cycle=2 ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-1/events.jsonl"
check "creates events.jsonl" "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "one line"             "$(wc -l < "$LOG" | tr -d ' ')" "1"
check "kind"                 "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).kind)' "$LOG")" "phase.enter"
check "ticket"               "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).ticket)' "$LOG")" "HEL-1"
check "numeric cycle"        "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).cycle)' "$LOG")" "number"
check "t is a number"        "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).t)' "$LOG")" "number"
check "default role"         "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).role)' "$LOG")" "script"
rm -rf "$REPO"

# --- appends rather than truncates -----------------------------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=HEL-2 msg=one ) >/dev/null 2>&1
( cd "$REPO" && "$SCRIPT" note ticket=HEL-2 msg=two ) >/dev/null 2>&1
check "appends" "$(wc -l < "$REPO/.concertino/runs/HEL-2/events.jsonl" | tr -d ' ')" "2"
rm -rf "$REPO"

# --- quotes and newlines survive as valid JSON ------------------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=HEL-3 msg='he said "hi"
and left	now' ) >/dev/null 2>&1
check "escapes to valid JSON" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).msg.includes(String.fromCharCode(10))?"multiline":"flat")' "$REPO/.concertino/runs/HEL-3/events.jsonl")" \
  "multiline"
rm -rf "$REPO"

# --- long values are truncated so the line stays atomic ---------------------
REPO="$(new_repo)"
BIG="$(head -c 9000 /dev/zero | tr '\0' 'x')"
( cd "$REPO" && "$SCRIPT" note ticket=HEL-4 msg="$BIG" ) >/dev/null 2>&1
LINELEN="$(head -1 "$REPO/.concertino/runs/HEL-4/events.jsonl" | wc -c | tr -d ' ')"
check "line <= 4000 bytes" "$([ "$LINELEN" -le 4000 ] && echo yes || echo no)" "yes"
check "still valid JSON"   "$(node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim());console.log("yes")' "$REPO/.concertino/runs/HEL-4/events.jsonl")" "yes"
rm -rf "$REPO"

# --- works from inside a worktree, writing to the MAIN checkout -------------
REPO="$(new_repo)"
git -C "$REPO" worktree add -q "$REPO/wt" -b feat 2>/dev/null
( cd "$REPO/wt" && "$SCRIPT" note ticket=HEL-5 msg=from-worktree ) >/dev/null 2>&1
check "writes to main checkout" \
  "$([ -f "$REPO/.concertino/runs/HEL-5/events.jsonl" ] && echo yes || echo no)" "yes"
check "not inside the worktree" \
  "$([ -f "$REPO/wt/.concertino/runs/HEL-5/events.jsonl" ] && echo yes || echo no)" "no"
rm -rf "$REPO"

# --- identity fields stay strings even when they look numeric ---------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=42 role=7 msg=hi ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/42/events.jsonl"
check "numeric ticket stays a string" "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).ticket)' "$LOG")" "string"
check "numeric role stays a string"   "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).role)' "$LOG")" "string"
rm -rf "$REPO"

# --- zero-padded numbers stay strings rather than emitting invalid JSON -----
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=HEL-8 code=007 ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-8/events.jsonl"
check "zero-padded value is valid JSON" "$(node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim());console.log("yes")' "$LOG" 2>/dev/null || echo no)" "yes"
check "zero-padded value is a string"   "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).code)' "$LOG")" "007"
rm -rf "$REPO"

# --- plain integers are still emitted unquoted ------------------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=HEL-9 cycle=0 n=-12 ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-9/events.jsonl"
check "zero is a number"     "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).cycle)' "$LOG")" "number"
check "negative is a number" "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).n)' "$LOG")" "-12"
rm -rf "$REPO"

# --- missing ticket is a no-op, never a failure -----------------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note msg=orphan ) >/dev/null 2>&1
check "exit 0 without ticket" "$?" "0"
rm -rf "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash test/scripts/emit-event.test.sh`
Expected: FAIL — every check errors because `core/scripts/emit-event.sh` does not exist.

- [ ] **Step 3: Write the implementation**

Create `core/scripts/emit-event.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# emit-event.sh — append one structured event to a run's event log.
#
# The telemetry seam for the Concertino dashboard. Called by the other
# procedure scripts and by the agent roles at the moments they already write
# workflow-state.md, so the dashboard works identically on every harness.
#
# Usage:
#   emit-event.sh <kind> k=v [k=v ...]
#   emit-event.sh escalation --await ticket=<ID> question=<text> options=a,b
#
# `ticket=<ID>` is required; everything else is written through to the JSON
# object verbatim. Values matching an integer or true/false are emitted
# unquoted; everything else is a JSON string.
#
# Writes to  <main checkout>/.concertino/runs/<TICKET>/events.jsonl
# — the MAIN checkout, never the worktree, because cleanup.sh --phase4
# destroys the worktree and would take the run's history with it.
#
# ALWAYS exits 0 in normal mode, including on internal error. Telemetry must
# never fail a delivery run. (--await is the one exception; see below.)
# ===========================================================================

MAX_LINE=4000

# Millisecond epoch. GNU date supports %3N; BSD/macOS date does not, so fall
# back to node (already a hard requirement for Concertino).
now_ms() {
  local d
  d="$(date +%s%3N 2>/dev/null)"
  case "$d" in
    *N*|'') node -e 'process.stdout.write(String(Date.now()))' ;;
    *) printf '%s' "$d" ;;
  esac
}

KIND="${1:-}"
[ -z "$KIND" ] && exit 0
shift || true

AWAIT=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--await" ]; then AWAIT=1; else ARGS+=("$a"); fi
done

# Resolve the main checkout. `git rev-parse --git-common-dir` points at the
# shared .git directory from a worktree as well as from the main checkout, but
# it is RELATIVE on some git versions and absolute on others — normalise both.
main_checkout() {
  local common
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  [ -z "$common" ] && return 1
  case "$common" in
    /*) ;;
     *) common="$(cd "$common" 2>/dev/null && pwd)" || return 1 ;;
  esac
  ( cd "$(dirname "$common")" 2>/dev/null && pwd ) || return 1
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  # Drop any remaining control characters rather than emit invalid JSON.
  printf '%s' "$s" | tr -d '\000-\010\013\014\016-\037'
}

# Auto-unquote only well-formed JSON numbers. Leading zeros are excluded
# deliberately: bare 007 is a JSON syntax error, and a reader would count the
# whole event as malformed and drop it.
json_value() {
  local v="$1"
  if [[ "$v" =~ ^-?(0|[1-9][0-9]*)$ ]] || [ "$v" = "true" ] || [ "$v" = "false" ]; then
    printf '%s' "$v"
  else
    printf '"%s"' "$(json_escape "$v")"
  fi
}

# The identity fields are string-typed by contract regardless of what they look
# like — a ticket of "42" must stay "42", never become a JSON number, or every
# consumer that treats ticket as a key breaks.
json_string() {
  printf '"%s"' "$(json_escape "$1")"
}

ROOT="$(main_checkout)" || exit 0

TICKET=""
ROLE="${CONCERTINO_ROLE:-script}"
PROJECT="${CONCERTINO_PROJECT:-$(basename "$ROOT")}"
FIELDS=""

for kv in ${ARGS+"${ARGS[@]}"}; do
  key="${kv%%=*}"
  val="${kv#*=}"
  [ "$key" = "$kv" ] && continue          # no '=' — ignore
  case "$key" in
    ticket)  TICKET="$val" ;;
    role)    ROLE="$val" ;;
    project) PROJECT="$val" ;;
    *)       FIELDS="${FIELDS},\"$(json_escape "$key")\":$(json_value "$val")" ;;
  esac
done

[ -z "$TICKET" ] && exit 0

RUN_DIR="${ROOT}/.concertino/runs/${TICKET}"
mkdir -p "$RUN_DIR" 2>/dev/null || exit 0
LOG="${RUN_DIR}/events.jsonl"

build_line() {
  printf '{"t":%s,"kind":%s,"project":%s,"ticket":%s,"role":%s%s}' \
    "$(now_ms)" \
    "$(json_string "$1")" \
    "$(json_string "$PROJECT")" \
    "$(json_string "$TICKET")" \
    "$(json_string "$ROLE")" \
    "$FIELDS"
}

LINE="$(build_line "$KIND")"

# Keep the line under PIPE_BUF so concurrent O_APPEND writes from the
# orchestrator and a sub-agent can never interleave. If a caller passed a huge
# value, drop the extra fields rather than emit a torn or invalid line.
# LC_ALL=C makes ${#LINE} count bytes rather than characters, which is what
# PIPE_BUF actually cares about.
if [ "$(LC_ALL=C; echo ${#LINE})" -gt "$MAX_LINE" ]; then
  FIELDS=",\"truncated\":true"
  LINE="$(build_line "$KIND")"
fi

printf '%s\n' "$LINE" >> "$LOG" 2>/dev/null || exit 0

exit 0
```

- [ ] **Step 4: Make it executable and wire up the test runner**

```bash
chmod +x core/scripts/emit-event.sh
```

In `package.json`, replace the `test` script:

```json
"scripts": {
  "test": "bash test/scripts/emit-event.test.sh",
  "test:selftest": "node bin/concertino sync --out=/tmp/concertino-selftest --config=config/examples/helio.json --dry-run"
}
```

`node --test test/` is deliberately **not** added yet — it errors when `test/`
contains no JS test files, and Task 3 adds it along with the first one. Do not
create a placeholder test to work around this.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bash test/scripts/emit-event.test.sh`
Expected: PASS — `20 passed, 0 failed`.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/scripts/emit-event.sh test/scripts/emit-event.test.sh package.json
git commit -m "feat(telemetry): add emit-event.sh, the harness-agnostic event emitter"
```

---

### Task 2: `emit-event.sh --await` — blocking escalations

**Files:**
- Modify: `core/scripts/emit-event.sh`
- Modify: `test/scripts/emit-event.test.sh`

**Interfaces:**
- Consumes: Task 1's `emit-event.sh`.
- Produces: `emit-event.sh escalation --await ticket=<ID> question=<text> options=a,b`
  writes an `escalation.raised` event, polls `<run dir>/answer.json` every second,
  and on success prints the value of that file's `answer` key to **stdout** and
  exits 0. On timeout it appends `escalation.timeout` and exits 1.
  Timeout comes from `CONCERTINO_ESCALATION_TIMEOUT_MIN` (default 60).

- [ ] **Step 1: Write the failing test**

Append to `test/scripts/emit-event.test.sh`, immediately before the final `echo "  $PASS passed..."` line:

```bash
# --- --await returns the answer written by the dashboard --------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-6 question="add zod?" options=approve,deny ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
# Wait for the raised event, then answer it the way the TUI would.
for _ in $(seq 1 50); do
  [ -f "$REPO/.concertino/runs/HEL-6/events.jsonl" ] && break
  sleep 0.1
done
printf '{"answer":"approve"}' > "$REPO/.concertino/runs/HEL-6/answer.json"
wait "$AWAIT_PID"; AWAIT_RC=$?
check "--await exit 0 when answered" "$AWAIT_RC" "0"
check "--await prints the answer"    "$(tr -d '\n' < "$REPO/out.txt")" "approve"
check "--await raised an event"      "$(grep -c 'escalation.raised' "$REPO/.concertino/runs/HEL-6/events.jsonl")" "1"
rm -rf "$REPO"

# --- --await times out rather than hanging forever --------------------------
REPO="$(new_repo)"
( cd "$REPO" && CONCERTINO_ESCALATION_TIMEOUT_MIN=0 "$SCRIPT" escalation --await ticket=HEL-7 question=q ) >/dev/null 2>&1
check "--await exit 1 on timeout" "$?" "1"
check "--await logged a timeout"  "$(grep -c 'escalation.timeout' "$REPO/.concertino/runs/HEL-7/events.jsonl")" "1"
rm -rf "$REPO"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash test/scripts/emit-event.test.sh`
Expected: FAIL on the four new checks — `--await` is currently parsed but ignored, so the process returns immediately, writes no answer to stdout, and never emits `escalation.timeout`.

- [ ] **Step 3: Write the implementation**

In `core/scripts/emit-event.sh`, replace the final two lines:

```bash
printf '%s\n' "$LINE" >> "$LOG" 2>/dev/null || exit 0

exit 0
```

with:

```bash
if [ "$AWAIT" -eq 1 ]; then
  # An escalation always lands in the log as `escalation.raised`, whatever
  # kind the caller passed, so the reducer has one thing to look for.
  LINE="$(build_line escalation.raised)"
fi

printf '%s\n' "$LINE" >> "$LOG" 2>/dev/null || exit 0

[ "$AWAIT" -eq 0 ] && exit 0

# --- blocking escalation ---------------------------------------------------
# Poll for the answer file the dashboard writes. This is the whole control
# plane: no keystroke injection, no detecting when a harness is at a prompt,
# and identical on Codex or a local-model harness.
ANSWER_FILE="${RUN_DIR}/answer.json"
rm -f "$ANSWER_FILE" 2>/dev/null || true

TIMEOUT_MIN="${CONCERTINO_ESCALATION_TIMEOUT_MIN:-60}"
DEADLINE=$(( $(date +%s) + TIMEOUT_MIN * 60 ))

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if [ -f "$ANSWER_FILE" ]; then
    ANSWER="$(node -e '
      try {
        const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        process.stdout.write(String(a.answer == null ? "" : a.answer));
      } catch { process.stdout.write(""); }
    ' "$ANSWER_FILE" 2>/dev/null)"
    if [ -n "$ANSWER" ]; then
      FIELDS=",\"answer\":$(json_value "$ANSWER")"
      printf '%s\n' "$(build_line escalation.answered)" >> "$LOG" 2>/dev/null || true
      printf '%s\n' "$ANSWER"
      exit 0
    fi
  fi
  sleep 1
done

# Timed out: tell the log, and exit non-zero so the caller falls back to its
# own escalation path (printing the question to chat). The dashboard is an
# accelerator for escalations — never a new way for a run to hang.
FIELDS=""
printf '%s\n' "$(build_line escalation.timeout)" >> "$LOG" 2>/dev/null || true
exit 1
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash test/scripts/emit-event.test.sh`
Expected: PASS — `25 passed, 0 failed`. The timeout case returns in well under a second because `CONCERTINO_ESCALATION_TIMEOUT_MIN=0` puts the deadline in the past.

- [ ] **Step 5: Commit**

```bash
git add core/scripts/emit-event.sh test/scripts/emit-event.test.sh
git commit -m "feat(telemetry): add blocking --await mode for escalations"
```

---

### Task 3: `lib/ui/store.js` — reading the event log

**Files:**
- Create: `lib/ui/store.js`
- Create: `test/store.test.js`
- Modify: `package.json` (add `node --test test/` now that a JS suite exists)

**Interfaces:**
- Consumes: the on-disk layout written by Task 1.
- Produces:
  - `runsDir(root) → string`
  - `eventsPath(root, ticket) → string`
  - `answerPath(root, ticket) → string`
  - `listTickets(root) → string[]`
  - `readEvents(root, ticket) → { events: Event[], malformed: number }`
  - `readAll(root) → Map<string, { events, malformed }>`

- [ ] **Step 1: Write the failing test**

Create `test/store.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('../lib/ui/store');

function tmpRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-store-'));
  for (const [ticket, lines] of Object.entries(files || {})) {
    const dir = path.join(root, '.concertino', 'runs', ticket);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), lines);
  }
  return root;
}

test('readEvents returns parsed events', () => {
  const root = tmpRoot({
    'HEL-1': '{"t":1,"kind":"run.start","ticket":"HEL-1"}\n{"t":2,"kind":"note","ticket":"HEL-1"}\n',
  });
  const { events, malformed } = store.readEvents(root, 'HEL-1');
  assert.equal(events.length, 2);
  assert.equal(malformed, 0);
  assert.equal(events[0].kind, 'run.start');
});

test('readEvents counts malformed lines instead of throwing', () => {
  const root = tmpRoot({
    'HEL-2': '{"t":1,"kind":"note","ticket":"HEL-2"}\nnot json\n{"broken\n{"t":3,"kind":"note","ticket":"HEL-2"}\n',
  });
  const { events, malformed } = store.readEvents(root, 'HEL-2');
  assert.equal(events.length, 2);
  assert.equal(malformed, 2);
});

test('readEvents rejects lines missing required fields', () => {
  const root = tmpRoot({ 'HEL-3': '{"kind":"note"}\n{"t":5}\n{"t":6,"kind":"note"}\n' });
  const { events, malformed } = store.readEvents(root, 'HEL-3');
  assert.equal(events.length, 1);
  assert.equal(malformed, 2);
});

test('readEvents on a missing log is empty, not an error', () => {
  const root = tmpRoot({});
  assert.deepEqual(store.readEvents(root, 'NOPE'), { events: [], malformed: 0 });
});

test('readEvents ignores blank lines', () => {
  const root = tmpRoot({ 'HEL-4': '\n{"t":1,"kind":"note","ticket":"HEL-4"}\n\n' });
  const { events, malformed } = store.readEvents(root, 'HEL-4');
  assert.equal(events.length, 1);
  assert.equal(malformed, 0);
});

test('listTickets lists run directories', () => {
  const root = tmpRoot({ 'HEL-1': '', 'HEL-2': '' });
  assert.deepEqual(store.listTickets(root).sort(), ['HEL-1', 'HEL-2']);
});

test('listTickets on a repo with no runs is empty', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-store-'));
  assert.deepEqual(store.listTickets(root), []);
});

test('readAll returns a map keyed by ticket', () => {
  const root = tmpRoot({
    'HEL-1': '{"t":1,"kind":"note","ticket":"HEL-1"}\n',
    'HEL-2': '{"t":2,"kind":"note","ticket":"HEL-2"}\n',
  });
  const all = store.readAll(root);
  assert.equal(all.size, 2);
  assert.equal(all.get('HEL-1').events.length, 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/store.test.js`
Expected: FAIL — `Cannot find module '../lib/ui/store'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ui/store.js`:

```js
'use strict';

// Filesystem access for the run event logs. Everything that touches disk lives
// here so the reducer and renderer can stay pure.

const fs = require('fs');
const path = require('path');

function runsDir(root) {
  return path.join(root, '.concertino', 'runs');
}

function runDir(root, ticket) {
  return path.join(runsDir(root), ticket);
}

function eventsPath(root, ticket) {
  return path.join(runDir(root, ticket), 'events.jsonl');
}

function answerPath(root, ticket) {
  return path.join(runDir(root, ticket), 'answer.json');
}

function listTickets(root) {
  let entries;
  try {
    entries = fs.readdirSync(runsDir(root), { withFileTypes: true });
  } catch (e) {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

// A malformed line is skipped and counted, never thrown. A half-written line
// from a crashed emitter must not take the whole dashboard down.
function readEvents(root, ticket) {
  let raw;
  try {
    raw = fs.readFileSync(eventsPath(root, ticket), 'utf8');
  } catch (e) {
    return { events: [], malformed: 0 };
  }

  const events = [];
  let malformed = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch (e) {
      malformed++;
      continue;
    }
    if (ev && typeof ev.t === 'number' && typeof ev.kind === 'string') events.push(ev);
    else malformed++;
  }

  return { events, malformed };
}

function readAll(root) {
  const out = new Map();
  for (const ticket of listTickets(root)) out.set(ticket, readEvents(root, ticket));
  return out;
}

module.exports = { runsDir, runDir, eventsPath, answerPath, listTickets, readEvents, readAll };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/store.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 5: Add the JS suite to `npm test`**

Now that `test/` holds a real JS suite, update the `test` script in `package.json`:

```json
"test": "node --test test/ && bash test/scripts/emit-event.test.sh"
```

Run: `npm test`
Expected: PASS — both the JS suite and the shell suite.

- [ ] **Step 6: Commit**

```bash
git add lib/ui/store.js test/store.test.js package.json
git commit -m "feat(dashboard): add event log store with malformed-line tolerance"
```

---

### Task 4: `lib/ui/reducer.js` — events to run model

**Files:**
- Create: `lib/ui/reducer.js`
- Create: `test/reducer.test.js`

**Interfaces:**
- Consumes: `store.readAll()` output shape from Task 3.
- Produces: `reduce(eventsByTicket, windows, now) → Run[]`, where
  `windows` is `[{ ticket, alive, idleMs }]` and each `Run` is:
  `{ ticket, project, changeName, branch, worktree, devPort, backendPort, harness, model, phase, cycle, gates: [{name,status,durationMs,firstError}], lastVerdict: {role,verdict,ref}|null, escalation: {question,options,raisedAt}|null, escalationStale, events, startedAt, endedAt, endStatus, elapsedMs, window: {alive,idleMs}|null, status, telemetry, malformed }`.
  `status` ∈ `needs-you | running | failed | done | unknown`;
  `telemetry` ∈ `full | partial | none`. Output is sorted attention-first.

- [ ] **Step 1: Write the failing test**

Create `test/reducer.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { reduce } = require('../lib/ui/reducer');

// Helper: build the Map shape store.readAll() produces.
function log(ticket, events, malformed) {
  return new Map([[ticket, { events, malformed: malformed || 0 }]]);
}
const NOW = 1000000;

test('folds run.start into identity fields', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 100, kind: 'run.start', ticket: 'HEL-1', project: 'helio', role: 'script',
      branch: 'feature/panel-resize-handles/HEL-1', worktree: '/w/HEL-1',
      dev_port: 5334, backend_port: 8334, harness: 'claude', model: 'opus-5' },
  ]), [], NOW);

  assert.equal(run.branch, 'feature/panel-resize-handles/HEL-1');
  assert.equal(run.devPort, 5334);
  assert.equal(run.harness, 'claude');
  assert.equal(run.startedAt, 100);
});

test('derives changeName from the branch middle segment', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'run.start', ticket: 'HEL-1', role: 'script', branch: 'feature/panel-resize-handles/HEL-1' },
  ]), [], NOW);
  assert.equal(run.changeName, 'panel-resize-handles');
});

test('tracks the latest phase and cycle', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Execution', cycle: 1 },
    { t: 2, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Evaluation', cycle: 2 },
  ]), [], NOW);
  assert.equal(run.phase, 'Evaluation');
  assert.equal(run.cycle, 2);
});

test('keeps only the latest result per gate name', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'gate.result', ticket: 'HEL-1', role: 'script', gate: 'test', status: 'fail', duration_ms: 900 },
    { t: 2, kind: 'gate.result', ticket: 'HEL-1', role: 'script', gate: 'lint', status: 'pass', duration_ms: 100 },
    { t: 3, kind: 'gate.result', ticket: 'HEL-1', role: 'script', gate: 'test', status: 'pass', duration_ms: 800 },
  ]), [], NOW);
  assert.equal(run.gates.length, 2);
  assert.equal(run.gates.find((g) => g.name === 'test').status, 'pass');
  assert.equal(run.gates.find((g) => g.name === 'test').durationMs, 800);
});

test('events are folded in timestamp order even when the file is not', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 30, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Delivery' },
    { t: 10, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Planning' },
  ]), [], NOW);
  assert.equal(run.phase, 'Delivery');
});

test('a pending escalation makes the run need you', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator',
      question: 'add zod?', options: 'approve,deny' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.equal(run.status, 'needs-you');
  assert.deepEqual(run.escalation.options, ['approve', 'deny']);
});

test('an answered escalation clears it', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator', question: 'q' },
    { t: 2, kind: 'escalation.answered', ticket: 'HEL-1', role: 'human', answer: 'approve' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.equal(run.escalation, null);
  assert.equal(run.status, 'running');
});

test('a BLOCKER verdict needs you', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'verdict', ticket: 'HEL-1', role: 'evaluator', verdict: 'BLOCKER', ref: 'r.md' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.equal(run.status, 'needs-you');
});

test('a dead window with no run.end is failed, not running', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Execution' },
  ]), [{ ticket: 'HEL-1', alive: false, idleMs: 0 }], NOW);
  assert.equal(run.status, 'failed');
});

test('a dead window holding an escalation marks it stale', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator', question: 'q' },
  ]), [{ ticket: 'HEL-1', alive: false, idleMs: 0 }], NOW);
  assert.equal(run.status, 'failed');
  assert.equal(run.escalationStale, true);
});

test('run.end delivered is done', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'run.start', ticket: 'HEL-1', role: 'script' },
    { t: 9, kind: 'run.end', ticket: 'HEL-1', role: 'orchestrator', status: 'delivered' },
  ]), [], NOW);
  assert.equal(run.status, 'done');
  assert.equal(run.elapsedMs, 8);
});

test('telemetry tier is full when semantic events are present', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'run.start', ticket: 'HEL-1', role: 'script' },
    { t: 2, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Planning' },
  ]), [], NOW);
  assert.equal(run.telemetry, 'full');
});

test('telemetry tier is partial with script events only', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'run.start', ticket: 'HEL-1', role: 'script' },
    { t: 2, kind: 'gate.result', ticket: 'HEL-1', role: 'script', gate: 'test', status: 'pass' },
  ]), [], NOW);
  assert.equal(run.telemetry, 'partial');
  assert.equal(run.phase, null);
});

test('a window with no event log at all still produces a run', () => {
  const runs = reduce(new Map(), [{ ticket: 'HEL-9', alive: true, idleMs: 660000 }], NOW);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].telemetry, 'none');
  assert.equal(runs[0].status, 'running');
  assert.equal(runs[0].window.idleMs, 660000);
});

test('malformed count is carried through to the run', () => {
  const [run] = reduce(log('HEL-1', [{ t: 1, kind: 'note', ticket: 'HEL-1', role: 'script' }], 3), [], NOW);
  assert.equal(run.malformed, 3);
});

test('runs sort attention-first', () => {
  const events = new Map([
    ['HEL-DONE', { events: [{ t: 1, kind: 'run.end', ticket: 'HEL-DONE', role: 'orchestrator', status: 'delivered' }], malformed: 0 }],
    ['HEL-RUN',  { events: [{ t: 2, kind: 'phase.enter', ticket: 'HEL-RUN', role: 'orchestrator', phase: 'Execution' }], malformed: 0 }],
    ['HEL-ESC',  { events: [{ t: 3, kind: 'escalation.raised', ticket: 'HEL-ESC', role: 'orchestrator', question: 'q' }], malformed: 0 }],
  ]);
  const windows = [
    { ticket: 'HEL-RUN', alive: true, idleMs: 0 },
    { ticket: 'HEL-ESC', alive: true, idleMs: 0 },
  ];
  const runs = reduce(events, windows, NOW);
  assert.deepEqual(runs.map((r) => r.ticket), ['HEL-ESC', 'HEL-RUN', 'HEL-DONE']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/reducer.test.js`
Expected: FAIL — `Cannot find module '../lib/ui/reducer'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ui/reducer.js`:

```js
'use strict';

// Pure fold: event log + tmux window state -> the Run model the screens render.
// No I/O, no clock. `now` is passed in so elapsed times are testable.

// Semantic events only an agent can emit. Their presence is what proves the
// run is fully instrumented.
const TIER3_KINDS = new Set([
  'phase.enter', 'agent.spawn', 'agent.resume', 'agent.return', 'verdict',
]);

// Events the procedure scripts emit. Deterministic — no model can forget them.
const TIER2_KINDS = new Set(['run.start', 'gate.result']);

const STATUS_ORDER = { 'needs-you': 0, running: 1, unknown: 2, failed: 3, done: 4 };

function emptyRun(ticket) {
  return {
    ticket,
    project: null,
    changeName: null,
    branch: null,
    worktree: null,
    devPort: null,
    backendPort: null,
    harness: null,
    model: null,
    phase: null,
    cycle: null,
    gates: [],
    lastVerdict: null,
    escalation: null,
    escalationStale: false,
    events: [],
    startedAt: null,
    endedAt: null,
    endStatus: null,
    elapsedMs: null,
    window: null,
    status: 'unknown',
    telemetry: 'none',
    malformed: 0,
  };
}

// `options` arrives as a comma-joined string from the shell emitter, but an
// array is legal too — accept both.
function toOptions(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.length) return v.split(',');
  return [];
}

function applyEvent(run, ev) {
  run.events.push(ev);
  if (ev.project && !run.project) run.project = ev.project;

  switch (ev.kind) {
    case 'run.start':
      run.startedAt = ev.t;
      if (ev.branch != null) run.branch = ev.branch;
      if (ev.worktree != null) run.worktree = ev.worktree;
      if (ev.dev_port != null) run.devPort = ev.dev_port;
      if (ev.backend_port != null) run.backendPort = ev.backend_port;
      if (ev.harness != null) run.harness = ev.harness;
      if (ev.model != null) run.model = ev.model;
      break;

    case 'run.end':
      run.endedAt = ev.t;
      run.endStatus = ev.status || 'failed';
      break;

    case 'phase.enter':
      if (ev.phase != null) run.phase = ev.phase;
      if (ev.cycle != null) run.cycle = ev.cycle;
      break;

    case 'agent.resume':
      if (ev.cycle != null) run.cycle = ev.cycle;
      break;

    case 'gate.result': {
      const gate = {
        name: ev.gate,
        status: ev.status,
        durationMs: ev.duration_ms != null ? ev.duration_ms : null,
        firstError: ev.first_error != null ? ev.first_error : null,
      };
      const i = run.gates.findIndex((g) => g.name === ev.gate);
      if (i >= 0) run.gates[i] = gate;
      else run.gates.push(gate);
      break;
    }

    case 'verdict':
      run.lastVerdict = {
        role: ev.role,
        verdict: ev.verdict,
        ref: ev.ref != null ? ev.ref : null,
      };
      break;

    case 'escalation.raised':
      run.escalation = {
        question: ev.question || '',
        options: toOptions(ev.options),
        raisedAt: ev.t,
      };
      break;

    case 'escalation.answered':
    case 'escalation.timeout':
      run.escalation = null;
      break;

    default:
      break;
  }
}

// Order matters. A finished or dead run is reported as such even if it was
// holding an escalation when it died — that escalation is stale, and showing
// it as actionable would send you to answer a question nobody is waiting on.
function deriveStatus(run) {
  if (run.endStatus) return run.endStatus === 'delivered' ? 'done' : 'failed';
  if (run.window && !run.window.alive) return 'failed';
  if (run.escalation) return 'needs-you';
  if (run.lastVerdict && run.lastVerdict.verdict === 'BLOCKER') return 'needs-you';
  if (run.window && run.window.alive) return 'running';
  return 'unknown';
}

function deriveTelemetry(run) {
  let t3 = false;
  let t2 = false;
  for (const ev of run.events) {
    if (TIER3_KINDS.has(ev.kind)) t3 = true;
    else if (TIER2_KINDS.has(ev.kind)) t2 = true;
  }
  if (t3) return 'full';
  if (t2) return 'partial';
  return 'none';
}

function lastActivity(run) {
  return run.events.length ? run.events[run.events.length - 1].t : 0;
}

function reduce(eventsByTicket, windows, now) {
  const byTicket = new Map();

  for (const [ticket, parsed] of eventsByTicket) {
    const run = emptyRun(ticket);
    run.malformed = parsed.malformed || 0;
    const ordered = parsed.events.slice().sort((a, b) => a.t - b.t);
    for (const ev of ordered) applyEvent(run, ev);
    byTicket.set(ticket, run);
  }

  // A live tmux window with no log at all is still a run — it is just one we
  // know nothing about, and that is exactly what we must show.
  for (const w of windows || []) {
    let run = byTicket.get(w.ticket);
    if (!run) {
      run = emptyRun(w.ticket);
      byTicket.set(w.ticket, run);
    }
    run.window = { alive: w.alive, idleMs: w.idleMs != null ? w.idleMs : null };
  }

  const runs = [];
  for (const run of byTicket.values()) {
    if (run.branch) run.changeName = run.branch.split('/')[1] || null;
    run.telemetry = deriveTelemetry(run);
    run.status = deriveStatus(run);
    run.escalationStale = !!(run.escalation && run.window && !run.window.alive);
    run.elapsedMs = run.startedAt != null ? (run.endedAt || now) - run.startedAt : null;
    runs.push(run);
  }

  runs.sort((a, b) =>
    (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (lastActivity(b) - lastActivity(a)));

  return runs;
}

module.exports = { reduce, TIER2_KINDS, TIER3_KINDS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/reducer.test.js`
Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/reducer.js test/reducer.test.js
git commit -m "feat(dashboard): add pure reducer folding events and tmux state into runs"
```

---

### Task 5: `lib/ui/session.js` — the tmux backend

**Files:**
- Create: `lib/ui/session.js`
- Create: `test/session.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `hasTmux() → boolean`
  - `createSession(name) → Session`
  - `Session`: `{ name, ensure(), listWindows() → [{ticket, alive}], capture(ticket) → string, spawn(ticket, cmd), kill(ticket), attach(ticket) }`

The session keeps a placeholder window named `__concertino__` so it survives when
every run has finished, and sets `remain-on-exit on` so a finished run's window
stays visible as a dead pane rather than vanishing — that is what lets the
reducer distinguish "died without `run.end`" from "never existed".

- [ ] **Step 1: Write the failing test**

Create `test/session.test.js`:

```js
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { hasTmux, createSession } = require('../lib/ui/session');

const SESSION = 'concertino-test-' + process.pid;
const skip = !hasTmux() ? { skip: 'tmux not installed' } : {};
const s = createSession(SESSION);

before(() => { if (hasTmux()) s.ensure(); });
after(()  => { if (hasTmux()) { try { require('child_process').execFileSync('tmux', ['kill-session', '-t', SESSION]); } catch (e) {} } });

test('ensure is idempotent', skip, () => {
  s.ensure();
  s.ensure();
  assert.ok(Array.isArray(s.listWindows()));
});

test('the placeholder window is hidden from listWindows', skip, () => {
  assert.equal(s.listWindows().filter((w) => w.ticket === '__concertino__').length, 0);
});

test('spawn creates a live window named for the ticket', skip, () => {
  s.spawn('HEL-1', 'sleep 300');
  const w = s.listWindows().find((x) => x.ticket === 'HEL-1');
  assert.ok(w, 'window should exist');
  assert.equal(w.alive, true);
});

test('capture returns the pane contents', skip, () => {
  s.spawn('HEL-2', 'echo concertino-marker; sleep 300');
  // Give the shell a moment to produce output.
  require('child_process').execFileSync('sleep', ['1']);
  assert.match(s.capture('HEL-2'), /concertino-marker/);
});

test('a finished window stays listed but not alive', skip, () => {
  s.spawn('HEL-3', 'true');
  require('child_process').execFileSync('sleep', ['1']);
  const w = s.listWindows().find((x) => x.ticket === 'HEL-3');
  assert.ok(w, 'dead window should still be listed (remain-on-exit)');
  assert.equal(w.alive, false);
});

test('kill removes the window', skip, () => {
  s.spawn('HEL-4', 'sleep 300');
  s.kill('HEL-4');
  assert.equal(s.listWindows().find((x) => x.ticket === 'HEL-4'), undefined);
});

test('capture of an unknown window is empty, not an error', skip, () => {
  assert.equal(s.capture('NOPE'), '');
});

test('listWindows on a nonexistent session is empty', skip, () => {
  assert.deepEqual(createSession('concertino-does-not-exist-' + process.pid).listWindows(), []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/session.test.js`
Expected: FAIL — `Cannot find module '../lib/ui/session'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ui/session.js`:

```js
'use strict';

// tmux is the session backend. Two properties earn the dependency:
//   1. runs survive the TUI crashing, the ssh session dropping, and the lid
//      closing — which is the whole point of an unattended overnight fleet;
//   2. `attach` is free and perfect, so we never re-render a harness's own UI.

const { execFileSync, spawnSync } = require('child_process');

const PLACEHOLDER = '__concertino__';

function tmux(args) {
  return execFileSync('tmux', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function hasTmux() {
  try {
    tmux(['-V']);
    return true;
  } catch (e) {
    return false;
  }
}

function createSession(name) {
  const target = (ticket) => name + ':' + ticket;

  return {
    name,

    ensure() {
      try {
        tmux(['has-session', '-t', name]);
      } catch (e) {
        // The placeholder keeps the session alive when no runs are active,
        // so window ids stay stable across an empty fleet.
        tmux(['new-session', '-d', '-s', name, '-n', PLACEHOLDER,
          'sh', '-c', 'while true; do sleep 3600; done']);
      }
      // Without remain-on-exit a finished run's window disappears, and we lose
      // the ability to tell "exited without run.end" from "never started".
      try { tmux(['set-option', '-t', name, 'remain-on-exit', 'on']); } catch (e) {}
    },

    listWindows() {
      let out;
      try {
        out = tmux(['list-windows', '-t', name, '-F', '#{window_name}\t#{pane_dead}']);
      } catch (e) {
        return [];
      }
      return out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [ticket, dead] = line.split('\t');
          return { ticket, alive: dead !== '1' };
        })
        .filter((w) => w.ticket !== PLACEHOLDER);
    },

    capture(ticket) {
      try {
        return tmux(['capture-pane', '-p', '-t', target(ticket)]);
      } catch (e) {
        return '';
      }
    },

    spawn(ticket, cmd) {
      this.ensure();
      tmux(['new-window', '-d', '-t', name, '-n', ticket, cmd]);
    },

    kill(ticket) {
      try { tmux(['kill-window', '-t', target(ticket)]); } catch (e) {}
    },

    // Blocks until the user detaches. The caller must leave raw mode first.
    attach(ticket) {
      return spawnSync('tmux', ['attach', '-t', target(ticket)], { stdio: 'inherit' });
    },
  };
}

module.exports = { hasTmux, createSession, PLACEHOLDER };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/session.test.js`
Expected: PASS — 8 tests (or 8 skipped with a clear reason if tmux is absent).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/session.js test/session.test.js
git commit -m "feat(dashboard): add tmux session backend"
```

---

### Task 6: `lib/ui/format.js` + `lib/ui/screens/fleet.js` — rendering

**Files:**
- Create: `lib/ui/format.js`
- Create: `lib/ui/screens/fleet.js`
- Create: `test/format.test.js`
- Create: `test/fleet.test.js`

**Interfaces:**
- Consumes: the `Run` shape from Task 4.
- Produces:
  - `format`: `dur(ms) → string`, `truncate(s, n) → string`, `padTo(s, n) → string`, `bar(frac, width) → string`
  - `fleet`: `renderFleet(runs, { cols, selected }) → string`

- [ ] **Step 1: Write the failing tests**

Create `test/format.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { dur, truncate, padTo, bar } = require('../lib/ui/format');

test('dur renders seconds, minutes, and hours', () => {
  assert.equal(dur(0), '0s');
  assert.equal(dur(23000), '23s');
  assert.equal(dur(8 * 60000), '8m');
  assert.equal(dur(64 * 60000), '1h04m');
  assert.equal(dur(null), '—');
});

test('truncate uses an ellipsis and never exceeds the width', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('panel-resize-handles', 10), 'panel-res…');
  assert.equal(truncate('panel-resize-handles', 10).length, 10);
});

test('padTo pads and truncates to an exact width', () => {
  assert.equal(padTo('ab', 5), 'ab   ');
  assert.equal(padTo('abcdefgh', 5).length, 5);
});

test('bar renders a proportional progress bar', () => {
  assert.equal(bar(0, 4), '░░░░');
  assert.equal(bar(1, 4), '▪▪▪▪');
  assert.equal(bar(0.5, 4), '▪▪░░');
  assert.equal(bar(2, 4), '▪▪▪▪');
});
```

Create `test/fleet.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderFleet } = require('../lib/ui/screens/fleet');

function run(over) {
  return Object.assign({
    ticket: 'HEL-1', project: 'helio', changeName: 'a-change', branch: null,
    worktree: null, devPort: null, backendPort: null, harness: null, model: null,
    phase: null, cycle: null, gates: [], lastVerdict: null, escalation: null,
    escalationStale: false, events: [], startedAt: null, endedAt: null,
    endStatus: null, elapsedMs: 60000, window: { alive: true, idleMs: 0 },
    status: 'running', telemetry: 'full', malformed: 0,
  }, over);
}

const OPTS = { cols: 78, selected: 0 };

test('renders a header with the project and counts', () => {
  const out = renderFleet([run({})], OPTS);
  assert.match(out, /helio/);
  assert.match(out, /1 run/);
});

test('groups escalated runs under NEEDS YOU', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-338', status: 'needs-you', escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
    run({ ticket: 'HEL-331', status: 'running' }),
  ], OPTS);
  assert.match(out, /NEEDS YOU/);
  assert.ok(out.indexOf('HEL-338') < out.indexOf('HEL-331'), 'escalation must come first');
  assert.match(out, /add zod@3\?/);
});

test('shows phase and cycle for fully instrumented runs', () => {
  const out = renderFleet([run({ phase: 'Evaluation', cycle: 2, gates: [
    { name: 'test', status: 'pass' }, { name: 'lint', status: 'pass' },
    { name: 'build', status: 'fail' },
  ] })], OPTS);
  assert.match(out, /Evaluation/);
  assert.match(out, /cycle 2/);
  assert.match(out, /2\/3/);
});

test('a partially instrumented run says so instead of inventing a phase', () => {
  const out = renderFleet([run({ telemetry: 'partial', phase: null })], OPTS);
  assert.match(out, /phase unknown/);
  assert.doesNotMatch(out, /Evaluation/);
});

test('an uninstrumented run reports no telemetry and its idle time', () => {
  const out = renderFleet([run({ telemetry: 'none', phase: null, window: { alive: true, idleMs: 11 * 60000 } })], OPTS);
  assert.match(out, /no telemetry/);
  assert.match(out, /idle 11m/);
});

test('a stale escalation on a dead run is labelled stale', () => {
  const out = renderFleet([run({
    status: 'failed', escalationStale: true,
    escalation: { question: 'q', options: [], raisedAt: 1 },
  })], OPTS);
  assert.match(out, /stale/);
});

test('malformed events are surfaced in the footer', () => {
  const out = renderFleet([run({ malformed: 2 })], OPTS);
  assert.match(out, /2 malformed events/);
});

test('an empty fleet renders a hint rather than a blank screen', () => {
  const out = renderFleet([], OPTS);
  assert.match(out, /no active runs/i);
});

test('no rendered line exceeds the terminal width', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-338', status: 'needs-you', changeName: 'an-extremely-long-change-name-that-will-not-fit-anywhere',
          escalation: { question: 'a very long escalation question that should be truncated to fit the terminal', options: ['approve', 'deny'], raisedAt: 1 } }),
    run({ ticket: 'HEL-331' }),
  ], { cols: 60, selected: 0 });
  // eslint-disable-next-line no-control-regex
  const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  for (const line of out.split('\n')) {
    assert.ok(visible(line).length <= 60, `line too long (${visible(line).length}): ${line}`);
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/format.test.js test/fleet.test.js`
Expected: FAIL — `Cannot find module '../lib/ui/format'`.

- [ ] **Step 3: Write `lib/ui/format.js`**

```js
'use strict';

const TTY = !!process.stdout.isTTY;
const wrap = (code, s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : s);

const bold   = (s) => wrap('1', s);
const dim    = (s) => wrap('2', s);
const red    = (s) => wrap('31', s);
const green  = (s) => wrap('32', s);
const yellow = (s) => wrap('33', s);
const blue   = (s) => wrap('34', s);
const magenta= (s) => wrap('35', s);
const cyan   = (s) => wrap('36', s);

// Colour per agent role — the "role gutter" that makes handoffs and the
// skeptic's isolated cold spikes readable without swimlanes.
const ROLE_COLOUR = {
  orchestrator: blue,
  executor: cyan,
  evaluator: yellow,
  skeptic: magenta,
  script: dim,
  human: green,
};

function visibleLength(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\x1b\[[0-9;]*m/g, '').length;
}

function dur(ms) {
  if (ms == null) return '—';
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return total + 's';
  const mins = Math.floor(total / 60);
  if (mins < 60) return mins + 'm';
  const hours = Math.floor(mins / 60);
  return hours + 'h' + String(mins % 60).padStart(2, '0') + 'm';
}

function truncate(s, n) {
  const str = String(s == null ? '' : s);
  if (n <= 0) return '';
  if (str.length <= n) return str;
  return str.slice(0, n - 1) + '…';
}

function padTo(s, n) {
  const t = truncate(s, n);
  return t + ' '.repeat(Math.max(0, n - t.length));
}

function bar(frac, width) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const filled = Math.round(f * width);
  return '▪'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

module.exports = {
  dur, truncate, padTo, bar, visibleLength,
  bold, dim, red, green, yellow, blue, magenta, cyan, ROLE_COLOUR,
};
```

- [ ] **Step 4: Write `lib/ui/screens/fleet.js`**

```js
'use strict';

// The fleet screen. Pure: (runs, opts) -> string. Attention is the sort key,
// so whatever is blocking you is always at the top and can never scroll away.

const f = require('../format');

const PHASE_ORDER = ['Setup', 'Planning', 'Execution', 'Evaluation', 'Delivery', 'Cleanup'];

function phaseFraction(run) {
  if (!run.phase) return 0;
  const i = PHASE_ORDER.indexOf(run.phase);
  return i < 0 ? 0 : (i + 1) / PHASE_ORDER.length;
}

// The second line of a run: what it is doing, and how confident we are that we
// know. A run we cannot see into must look different from a healthy one.
function statusLine(run, width) {
  const parts = [];

  if (run.telemetry === 'none') {
    parts.push('no telemetry');
  } else if (!run.phase) {
    parts.push('phase unknown');
  } else {
    parts.push(f.padTo(run.phase, 11));
    if (run.cycle != null) parts.push('cycle ' + run.cycle);
  }

  if (run.gates.length) {
    const passed = run.gates.filter((g) => g.status === 'pass').length;
    parts.push('gates ' + passed + '/' + run.gates.length);
  }

  if (run.window && run.window.idleMs != null && run.window.idleMs >= 60000) {
    parts.push('idle ' + f.dur(run.window.idleMs));
  }

  parts.push(f.dur(run.elapsedMs));
  return f.truncate(parts.join('   '), width);
}

function renderRun(run, opts, selected) {
  const lines = [];
  const marker = selected ? '▸' : ' ';
  const name = run.changeName || f.dim('(no branch yet)');
  lines.push(`  ${marker} ${f.padTo(run.ticket, 9)} ${f.truncate(name, opts.cols - 16)}`);

  if (run.escalation) {
    const stale = run.escalationStale ? ' [stale]' : '';
    const keys = run.escalation.options.length
      ? '   ' + run.escalation.options.map((o) => `[${o[0]}]${o.slice(1)}`).join('  ')
      : '';
    lines.push('      ' + f.yellow(f.truncate(run.escalation.question + stale + keys, opts.cols - 8)));
  } else {
    const b = f.dim(f.bar(phaseFraction(run), 20));
    lines.push('      ' + b + '  ' + statusLine(run, Math.max(0, opts.cols - 30)));
  }

  return lines;
}

function renderFleet(runs, opts) {
  const cols = Math.max(40, (opts && opts.cols) || 80);
  const selected = (opts && opts.selected) || 0;
  const project = (runs[0] && runs[0].project) || '';

  const needsYou = runs.filter((r) => r.status === 'needs-you');
  const active   = runs.filter((r) => r.status === 'running' || r.status === 'unknown');
  const finished = runs.filter((r) => r.status === 'done' || r.status === 'failed');

  const out = [];
  const countLabel = `${runs.length} run${runs.length === 1 ? '' : 's'}` +
    (needsYou.length ? ` · ${needsYou.length} needs you` : '');
  out.push(f.bold('concertino') + f.dim(' · ' + project) + '  ' +
    f.dim(countLabel));
  out.push('');

  if (!runs.length) {
    out.push(f.dim('  no active runs — press n to start one'));
  }

  let index = 0;
  const section = (title, group, colour) => {
    if (!group.length) return;
    out.push('  ' + colour(title));
    for (const run of group) {
      for (const line of renderRun(run, { cols }, index === selected)) out.push(line);
      index++;
    }
    out.push('');
  };

  section('NEEDS YOU', needsYou, f.yellow);
  section('RUNNING', active, f.dim);
  section('DONE', finished, f.dim);

  const malformed = runs.reduce((n, r) => n + (r.malformed || 0), 0);
  if (malformed) out.push('  ' + f.yellow(`▲ ${malformed} malformed events`));

  out.push(f.dim('  ↵ attach   n new run   k kill   r restart   q quit'));

  return out.map((l) => (f.visibleLength(l) > cols ? f.truncate(l, cols) : l)).join('\n');
}

module.exports = { renderFleet, phaseFraction };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/format.test.js test/fleet.test.js`
Expected: PASS — 4 + 9 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/ui/format.js lib/ui/screens/fleet.js test/format.test.js test/fleet.test.js
git commit -m "feat(dashboard): add formatting helpers and the fleet screen"
```

---

### Task 7: `concertino watch` — the loop and CLI wiring

**Files:**
- Create: `lib/ui/watch.js`
- Modify: `bin/concertino` (new `watch` command, doctor check, help text)
- Modify: `package.json` (`files` gains `lib/`)
- Modify: `config/concertino.schema.json` (`dashboard` block)

**Interfaces:**
- Consumes: `store.readAll` (Task 3), `reduce` (Task 4), `createSession`/`hasTmux` (Task 5), `renderFleet` (Task 6).
- Produces: `watch({ root, config }) → Promise<void>` and the `concertino watch` command.

- [ ] **Step 1: Write `lib/ui/watch.js`**

```js
'use strict';

// The poll loop. Everything stateful lives here so the reducer and the screens
// stay pure: idle tracking needs memory across polls, and keyboard handling
// needs raw mode.

const store = require('./store');
const { reduce } = require('./reducer');
const { createSession, hasTmux } = require('./session');
const { renderFleet } = require('./screens/fleet');

const POLL_MS = 1000;
const IDLE_SAMPLE_MS = 2000;

// A cheap content hash. We never parse the pane — only ask "did anything
// change" — so this works identically for Claude Code, Codex, or a local model.
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function clear() {
  process.stdout.write('\x1b[2J\x1b[H');
}

async function watch(opts) {
  const root = opts.root;
  const cfg = (opts.config && opts.config.dashboard) || {};
  const session = createSession(cfg.tmuxSession || 'concertino');

  if (!hasTmux()) {
    console.error('concertino watch: tmux not found on PATH.');
    console.error('Install it (e.g. `pacman -S tmux`, `brew install tmux`, `apt install tmux`) and retry.');
    process.exitCode = 1;
    return;
  }

  session.ensure();

  // ticket -> { hash, since }
  const idle = new Map();
  let selected = 0;
  let lastSample = 0;
  let running = true;

  function sampleWindows(now) {
    const windows = session.listWindows();
    const takeSample = now - lastSample >= IDLE_SAMPLE_MS;
    if (takeSample) lastSample = now;

    return windows.map((w) => {
      if (!w.alive) return { ticket: w.ticket, alive: false, idleMs: null };
      if (takeSample) {
        const h = hash(session.capture(w.ticket));
        const prev = idle.get(w.ticket);
        if (!prev || prev.hash !== h) idle.set(w.ticket, { hash: h, since: now });
      }
      const entry = idle.get(w.ticket);
      return { ticket: w.ticket, alive: true, idleMs: entry ? now - entry.since : 0 };
    });
  }

  function draw() {
    const now = Date.now();
    const runs = reduce(store.readAll(root), sampleWindows(now), now);
    if (selected >= runs.length) selected = Math.max(0, runs.length - 1);
    clear();
    process.stdout.write(renderFleet(runs, { cols: process.stdout.columns || 80, selected }) + '\n');
    return runs;
  }

  let runs = draw();
  const timer = setInterval(() => { if (running) runs = draw(); }, POLL_MS);

  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  await new Promise((resolve) => {
    stdin.on('data', (key) => {
      if (key === 'q' || key === '\u0003') {          // q / Ctrl-C
        clearInterval(timer);
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
        clear();
        resolve();
        return;
      }
      // Arrow keys arrive as a three-byte escape sequence in raw mode.
      if (key === 'j' || key === '\x1b[B') { selected = Math.min(selected + 1, runs.length - 1); runs = draw(); }
      if (key === 'k' || key === '\x1b[A') { selected = Math.max(selected - 1, 0); runs = draw(); }
      if (key === '\r' && runs[selected]) {
        // Hand the terminal to tmux, then take it back on detach.
        running = false;
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
        session.attach(runs[selected].ticket);
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();
        running = true;
        runs = draw();
      }
    });
  });
}

module.exports = { watch };
```

- [ ] **Step 2: Wire the `watch` command into `bin/concertino`**

Add near the other `cmd*` functions:

```js
function cmdWatch(args) {
  const out = path.resolve(args.out || '.');
  const cfgPath = args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json');
  let config = {};
  if (exists(cfgPath)) {
    try { config = JSON.parse(read(cfgPath)); } catch (e) { /* watch works without config */ }
  }
  const { watch } = require(path.join(REPO, 'lib', 'ui', 'watch'));
  return watch({ root: out, config });
}
```

The dispatch at the bottom of the file is an `else if` chain, not a switch. Add a
branch to it, after the `doctor` line — and `await` it, since `cmdWatch` returns a
promise and the chain already runs inside an `async` IIFE:

```js
    else if (cmd === 'doctor')    cmdDoctor(args);
    else if (cmd === 'watch')     await cmdWatch(args);
```

- [ ] **Step 3: Add the doctor check**

In `cmdDoctor`, immediately after the `section('Claude Code')` block (around
`bin/concertino:760`), insert:

```js
  section('Dashboard');
  const tmuxVer = shell('tmux -V 2>/dev/null');
  tmuxVer ? ok('tmux', tmuxVer) : warn('tmux not found — `concertino watch` needs it');
```

- [ ] **Step 4: Add help text**

In `help()`, add to the command list, matching the surrounding formatting:

```
concertino watch      [--config=PATH] [--out=DIR]
                      Live fleet dashboard: every active run, its phase, gates,
                      and escalations. ↵ attaches to a run, q quits. Needs tmux.
```

- [ ] **Step 5: Add the config schema block**

In `config/concertino.schema.json`, add a sibling of the existing `ui` property:

```json
"dashboard": {
  "type": "object",
  "description": "Settings for `concertino watch`, the fleet dashboard. Distinct from `ui`, which describes whether the project under test has a user interface.",
  "additionalProperties": false,
  "properties": {
    "tmuxSession": { "type": "string", "description": "tmux session name holding one window per run.", "default": "concertino" },
    "maxConcurrent": { "type": "integer", "minimum": 1, "description": "Cap on simultaneously running orchestrators when launching a batch.", "default": 2 },
    "escalationTimeoutMinutes": { "type": "integer", "minimum": 0, "description": "How long `emit-event.sh --await` blocks before giving up and letting the agent escalate to chat.", "default": 60 },
    "launchPad": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "enabled": { "type": "boolean", "description": "Enable the ticket-provider launch pad. Also requires ticketProvider.kind=linear and LINEAR_API_KEY.", "default": false }
      }
    }
  }
}
```

- [ ] **Step 6: Add `lib/` to the published files**

In `package.json`, add `"lib/"` to the `files` array, after `"bin/"`.

- [ ] **Step 7: Verify manually**

```bash
node bin/concertino --help | grep -A2 watch
node bin/concertino doctor | grep -i tmux
npm test
```

Expected: help lists `watch`; doctor reports a tmux version or a warning; all tests pass.

Then a **non-interactive** smoke test. `watch` handles a non-TTY stdin (it skips
raw mode), so piping `q` in drives one render and a clean exit — no terminal
required:

```bash
tmux kill-session -t concertino 2>/dev/null
tmux new-session -d -s concertino -n HEL-999 'sleep 300'
echo q | node bin/concertino watch > /tmp/watch-smoke.txt 2>&1
echo "exit=$?"
cat /tmp/watch-smoke.txt
tmux kill-session -t concertino
```

Expected: `exit=0`, and the captured output contains `HEL-999` and
`no telemetry` — a live window with no event log is exactly the tier-1-only
degradation case.

Do **not** attempt to test attach, key navigation, or detach: those need a real
terminal and are verified separately by the human partner.

- [ ] **Step 8: Commit**

```bash
git add lib/ui/watch.js bin/concertino package.json config/concertino.schema.json
git commit -m "feat(dashboard): add concertino watch with tmux-backed fleet view"
```

---

### Task 8: Tier-2 emission from the procedure scripts

**Files:**
- Modify: `core/scripts/setup-worktree.sh`
- Modify: `core/scripts/start-servers.sh`
- Modify: `core/scripts/assert-phase.sh`
- Modify: `core/scripts/cleanup.sh`
- Modify: `core/scripts/README.md`

**Interfaces:**
- Consumes: `emit-event.sh` (Tasks 1–2).
- Produces: `run.start`, `gate.result`, and `run.end` events with `role=script`,
  emitted without any agent cooperation.

Every call is suffixed `|| true`. Telemetry must never fail a delivery run.

- [ ] **Step 1: Emit `run.start` from `setup-worktree.sh`**

Replace the four `READY` lines at the end of `core/scripts/setup-worktree.sh` with:

```bash
# Tier-2 telemetry: the dashboard's run header, emitted by the script rather
# than the agent so a run can never appear without a truthful identity.
CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" run.start \
  "ticket=${TICKET_ID}" \
  "branch=${BRANCH}" \
  "worktree=${WORKTREE_PATH}" \
  "dev_port=${DEV_PORT}" \
  "backend_port=${BACKEND_PORT}" \
  "harness=${CONCERTINO_HARNESS:-unknown}" || true

echo "READY worktree=${WORKTREE_PATH}"
echo "READY branch=${BRANCH}"
echo "READY dev_port=${DEV_PORT}"
echo "READY backend_port=${BACKEND_PORT}"
```

- [ ] **Step 2: Emit a gate result from `assert-phase.sh`**

In `core/scripts/assert-phase.sh`, replace the final block:

```bash
if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
echo "PASS $PHASE"
```

with:

```bash
# The ticket id is not an argument here, so derive it from the worktree path —
# worktrees are created at <base>/<branch> and branches end in /<TICKET-ID>.
GATE_TICKET="${WORKTREE_PATH##*/}"

if [ "$FAILED" -ne 0 ]; then
  CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.result \
    "ticket=${GATE_TICKET}" "gate=phase:${PHASE}" "status=fail" || true
  exit 1
fi

CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.result \
  "ticket=${GATE_TICKET}" "gate=phase:${PHASE}" "status=pass" || true
echo "PASS $PHASE"
```

- [ ] **Step 3: Emit a gate result from `start-servers.sh`**

In `core/scripts/start-servers.sh`, inside `start_one`, replace the final line
`echo "READY ${label}=${url}"` with:

```bash
  CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.result \
    "ticket=${WORKTREE_PATH##*/}" "gate=server:${label}" "status=pass" || true
  echo "READY ${label}=${url}"
```

- [ ] **Step 4: Emit `run.end` from `cleanup.sh`**

`cleanup.sh` has no `SCRIPT_DIR`. Add it immediately after the `WORKTREE_PATH` /
`DEV_PORT` / `BACKEND_PORT` assignments:

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
```

Then replace the final line `echo "READY cleaned worktree=${WORKTREE_PATH}"` with:

```bash
# Phase-4 cleanup only runs post-merge, so reaching here means the run shipped.
CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" run.end \
  "ticket=${WORKTREE_PATH##*/}" "status=delivered" || true

echo "READY cleaned worktree=${WORKTREE_PATH}"
```

- [ ] **Step 5: Document the new script**

In `core/scripts/README.md`, add a row to the Scripts table:

```
| `emit-event.sh`     | Append a dashboard event; `--await` blocks for an answer   | `<kind> [--await] k=v ...`                                  |
```

And add to the Contract section:

```
- `emit-event.sh` appends one JSON line to
  `<main checkout>/.concertino/runs/<TICKET>/events.jsonl`. It always exits 0
  (except on `--await` timeout) so telemetry can never fail a run. Other scripts
  call it with `|| true` for the same reason.
```

- [ ] **Step 6: Verify end to end**

```bash
npm test
bash -n core/scripts/setup-worktree.sh core/scripts/assert-phase.sh core/scripts/start-servers.sh core/scripts/cleanup.sh
```

Expected: all tests pass, and `bash -n` reports no syntax errors.

Then confirm the READY contract is unchanged:

```bash
cd /tmp && rm -rf ct && mkdir ct && cd ct && git init -q && git commit -q --allow-empty -m init
mkdir -p scripts/concertino && cp ~/Development/concertino/core/scripts/*.sh scripts/concertino/
./scripts/concertino/setup-worktree.sh TEST-7 feature/a-test-change/TEST-7
cat .concertino/runs/TEST-7/events.jsonl
```

Expected: four `READY` lines exactly as before, plus one `run.start` line in the
event log with `branch`, `worktree`, `dev_port`, and `backend_port` populated.

- [ ] **Step 7: Commit**

```bash
git add core/scripts/
git commit -m "feat(telemetry): emit tier-2 events from the procedure scripts"
```

---

### Task 9: Tier-3 emission from the agent roles

**Files:**
- Modify: `core/roles/orchestrator.md`
- Modify: `core/roles/evaluator.md`
- Modify: `core/roles/skeptic.md`
- Create: `docs/dashboard.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `emit-event.sh` (Tasks 1–2).
- Produces: `phase.enter`, `agent.spawn`, `agent.resume`, `verdict`, and
  `escalation.raised` events at the points the roles already write
  `workflow-state.md` — no new compliance surface.

- [ ] **Step 1: Add a telemetry section to the orchestrator role**

In `core/roles/orchestrator.md`, immediately after the `## Workflow State`
section, insert:

```markdown
## Dashboard telemetry

Every time you write `workflow-state.md`, also emit one event. This is what
makes `concertino watch` able to show the run; it costs one bash call at points
you are already stopping at.

```bash
scripts/concertino/emit-event.sh phase.enter \
  ticket=$TICKET_ID role=orchestrator phase=<Phase> cycle=<n>
```

Also emit:

- `agent.spawn role=orchestrator agent=<executor|evaluator|skeptic>` when you spawn one,
- `agent.resume role=orchestrator agent=<executor|evaluator> cycle=<n>` when you resume one,
- `run.end ticket=$TICKET_ID role=orchestrator status=escalated` when a circuit
  breaker sends the run to the human instead of to delivery.

Never let telemetry block delivery: if a call fails, continue.
```

- [ ] **Step 2: Replace the escalation instruction with the blocking call**

In `core/roles/orchestrator.md`, in the `## Escalation & Circuit Breakers`
section, insert before `### Resolves in-loop (no human)`:

```markdown
### How to raise one

Raise every escalation through the canonical script. It records the escalation
for the dashboard and blocks until the human answers, returning their decision
on stdout:

```bash
scripts/concertino/emit-event.sh escalation --await \
  ticket=$TICKET_ID role=orchestrator \
  question="<one sentence, the decision you need>" \
  options=approve,deny
```

If it exits non-zero it timed out — fall back to presenting the `ESCALATION`
block in chat and waiting there. Never treat a timeout as an approval.
```

- [ ] **Step 3: Add verdict emission to the evaluator and skeptic**

In `core/roles/evaluator.md`, under `### Step 2: Return verdict` (the section that
defines the `Overall: PASS | FAIL | BLOCKER` line, around line 142), add:

```markdown
Immediately after writing your report, emit the verdict for the dashboard:

```bash
scripts/concertino/emit-event.sh verdict \
  ticket=$TICKET_ID role=evaluator verdict=<PASS|FAIL|BLOCKER> ref=<report path>
```
```

In `core/roles/skeptic.md`, under the report template's `### Verdict: CONFIRM |
REFUTE` heading (around line 127):

```markdown
Immediately after writing your report, emit the verdict for the dashboard:

```bash
scripts/concertino/emit-event.sh verdict \
  ticket=$TICKET_ID role=skeptic verdict=<CONFIRM|REFUTE|BLOCKER> ref=<report path>
```
```

- [ ] **Step 4: Write the docs page**

Create `docs/dashboard.md`:

```markdown
# The dashboard — `concertino watch`

A terminal fleet view for watching orchestrator runs at a high level.

```bash
concertino watch
```

Requires **tmux**. Runs live in a tmux session (one window per ticket), so they
survive the dashboard crashing, an ssh drop, or a closed laptop.

## Keys

| Key | Action |
| --- | --- |
| `↵` | Attach to the selected run. `Ctrl-b d` detaches back to the dashboard |
| `j` / `k` | Move the selection |
| `q` | Quit the dashboard (runs keep going) |

## What it knows, and how much to trust it

Three tiers of telemetry, and the dashboard degrades down them rather than
pretending:

| Shown | Means |
| --- | --- |
| Phase, cycle, gates, verdicts | Fully instrumented — the agent is emitting events |
| `phase unknown`, gates present | Only the procedure scripts are reporting |
| `no telemetry · idle 11m` | Nothing but the tmux process itself |

A run you cannot see into looks conspicuously uninstrumented, never healthy.

## Configuration

```json
"dashboard": {
  "tmuxSession": "concertino",
  "maxConcurrent": 2,
  "escalationTimeoutMinutes": 60,
  "launchPad": { "enabled": false }
}
```

`dashboard` is distinct from `ui`, which describes whether the *project under
test* has a user interface and how the evaluator reviews it.

## Where the data lives

```
.concertino/runs/<TICKET>/
  events.jsonl    append-only event log — survives cleanup
  answer.json     written by the dashboard to answer an escalation
```

The log lives in the main checkout, not the worktree, so a run's history
survives `cleanup.sh --phase4` removing the worktree. Tail it directly:

```bash
tail -f .concertino/runs/HEL-334/events.jsonl | jq .
```
```

- [ ] **Step 5: Link it from the README**

In `README.md`, add to the CLI reference block:

```
concertino watch      [--config=PATH] [--out=DIR]
                      Live fleet dashboard — every active run, its phase, gates,
                      and escalations. Needs tmux. See docs/dashboard.md.
```

- [ ] **Step 6: Verify the rendered output still syncs**

```bash
npm test
node bin/concertino sync --out=/tmp/concertino-selftest --config=config/examples/helio.json --dry-run
```

Expected: tests pass; sync reports the rendered files without error, and the
role bodies now contain the telemetry sections.

- [ ] **Step 7: Commit**

```bash
git add core/roles/ docs/dashboard.md README.md
git commit -m "feat(telemetry): emit tier-3 events from the agent roles; document the dashboard"
```

---

## Definition of done for Slice 1

- `concertino watch` shows every run in the tmux session, sorted attention-first.
- A run with no telemetry at all still appears, labelled as such, with its idle time.
- `npm test` passes: store, reducer, format, fleet, session, and the emitter's shell tests.
- The `READY` / `PASS` / `FAIL` contracts of the four existing scripts are byte-identical to before.
- `concertino doctor` reports tmux.

**Not** in this slice: answering escalations from the TUI (the `answer.json`
writer), the drill-down screen, kill/restart, and the launch pad. Those are
slices 2 and 3.
