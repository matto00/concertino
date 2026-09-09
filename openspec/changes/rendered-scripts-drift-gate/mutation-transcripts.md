# CON-172 mutation transcripts (real tree, not scratch)

These runs invoke the same `run_drift_check` function defined in
`test/scripts/rendered-scripts-drift.test.sh` (sourced once with
`RENDERED_SCRIPTS_DRIFT_SOURCE_ONLY=1`), applied directly to the real
`core/scripts/` and `scripts/concertino/` trees in this worktree.
No path under `scripts/concertino/pricing-table.json` or
`scripts/concertino/report-cost.sh` is ever touched -- both files are
absent from this worktree (a worktree checks out tracked content only).

## 3.1 Baseline: unmutated real tree
```
exit=0
```
Green alone is not evidence the check works -- see mutation runs below.

## 3.2 Content mismatch: append a byte to scripts/concertino/emit-event.sh
```
rendered-scripts-drift: scripts/concertino/ has drifted from core/scripts/
content differs:
  emit-event.sh
remedy: run 'concertino sync' and commit the resulting render as its own reviewable diff. Do not hand-edit files under scripts/concertino/.
exit=1
```

Restored `scripts/concertino/emit-event.sh` via `git checkout --`. Confirm green again:
```
exit=0
```

## 3.2b Non-executable render: clear exec bit on scripts/concertino/emit-event.sh (content unchanged)
```
rendered-scripts-drift: scripts/concertino/ has drifted from core/scripts/
not executable:
  emit-event.sh
remedy: run 'concertino sync' and commit the resulting render as its own reviewable diff. Do not hand-edit files under scripts/concertino/.
exit=1
```

Restored the executable bit. Confirm green again:
```
exit=0
```

Confirm `core/scripts/lib/git-child-env.sh` (core mode 644, render mode 755,
identical blob) does NOT fail the gate -- assert-executable, not mode-equality:
```
644 /home/matt/Development/concertino/.concertino/worktrees/task/rendered-scripts-drift-gate/CON-172/core/scripts/lib/git-child-env.sh
755 /home/matt/Development/concertino/.concertino/worktrees/task/rendered-scripts-drift-gate/CON-172/scripts/concertino/lib/git-child-env.sh
content: identical
gate exit (whole tree, includes this file): 0
```

## 3.3 Missing counterpart: add core/scripts/con172-throwaway.sh with no render
```
rendered-scripts-drift: scripts/concertino/ has drifted from core/scripts/
never rendered:
  con172-throwaway.sh
remedy: run 'concertino sync' and commit the resulting render as its own reviewable diff. Do not hand-edit files under scripts/concertino/.
exit=1
```

Deleted the throwaway file. Confirm green again:
```
exit=0
```

## 3.4 Exemption cannot suppress a content mismatch
Synthetic env-supplied exemption entry for `emit-event.sh` (an ordinary
rendered file, never pricing-table.json/report-cost.sh) plus a mutated
rendered copy:
```
rendered-scripts-drift: scripts/concertino/ has drifted from core/scripts/
content differs:
  emit-event.sh
remedy: run 'concertino sync' and commit the resulting render as its own reviewable diff. Do not hand-edit files under scripts/concertino/.
exit=1
```

Still reported as a content mismatch despite being exempt -- the exemption
only ever suppresses the missing-counterpart case.

Restored `scripts/concertino/emit-event.sh` and dropped the synthetic entry. Confirm green again:
```
exit=0
```
