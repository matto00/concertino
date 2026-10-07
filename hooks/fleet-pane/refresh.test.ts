// hooks/fleet-pane/refresh.test.ts
import { test, expect, mock } from 'claude-code/testing'
import type { AgentInfo, EngineInterface, ProcessRunResult, SessionMessage } from 'claude-code'
import { runFleetSnapshot } from './snapshot'
import { PANE } from './register'

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
    timeline: [{ t: 0, kind: 'phase.enter' }], currentAgent: null }],
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

test('runFleetSnapshot: help-like stdout means concertino has no fleet command', async () => {
  const got = await runFleetSnapshot(fake$(async () => result({ stdout: 'concertino — usage:\n  init ...' })), '/repo')
  expect(got.ok).toBe(false)
  if (!got.ok) expect(got.error).toMatch(/no `fleet` command/)
})

test('runFleetSnapshot: a rejected process call is an error, not a throw', async () => {
  const got = await runFleetSnapshot(fake$(async () => { throw new Error('spawn ENOENT') }), '/repo')
  expect(got.ok).toBe(false)
  if (!got.ok) expect(got.error).toMatch(/ENOENT/)
})

// --- the poll, driven through engine events -------------------------------------------------------
// The kit's `$` has no `process`/`state`/`ui.status` nouns, so the plugin's own `$` calls are answered
// by hooks registered beneath it, and `session.start` + the mock clock fire `refresh` for real.
type On = (name: any, fn: (...a: any[]) => any) => void
type World = { stdout?: () => Promise<any>; agents?: any; messages?: any }

const okRun = (stdout: string) =>
  ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

function world(on: On, w: World = {}) {
  const store = new Map<string, unknown>()
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const opened: string[] = []
  const closed: string[] = []
  let stateSets = 0
  const fleetSets: any[] = []
  const showAllSets: unknown[] = []
  let runs = 0
  on('state.get', async (_$: unknown, e: { key: string }) => ({ value: { value: store.get(e.key), version: 1 } }))
  on('state.set', async (_$: unknown, e: { key: string; value: unknown }) => {
    if (e.key === 'fleet') { stateSets++; fleetSets.push(e.value) }
    if (e.key === 'showAll') showAllSets.push(e.value)
    store.set(e.key, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('session.start', async () => ({ cwd: '/repo' }))
  on('session.root', async () => ({ value: '/repo' }))
  on('process.run', async () => { runs++; return { value: await (w.stdout ? w.stdout() : okRun(JSON.stringify(SNAP))) } })
  on('agent.list', async () => ({ value: w.agents ?? [] }))
  on('session.messages', async () => ({ value: w.messages ?? [] }))
  on('ui.status', async (_$: unknown, e: { text?: string }) => { statuses.push(e.text); return { value: undefined } })
  on('ui.toast', async (_$: unknown, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  on('ui.panes', async () => ({ value: [] }))
  on('ui.open', async (_$: unknown, e: { id: string }) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', async (_$: unknown, e: { id: string }) => { closed.push(e.id); return { value: undefined } })
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  const clock = mock.clock(on as never)
  return { fleetSets, showAllSets, store, statuses, toasts, opened, closed, clock, stateSets: () => stateSets, runs: () => runs }
}

const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

const agentCall = (id: string, ticket: string): SessionMessage => ({
  role: 'assistant', text: '',
  toolUses: [{ tool_use_id: 'tu-' + id, tool: 'Agent', agentId: id, input: { subagent_type: 'concertino-orchestrator', prompt: `TICKET_ID=${ticket}` } }],
}) as unknown as SessionMessage

test('refresh: writes correlated lanes to state and sets the status line', async ($, on) => {
  const w = world(on, {
    agents: [{ id: 'a', description: '', type: 'concertino-orchestrator', status: 'running' } as AgentInfo],
    messages: [agentCall('a', 'CON-1')],
  })
  await start($)
  await w.clock.advance(2000)
  const value = w.store.get('fleet') as any
  expect(value.lanes).toHaveLength(1)
  expect(value.lanes[0]).toMatchObject({ agentId: 'a', liveness: 'running' })
  expect(value.error).toBeNull()
  expect(value.root).toBe('/r')
  expect(w.statuses.at(-1)).toBe('fleet: 1 running')
})

test('refresh: an identical snapshot does not rewrite state', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.advance(2000)
  await w.clock.advance(2000)
  expect(w.runs()).toBe(2)
  expect(w.stateSets()).toBe(1)
})

test('refresh: on CLI failure keeps the last lanes, records the error, clears the status line', async ($, on) => {
  let fail = false
  const w = world(on, {
    stdout: async () => fail
      ? { exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false }
      : okRun(JSON.stringify(SNAP)),
  })
  await start($)
  await w.clock.advance(2000)
  fail = true
  await w.clock.advance(2000)
  const value = w.store.get('fleet') as any
  expect(value.lanes).toHaveLength(1)
  expect(value.error).toMatch(/exit 1 boom/)
  expect(w.statuses.at(-1)).toBeUndefined()
})

test('refresh: toasts once per new escalation_id', async ($, on) => {
  const withEsc = { ...SNAP, runs: [{ ...SNAP.runs[0], status: 'needs-you',
    escalation: { question: 'Which schema?', options: ['a', 'b'], raisedAt: 0, escalationId: 'esc-1', role: 'skeptic' } }] }
  const w = world(on, { stdout: async () => okRun(JSON.stringify(withEsc)) })
  await start($)
  await w.clock.advance(2000)
  await w.clock.advance(2000)
  expect(w.toasts).toEqual(['CON-1 needs you: Which schema?'])
  expect(w.store.get('seenEscalations')).toEqual(['esc-1'])
})

test('refresh: denied session.messages still renders lanes as external', async ($, on) => {
  const w = world(on, { messages: { deny: 'no' } })
  await start($)
  await w.clock.advance(2000)
  expect((w.store.get('fleet') as any).lanes[0]?.liveness).toBe('external')
})

test('session.start does not open the pane; with a run it opens once at the first poll and polls every 2 s', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.opened).toEqual([])
  await w.clock.advance(2000)
  expect(w.runs()).toBe(1)
  expect(w.opened).toEqual([PANE])
  await w.clock.advance(4000)
  expect(w.runs()).toBe(3)
  expect(w.opened).toEqual([PANE])
})

test('an empty snapshot opens no pane and backs off to 15 s', async ($, on) => {
  const w = world(on, { stdout: async () => okRun(JSON.stringify({ ...SNAP, runs: [] })) })
  await start($)
  await w.clock.advance(2000)
  expect(w.runs()).toBe(1)
  await w.clock.advance(2000)
  expect(w.runs()).toBe(1)
  await w.clock.advance(11000)
  expect(w.runs()).toBe(1)
  await w.clock.advance(2000)
  expect(w.runs()).toBe(2)
  expect(w.opened).toEqual([])
})

test('/fleet opens the pane even with no runs', async ($, on) => {
  const w = world(on, { stdout: async () => okRun(JSON.stringify({ ...SNAP, runs: [] })) })
  await start($)
  await $.command.run({ command: 'fleet', args: '' })
  expect(w.opened).toEqual([PANE])
})

test('refresh: an escalation without an escalationId toasts once, keyed by ticket and raisedAt', async ($, on) => {
  const old = { ...SNAP, runs: [{ ...SNAP.runs[0], status: 'needs-you',
    escalation: { question: 'Old one?', options: [], raisedAt: 123, escalationId: null, role: null } }] }
  const w = world(on, { stdout: async () => okRun(JSON.stringify(old)) })
  await start($)
  await w.clock.advance(2000)
  await w.clock.advance(2000)
  expect(w.toasts).toEqual(['CON-1 needs you: Old one?'])
  expect(w.store.get('seenEscalations')).toEqual(['CON-1:123'])
})

test('/fleet opens the pane; /fleet off closes it', async ($, on) => {
  const w = world(on)
  await start($)
  w.opened.length = 0
  await $.command.run({ command: 'fleet', args: '' })
  expect(w.opened).toEqual([PANE])
  await $.command.run({ command: 'fleet', args: 'off' })
  expect(w.closed).toEqual([PANE])
})

test('refresh: a good poll after a failure clears the error even when the lanes are unchanged', async ($, on) => {
  let fail = false
  const w = world(on, {
    stdout: async () => fail
      ? { exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false }
      : okRun(JSON.stringify(SNAP)),
  })
  await start($)
  await w.clock.advance(2000)
  fail = true
  await w.clock.advance(2000)
  fail = false
  await w.clock.advance(15000)   // a failing poll backs off to the idle delay
  const last = w.fleetSets.at(-1)
  expect(last.error).toBeNull()
  expect(last.lanes).toHaveLength(1)
})

test('refresh: a tick is skipped while the previous poll is still running', async ($, on) => {
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  const w = world(on, { stdout: async () => { await gate; return okRun(JSON.stringify(SNAP)) } })
  await start($)
  await w.clock.advance(2000)
  await w.clock.advance(2000)
  expect(w.runs()).toBe(1)
  release()
  await w.clock.advance(0)
  expect(w.stateSets()).toBe(1)
})

test('refresh: a denied agent.list still renders lanes as external and writes state', async ($, on) => {
  const w = world(on, { agents: { deny: 'no' } })
  await start($)
  await w.clock.advance(2000)
  expect((w.store.get('fleet') as any).lanes[0]?.liveness).toBe('external')
})

const STALE = { ...SNAP, runs: [{ ...SNAP.runs[0], timeline: [{ t: -31 * 60_000, kind: 'phase.enter' }] }] }

test('refresh: all lanes stale opens no pane, clears the status line and backs off to 15 s, yet still stores the lanes', async ($, on) => {
  const w = world(on, { stdout: async () => okRun(JSON.stringify(STALE)) })
  await start($)
  await w.clock.advance(2000)
  expect(w.runs()).toBe(1)
  expect(w.opened).toEqual([])
  expect(w.statuses.at(-1)).toBeUndefined()
  expect((w.store.get('fleet') as any).lanes).toHaveLength(1)
  await w.clock.advance(13000)
  expect(w.runs()).toBe(1)
  await w.clock.advance(2000)
  expect(w.runs()).toBe(2)
})

test('/fleet all toggles showAll and says which way', async ($, on) => {
  const w = world(on)
  await start($)
  const first = await $.command.run({ command: 'fleet', args: 'all' })
  expect(first.text).toBe('Fleet pane: showing all lanes.')
  const second = await $.command.run({ command: 'fleet', args: 'all' })
  expect(second.text).toBe('Fleet pane: showing live lanes only.')
  expect(w.showAllSets).toEqual([true, false])
})
