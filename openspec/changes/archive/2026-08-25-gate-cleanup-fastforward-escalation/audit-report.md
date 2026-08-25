# CON-138 — Task 1.1 audit: `--await`/`--raise-only`/`--wait-only` call sites under `core/scripts/`

## Method

Two-direction grep against `core/scripts/*.sh`:

1. **Forward** — grep for the flags themselves:
   ```
   grep -rn -- '--await\|--raise-only\|--wait-only' core/scripts/*.sh
   ```
2. **Reverse** — grep for `emit-event.sh escalation` invocations (in case a call site
   passed the flag through a variable rather than a literal, which the forward grep
   would miss):
   ```
   grep -rn 'emit-event\.sh.*escalation\|escalation.*emit-event\.sh' core/scripts/*.sh
   ```

## Results

### Forward grep

| File | Line | Kind |
| --- | --- | --- |
| `core/scripts/cleanup.sh` | 345 (pre-fix; now inside the `tui-attached.sh`-gated branch) | **executable call site**: `"${SCRIPT_DIR}/emit-event.sh" escalation --await` |
| `core/scripts/emit-event.sh` | throughout (header comment, `--await`/`--raise-only`/`--wait-only` flag parsing, internal logic) | **the implementation of the flags itself** — not a call site |
| `core/scripts/gather-escalation-context.sh` | 23 | comment only, referencing the `--await` call in its caller |
| `core/scripts/triage-followup.sh` | 52 | comment only, referencing the `--await` call in its caller |
| `core/scripts/tui-attached.sh` | 9 | comment only, describing what this script gates |

### Reverse grep

| File | Line | Kind |
| --- | --- | --- |
| `core/scripts/cleanup.sh` | 345 | **executable call site** (same as above) |
| `core/scripts/gather-escalation-context.sh` | 23 | comment only |
| `core/scripts/emit-event.sh` | 13-15 | header-comment usage examples for the flags it implements |
| `core/scripts/triage-followup.sh` | 52 | comment only |

## Conclusion

Both directions agree: **`core/scripts/cleanup.sh:345` (the fast-forward escalation's
`emit-event.sh escalation --await` call) is the only executable call site under
`core/scripts/` that itself invokes `--await`/`--raise-only`/`--wait-only`**, and it was,
prior to this change, the only one of those call sites not gated on `tui-attached.sh`
(CON-126 gated the orchestrator's own prose-level escalation calls in
`core/roles/orchestrator.md`, but never touched any script). No other script under
`core/scripts/` raises or waits on an escalation directly. This confirms the design.md
assumption stated in the Context section and closes the "preliminary check, not a
required deliverable" gap that section calls out.

This audit was re-run after the fix landed (task 2 below) to confirm the call site
count and location are unchanged (the call is now inside an `if tui-attached.sh; then
... fi` block, still at the same executable line, still the only call site).
