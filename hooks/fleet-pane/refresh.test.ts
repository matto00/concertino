// hooks/fleet-pane/refresh.test.ts
import { test, expect, mock } from 'claude-code/testing'
import type { AgentInfo, EngineInterface, ProcessRunResult, SessionMessage } from 'claude-code'
import { runFleetSnapshot } from './snapshot'
import { PANE } from './register'
import { draftMessage } from './lanes'
import { laneShare, laneUsd } from './usage'

// The test kit's `$` carries only the events the engine raises on its own; `process.run` is a call a
// plugin makes on its own `$`, so the snapshot runner is exercised against a stand-in `$` with the
// same call shape (`run(argv, init)`).
type RunInit = { cwd?: string; timeoutMs?: number }
const fake$ = (run: (argv: readonly string[], init?: RunInit) => Promise<ProcessRunResult>) =>
  ({ process: { run } }) as unknown as EngineInterface
const result = (r: Partial<ProcessRunResult>): ProcessRunResult =>
  ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r })

const RUN = { ticket: 'CON-1', changeName: 'x', branch: 'feature/x/CON-1', worktree: '/w', phase: 'Planning', cycle: 1,
  gates: [], lastVerdict: null, escalation: null, costUsd: null, startedAt: 0, endedAt: null, endStatus: null,
  elapsedMs: 5, status: 'unknown', malformed: 0, ticket_doc: { title: 'X', excerpt: null }, pendingAnswer: null,
  timeline: [{ t: 0, kind: 'phase.enter' }], currentAgent: null, ticket_meta: null, ticket_meta_error: null }
const SNAP = { generatedAt: 1, root: '/r', project: 'sandbox', runs: [RUN] }

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

test('runFleetSnapshot: appends --tickets= for the given tickets, comma-joined', async () => {
  let seen: readonly string[] = []
  const $ = fake$(async argv => { seen = argv; return result({ stdout: JSON.stringify(SNAP) }) })
  await runFleetSnapshot($, '/repo', ['CON-1', 'CON-2'])
  expect(seen).toEqual(['concertino', 'fleet', '--json', '--tickets=CON-1,CON-2'])
})

test('runFleetSnapshot: non-zero exit is an error carrying the stderr tail', async () => {
  const got = await runFleetSnapshot(fake$(async () => result({ exitCode: 127, stderr: 'bash: concertino: command not found' })), '/repo')
  expect(got.ok).toBe(false)
  if (!got.ok) expect(got.error).toMatch(/exit 127.*command not found/)
})

test('runFleetSnapshot: empty stdout is an error', async () => {
  const got = await runFleetSnapshot(fake$(async () => result({})), '/repo')
  expect(got.ok).toBe(false)
  if (!got.ok) expect(got.error).toMatch(/no output/)
})

test('runFleetSnapshot: help-like stdout means concertino has no fleet command', async () => {
  const got = await runFleetSnapshot(fake$(async () => result({ stdout: 'concertino — usage:\n  init ...' })), '/repo')
  expect(got.ok).toBe(false)
  if (!got.ok) expect(got.error).toMatch(/no `fleet` command/)
})

test('runFleetSnapshot: bad JSON and a JSON without runs are errors', async () => {
  const bad = await runFleetSnapshot(fake$(async () => result({ stdout: '{"runs": [' })), '/repo')
  expect(bad.ok).toBe(false)
  if (!bad.ok) expect(bad.error).toMatch(/bad JSON/)
  const shape = await runFleetSnapshot(fake$(async () => result({ stdout: '{"root": "/r"}' })), '/repo')
  expect(shape.ok).toBe(false)
  if (!shape.ok) expect(shape.error).toMatch(/unexpected JSON shape/)
})

test('runFleetSnapshot: a rejected process call is an error, not a throw', async () => {
  const got = await runFleetSnapshot(fake$(async () => { throw new Error('spawn ENOENT') }), '/repo')
  expect(got.ok).toBe(false)
  if (!got.ok) expect(got.error).toMatch(/ENOENT/)
})

// --- the poll, driven through engine events -------------------------------------------------------
// The plugin's own `$` calls are answered by hooks registered beneath it, and `session.start` + the
// mock clock fire `refresh` for real. `session.id` is one of them, so `driver: here` is exercised
// through the plugin's own `$.session.id()`.
type On = (name: any, fn: (...a: any[]) => any) => void
type World = {
  open?: object; stdout?: () => Promise<any>; agents?: any | (() => any); messages?: any | (() => any)
  surfaces?: readonly string[]; session?: string; fill?: { isFilled: boolean; refusal?: string }
  usage?: any | (() => any); turnResult?: object
}

const okRun = (stdout: string) =>
  ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const snap = (runs: object[], over: object = {}) => async () => okRun(JSON.stringify({ ...SNAP, runs, ...over }))

function world(on: On, w: World = {}) {
  const store = new Map<string, unknown>()
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const logs: string[] = []
  const opened: string[] = []
  const registered: any[] = []
  const closed: string[] = []
  const argvs: (readonly string[])[] = []
  const fills: any[] = []
  let stateSets = 0
  const sets: Record<string, number> = {}
  const fleetSets: any[] = []
  const showAllSets: unknown[] = []
  let runs = 0
  const value = (v: any) => (typeof v === 'function' ? v() : v)
  on('state.get', async (_$: unknown, e: { key: string }) => ({ value: { value: store.get(e.key), version: 1 } }))
  on('state.set', async (_$: unknown, e: { key: string; value: unknown }) => {
    if (e.key === 'fleet') { stateSets++; fleetSets.push(e.value) }
    if (e.key === 'showAll') showAllSets.push(e.value)
    sets[e.key] = (sets[e.key] ?? 0) + 1
    store.set(e.key, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('session.start', async () => ({ cwd: '/repo' }))
  on('session.root', async () => ({ value: '/repo' }))
  if (w.session !== undefined) on('session.id', async () => ({ value: w.session }))
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => { runs++; argvs.push(e.argv); return { value: await (w.stdout ? w.stdout() : okRun(JSON.stringify(SNAP))) } })
  on('agent.list', async () => ({ value: value(w.agents) ?? [] }))
  on('session.messages', async () => ({ value: value(w.messages) ?? [] }))
  on('ui.status', async (_$: unknown, e: { text?: string }) => { statuses.push(e.text); return { value: undefined } })
  on('ui.log', async (_$: unknown, e: { text: string }) => { logs.push(e.text); return { value: undefined } })
  on('ui.toast', async (_$: unknown, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  on('session.surfaces', async () => ({ value: w.surfaces ?? ['terminal'] }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.open', async (_$: unknown, e: { id: string }) => { opened.push(e.id); return { value: w.open ?? { isPlaced: true } } })
  on('ui.close', async (_$: unknown, e: { id: string }) => { closed.push(e.id); return { value: undefined } })
  on('command.register', async (_$: unknown, e: { name: string }) => { registered.push(e); return { value: { command: e.name } } })
  on('prompt.fill', async (_$: unknown, e: any) => { fills.push(e); return w.fill ?? { isFilled: true } })
  if (w.usage !== undefined) on('session.usage', async () => ({ value: value(w.usage) }))
  // The bottom of turn.complete: the engine's own answer, here a turn with no usage of its own.
  on('turn.complete', async () => w.turnResult ?? { text: '' })
  const clock = mock.clock(on as never)
  return { sets, logs, registered, argvs, fleetSets, showAllSets, store, statuses, toasts, opened, closed, fills, clock, stateSets: () => stateSets, runs: () => runs }
}

const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
const fleetOf = (w: ReturnType<typeof world>) => w.store.get('fleet') as any
const laneOf = (w: ReturnType<typeof world>, ticket = 'CON-1') => fleetOf(w).lanes.find((l: any) => l.run.ticket === ticket)

const orch = (id: string, status: AgentInfo['status'], name: string): AgentInfo =>
  ({ id, name, description: `${name} orchestrator`, type: 'concertino:concertino-orchestrator', status }) as AgentInfo
const agentCall = (id: string, ticket: string): SessionMessage => ({
  role: 'assistant', text: '',
  toolUses: [{ tool_use_id: 'tu-' + id, tool: 'Agent', agentId: id, input: { subagent_type: 'concertino-orchestrator', prompt: `TICKET_ID=${ticket}` } }],
}) as unknown as SessionMessage

test('refresh: writes lanes matched by agent name, the project, and the status line', async ($, on) => {
  const w = world(on, { session: 'me', agents: [orch('a', 'running', 'CON-1')] })
  await start($)
  await w.clock.advance(2000)
  const value = fleetOf(w)
  expect(value.lanes).toHaveLength(1)
  expect(value.lanes[0]).toMatchObject({ driver: 'here', agent: 'running', agentId: 'a', agentStatus: 'running' })
  expect(value.error).toBeNull()
  expect(value.root).toBe('/r')
  expect(value.project).toBe('sandbox')
  expect(w.statuses.at(-1)).toBe('fleet: 1 running')
  expect(w.store.get('knownAgents')).toEqual({ 'CON-1': 'a' })
})

test('refresh: the transcript Agent call is the fallback match', async ($, on) => {
  const w = world(on, { agents: [{ id: 'a', description: 'deliver', type: 'concertino-orchestrator', status: 'waiting' }], messages: [agentCall('a', 'CON-1')] })
  await start($)
  await w.clock.advance(2000)
  expect(laneOf(w)).toMatchObject({ driver: 'here', agent: 'waiting', agentId: 'a' })
})

test('refresh: $.session.id decides driver here, other and none', async ($, on) => {
  const w = world(on, { session: 'me', stdout: snap([
    { ...RUN, ticket: 'MINE', driverSession: 'me' }, { ...RUN, ticket: 'THEIRS', driverSession: 'them' }, { ...RUN, ticket: 'NOBODY', driverSession: null },
  ]) })
  await start($)
  await w.clock.advance(2000)
  expect(laneOf(w, 'MINE')).toMatchObject({ driver: 'here', agent: 'unseen' })
  expect(laneOf(w, 'THEIRS').driver).toBe('other')
  expect(laneOf(w, 'THEIRS').agent).toBeUndefined()
  expect(laneOf(w, 'NOBODY').driver).toBe('none')
})

test('refresh: without a session id a recorded driver session reads other', async ($, on) => {
  const w = world(on, { stdout: snap([{ ...RUN, driverSession: 'me' }]) })
  await start($)
  await w.clock.advance(2000)
  expect(laneOf(w).driver).toBe('other')
})

test('refresh: an orchestrator that drops out of the agent list reads stalled on the next poll', async ($, on) => {
  let agents: AgentInfo[] = [orch('a', 'running', 'CON-1')]
  const w = world(on, { session: 'me', agents: () => agents })
  await start($)
  await w.clock.advance(2000)
  expect(laneOf(w).agent).toBe('running')
  agents = []
  await w.clock.advance(2000)
  expect(laneOf(w)).toMatchObject({ driver: 'here', agent: 'stalled', agentId: 'a' })
  expect(w.statuses.at(-1)).toBe('fleet: 1 stalled')
})

test('refresh: project falls back to the root basename for an older CLI', async ($, on) => {
  const w = world(on, { stdout: snap([RUN], { project: undefined, root: '/home/me/concertino-sandbox/' }) })
  await start($)
  await w.clock.advance(2000)
  expect(fleetOf(w).project).toBe('concertino-sandbox')
})

test('command: /fleet is registered immediate so it runs mid-turn', async ($, on) => {
  const w = world(on)
  await start($)
  const e = w.registered.find((x: any) => x.name === 'fleet')
  expect(e.immediate).toBe(true)
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
  const value = fleetOf(w)
  expect(value.lanes).toHaveLength(1)
  expect(value.error).toMatch(/exit 1 boom/)
  expect(w.statuses.at(-1)).toBeUndefined()
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

test('refresh: denied session.messages and agent.list still write lanes, with no driver', async ($, on) => {
  const w = world(on, { messages: { deny: 'no' }, agents: { deny: 'no' } })
  await start($)
  await w.clock.advance(2000)
  expect(laneOf(w)).toMatchObject({ driver: 'none' })
  expect(laneOf(w).agentId).toBeUndefined()
})

// --- escalation toasts -----------------------------------------------------------------------------

const withEsc = (escalation: object, over: object = {}) => snap([{ ...RUN, status: 'needs-you', escalation, ...over }])

test('refresh: toasts once per new escalation id', async ($, on) => {
  const w = world(on, { stdout: withEsc({ question: 'Which schema?', options: ['a', 'b'], raisedAt: 0, escalationId: 'esc-1', role: 'skeptic' }) })
  await start($)
  await w.clock.advance(2000)
  await w.clock.advance(2000)
  expect(w.toasts).toEqual(['CON-1 needs you: Which schema?'])
  expect(w.store.get('seenEscalations')).toEqual(['esc-1'])
})

test('refresh: an escalation with an empty question toasts its first sub-question', async ($, on) => {
  const w = world(on, { stdout: withEsc({ question: '', options: [], raisedAt: 0, escalationId: 'esc-2', role: 'skeptic',
    subQuestions: [{ question: '  ', options: [] }, { question: 'Which cache?', options: ['a) Map'] }] }) })
  await start($)
  await w.clock.advance(2000)
  expect(w.toasts).toEqual(['CON-1 needs you: Which cache?'])
})

test('refresh: an escalation with nothing to say still toasts who escalated', async ($, on) => {
  const w = world(on, { stdout: withEsc({ question: '', options: [], raisedAt: 0, escalationId: 'esc-3', role: 'evaluator' }) })
  await start($)
  await w.clock.advance(2000)
  expect(w.toasts).toEqual(['CON-1 needs you: evaluator escalated'])
})

test('refresh: an escalation without an escalationId toasts once, keyed by ticket and raisedAt', async ($, on) => {
  const w = world(on, { stdout: withEsc({ question: 'Old one?', options: [], raisedAt: 123, escalationId: null, role: null }) })
  await start($)
  await w.clock.advance(2000)
  await w.clock.advance(2000)
  expect(w.toasts).toEqual(['CON-1 needs you: Old one?'])
  expect(w.store.get('seenEscalations')).toEqual(['CON-1:123'])
})

test('refresh: an answered escalation does not toast', async ($, on) => {
  const w = world(on, { stdout: withEsc({ question: 'Q?', options: [], raisedAt: 0, escalationId: 'esc-4', role: 'skeptic' }, { pendingAnswer: { answer: 'a' } }) })
  await start($)
  await w.clock.advance(2000)
  expect(w.toasts).toEqual([])
})

test('refresh: a needs-you lane toasts however old its last event, since it is always shown', async ($, on) => {
  const w = world(on, { stdout: withEsc({ question: 'Old?', options: [], raisedAt: 0, escalationId: 'old-1', role: 'skeptic' },
    { timeline: [{ t: -3_600_000 * 2, kind: 'escalation.raised' }] }) })
  await start($)
  await w.clock.advance(2000)
  expect(w.toasts).toEqual(['CON-1 needs you: Old?'])
})

// --- comment baselines -----------------------------------------------------------------------------

const metaWith = (comments: { createdAt: number | null }[]) => ({
  fetchedAt: 0, id: 'u', identifier: 'CON-1', title: 't', description: '', url: null, state: { name: null, type: null },
  assignee: null, priority: null, estimate: null, labels: [], commentsTruncated: false, source: 'linear',
  comments: comments.map((c, i) => ({ id: `c${i}`, author: 'a', body: 'b', ...c })),
})

test('refresh: the first time a ticket\'s comments arrive, they are marked seen up to the newest', async ($, on) => {
  const w = world(on, { stdout: snap([{ ...RUN, ticket: 'con-1', ticket_meta: metaWith([{ createdAt: 300 }, { createdAt: 900 }, { createdAt: null }]) }]) })
  await start($)
  await w.clock.advance(2000)
  expect(w.store.get('seenComments')).toEqual({ 'CON-1': 900 })
})

test('refresh: an existing seen mark is never overwritten by the baseline', async ($, on) => {
  const w = world(on, { stdout: snap([{ ...RUN, ticket_meta: metaWith([{ createdAt: 900 }]) }, { ...RUN, ticket: 'CON-2', ticket_meta: metaWith([{ createdAt: 50 }]) }]) })
  w.store.set('seenComments', { 'CON-1': 100 })
  await start($)
  await w.clock.advance(2000)
  expect(w.store.get('seenComments')).toEqual({ 'CON-1': 100, 'CON-2': 50 })
})

test('refresh: a ticket fetched with no comments is baselined at 0, so its first comment later counts as new', async ($, on) => {
  let meta = metaWith([])
  const w = world(on, { stdout: async () => okRun(JSON.stringify({ ...SNAP, runs: [{ ...RUN, ticket_meta: meta }] })) })
  await start($)
  await w.clock.advance(2000)
  expect(w.store.get('seenComments')).toEqual({ 'CON-1': 0 })
  meta = metaWith([{ createdAt: 500 }])
  await w.clock.advance(2000)
  expect(w.store.get('seenComments')).toEqual({ 'CON-1': 0 })
})

test('refresh: a ticket not yet fetched is not baselined', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.advance(2000)
  expect(w.store.get('seenComments') ?? {}).toEqual({})
})

// --- usage: turns attributed to lanes, the account read on each poll --------------------------------

const TURN_USAGE = { model: 'claude-sonnet-4-5', input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 40, cache_read_input_tokens: 1000 }
const TURN_WEIGHT = 3 * (100 + 50 + 50 + 100)
const TURN_TOKENS = 1150
const turn = (over: object = {}) => ({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', usage: TURN_USAGE, ...over })
const sub = (id: string, parentId?: string): AgentInfo =>
  ({ id, description: 'worker', type: 'general-purpose', status: 'running', ...(parentId ? { parentId } : {}) }) as AgentInfo

test('turn.complete: a sub-agent turn lands on its orchestrator\'s ticket through the parentId chain', async ($, on) => {
  const w = world(on, { agents: [orch('o1', 'running', 'SBX-1'), sub('exec', 'o1'), sub('grand', 'exec')] })
  w.store.set('knownAgents', { 'SBX-1': 'o1' })
  await ($ as any).turn.complete(turn({ agentId: 'grand' }))
  expect(w.store.get('laneUsage')).toEqual({ 'SBX-1': { tokens: TURN_TOKENS, weight: TURN_WEIGHT, turns: 1 } })
  expect(w.store.get('usageMeter')).toEqual({ weight: TURN_WEIGHT, usdAtStart: null })
  await ($ as any).turn.complete(turn({ agentId: 'o1' }))
  expect(w.store.get('laneUsage')).toEqual({ 'SBX-1': { tokens: 2 * TURN_TOKENS, weight: 2 * TURN_WEIGHT, turns: 2 } })
  expect((w.store.get('usageMeter') as any).weight).toBe(2 * TURN_WEIGHT)
})

test('turn.complete: a main-loop turn and an unrelated agent count only toward the meter', async ($, on) => {
  const w = world(on, { agents: [orch('o1', 'running', 'SBX-1'), sub('loner')] })
  w.store.set('knownAgents', { 'SBX-1': 'o1' })
  await ($ as any).turn.complete(turn())
  await ($ as any).turn.complete(turn({ agentId: 'loner' }))
  expect(w.store.get('laneUsage') ?? {}).toEqual({})
  expect(w.store.get('usageMeter')).toEqual({ weight: 2 * TURN_WEIGHT, usdAtStart: null })
})

test('turn.complete: the result\'s usage is preferred; a turn with none records nothing', async ($, on) => {
  // Opus usage in the chain's answer beats the sonnet usage on the event.
  const w = world(on, { turnResult: { text: '', usage: { ...TURN_USAGE, model: 'claude-opus-5' } } })
  await ($ as any).turn.complete(turn())
  expect((w.store.get('usageMeter') as any).weight).toBe(5 * 300)
})

test('turn.complete: no usage on the event or the result writes no meter', async ($, on) => {
  const w = world(on)
  const { usage: _drop, ...bare } = turn() as any
  const r = await ($ as any).turn.complete(bare)
  expect(r).toMatchObject({ text: '' })
  expect(w.store.get('usageMeter')).toBeUndefined()
})

test('refresh: reads the account from $.session.usage and starts the meter at the first known cost', async ($, on) => {
  let usage: any = { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-07T22:00:00Z' }] }
  const w = world(on, { usage: () => usage })
  await start($)
  await w.clock.advance(2000)
  expect(w.store.get('account')).toEqual({ rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-07T22:00:00Z' }], usd: null })
  expect(w.store.get('usageMeter')).toBeUndefined()                         // no cost yet: no start
  usage = { ...usage, rateLimits: [{ kind: 'seven_day', percentUsed: 10 }], cost: { usd: 1.25 } }
  await w.clock.advance(2000)
  expect(w.store.get('account')).toEqual({ rateLimits: [{ kind: 'seven_day', percentUsed: 10 }], usd: 1.25 })
  expect(w.store.get('usageMeter')).toEqual({ weight: 0, usdAtStart: 1.25 })
  usage = { ...usage, cost: { usd: 3 } }
  await w.clock.advance(2000)
  expect((w.store.get('account') as any).usd).toBe(3)
  expect((w.store.get('usageMeter') as any).usdAtStart).toBe(1.25)          // set once
})

test('refresh: an unchanged account is not rewritten, and the meter start is set once', async ($, on) => {
  const w = world(on, { usage: { startedAt: 0, context: { window: 1 }, rateLimits: [], cost: { usd: 2 } } })
  await start($)
  await w.clock.advance(2000)
  await w.clock.advance(2000)
  expect(w.runs()).toBe(2)
  expect(w.sets['account']).toBe(1)
  expect(w.store.get('usageMeter')).toEqual({ weight: 0, usdAtStart: 2 })
})

test('refresh: a session.usage that refuses leaves the lanes alone and writes no account', async ($, on) => {
  const w = world(on, { usage: () => { throw new Error('no usage here') } })
  await start($)
  await w.clock.advance(2000)
  expect(fleetOf(w).lanes).toHaveLength(1)
  expect(w.store.get('account')).toBeUndefined()
})

test('turn.complete then refresh: a lane\'s share and dollars come out of the meter', async ($, on) => {
  let usd = 1
  const w = world(on, { agents: [orch('o1', 'running', 'CON-1'), sub('exec', 'o1')], session: 'me',
    usage: () => ({ startedAt: 0, context: { window: 1 }, rateLimits: [], cost: { usd } }) })
  await start($)
  await w.clock.advance(2000)                                   // matches o1 to CON-1, meter starts at $1
  expect(w.store.get('knownAgents')).toEqual({ 'CON-1': 'o1' })
  await ($ as any).turn.complete(turn({ agentId: 'exec' }))
  await ($ as any).turn.complete(turn())                        // the main loop, same weight
  usd = 3
  await w.clock.advance(2000)
  const lane = (w.store.get('laneUsage') as any)['CON-1']
  const meter = w.store.get('usageMeter') as any
  expect(laneShare(lane, meter)).toBe(0.5)
  expect(laneUsd(lane, meter, w.store.get('account') as any)).toBe(1)
})

test('refresh: with no session.usage answer the poll still writes lanes and no account', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.advance(2000)
  expect(fleetOf(w).lanes).toHaveLength(1)
  expect(w.store.get('account')).toBeUndefined()
})

// --- pane opening and polling ----------------------------------------------------------------------

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
  const w = world(on, { stdout: snap([]) })
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

test('only finished runs open no pane and back off to 15 s, yet still store the lanes', async ($, on) => {
  const w = world(on, { stdout: snap([{ ...RUN, status: 'done', endStatus: 'merged', endedAt: 0 }]) })
  await start($)
  await w.clock.advance(2000)
  expect(w.opened).toEqual([])
  expect(w.statuses.at(-1)).toBeUndefined()
  expect(fleetOf(w).lanes).toHaveLength(1)
  await w.clock.advance(13000)
  expect(w.runs()).toBe(1)
  await w.clock.advance(2000)
  expect(w.runs()).toBe(2)
})

test('regression: a quiet driverless run with no run.end opens no pane and backs off to 15 s', async ($, on) => {
  const w = world(on, { session: 'me', stdout: snap([{ ...RUN, timeline: [{ t: -31 * 60_000, kind: 'phase.enter' }] }]) })
  await start($)
  await w.clock.advance(2000)
  expect(w.opened).toEqual([])
  expect(fleetOf(w).lanes).toHaveLength(1)
  await w.clock.advance(13000)
  expect(w.runs()).toBe(1)
  await w.clock.advance(2000)
  expect(w.runs()).toBe(2)
  expect(w.opened).toEqual([])
})

test('a recently finished run is drawn yet opens no pane and backs off to 15 s', async ($, on) => {
  const w = world(on, { stdout: snap([{ ...RUN, status: 'failed', endStatus: 'failed', endedAt: 0 }]) })
  await start($)
  await w.clock.advance(2000)
  expect(w.opened).toEqual([])
  await w.clock.advance(13000)
  expect(w.runs()).toBe(1)
})

test('a live run opens the pane after a quiet one did not', async ($, on) => {
  let runs: object[] = [{ ...RUN, timeline: [{ t: -31 * 60_000, kind: 'phase.enter' }] }]
  const w = world(on, { stdout: async () => okRun(JSON.stringify({ ...SNAP, runs })) })
  await start($)
  await w.clock.advance(2000)
  expect(w.opened).toEqual([])
  runs = [{ ...RUN, timeline: [{ t: 2000, kind: 'phase.enter' }] }]
  await w.clock.advance(15000)
  expect(w.opened).toEqual([PANE])
})

test('regression: a re-dispatched orchestrator is remembered under its new id', async ($, on) => {
  let agents: AgentInfo[] = [orch('a1', 'killed', 'CON-1')]
  const w = world(on, { session: 'me', agents: () => agents })
  await start($)
  await w.clock.advance(2000)
  expect(w.store.get('knownAgents')).toEqual({ 'CON-1': 'a1' })
  agents = [orch('a2', 'running', 'CON-1')]
  await w.clock.advance(2000)
  expect(w.store.get('knownAgents')).toEqual({ 'CON-1': 'a2' })
  // Once it drops out of the list, the lane follows the new id, not the old one.
  agents = []
  await w.clock.advance(2000)
  expect(laneOf(w)).toMatchObject({ agent: 'stalled', agentId: 'a2' })
})

test('regression: a remembered orchestrator does not claim a run another session now drives', async ($, on) => {
  let driverSession: string | null = null
  const w = world(on, { session: 'me', agents: [orch('a', 'running', 'CON-1')], stdout: async () => okRun(JSON.stringify({ ...SNAP, runs: [{ ...RUN, driverSession }] })) })
  await start($)
  await w.clock.advance(2000)
  expect(laneOf(w)).toMatchObject({ driver: 'here', agent: 'running' })
  driverSession = 'them'
  await w.clock.advance(2000)
  expect(laneOf(w).driver).toBe('other')
  expect(laneOf(w).agent).toBeUndefined()
})

test("refresh: the second poll passes the previous poll's shown lanes as --tickets; quiet lanes are not requested", async ($, on) => {
  const stale = { ...RUN, ticket: 'CON-9', timeline: [{ t: -3_600_000 * 2, kind: 'phase.enter' }] }
  const w = world(on, { stdout: snap([RUN, stale]) })
  await start($)
  await w.clock.advance(2000)
  await w.clock.advance(2000)
  expect(w.argvs[0]).toEqual(['concertino', 'fleet', '--json'])
  expect(w.argvs[1]).toEqual(['concertino', 'fleet', '--json', '--tickets=CON-1'])
})

test('refresh: the selected lane is requested even when quiet or in a collapsed group', async ($, on) => {
  const stale = { ...RUN, ticket: 'CON-9', timeline: [{ t: -3_600_000 * 2, kind: 'phase.enter' }] }
  const done = { ...RUN, ticket: 'CON-5', status: 'done', endStatus: 'merged', endedAt: -90 * 60_000 }
  const w = world(on, { stdout: snap([RUN, stale, done]) })
  w.store.set('selected', 'CON-9')
  await start($)
  await w.clock.advance(2000)
  await w.clock.advance(2000)
  expect(w.argvs[1]).toEqual(['concertino', 'fleet', '--json', '--tickets=CON-1,CON-9'])
  w.store.set('selected', 'CON-5')
  await w.clock.advance(2000)
  expect(w.argvs[2]).toEqual(['concertino', 'fleet', '--json', '--tickets=CON-1,CON-5'])
})

test('refresh: an opened Done group requests its lanes', async ($, on) => {
  const done = { ...RUN, ticket: 'CON-5', status: 'done', endStatus: 'merged', endedAt: -90 * 60_000 }
  const w = world(on, { stdout: snap([RUN, done]) })
  w.store.set('openGroups', ['done'])
  await start($)
  await w.clock.advance(2000)
  await w.clock.advance(2000)
  expect(w.argvs[1]).toEqual(['concertino', 'fleet', '--json', '--tickets=CON-1,CON-5'])
})

// --- /fleet ------------------------------------------------------------------------------------------

test('/fleet opens the pane even with no runs', async ($, on) => {
  const w = world(on, { stdout: snap([]) })
  await start($)
  await $.command.run({ command: 'fleet', args: '' })
  expect(w.opened).toEqual([PANE])
})

test('/fleet says why the pane could not be placed', async ($, on) => {
  const w = world(on, { open: { isPlaced: false, reason: 'the terminal is 90 columns wide' } })
  await start($)
  const r: any = await $.command.run({ command: 'fleet', args: '' })
  expect(r.text).toBeUndefined()
  expect(w.logs[0]).toMatch(/not shown: the terminal is 90 columns wide/)
  expect(w.logs[0]).toMatch(/surfaces: terminal/)
})

test('/fleet opens the pane; /fleet off closes it', async ($, on) => {
  const w = world(on, { surfaces: ['terminal', 'desktop'] })
  await start($)
  w.opened.length = 0
  const r: any = await $.command.run({ command: 'fleet', args: '' })
  expect(r.text).toBeUndefined()
  expect(w.logs).toEqual([expect.stringMatching(/opened · surfaces: terminal, desktop/)])
  expect(w.opened).toEqual([PANE])
  const off: any = await $.command.run({ command: 'fleet', args: 'off' })
  expect(off.text).toBeUndefined()
  expect(w.logs.at(-1)).toBe('Fleet pane closed.')
  expect(w.closed).toEqual([PANE])
})

test('/fleet all toggles showAll through a single update and says which way', async ($, on) => {
  const w = world(on)
  await start($)
  const first: any = await $.command.run({ command: 'fleet', args: 'all' })
  expect(first.text).toBeUndefined()
  expect(w.logs[0]).toBe('Fleet pane: showing every lane.')
  const second: any = await $.command.run({ command: 'fleet', args: 'all' })
  expect(second.text).toBeUndefined()
  expect(w.logs[1]).toBe('Fleet pane: showing live and recent lanes.')
  expect(w.showAllSets).toEqual([true, false])
})

// --- Draft answer: the pane fills the prompt box --------------------------------------------------------

const ESC = {
  question: '', options: [], raisedAt: 0, escalationId: 'e1', role: 'skeptic', gate: 'design',
  subQuestions: [{ question: 'Which cache?', options: ['a) Map-based LRU', 'b) lru-cache'] }, { question: 'Scope?', options: ['1. both', '2. reads'] }],
}
const NEEDS = { ...RUN, ticket: 'SBX-4', status: 'needs-you', escalation: ESC }
const PANE_PROPS = { title: 'Fleet', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

function seedPane(w: ReturnType<typeof world>, picks: (string | null)[], note = '') {
  w.store.set('fleet', { lanes: [{ run: NEEDS, driver: 'here', agent: 'waiting' }], error: null, fingerprint: 'f', generatedAt: 0, root: '/r', project: 'sandbox' })
  w.store.set('selected', null)
  w.store.set('showAll', false)
  w.store.set('openGroups', [])
  w.store.set('drafts', { e1: { picks, note } })
}

for (const surface of ['terminal', 'desktop'] as const) {
  const mount = ($: any) => $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props: PANE_PROPS, requestId: PANE })

  test(`Draft answer fills the prompt box with the draft message, replacing it, then toasts (${surface})`, async ($, on) => {
    const w = world(on)
    seedPane(w, ['Map-based LRU', 'both'], 'keep it small')
    const ui = await mount($)
    await ui.press({ key: 'draft' })
    const expected = draftMessage('SBX-4', ESC as never, { picks: ['Map-based LRU', 'both'], note: 'keep it small' })
    expect(w.fills).toHaveLength(1)
    expect(w.fills[0]).toMatchObject({ text: expected, mode: 'replace', origin: { kind: 'plugin', name: 'concertino' } })
    expect(expected).toMatch(/^Answer SBX-4's skeptic escalation \(e1\):\n1\. Which cache\? → Map-based LRU\n2\. Scope\? → both\nNote: keep it small\n/)
    expect(w.toasts).toEqual(['Answer for SBX-4 is in the prompt box. Review it and press Enter.'])
    // The pane writes nothing: the draft is kept, so a cleared prompt box can be refilled.
    expect(w.store.get('drafts')).toEqual({ e1: { picks: ['Map-based LRU', 'both'], note: 'keep it small' } })
  })

  test(`Draft answer says so when the prompt box refuses (${surface})`, async ($, on) => {
    // A hook's own refusal reaches the caller without a cause: the site strips one a hook writes.
    const w = world(on, { fill: { isFilled: false, refusal: 'dialog' } })
    seedPane(w, ['Map-based LRU', 'both'])
    const ui = await mount($)
    await ui.press({ key: 'draft' })
    expect(w.fills).toHaveLength(1)
    expect(w.toasts).toEqual(["Couldn't fill the prompt box. Close any open dialog and try again."])
  })

  test(`Draft answer is not offered until every question is answered (${surface})`, async ($, on) => {
    const w = world(on)
    seedPane(w, ['Map-based LRU', null])
    const ui = await mount($)
    expect(await ui.find({ key: 'draft' })).toBeUndefined()
    expect(w.fills).toEqual([])
  })
}
