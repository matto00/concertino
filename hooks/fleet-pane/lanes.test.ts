import { test, expect } from 'claude-code/testing'
import type { AgentInfo, SessionMessage } from 'claude-code'
import type { Run } from '../../types'
import { agentIdsByTicket, correlate, summarize, fingerprint, displayStatus } from './lanes'

const run = (over: Partial<Run>): Run => ({
  ticket: 'CON-1', changeName: null, branch: null, worktree: null, phase: null, cycle: null, gates: [],
  lastVerdict: null, escalation: null, costUsd: null, startedAt: null, endedAt: null, endStatus: null,
  elapsedMs: null, status: 'unknown', malformed: 0, ticket_doc: { title: null, excerpt: null },
  pendingAnswer: null, timeline: [], currentAgent: null, ...over,
})

const agentCall = (id: string, ticket: string): SessionMessage => ({
  role: 'assistant', text: '',
  toolUses: [{ tool_use_id: 'tu-' + id, tool: 'Agent', agentId: id,
    input: { subagent_type: 'concertino-orchestrator', description: 'deliver ' + ticket,
      prompt: `TICKET_ID=${ticket} AGENT_MERGE_OVERRIDE= SPEED=` } }],
})

const agent = (id: string, status: AgentInfo['status']): AgentInfo =>
  ({ id, description: 'd', type: 'concertino-orchestrator', status })

test('agentIdsByTicket: maps TICKET_ID in an Agent prompt to its agentId; newest Agent call wins for a ticket', async () => {
  const map = agentIdsByTicket([
    agentCall('a-old', 'CON-1'),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'x', tool: 'Bash', input: { command: 'echo TICKET_ID=CON-9' } }] },
    agentCall('a-new', 'CON-1'),
    agentCall('b', 'CON-2'),
  ])
  expect([...map.entries()]).toEqual([['CON-1', 'a-new'], ['CON-2', 'b']])
})

const promptCall = (id: string, prompt: string, subagent_type = 'concertino-orchestrator'): SessionMessage => ({
  role: 'assistant', text: '',
  toolUses: [{ tool_use_id: 'tu-' + id, tool: 'Agent', agentId: id, input: { subagent_type, prompt } }],
})

test('agentIdsByTicket: the real orchestrator prompt shapes all map', async () => {
  const map = agentIdsByTicket([
    promptCall('a', 'TICKET_ID=HEL-1027. AGENT_MERGE_OVERRIDE=1'),
    promptCall('b', 'TICKET_ID=`HEL-1028`. SPEED=fast'),
    promptCall('c', 'TICKET_ID: HEL-1029 go'),
  ])
  expect([...map.entries()]).toEqual([['HEL-1027', 'a'], ['HEL-1028', 'b'], ['HEL-1029', 'c']])
})

test('agentIdsByTicket: ignores Agent calls that are not the orchestrator', async () => {
  const map = agentIdsByTicket([promptCall('o', 'TICKET_ID=CON-1.'), promptCall('x', 'TICKET_ID=CON-1', 'Explore')])
  expect([...map.entries()]).toEqual([['CON-1', 'o']])
  expect([...agentIdsByTicket([promptCall('x', 'TICKET_ID=CON-1', 'Explore')]).keys()]).toEqual([])
})

test('correlate: a lower-case run ticket matches an upper-case TICKET_ID', async () => {
  const [lane] = correlate([run({ ticket: 'con-79' })], [agent('z', 'running')], agentIdsByTicket([promptCall('z', 'TICKET_ID=CON-79.')]))
  expect(lane).toMatchObject({ agentId: 'z', liveness: 'running' })
})

test('displayStatus: unknown with a running agent reads running, otherwise the run status', async () => {
  expect(displayStatus({ run: run({ status: 'unknown' }), liveness: 'running' })).toBe('running')
  expect(displayStatus({ run: run({ status: 'unknown' }), liveness: 'external' })).toBe('unknown')
  expect(displayStatus({ run: run({ status: 'failed' }), liveness: 'running' })).toBe('failed')
})

test('correlate: liveness is running for a live agent, external with no match, stalled when the agent ended but the run did not, ended when the run has a terminal run.end', async () => {
  const byTicket = new Map([['CON-1', 'a'], ['CON-3', 'c'], ['CON-4', 'd']])
  const lanes = correlate(
    [run({ ticket: 'CON-1' }), run({ ticket: 'CON-2' }), run({ ticket: 'CON-3' }),
     run({ ticket: 'CON-4', endStatus: 'failed', status: 'failed' })],
    [agent('a', 'running'), agent('c', 'completed'), agent('d', 'completed')],
    byTicket,
  )
  const by = Object.fromEntries(lanes.map(l => [l.run.ticket, l]))
  expect(by['CON-1']).toMatchObject({ agentId: 'a', agentStatus: 'running', liveness: 'running' })
  expect(by['CON-2']).toMatchObject({ liveness: 'external' })
  expect(by['CON-2'].agentId).toBeUndefined()
  expect(by['CON-3']).toMatchObject({ agentId: 'c', liveness: 'stalled' })
  expect(by['CON-4']).toMatchObject({ liveness: 'ended' })
})

test('correlate: a matched agentId missing from agent.list is external (the engine dropped its task)', async () => {
  const [lane] = correlate([run({})], [], new Map([['CON-1', 'gone']]))
  expect(lane).toMatchObject({ agentId: 'gone', liveness: 'external' })
  expect(lane?.agentStatus).toBeUndefined()
})

test('correlate: orders needs-you, then running/unknown, then failed; ties keep input order', async () => {
  const lanes = correlate([
    run({ ticket: 'F', status: 'failed' }), run({ ticket: 'U1', status: 'unknown' }),
    run({ ticket: 'N', status: 'needs-you' }), run({ ticket: 'R', status: 'running' }), run({ ticket: 'U2', status: 'unknown' }),
  ], [], new Map())
  expect(lanes.map(l => l.run.ticket)).toEqual(['N', 'U1', 'R', 'U2', 'F'])
})

test('summarize: running by liveness, idle for the rest, needs-you; undefined with no lanes', async () => {
  expect(summarize([])).toBeUndefined()
  const lanes = correlate([
    run({ ticket: 'A', status: 'needs-you' }), run({ ticket: 'B' }), run({ ticket: 'C' }),
  ], [agent('b', 'running')], new Map([['B', 'b']]))
  expect(summarize(lanes)).toBe('fleet: 1 running · 1 idle · 1 needs you')
})

test('summarize: idle and failed; running is always shown', async () => {
  const lanes = correlate([run({ ticket: 'A' }), run({ ticket: 'B', status: 'failed' })], [], new Map())
  expect(summarize(lanes)).toBe('fleet: 0 running · 1 idle · 1 failed')
})

test('fingerprint: stable across identical input, changes on phase, escalation, liveness, answer', async () => {
  const base = correlate([run({ phase: 'Planning' })], [], new Map())
  expect(fingerprint(base, null)).toBe(fingerprint(correlate([run({ phase: 'Planning' })], [], new Map()), null))
  expect(fingerprint(correlate([run({ phase: 'Execution' })], [], new Map()), null)).not.toBe(fingerprint(base, null))
  expect(fingerprint(correlate([run({ phase: 'Planning', pendingAnswer: { answer: 'a' } })], [], new Map()), null)).not.toBe(fingerprint(base, null))
  expect(fingerprint(base, 'boom')).not.toBe(fingerprint(base, null))
})
