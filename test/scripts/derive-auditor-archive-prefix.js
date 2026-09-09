'use strict';
// CON-166: derives the ARCHIVE_PREFIX value the auditor role ACTUALLY passes
// to check-merge-readiness.sh, by rendering the real `core/roles/auditor.md`
// template through the real `renderBody()` against a real example config
// (config/examples/helio.json) — never a value the test hardcodes on its
// own. Used by check-merge-readiness.test.sh's 166.3 fixture so that test
// and caller cannot drift apart again (evaluation-1.md CR 1): a bug in
// either the `<change-dir-root>` token, its lib/config.js derivation, or the
// auditor.md prose shows up as this script's own output changing, which the
// test then feeds straight into the script under test.
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const { withDefaults } = require(path.join(REPO, 'lib', 'config'));
const { renderBody } = require(path.join(REPO, 'lib', 'cli', 'render'));

const configPath = path.join(REPO, 'config', 'examples', 'helio.json');
const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const c = withDefaults(Object.assign({}, raw));

const auditorPath = path.join(REPO, 'core', 'roles', 'auditor.md');
const text = fs.readFileSync(auditorPath, 'utf8');
const out = renderBody(text, c, 'claude-code');

const m = out.match(/check-merge-readiness\.sh "\$WORKTREE_PATH" "\$BRANCH" "\$TICKET_ID" "([^"]+)"/);
if (!m) {
  console.error('derive-auditor-archive-prefix.js: could not find the rendered check-merge-readiness.sh invocation line in core/roles/auditor.md');
  process.exit(1);
}
process.stdout.write(m[1]);
