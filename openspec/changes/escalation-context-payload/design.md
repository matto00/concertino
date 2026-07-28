## Context

`emit-event.sh escalation --await` already blocks on a human answer written to
`answer.json` and records `escalation.raised` / `escalation.answered` / `escalation.timeout`.
The dashboard's escalation screen (`lib/ui/screens/escalation.js`) renders `question` and
`options` from `run.escalation`, built by `lib/ui/reducer.js` on `escalation.raised`. Neither
carries anything about *why* the question is being asked — that context lives only in the
orchestrator's chat transcript, which the dashboard cannot see.

`persist-evidence.sh` (CON-10) already solved an adjacent problem: an artifact that lives in
the worktree does not survive `cleanup.sh --phase4`, so it copies into
`<main checkout>/.concertino/runs/<TICKET>/evidence/` and hands back a durable ref, or omits
the ref entirely on failure rather than emit a dangling one. `emit-event.sh` already owns the
4000-byte line cap (`MAX_LINE=4000`, enforced in `write_line`, currently by dropping every
caller-supplied field to `truncated:true` if the line doesn't fit).

## Goals / Non-Goals

**Goals:**
- Let the orchestrator attach kind-specific, structured context to an escalation via one
  canonical script call, at the same point it already raises the escalation.
- Keep the 4000-byte line cap intact for every event, escalation or otherwise.
- When context does not fit inline, truncate *visibly* (not silently) and persist the full
  text via the existing evidence mechanism rather than a second one.
- Render that context above the options on the escalation screen, degrading honestly (no
  context block at all) when there is none.

**Non-Goals:**
- Rendering the *contents* of a `context_ref` file inline in the TUI. The drill-down's
  EVIDENCE panel already treats refs as paths a human opens outside the dashboard
  (`f.truncate('  ' + (ev.label || ev.ref...))` in `drilldown.js`); the escalation screen
  follows the same convention rather than becoming a file viewer.
- Changing `escalation.answered` / `escalation.timeout` semantics, or any circuit-breaker
  bound. This is additive context on the existing `escalation.raised` event only.
- A generic "attach arbitrary structured data to any event" mechanism. Scope is the five
  escalation kinds CON-11 enumerates.

## Decisions

### 1. `gather-escalation-context.sh` is a pure formatter; `emit-event.sh` owns sizing/persistence

`gather-escalation-context.sh <KIND> [k=v ...]` takes an escalation kind and the kind's
specific fields, validates the required ones are present, and prints a formatted plain-text
block to stdout. It does not know about the 4000-byte cap and does not call
`persist-evidence.sh` itself.

Rationale: `emit-event.sh` already is the one place that knows the line-cap budget and
already special-cases the `escalation` kind heavily (relabelling to `escalation.raised`,
running the await/poll loop). Teaching it to also own "does this field fit, and if not, where
does the overflow go" keeps that budget logic in one place rather than duplicating cap-aware
logic into a second script. `gather-escalation-context.sh` earns its keep purely by making
the five kinds of context-gathering a committed procedure instead of prose — exactly the
problem statement in the ticket ("Shape").

Alternative considered: fold formatting into `emit-event.sh` itself via a `--kind=` flag.
Rejected — it would make one script own two unrelated concerns (what does this escalation's
context look like vs. how does an oversized event degrade), and every future escalation kind
would require touching the transport script instead of the formatter.

### 2. Kinds and required fields (mirrors the ticket's enumeration exactly)

| Kind           | Required fields                              | Optional fields |
| -------------- | --------------------------------------------- | ---------------- |
| `dependency`   | `package`, `version`, `purpose`, `file`       | `alternative` (default: `none identified`) |
| `api-change`   | `current`, `proposed`, `callsites`            | — |
| `budget`       | `counter`, `last_verdict`, `change_request`   | — |
| `blocker`      | `command`, `exit_code`, `output`              | — |
| `contradiction`| `requirement_a`, `requirement_b`              | — |

Unknown kind or a missing required field for the given kind is a hard failure
(`FAIL <reason>` on stderr, exit non-zero, nothing on stdout) — the same "no dangling
half-result" discipline `persist-evidence.sh` established. The orchestrator must not let a
malformed context call block the escalation itself: if the script fails, raise the
escalation without `context=` rather than not raising it at all (the question is what
matters most; missing context is a known, honest degradation the screen already handles).

### 3. `context` overflow: truncate visibly, persist the overflow via `persist-evidence.sh`

In the `escalation --await` path, after the normal fields are collected, `context` (if
present) is handled specially:

1. Build the full `escalation.raised` line with `context` inline, verbatim.
2. If `${#line} <= MAX_LINE`, write it as-is. No `context_ref`, no `context_truncated` — an
   absent flag means "didn't need to truncate," consistent with how `gate.result`'s
   `first_error` is present-or-absent rather than a boolean plus a value.
3. If it doesn't fit: write the *full* context to a temp file, persist it via
   `persist-evidence.sh <TICKET_ID> <tmpfile>` (named
   `escalation-context-<epoch_ms>.txt` so concurrent/successive escalations on the same
   ticket never collide or overwrite each other — unlike a planning artifact, a given
   escalation's context is a one-off snapshot, not a "latest version"). Truncate the inline
   `context` value to whatever budget remains after `question`/`options`/other fields, append
   a visible marker (`… [truncated, N of TOTAL bytes shown — full context: <ref>]`), set
   `context_truncated=true` and `context_ref=<persisted path>`.
4. If `persist-evidence.sh` itself fails (unwritable destination — the same failure mode
   `evidence-telemetry` already treats as "omit the ref, never emit a dangling one"): keep the
   truncated inline `context` and `context_truncated=true`, but omit `context_ref` entirely.
5. If, even after truncating `context` to zero length, the line still doesn't fit (some other
   field — `question` or `options` — is itself pathologically large): fall through to the
   existing last-resort behavior (drop every caller field, `truncated:true`). This is
   unchanged from today and is not expected to trigger for realistic escalations; the design
   goal is that `context` truncation is what pays down the byte budget in the normal case,
   never the questions options themselves.

Alternative considered: always persist context to a file and never inline it, so the event
line is small and simple regardless of size. Rejected — most context (a dependency name and
version, a two-line signature diff) comfortably fits in 4000 bytes, and forcing every
escalation to require an extra file read to render defeats "decide from the screen alone" for
the common case. Inline-first-with-overflow-fallback keeps the fast path fast.

Alternative considered: a second persistence directory dedicated to escalation context.
Rejected per the ticket's explicit steer — CON-10 already solved "does this ref survive
`cleanup.sh --phase4`" once; a second directory would duplicate that reasoning for no benefit
over reusing `.concertino/runs/<TICKET>/evidence/`.

### 4. Dashboard: additive fields only

`lib/ui/reducer.js`'s `escalation.raised` case gains three optional fields:
`context: ev.context || null`, `contextTruncated: !!ev.context_truncated`,
`contextRef: ev.context_ref || null`. `escalation.js` renders a context block between the
question and the options only when `esc.context` is truthy; when `contextTruncated`, an
additional dim line notes the ref path. No context at all renders exactly as today — no
"CONTEXT" label, no empty box.

### 5. Orchestrator role doc: one new step, no new judgment

`core/roles/orchestrator.md`'s "How to raise one" gains a single step immediately before the
existing `emit-event.sh escalation --await` call: run `gather-escalation-context.sh <kind>
...` for whichever of the five kinds matches the escalation being raised, and pass its output
as `context="$CONTEXT"` on the existing call. This is documentation of a procedure that
already maps 1:1 onto the "Always reaches the human" table's five bullets — it does not add a
new decision the model has to make, it only makes the existing decision's grounds visible.

## Risks / Trade-offs

- [Risk] A caller passes a `context` value containing a literal `=` or newlines that could be
  mis-parsed by `emit-event.sh`'s `k=v` splitting. → Mitigation: unaffected — `emit-event.sh`
  already splits only on the *first* `=` per token
  (`key="${kv%%=*}"; val="${kv#*=}"`), and callers already pass multi-line values as a single
  quoted bash argument (see the existing `note` test with an embedded newline and tab). No
  change needed to the splitting logic itself.
- [Risk] `gather-escalation-context.sh` becomes another place the model has to remember to
  call, and might skip it under time pressure. → Mitigation: the role doc step is a single
  line inserted directly above the call the orchestrator is already required to make; failure
  to call it degrades to today's behavior (no context), not a broken escalation.
- [Risk] Truncation math (reserving budget for `context` after other fields) could be fiddly
  and produce an invalid JSON line at the boundary. → Mitigation: build the candidate line
  first, measure it, and only then decide how much to cut — the same "build then measure"
  pattern the existing `write_line` already uses for the whole-line fallback, just applied to
  one field before falling back to the coarser existing behavior.
- [Trade-off] `context_ref` files are named by raise time (`escalation-context-<epoch_ms>.txt`)
  rather than by escalation kind or question — slightly less discoverable when browsing the
  evidence directory by hand, but avoids needing to sanitize an arbitrary kind/question string
  into a filename.

## Migration Plan

Purely additive — no data migration. Existing `escalation.raised` events without `context`
continue to render exactly as before. Roll out is: land the script + `emit-event.sh` change +
reducer/screen change + role-doc update together (they are only useful in combination), run
the existing `test/scripts/escalation-loop.test.sh` end-to-end test unmodified to confirm the
non-context path is untouched, and add the new context-specific tests alongside it.

## Open Questions

None outstanding — the ticket's "Shape" and "Two traps" sections already resolve the two
design forks (script vs. inline procedure; inline-with-file-fallback vs. a second
persistence mechanism) that would otherwise need escalating.
