# CON-16: Escalation context truncation can split a UTF-8 character mid-sequence

## Description

`emit-event.sh`'s context truncation cuts at a byte boundary to fit the 4000-byte event line cap. A multi-byte UTF-8 character straddling that boundary is split, leaving a partial sequence in the emitted JSON.

Raised as non-blocking by CON-11's evaluator and confirmed by its final skeptic. Untested, because the context this feature currently carries is ASCII-ish — package names, command output, type signatures.

### Why it will bite eventually

Escalation context is assembled from things a human wrote or a tool printed: ticket text, error output, quoted requirements. Any of those can contain a smart quote, an em dash, an accented name, or an emoji in a commit message. When one lands on the cut, the result is a lone continuation byte in the JSON string.

Two consequences, and the second is the bad one:

* `JSON.parse` may reject the line, so `lib/ui/store.js` counts the whole event as **malformed and drops it** — the escalation vanishes from the dashboard rather than showing truncated.
* Or it parses and the terminal renders a replacement character mid-word, which is merely ugly.

Losing the escalation entirely is the failure worth preventing: a run blocked on a question nobody can see is exactly the state the dashboard exists to make impossible.

### This is the same family as two fixed bugs

`format.js`'s `truncate` and `padTo` both counted raw UTF-16 units where they needed visible columns, and both shipped green because `isTTY` is false under `node --test` so no test ever saw the path. `truncate` was later fixed again to iterate by code point so it could not split a surrogate pair.

Same lesson, different layer: this one counts bytes where it needs character boundaries.

## Acceptance Criteria

* Truncation never emits a partial UTF-8 sequence — back off to the previous character boundary rather than cutting mid-sequence.
* The visible truncation marker still reports honest byte counts, and the full text still persists via `persist-evidence.sh` with `context_ref` set, exactly as now.
* A test truncates context containing multi-byte characters positioned deliberately across the boundary, and asserts the emitted line is valid JSON and the decoded context ends on a whole character.
* Worth checking the same boundary in `emit-event.sh`'s existing `msg` / `first_error` truncation, which predates this feature and cuts the same way.

## Notes

Also flagged by CON-11's reviewers, and cheaper to fold in here than to file separately: the `blocker` context kind relies on the caller pre-trimming command output to "first lines" rather than `gather-escalation-context.sh` doing it. A caller that forgets sends the whole log and forces the truncation path unnecessarily.
