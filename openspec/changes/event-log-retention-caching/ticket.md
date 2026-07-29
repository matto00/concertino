# CON-4: Event logs under .concertino/runs/ accumulate with no retention policy

## Description

`cleanup.sh --phase4` deliberately leaves `.concertino/runs/<TICKET>/events.jsonl` behind when it destroys a worktree — that is correct, and is why a run's history survives the moment it succeeds. But nothing ever removes those logs, so the directory grows for the life of the project.

Two consequences:

* **Disk.** Unbounded growth in the main checkout. Gitignored, so it is disk only, but nothing bounds it.
* **Read cost.** `lib/ui/store.js`'s `readAll` re-reads and re-`JSON.parse`s every log in full on every dashboard poll, once per second. Ten runs with large logs is a lot of synchronous parsing on the main thread, and it scales with total project history rather than with active runs.

The fleet view's rendering side is already bounded — finished sections are capped and the total output is clamped to the terminal height — so this is about the store and the disk, not the screen.

## Acceptance criteria

* A documented retention policy, with a configurable bound under the `dashboard` config block and a sensible default.
* Old logs are pruned by something the user runs or that runs on a natural boundary; pruning must never remove a log for a run that is still active.
* `readAll` no longer re-parses unchanged logs on every poll — cache by file mtime and size, or read incrementally from the last offset.
* A test covers that an active run's log is never pruned.

## Notes

Incremental reading is the more valuable half: the logs are append-only, so re-reading from a stored offset is both simpler and strictly better than caching whole parses. Retention can stay a blunt age cutoff.

## Metadata

- Ticket: CON-4
- URL: https://linear.app/helioapp/issue/CON-4/event-logs-under-concertinoruns-accumulate-with-no-retention-policy
- Priority: Medium
