'use strict';

// The shared empty-state widget (design.md Decision 5). Mirrors the
// codebase's existing dim-styled short-message "nothing to show" convention
// — e.g. fleet/sections.js's `f.dim('  no active runs')`, launchpad.js's
// `f.dim('no tickets cached yet — press r to fetch')` — optionally
// icon-prefixed via header.js's `sectionHeader` convention when `icon` is
// given. Not `launchpad.js`'s `teamNotFoundMessage` (that lives in watch.js
// and renders via `f.red` as an error message, not a dim-styled empty state
// — design-gate round 4 correction).

const f = require('../format');
const { sectionHeader } = require('./header');

// emptyState({ icon, message }) -> [line]. `message` is rendered verbatim,
// dim-styled, optionally prefixed with `icon` via sectionHeader's own
// "icon + ' ' + label" convention.
function emptyState({ icon, message }) {
  return [f.dim(sectionHeader({ icon, label: message }))];
}

module.exports = { emptyState };
