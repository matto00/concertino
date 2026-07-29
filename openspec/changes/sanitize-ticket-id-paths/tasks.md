## 1. persist-evidence.sh

- [x] 1.1 Add `looks_like_ticket() { [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; }` to
      `core/scripts/persist-evidence.sh`, placed immediately after argument parsing.
- [x] 1.2 Reject `TICKET_ID` that fails `looks_like_ticket` before `main_checkout` is called or
      any directory is created: print `FAIL invalid TICKET_ID: <value>` to stderr, print no
      `READY` line, exit non-zero.

## 2. emit-event.sh

- [x] 2.1 Add the identical `looks_like_ticket()` definition to `core/scripts/emit-event.sh`.
- [x] 2.2 Reject a `TICKET` that fails `looks_like_ticket` the same way the existing
      `[ -z "$TICKET" ] && exit 0` line already handles an empty ticket — no `RUN_DIR` created, no
      line written, exit 0 in the normal (non-`--await`) path. Confirm the `--await` path is
      covered by the same early check (it is reached only after `TICKET` is resolved) rather than
      needing a second guard.

## 3. Shared pattern test

- [x] 3.1 Extend `test/scripts/ticket-pattern.test.sh`'s `extract()` calls to also cover
      `core/scripts/emit-event.sh` and `core/scripts/persist-evidence.sh`, and fold both into the
      existing all-equal byte-comparison assertion.

## 4. New filesystem-level tests

- [x] 4.1 In `test/scripts/persist-evidence.test.sh`, add a case that calls the script with a
      `TICKET_ID` of `../../../../escape` and a valid readable source file, and assert: exit
      non-zero, `FAIL` on stderr, no `READY` on stdout, and no file exists anywhere under the
      main checkout outside `.concertino/runs/`.
- [x] 4.2 In `test/scripts/emit-event.test.sh`, add a case that calls the script with
      `ticket=../../../../escape` and any event kind, and assert: exit 0, nothing written to
      `.concertino/runs/` anywhere, and no file created outside it.
- [x] 4.3 In both new cases, also assert a well-formed sibling ticket id (e.g. `CON-14`) still
      succeeds in the same test run, so the guard is proven to narrow rather than break normal
      use.

## 5. Sync and verify

- [x] 5.1 Run `node bin/concertino sync --config=concertino.config.json` (or the project's
      canonical sync invocation) so `scripts/concertino/emit-event.sh` and
      `scripts/concertino/persist-evidence.sh` are re-rendered from the updated `core/scripts/`
      copies, and confirm via `diff` that the rendered copies are byte-identical to their
      `core/scripts/` sources (matching every other script in that directory).
- [x] 5.2 Run the full suite (`npm test`), including
      `bash test/scripts/ticket-pattern.test.sh`, `bash test/scripts/emit-event.test.sh`, and
      `bash test/scripts/persist-evidence.test.sh`, and confirm all pass.
