'use strict';

// Resolves { title, description } | null for a run's ticket — the drill-down
// header/TICKET panel's one impure read (design.md Decision 2: kept OUT of
// reducer.js's pure fold, same shape as watch.js's own `queuedTitles` read).
//
// Two sources, in preference order (design.md's "Context" / Decision 1):
//   1. The persisted snapshot `<root>/.concertino/runs/<TICKET_ID>/evidence/
//      ticket.md`, written by persist-evidence.sh at a deterministic path —
//      the more honest source when it exists (it is exactly what the run
//      worked from), and the only one that survives cleanup.sh --phase4
//      destroying the worktree.
//   2. The launch pad cache (`lib/ui/cache.js`), matched by identifier — for
//      a run whose ticket.md was never persisted (pre-this-change, or a run
//      that escalated before Planning finished writing it).
//
// Never throws — mirrors cache.js#read's own "missing/malformed degrades to
// empty" contract, so a caller never needs a try/catch of its own.

const fs = require('fs');
const path = require('path');

// The first non-empty line's title, per design.md Decision 3: strips a
// leading `TICKET-ID:` token when present, but a first line that doesn't
// match the `# ...` shape at all still contributes its whole (trimmed) text
// as the title — never treated as a reason to fall back to the cache. (That
// fallback is reserved for a title that is BLANK after trimming — see
// resolve() below.)
const TITLE_RE = /^#\s*(?:\S+:\s*)?(.+)$/;

// Any `##`-level heading — used both to detect the `## Description` section
// itself and to find where that section (or, absent one, the pre-heading
// prose fallback) ends.
const HEADING2_RE = /^##\s+(.*)$/;
const DESCRIPTION_HEADING_RE = /^##\s+description\s*$/i;

function persistedPath(root, ticket) {
  return path.join(root, '.concertino', 'runs', ticket, 'evidence', 'ticket.md');
}

// Parses a ticket.md's raw text into { title, description }. Never throws:
// a shape this doesn't recognise degrades to whatever it can salvage (see
// each step below), not an exception.
function parseTicketMd(content) {
  const lines = String(content == null ? '' : content).split('\n');

  let titleIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') { titleIdx = i; break; }
  }
  // Empty/whitespace-only file: nothing to title or describe. Caller (see
  // resolve()) treats a blank title as equivalent to an unreadable file.
  if (titleIdx === -1) return { title: '', description: '' };

  const titleLine = lines[titleIdx].trim();
  const titleMatch = TITLE_RE.exec(titleLine);
  const title = (titleMatch ? titleMatch[1] : titleLine).trim();

  // Scope the description to the first `## Description` section (design.md
  // Decision 3) — never the whole remainder, so sections like `## Acceptance
  // Criteria` / `## Metadata` never bleed into the bounded TICKET panel.
  let descStart = -1;
  for (let i = titleIdx + 1; i < lines.length; i++) {
    if (DESCRIPTION_HEADING_RE.test(lines[i].trim())) {
      descStart = i + 1;
      break;
    }
  }

  if (descStart !== -1) {
    let descEnd = lines.length;
    for (let i = descStart; i < lines.length; i++) {
      if (HEADING2_RE.test(lines[i].trim())) { descEnd = i; break; }
    }
    return { title, description: lines.slice(descStart, descEnd).join('\n').trim() };
  }

  // No `## Description` heading at all — only possible for a ticket.md that
  // predates this change's convention (task 5.1 makes the heading mandatory
  // going forward). Fall back to the prose between the title and the first
  // `##` heading found (or the whole remainder, if there are none).
  let fallbackEnd = lines.length;
  for (let i = titleIdx + 1; i < lines.length; i++) {
    if (HEADING2_RE.test(lines[i].trim())) { fallbackEnd = i; break; }
  }
  return { title, description: lines.slice(titleIdx + 1, fallbackEnd).join('\n').trim() };
}

// resolve(root, ticket, cache) -> { title, description } | null
function resolve(root, ticket, cache) {
  let content = null;
  try {
    content = fs.readFileSync(persistedPath(root, ticket), 'utf8');
  } catch (e) {
    content = null; // missing or unreadable — fall through to the cache
  }

  if (content != null) {
    const parsed = parseTicketMd(content);
    // A blank title after trimming (an empty file, or a write interrupted
    // mid-Planning) is treated the same as an unreadable file — design.md's
    // own risk log: passing a bare null check here would otherwise render an
    // empty title row / empty panel instead of the honest fallback.
    if (parsed.title.trim() !== '') {
      return { title: parsed.title, description: parsed.description };
    }
  }

  const tickets = (cache && Array.isArray(cache.tickets)) ? cache.tickets : [];
  const found = tickets.find((t) => t && t.identifier === ticket);
  if (found) {
    return { title: found.title || '', description: found.description || '' };
  }

  return null;
}

module.exports = { resolve, parseTicketMd, persistedPath };
