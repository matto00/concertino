# CON-19: Open evidence artifacts from the drill-down

## Description

The drill-down's evidence panel now lists a run's artifacts — proposal, design, evaluation reports, both skeptic reports — persisted durably by `persist-evidence.sh` into `.concertino/runs/<TICKET>/evidence/`. But they are only names. Reading one means leaving the dashboard, finding the path and opening it yourself.

Being able to read the skeptic's REFUTE without leaving the screen is most of why the panel is worth having. CON-10 (https://linear.app/helioapp/issue/CON-10/nothing-emits-evidence-events-so-the-drill-downs-evidence-panel-is) made the artifacts durable and reachable; this makes them readable.

## Acceptance Criteria

* Selecting an evidence entry opens it in a reader screen — the `ticketview` screen already solves the "render a long text document in a bounded, scrollable pane" problem and should be reused rather than duplicated.
* Scrollable, since evaluation and skeptic reports run to several screens.
* `esc` returns to the drill-down with the same entry still selected.
* An entry whose file is missing says so rather than opening an empty reader — a ref can outlive its file if the runs directory is pruned (see CON-4: https://linear.app/helioapp/issue/CON-4/event-logs-under-concertinoruns-accumulate-with-no-retention-policy).
* Markdown renders as plain text, and control bytes are stripped, consistent with the launch pad's handling of untrusted text.
* No key is advertised on the evidence panel unless it is bound there.

## Notes

Worth deciding whether this shares a screen with the ticket viewer or gets its own registry entry. They render the same shape of thing — a scrollable document — so a shared `docview` screen taking `{title, body}` is probably right, with `ticketview` becoming a caller rather than a special case.

Also relevant: CON-4 (https://linear.app/helioapp/issue/CON-4/event-logs-under-concertinoruns-accumulate-with-no-retention-policy) proposes pruning old event logs. If evidence lives under the same directory, pruning must either keep evidence or the panel must degrade honestly when it is gone — decide that alongside CON-4 rather than separately.
