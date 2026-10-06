// hooks/fleet-pane/render.test.ts
import { test, expect, mock } from 'claude-code/testing'
import type { Lane, Run } from '../../types'

const PANE = { title: 'Fleet', isFocused: true, bodyColumns: 80, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {} }

const run = (over: Partial<Run>): Run => ({
  ticket: 'CON-1', changeName: 'thing', branch: 'feature/thing/CON-1', worktree: '/w/CON-1', phase: 'Execution', cycle: 1,
  gates: [{ name: 'a', status: 'pass', durationMs: null, firstError: null }, { name: 'b', status: 'fail', durationMs: null, firstError: null }],
  lastVerdict: null, escalation: null, costUsd: 1.84, startedAt: -12 * 60_000, endedAt: null, endStatus: null,
  elapsedMs: 12 * 60_000, status: 'unknown', malformed: 0, ticket_doc: { title: 'Add the thing', excerpt: 'Line one.\nLine two.' },
  pendingAnswer: null, timeline: [{ t: 0, kind: 'phase.enter', phase: 'Execution', cycle: 1 }], currentAgent: 'executor', ...over,
})
const lane = (over: Partial<Run>, liveness: Lane['liveness'] = 'running'): Lane => ({ run: run(over), liveness })

// The kit's `$` has no `state` noun, so state is seeded through hooks beneath the plugin.
type On = (name: any, fn: (...a: any[]) => any) => void
function seed(on: On, lanes: Lane[], error: string | null = null, selected: string | null = null) {
  const store = new Map<string, unknown>([
    ['fleet', { lanes, error, fingerprint: 'f', generatedAt: 0, root: '/r' }],
    ['selected', selected],
  ])
  on('state.get', async (_$: unknown, e: { key: string }) => ({ value: { value: store.get(e.key), version: 1 } }))
  on('state.set', async (_$: unknown, e: { key: string; value: unknown }) => { store.set(e.key, e.value); return { value: { isSet: true, version: 2 } } })
  mock.clock(on as never)
  return store
}

for (const surface of ['terminal', 'desktop'] as const) {
  const mount = ($: any, props: object = PANE) =>
    $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props, requestId: 'fleet' })

  test(`list: empty state names the runs dir (${surface})`, async ($, on) => {
    seed(on, [])
    const ui = await mount($)
    expect((await ui.find({ key: 'empty' }))?.text).toMatch(/No concertino runs under \/r\/\.concertino\/runs/)
  })

  test(`list: one row per lane with ticket, status, phase, cycle, gates, elapsed, agent (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'CON-231', status: 'needs-you', phase: 'Evaluation', cycle: 2, currentAgent: 'skeptic' }),
              lane({ ticket: 'CON-228' }), lane({ ticket: 'CON-219' }, 'external')])
    const ui = await mount($)
    const rows = await ui.findAll({ type: 'Button' })
    expect(rows.map((r: any) => r.key)).toEqual(['lane:CON-231', 'lane:CON-228', 'lane:CON-219'])
    expect(rows[0]?.text).toMatch(/CON-231\s+needs-you\s+Evaluation\s+c2\s+\S+ 1\/2\s+12m\s+skeptic/)
    expect(rows[2]?.text).toMatch(/external$/)
    expect((await ui.find({ key: 'header' }))?.text).toMatch(/2 running · 1 idle · 1 needs you/)
  })

  test(`list: stalled lane is labelled (${surface})`, async ($, on) => {
    seed(on, [lane({}, 'stalled')])
    const ui = await mount($)
    expect((await ui.find({ key: 'lane:CON-1' }))?.text).toMatch(/stalled/)
  })

  test(`list: pressing a row selects it (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'A' }), lane({ ticket: 'B' })])
    const ui = await mount($)
    await ui.press({ key: 'lane:B' })
    expect(store.get('selected')).toBe('B')
  })

  test(`list: an error line is drawn above stale lanes (${surface})`, async ($, on) => {
    seed(on, [lane({})], 'concertino: exit 127 command not found')
    const ui = await mount($)
    expect((await ui.find({ key: 'error' }))?.text).toMatch(/exit 127/)
    expect(await ui.find({ key: 'lane:CON-1' })).toBeDefined()
  })

  test(`list: truncates every row to bodyColumns (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'CON-123456', currentAgent: 'evaluator' })])
    const ui = await mount($, { ...PANE, bodyColumns: 40 })
    const row = await ui.find({ key: 'lane:CON-123456' })
    expect(row?.text.length).toBeLessThanOrEqual(38)
    expect(row?.text).not.toMatch(/\n/)
  })

  test(`list: marker is ▶ on the detail lane and ● on the others (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'A' }), lane({ ticket: 'B' }), lane({ ticket: 'C' })], null, 'B')
    const ui = await mount($)
    const markers = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text.trim()).filter((s: string) => s === '▶' || s === '●')
    expect(markers).toEqual(['●', '▶', '●'])
  })

  test(`list: first nine rows get hotkeys 1-9, the tenth none (${surface})`, async ($, on) => {
    seed(on, Array.from({ length: 10 }, (_, i) => lane({ ticket: 'T' + i })))
    const ui = await mount($)
    const rows = await ui.findAll({ type: 'Button' })
    expect(rows.map((r: any) => r.props?.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', undefined])
  })

  test(`list: dimColor for external/stalled/unknown, not for running needs-you (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'EXT', status: 'running' }, 'external'), lane({ ticket: 'STL', status: 'running' }, 'stalled'),
              lane({ ticket: 'UNK', status: 'unknown' }, 'ended'), lane({ ticket: 'NEED', status: 'needs-you' })])
    const ui = await mount($)
    const dim = async (k: string) => (await ui.find({ key: 'lane:' + k }))?.props?.dimColor
    expect(await dim('EXT')).toBe(true)
    expect(await dim('STL')).toBe(true)
    expect(await dim('UNK')).toBe(true)
    expect(await dim('NEED')).toBeFalsy()
  })

  test(`list: unknown status with a running agent reads running and is not dimmed (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'LIVE', status: 'unknown' }, 'running')])
    const ui = await mount($)
    const row = await ui.find({ key: 'lane:LIVE' })
    expect(row?.text).toMatch(/LIVE\s+running\s/)
    expect(row?.props?.dimColor).toBeFalsy()
  })

  test(`list: a needs-you lane whose agent ended is neither labelled stalled nor dimmed (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'NEED', status: 'needs-you' }, 'stalled')])
    const ui = await mount($)
    const row = await ui.find({ key: 'lane:NEED' })
    expect(row?.text).not.toMatch(/stalled/)
    expect(row?.props?.dimColor).toBeFalsy()
  })

  test(`list: header is truncated to bodyColumns (${surface})`, async ($, on) => {
    seed(on, Array.from({ length: 12 }, (_, i) => lane({ ticket: 'T' + i, status: i % 2 ? 'needs-you' : 'running' })))
    const ui = await mount($, { ...PANE, bodyColumns: 20 })
    const text = (await ui.find({ key: 'header' }))?.text ?? ''
    expect(text.length).toBeGreaterThan(0)
    expect(text.length).toBeLessThanOrEqual(20)
  })

  test(`detail: header, phase line, ticket excerpt, timeline tail, PR and cost (${surface})`, async ($, on) => {
    seed(on, [lane({ timeline: Array.from({ length: 12 }, (_, i) => ({ t: i * 60_000, kind: 'gate.result', gate: 'g' + i, status: 'pass' }))
      .concat([{ t: 13 * 60_000, kind: 'pr', url: 'https://github.com/x/y/pull/148', label: 'pr' }]) })])
    const ui = await mount($)
    const detail = await ui.find({ key: 'detail' })
    expect(detail?.text).toMatch(/CON-1\s+Add the thing\s+feature\/thing\/CON-1/)
    expect(detail?.text).toMatch(/Phase Execution · cycle 1 · agent running · worktree \/w\/CON-1/)
    expect((await ui.find({ key: 'ticket' }))?.text).toMatch(/Line one\.\s+Line two\./)
    const timeline = (await ui.find({ key: 'timeline' }))?.text ?? ''
    expect(timeline).toMatch(/g11/)
    expect(timeline).not.toMatch(/g3\b/)          // last 8 only
    expect(timeline).toMatch(/pr/)
    expect((await ui.find({ key: 'pr' }))?.text).toMatch(/https:\/\/github.com\/x\/y\/pull\/148.*\$1\.84/)
  })

  test(`detail: escalation block with lettered options and the recorded answer (${surface})`, async ($, on) => {
    seed(on, [lane({ status: 'needs-you',
      escalation: { question: 'Include unverifiable gates?', options: ['include', 'exclude', 'separate class'], raisedAt: 0, escalationId: 'e1', role: 'skeptic' },
      pendingAnswer: { answer: 'b' } })])
    const ui = await mount($)
    const esc = (await ui.find({ key: 'escalation' }))?.text ?? ''
    expect(esc).toMatch(/ESCALATION \(skeptic/)
    expect(esc).toMatch(/Include unverifiable gates\?/)
    expect(esc).toMatch(/a\) include\s+b\) exclude\s+c\) separate class/)
    expect(esc).toMatch(/answered: b/)
  })

  test(`detail: renders sub-questions when options are empty (${surface})`, async ($, on) => {
    seed(on, [lane({ status: 'needs-you',
      escalation: { question: 'Two decisions', options: [], raisedAt: 0, escalationId: 'e2', role: 'orchestrator',
        subQuestions: [{ question: 'Schema?', options: ['v1', 'v2'] }, { question: 'Flag?', options: ['on', 'off'] }] } })])
    const ui = await mount($)
    const esc = (await ui.find({ key: 'escalation' }))?.text ?? ''
    expect(esc).toMatch(/1\. Schema\?\s+a\) v1\s+b\) v2/)
    expect(esc).toMatch(/2\. Flag\?\s+a\) on\s+b\) off/)
    expect(esc).not.toMatch(/\ba\)\s*$/m)        // no empty top-level option line
  })

  test(`detail: follows view.agentId over the selection (${surface})`, async ($, on) => {
    seed(on, [{ ...lane({ ticket: 'A' }), agentId: 'ag-a' }, { ...lane({ ticket: 'B', ticket_doc: { title: 'Bee', excerpt: null } }), agentId: 'ag-b' }], null, 'A')
    const ui = await mount($, { ...PANE, view: { agentId: 'ag-b' } })
    expect((await ui.find({ key: 'detail' }))?.text).toMatch(/^B\s+Bee/)
    await ui.redraw(PANE)
    expect((await ui.find({ key: 'detail' }))?.text).toMatch(/^A\s+Add the thing/)
  })

  test(`detail: inline placement draws the list only (${surface})`, async ($, on) => {
    seed(on, [lane({})])
    const ui = await mount($, { ...PANE, placement: 'inline' })
    expect(await ui.find({ key: 'lane:CON-1' })).toBeDefined()
    expect(await ui.find({ key: 'detail' })).toBeUndefined()
  })
}
