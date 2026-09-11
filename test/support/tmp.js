'use strict';
// CON-181: every test file that used fs.mkdtempSync(os.tmpdir(), ...) directly
// leaked the resulting directory — nothing ever removed it, on success or
// failure. `node --test` runs each *.test.js file in its own worker/process,
// so a `process.on('exit', ...)` cleanup registered here fires once per file,
// regardless of whether the file's tests passed, failed, or threw. Route every
// temp-dir creation in test/ through mkTmpDir() instead of calling
// fs.mkdtempSync(os.tmpdir(), ...) directly, so cleanup is automatic.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const created = [];

process.on('exit', () => {
  for (const dir of created) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort: process is exiting, nothing more we can do.
    }
  }
});

/**
 * Create a temp directory under os.tmpdir() with the given prefix, and
 * register it for automatic removal when this test file's process exits
 * (pass, fail, or throw).
 */
function mkTmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

module.exports = { mkTmpDir };
