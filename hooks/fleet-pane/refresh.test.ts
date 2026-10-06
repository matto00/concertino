// hooks/fleet-pane/refresh.test.ts
import { test, expect } from 'claude-code/testing'
import type { EngineInterface, ProcessRunResult } from 'claude-code'
import { runFleetSnapshot } from './snapshot'

// The test kit's `$` carries only the events the engine raises on its own; `process.run` is a call a
// plugin makes on its own `$`, so the snapshot runner is exercised against a stand-in `$` with the
// same call shape (`run(argv, init)`).
type RunInit = { cwd?: string; timeoutMs?: number }
const fake$ = (run: (argv: readonly string[], init?: RunInit) => Promise<ProcessRunResult>) =>
  ({ process: { run } }) as unknown as EngineInterface
const result = (r: Partial<ProcessRunResult>): ProcessRunResult =>
  ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r })

const SNAP = {
  generatedAt: 1, root: '/r',
  runs: [{ ticket: 'CON-1', changeName: 'x', branch: 'feature/x/CON-1', worktree: '/w', phase: 'Planning', cycle: 1,
    gates: [], lastVerdict: null, escalation: null, costUsd: null, startedAt: 0, endedAt: null, endStatus: null,
    elapsedMs: 5, status: 'unknown', malformed: 0, ticket_doc: { title: 'X', excerpt: null }, pendingAnswer: null,
    timeline: [], currentAgent: null }],
}

test('runFleetSnapshot: parses the CLI output and passes cwd + timeout', async () => {
  let seen: { argv: readonly string[]; cwd?: string; timeoutMs?: number } | null = null
  const $ = fake$(async (argv, init) => {
    seen = { argv, cwd: init?.cwd, timeoutMs: init?.timeoutMs }
    return result({ stdout: JSON.stringify(SNAP) })
  })
  const got = await runFleetSnapshot($, '/repo')
  expect(seen).toEqual({ argv: ['concertino', 'fleet', '--json'], cwd: '/repo', timeoutMs: 5000 })
  expect(got).toEqual({ ok: true, snapshot: SNAP })
})

test('runFleetSnapshot: non-zero exit is an error carrying the stderr tail', async () => {
  const got = await runFleetSnapshot(fake$(async () => result({ exitCode: 127, stderr: 'bash: concertino: command not found' })), '/repo')
  expect(got.ok).toBe(false)
  if (!got.ok) expect(got.error).toMatch(/exit 127.*command not found/)
})

test('runFleetSnapshot: empty stdout is an error, lanes are kept', async () => {
  const got = await runFleetSnapshot(fake$(async () => result({})), '/repo')
  expect(got.ok).toBe(false)
  if (!got.ok) expect(got.error).toMatch(/no output/)
})

test('runFleetSnapshot: a rejected process call is an error, not a throw', async () => {
  const got = await runFleetSnapshot(fake$(async () => { throw new Error('spawn ENOENT') }), '/repo')
  expect(got.ok).toBe(false)
  if (!got.ok) expect(got.error).toMatch(/ENOENT/)
})
