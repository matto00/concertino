'use strict';

// CON-21, design.md Decision 2: headless ticket drafting. The TUI
// (lib/ui/watch.js) is a plain Node CLI process — it has no access to the
// `Agent` tool, which only exists inside a running Claude Code agent turn —
// so turning a free-text intention into a draft ticket needs its own
// child-process plumbing, spawned via `claude -p ... --output-format json`,
// not the interactive tmux windows session.js manages for actual runs.
//
// Scoped to the Claude Code harness only for v1 (per the human's
// confirmation at planning) — this repo's primary target harness, and there
// is no existing multi-harness abstraction for headless, structured-output
// invocation yet to build on. A future harness would need its own dial here,
// not a silent guess at which binary to spawn.

const { execFile } = require('child_process');

const REQUIRED_FIELDS = ['title', 'description', 'acceptanceCriteria'];

// The drafting prompt. `acceptanceCriteria` is instructed to come back as ONE
// markdown string (e.g. a rendered bullet list), not a JSON array — the
// draft-review screen (lib/ui/screens/ticketdraft.js) edits it with the same
// plain-text buffer it uses for `description` (design.md Decision 3).
function draftPrompt(seed) {
  return [
    'Draft a well-scoped software delivery ticket from the intention below.',
    'Respond with ONLY a single JSON object — no markdown code fences, no',
    'commentary before or after it — with exactly these three string fields:',
    '"title", "description", "acceptanceCriteria".',
    '"acceptanceCriteria" must be one markdown string (for example a bullet',
    'list rendered as text), never a JSON array.',
    '',
    'Intention:',
    seed,
  ].join('\n');
}

function tryParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

// `claude -p ... --output-format json` wraps the model's own reply inside a
// harness envelope; the drafted JSON itself normally arrives as a STRING in
// the envelope's `result` field, so it has to be parsed a second time. Falls
// back to treating the outer JSON as the draft directly when there is no
// string `result` — a stub/fake harness (tests) or a future harness version
// that returns the draft unwrapped both still parse correctly rather than
// being treated as malformed.
function parseDraftOutput(stdout) {
  let outer;
  try {
    outer = JSON.parse(stdout);
  } catch (e) {
    throw new Error('drafting failed: response was not JSON');
  }

  const draft = (outer && typeof outer.result === 'string' ? tryParseJSON(outer.result) : null) || outer;

  if (!draft || typeof draft !== 'object') {
    throw new Error('drafting failed: response was not a JSON object');
  }

  for (const field of REQUIRED_FIELDS) {
    if (typeof draft[field] !== 'string' || !draft[field].trim()) {
      throw new Error('drafting failed: response was missing "' + field + '"');
    }
  }

  return { title: draft.title, description: draft.description, acceptanceCriteria: draft.acceptanceCriteria };
}

// Spawns the headless drafting invocation. `opts.execFile` is the same
// injectable-seam discipline linear.js's `transport` gives fetchTickets —
// tests hand in a fake, production omits it and gets the real
// `child_process.execFile`, and neither ever touches the network or a real
// `claude` binary in a test run.
//
// Returns `{ promise, cancel }`. `promise` resolves with
// `{ title, description, acceptanceCriteria }` or rejects with a single
// "drafting failed: ..." error — a non-zero exit, a malformed response, and a
// missing field are all funnelled through this one path (tasks.md 2.2), never
// distinguished on screen. `cancel()` kills the in-flight child process
// (tasks.md 2.3); calling it after the child has already settled is a
// harmless no-op — the caller is expected to also stop listening for this
// promise's own resolution once cancel() has been called (see watch.js's own
// sequence-number guard at the 'open-ticket-draft'/'cancel-prompt' call
// sites, which is what actually makes a cancelled draft's late resolution
// invisible to the human).
function draftTicket(seed, opts) {
  const o = opts || {};
  const run = o.execFile || execFile;
  const prompt = draftPrompt(String(seed || ''));

  let child = null;
  let cancelled = false;

  const promise = new Promise((resolve, reject) => {
    child = run('claude', ['-p', prompt, '--output-format', 'json'], { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (cancelled) {
          reject(new Error('drafting cancelled'));
          return;
        }
        if (err) {
          reject(new Error('drafting failed: ' + String((err && err.message) || err).split('\n')[0]));
          return;
        }
        try {
          resolve(parseDraftOutput(stdout));
        } catch (e) {
          reject(e);
        }
      });
  });

  // A rejection from a cancelled draft is expected and deliberately never
  // surfaced (see watch.js's own handling) — but an unhandled promise
  // rejection would still crash the dashboard process if nothing else ever
  // attaches a .catch(). This no-op catch exists solely to prevent that;
  // watch.js's real .then()/.catch() pair (attached separately, by the
  // caller) is what actually decides what the human sees.
  promise.catch(() => {});

  return {
    promise,
    cancel() {
      cancelled = true;
      if (child) child.kill();
    },
  };
}

module.exports = { draftTicket, draftPrompt, parseDraftOutput };
