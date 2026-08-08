## 1. New id-allocator script

- [x] 1.1 Write `core/scripts/next-ticket-id.sh <tickets-dir> <prefix>`, mirroring
      `core/scripts/next-report-number.sh`'s scan/`READY`/`FAIL` contract: scan `<tickets-dir>` for
      `^<prefix>-([0-9]+)\.md$`, compute `next` (highest + 1, or 1), validate `<prefix>` against
      `^[A-Za-z][A-Za-z0-9]*$`, `mkdir -p <tickets-dir>` if missing, safety re-check the computed
      target does not already exist, print `READY id=<prefix>-<next> path=<tickets-dir>/<prefix>-<next>.md`
      on success or `FAIL <reason>` to stderr + non-zero exit otherwise. chmod +x.
- [x] 1.2 Mirror it byte-for-byte to `scripts/concertino/next-ticket-id.sh` (this repo's own
      self-hosting copy — see CONTRIBUTING.md's `core/` → `scripts/concertino/*` relationship),
      chmod +x.
- [x] 1.3 Add `test/scripts/next-ticket-id.test.sh` covering: empty dir starts at 1; numbering
      continues from the highest existing matching file; numbering is independent per prefix;
      missing `<tickets-dir>` is created rather than failing; invalid prefix shape fails with `FAIL`
      and no `READY` line; an unexpected pre-existing target fails loudly (mirror
      `test/scripts/next-report-number.test.sh`'s stubbed-`basename` technique for this last case).

## 2. Provider-conditional `standalone` rendering

- [x] 2.1 In `lib/cli/render.js`'s `block()` switch, add a `case 'standaloneTicket'` returning, keyed
      on `c.ticketProvider.kind`: `linear`/`github` → today's exact existing wording (byte-identical);
      `local` → new wording instructing the orchestrator to derive `<prefix>` from `$TICKET_ID`,
      run `next-ticket-id.sh`, and write the returned `path` with `title:`/`state: backlog`
      frontmatter and a body summarizing the suggestion and linking back to `$TICKET_ID`.
- [x] 2.2 In `core/roles/orchestrator.md`, replace the `standalone` triage bullet's literal text
      (~line 479, inside the "Triaging a suggested follow-up" sub-procedure's step 5) with
      `{{block:standaloneTicket}}`, preserving the surrounding bullet-list indentation exactly.
- [x] 2.3 Run `bin/concertino sync --config=config/examples/concertino.json --out=<scratch dir>` and
      a second sync with `config/examples/generic.json` (github) to visually confirm both renders
      look correct, plus a synthetic `local`-provider config (see
      `test/scripts/local-provider-render.test.sh`'s fixture) to confirm the new wording renders.
      (Scratch-dir only — do not commit generated output outside the tracked
      `scripts/concertino/next-ticket-id.sh` mirror from task 1.2.)

## 3. Spec delta

- [x] 3.1 Confirm `openspec/changes/local-provider-standalone-escalation/specs/followup-triage/spec.md`
      (already written during planning) accurately reflects the final rendered wording from task 2.1
      once implemented — adjust if the actual implementation text drifts from the plan.

## 4. Tests

- [x] 4.1 Extend `test/scripts/local-provider-render.test.sh`: assert the `local` render's
      `standalone` triage bullet names `next-ticket-id.sh` and `tickets/`, and does not name
      `mcp__linear__save_issue`. Update its existing comment (lines ~45-50) that currently documents
      the `standalone` bullet as a pre-existing, out-of-scope unconditional Linear mention — that
      claim is no longer accurate after this change.
- [x] 4.2 Add or extend a render test asserting the `standalone` bullet's rendered text for a
      `linear`-configured fixture (e.g. `config/examples/concertino.json`) and a `github`-configured
      fixture (`config/examples/generic.json`) is byte-identical to the pre-change wording.
- [x] 4.3 Run the full local test suite (`npm test` or the project's documented equivalent) and the
      new/modified `test/scripts/*.sh` files directly; run `openspec validate --change
      local-provider-standalone-escalation` clean; run `concertino doctor` (if runnable without a
      committed `concertino.config.json`) or manually byte-diff `core/scripts/next-ticket-id.sh`
      against `scripts/concertino/next-ticket-id.sh` to confirm no drift.
