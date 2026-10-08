// hooks/fleet-pane/render.test.ts
import { test, expect, mock } from 'claude-code/testing'
import type { AnswerDraft, Escalation, Lane, Run } from '../../types'
import { unseenComments } from './render'

const NOW = 10 * 3_600_000
const MIN = 60_000

const PANE = { title: 'Fleet', isFocused: true, bodyColumns: 80, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {} }

const run = (over: Partial<Run>): Run => ({
  ticket: 'CON-1', changeName: 'thing', branch: 'feature/thing/CON-1', worktree: '/w/CON-1', phase: 'Execution', cycle: 2,
  gates: [], lastVerdict: null, escalation: null, costUsd: 1.84, startedAt: NOW - 12 * MIN, endedAt: null, endStatus: null,
  elapsedMs: 12 * MIN, status: 'running', malformed: 0, ticket_doc: { title: 'Add the thing', excerpt: 'Line one.\nLine two.' },
  pendingAnswer: null, timeline: [{ t: NOW - MIN, kind: 'phase.enter', phase: 'Execution', cycle: 2 }], currentAgent: 'executor',
  ticket_meta: null, ticket_meta_error: null, ...over,
})
const lane = (over: Partial<Run>, driver: Lane['driver'] = 'here', agent: Lane['agent'] | null = 'running'): Lane =>
  ({ run: run(over), driver, ...(agent && driver === 'here' ? { agent } : {}) })

const ESC: Escalation = {
  question: '', options: [], raisedAt: NOW - 7 * MIN, escalationId: 'e1', role: 'skeptic', gate: 'design', context: 'We need a cache.',
  subQuestions: [{ question: 'Which cache?', options: ['a) Map-based LRU', '(b) lru-cache package'] }, { question: 'Scope?', options: ['1. both', '2. reads only'] }],
}
const needs = (over: Partial<Run> = {}): Lane => lane({ ticket: 'SBX-4', status: 'needs-you', escalation: ESC, ...over })

type Seed = { selected?: string | null; showAll?: boolean; openGroups?: string[]; drafts?: Record<string, AnswerDraft>; error?: string | null; project?: string; detailTab?: 'overview' | 'ticket' | 'activity' | 'comments'; seenComments?: Record<string, number>
  laneUsage?: Record<string, { tokens: number; weight: number; turns: number }>; usageMeter?: { weight: number; usdAtStart: number | null }
  account?: { rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]; usd: number | null } | null }

// The kit's `$` has no `state` noun of its own here, so state is seeded through hooks beneath the plugin.
type On = (name: any, fn: (...a: any[]) => any) => void
function seed(on: On, lanes: Lane[], s: Seed = {}) {
  const store = new Map<string, unknown>([
    ['fleet', { lanes, error: s.error ?? null, fingerprint: 'f', generatedAt: 0, root: '/r', project: s.project ?? 'sandbox' }],
    ['selected', s.selected ?? null], ['showAll', s.showAll ?? false], ['openGroups', s.openGroups ?? []], ['drafts', s.drafts ?? {}], ['detailTab', s.detailTab ?? 'overview'], ['seenComments', s.seenComments ?? {}],
    ['laneUsage', s.laneUsage ?? {}], ['usageMeter', s.usageMeter ?? { weight: 0, usdAtStart: null }], ['account', s.account ?? null],
  ])
  on('state.get', async (_$: unknown, e: { key: string }) => ({ value: { value: store.get(e.key), version: 1 } }))
  on('state.set', async (_$: unknown, e: { key: string; value: unknown }) => { store.set(e.key, e.value); return { value: { isSet: true, version: 2 } } })
  mock.clock(on as never, { now: NOW })
  return store
}

for (const surface of ['terminal', 'desktop'] as const) {
  const mount = ($: any, props: object = PANE) =>
    $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props, requestId: 'fleet' })
  const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })) as { text: string; props: Record<string, unknown>; key?: string }[]
  const textOf = async (ui: any, key: string) => (await ui.find({ key }))?.text as string | undefined

  // ── header ───────────────────────────────────────────────────────────────────────────────────

  test(`header: project name, "fleet" and coloured count chips, zero counts omitted (${surface})`, async ($, on) => {
    seed(on, [needs(), lane({ ticket: 'R' }), lane({ ticket: 'O' }, 'other'), lane({ ticket: 'F', status: 'failed' }, 'none'),
      lane({ ticket: 'I', timeline: [{ t: NOW - 60 * MIN, kind: 'phase.enter' }] }, 'none')], { project: 'concertino-sandbox' })
    const ui = await mount($)
    const header = (await ui.find({ key: 'header' }))!
    expect(header).toBeDefined()
    const all = await texts(ui)
    const t = (s: string) => all.find(x => x.text === s)
    expect(t('concertino-sandbox')?.props).toMatchObject({ bold: true, color: 'claude' })
    expect(t('fleet')?.props?.dimColor).toBe(true)
    expect(t('1 needs you')?.props?.color).toBe('warning')
    expect(t('2 running')?.props?.color).toBe('success')
    expect(t('1 idle')?.props?.color).toBe('subtle')
    expect(t('1 failed')?.props?.color).toBe('error')
    // Exactly these pieces, in this order: no zero chips (stalled, done).
    expect(header.text).toBe('concertino-sandboxfleet1 needs you2 running1 idle1 failed')
  })

  test(`header: no project falls back to "concertino"; showAll says "fleet · all" (${surface})`, async ($, on) => {
    seed(on, [lane({})], { project: '', showAll: true })
    const ui = await mount($)
    const all = await texts(ui)
    expect(all.some(x => x.text === 'concertino' && x.props.color === 'claude')).toBe(true)
    expect(all.some(x => x.text === 'fleet · all')).toBe(true)
  })

  test(`empty: no runs names the runs dir; an error is drawn above the lanes (${surface})`, async ($, on) => {
    seed(on, [])
    const ui = await mount($)
    expect(await textOf(ui, 'empty')).toMatch(/No concertino runs under \/r\/\.concertino\/runs/)
  })

  test(`error: drawn while the last lanes stay (${surface})`, async ($, on) => {
    seed(on, [lane({})], { error: 'concertino: exit 127 command not found' })
    const ui = await mount($)
    expect(await textOf(ui, 'error')).toMatch(/exit 127/)
    expect(await ui.find({ key: 'lane:CON-1' })).toBeDefined()
    expect(await ui.find({ key: 'empty' })).toBeUndefined()
  })

  // ── groups ───────────────────────────────────────────────────────────────────────────────────

  test(`groups: labelled and ordered Needs you, Driven here, Other sessions, No driver session, Failed, Done (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'D', status: 'done', endedAt: NOW - 90 * MIN }, 'none'), lane({ ticket: 'F', status: 'failed', endedAt: NOW - 90 * MIN }, 'other'),
      lane({ ticket: 'X' }, 'none'), lane({ ticket: 'O' }, 'other'), lane({ ticket: 'H' }), needs()])
    const ui = await mount($)
    const boxes = (await ui.findAll({ type: 'Box' })).map((b: any) => b.key).filter((k: unknown) => typeof k === 'string' && k.startsWith('g:'))
    expect(boxes).toEqual(['g:needs', 'g:here', 'g:other', 'g:none', 'g:failed', 'g:done'])
    const all = await texts(ui)
    // One lane and nothing quiet: the label alone.
    for (const label of ['Needs you', 'Driven here', 'Other sessions', 'No driver session']) {
      expect(all.find(x => x.text === label)?.props?.dimColor).toBe(true)
    }
    // Only older finished lanes: a collapsed toggle, no rows.
    expect((await ui.find({ key: 'group:failed' }))?.props?.label).toBe('▸ Failed · 1')
    expect((await ui.find({ key: 'group:done' }))?.props?.label).toBe('▸ Done · 1')
    const rows = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key).filter((k: string) => k.startsWith('lane:'))
    expect(rows).toEqual(['lane:SBX-4', 'lane:H', 'lane:O', 'lane:X'])
  })

  test(`groups: a head counts its lanes when there are several (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'H1' }), lane({ ticket: 'H2' }), lane({ ticket: 'O' }, 'other')])
    const ui = await mount($)
    const all = await texts(ui)
    expect(all.some(x => x.text === 'Driven here · 2')).toBe(true)
    expect(all.some(x => x.text === 'Other sessions')).toBe(true)
  })

  test(`groups: quiet lanes of other sessions are counted in the group label (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'O' }, 'other'), lane({ ticket: 'OLD', timeline: [{ t: NOW - 31 * MIN, kind: 'phase.enter' }] }, 'other'),
      lane({ ticket: 'Q', timeline: [{ t: NOW - 31 * MIN, kind: 'phase.enter' }] }, 'none')])
    const ui = await mount($)
    const all = await texts(ui)
    expect(all.some(x => x.text === 'Other sessions · 2 (+1 quiet)')).toBe(true)
    // A group of quiet lanes only still stands, to carry the count.
    expect(all.some(x => x.text === 'No driver session · 1 (+1 quiet)')).toBe(true)
    expect(await ui.find({ key: 'lane:OLD' })).toBeUndefined()
    expect(await ui.find({ key: 'lane:Q' })).toBeUndefined()
  })

  test(`groups: recently finished lanes are drawn as rows under a plain head, no toggle (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'D', status: 'done', endedAt: NOW - 3 * MIN }, 'none'), lane({ ticket: 'F', status: 'failed', endedAt: NOW - 3 * MIN }, 'none')])
    const ui = await mount($)
    expect(await ui.find({ key: 'lane:D' })).toBeDefined()
    expect(await ui.find({ key: 'lane:F' })).toBeDefined()
    expect(await ui.find({ key: 'group:done' })).toBeUndefined()
    expect(await ui.find({ key: 'group:failed' })).toBeUndefined()
    const all = await texts(ui)
    expect(all.some(x => x.text === 'Done')).toBe(true)
    expect(all.some(x => x.text === 'Failed')).toBe(true)
  })

  test(`groups: pressing the Done toggle draws the older lanes too, pressing again hides them (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'H' }), lane({ ticket: 'NEW', status: 'done', endedAt: NOW - 3 * MIN }, 'none'),
      lane({ ticket: 'OLD', status: 'done', endedAt: NOW - 90 * MIN }, 'none')])
    const ui = await mount($)
    expect((await ui.find({ key: 'group:done' }))?.props?.label).toBe('▸ Done · 2')
    expect(await ui.find({ key: 'lane:NEW' })).toBeDefined()
    expect(await ui.find({ key: 'lane:OLD' })).toBeUndefined()
    await ui.press({ key: 'group:done' })
    expect(store.get('openGroups')).toEqual(['done'])
    await ui.redraw(PANE)
    expect((await ui.find({ key: 'group:done' }))?.props?.label).toBe('▾ Done · 2')
    expect(await ui.find({ key: 'lane:OLD' })).toBeDefined()
    await ui.press({ key: 'group:done' })
    expect(store.get('openGroups')).toEqual([])
    await ui.redraw(PANE)
    expect(await ui.find({ key: 'lane:OLD' })).toBeUndefined()
  })

  test(`groups: showAll draws every finished lane with no toggle (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'D', status: 'done', endedAt: NOW - 90 * MIN }, 'none'), lane({ ticket: 'F', status: 'failed', endedAt: NOW - 90 * MIN }, 'none')], { showAll: true })
    const ui = await mount($)
    expect(await ui.find({ key: 'lane:D' })).toBeDefined()
    expect(await ui.find({ key: 'lane:F' })).toBeDefined()
    expect(await ui.find({ key: 'group:done' })).toBeUndefined()
  })

  // ── rows ─────────────────────────────────────────────────────────────────────────────────────

  test(`rows: the tail says "waiting Nm" for needs-you, "N ago" for done, phase cN · time for running (${surface})`, async ($, on) => {
    seed(on, [needs(), lane({ ticket: 'R' }), lane({ ticket: 'D', status: 'done', endedAt: NOW - 3 * MIN }, 'none')], { openGroups: ['done'] })
    const ui = await mount($)
    expect(await textOf(ui, 'row:SBX-4')).toMatch(/waiting 7m$/)
    expect(await textOf(ui, 'row:D')).toMatch(/3m ago$/)
    expect(await textOf(ui, 'row:R')).toMatch(/Execution c2 · 12m$/)
    const tail = (await texts(ui)).find(x => x.text === 'waiting 7m')
    expect(tail?.props?.color).toBe('warning')
  })

  test(`rows: pressing a row selects it; the first nine rows get hotkeys (${surface})`, async ($, on) => {
    const store = seed(on, Array.from({ length: 10 }, (_, i) => lane({ ticket: 'T' + i })))
    const ui = await mount($)
    const rows = (await ui.findAll({ type: 'Button' })).filter((b: any) => b.key.startsWith('lane:'))
    expect(rows.map((r: any) => r.props?.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', undefined])
    await ui.press({ key: 'lane:T3' })
    expect(store.get('selected')).toBe('T3')
  })

  test(`rows: the detail lane is marked ▸, the others carry their state dot (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'A' }), lane({ ticket: 'B' }), lane({ ticket: 'C' }, 'here', 'stalled')], { selected: 'B' })
    const ui = await mount($)
    const marker = async (t: string) => (await ui.find({ key: 'row:' + t }))?.children?.[0] as any
    expect((await marker('A'))?.props?.color).toBe('success')
    expect((await textOf(ui, 'row:B'))?.startsWith('▸')).toBe(true)
    expect((await marker('C'))?.props?.color).toBe('error')
  })

  test(`rows: the title shows at WIDE columns and drops below; the phase drops below NARROW (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'R' })])
    const wide = await mount($, { ...PANE, bodyColumns: 48 })
    expect(await textOf(wide, 'row:R')).toMatch(/Add the thing/)
    await wide.redraw({ ...PANE, bodyColumns: 47 })
    expect(await textOf(wide, 'row:R')).not.toMatch(/Add the thing/)
    expect(await textOf(wide, 'row:R')).toMatch(/Execution c2 · 12m$/)
    await wide.redraw({ ...PANE, bodyColumns: 31 })
    expect(await textOf(wide, 'row:R')).not.toMatch(/Execution/)
    expect(await textOf(wide, 'row:R')).toMatch(/12m$/)
  })

  test(`rows: idle and done rows are dimmed, live ones are not (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'R' }), lane({ ticket: 'I' }, 'here', 'unseen'), lane({ ticket: 'D', status: 'done' }, 'none'), needs()],
      { openGroups: ['done'], selected: 'R' })
    const ui = await mount($)
    const dim = async (k: string) => (await ui.find({ key: 'lane:' + k }))?.props?.dimColor
    expect(await dim('I')).toBe(true)
    expect(await dim('D')).toBe(true)
    expect(await dim('R')).toBeFalsy()
    expect(await dim('SBX-4')).toBeFalsy()
  })

  // ── detail ───────────────────────────────────────────────────────────────────────────────────

  test(`detail: title row with ticket, title and PR link; meta row with branch, cost and elapsed (${surface})`, async ($, on) => {
    seed(on, [lane({ prUrl: 'https://github.com/x/y/pull/148' })])
    const ui = await mount($)
    expect(await textOf(ui, 'detail-header')).toMatch(/CON-1.*Add the thing.*PR #148/)
    const link = (await ui.findAll({ type: 'Link' })).find((l: any) => l.props?.href === 'https://github.com/x/y/pull/148')
    expect(link?.props?.label).toBe('PR #148')
    expect((await ui.find({ type: 'Text', text: /feature\/thing\/CON-1 · driven here/ }))?.text)
      .toBe('feature/thing/CON-1 · driven here · orchestrator running · $1.84 · 12m')
  })

  test(`detail: a PR from the timeline is linked when the run carries no prUrl (${surface})`, async ($, on) => {
    seed(on, [lane({ timeline: [{ t: NOW - MIN, kind: 'pr', url: 'https://github.com/x/y/pull/7' }] })])
    const ui = await mount($)
    expect((await ui.findAll({ type: 'Link' })).some((l: any) => l.props?.href === 'https://github.com/x/y/pull/7')).toBe(true)
  })

  test(`detail: the driver and agent fact in words (${surface})`, async ($, on) => {
    const store = seed(on, [
      lane({ ticket: 'HW' }, 'here', 'waiting'), lane({ ticket: 'HS' }, 'here', 'stalled'), lane({ ticket: 'HU' }, 'here', 'unseen'),
      lane({ ticket: 'O' }, 'other'), lane({ ticket: 'N' }, 'none'), lane({ ticket: 'E', status: 'done', endStatus: 'merged' }, 'here', null),
    ])
    const ui = await mount($)
    const words: [string, string][] = [
      ['HW', 'driven here · orchestrator waiting'], ['HS', 'driven here · orchestrator stopped'],
      ['HU', 'driven here · no orchestrator found here'], ['O', 'driven by another session'],
      ['N', 'no driver session recorded'], ['E', 'finished · merged'],
    ]
    for (const [ticket, said] of words) {
      store.set('selected', ticket)
      await ui.redraw(PANE)
      expect(await textOf(ui, 'detail-header')).toMatch(new RegExp('^' + ticket))
      expect((await ui.find({ type: 'Text', text: /^feature\// }))?.text).toBe(`feature/thing/CON-1 · ${said} · $1.84 · 12m`)
    }
  })

  test(`detail: the stepper marks done, current and pending phases; initials below 60 columns (${surface})`, async ($, on) => {
    seed(on, [lane({ phase: 'Execution' })])
    const ui = await mount($)
    // Text elements carry no key in the found tree, so the six cells are read by their glyph and order.
    const cell = async (i: number) => (await ui.findAll({ type: 'Text', text: /^[✓●○] / }))[i]!
    expect((await cell(0)).text).toBe('✓ Setup')
    expect((await cell(0)).props.color).toBe('success')
    expect((await cell(1)).text).toBe('✓ Plan')
    expect((await cell(2)).text).toBe('● Execute')
    expect((await cell(2)).props).toMatchObject({ color: 'suggestion', bold: true })
    expect((await cell(3)).text).toBe('○ Evaluate')
    expect((await cell(3)).props.dimColor).toBe(true)
    expect((await cell(5)).text).toBe('○ Cleanup')
    await ui.redraw({ ...PANE, bodyColumns: 59 })
    expect((await cell(2)).text).toBe('● E')
    expect((await cell(4)).text).toBe('○ D')
  })

  test(`detail: the stepper's current cell is warning for needs-you; an ended run is all done (${surface})`, async ($, on) => {
    const store = seed(on, [needs({ phase: 'Planning' }), lane({ ticket: 'E', status: 'done', endStatus: 'merged', phase: 'Delivery' }, 'none')])
    const ui = await mount($)
    const cells = async () => ui.findAll({ type: 'Text', text: /^[✓●○] / })
    expect((await cells())[1]?.text).toBe('● Plan')
    expect((await cells())[1]?.props).toMatchObject({ color: 'warning', bold: true })
    store.set('selected', 'E')
    await ui.redraw(PANE)
    expect((await cells()).map((c: any) => c.text)).toEqual(['✓ Setup', '✓ Plan', '✓ Execute', '✓ Evaluate', '✓ Deliver', '✓ Cleanup'])
  })

  // ── escalation card ──────────────────────────────────────────────────────────────────────────

  test(`escalation: title, age, context, numbered questions and stripped options as buttons (${surface})`, async ($, on) => {
    seed(on, [needs()])
    const ui = await mount($)
    const card = (await textOf(ui, 'escalation'))!
    expect(card).toMatch(/Skeptic needs a design call/)
    expect(card).toMatch(/7m ago/)
    expect(card).toMatch(/We need a cache\./)
    expect(card).toMatch(/1\. Which cache\?/)
    expect(card).toMatch(/2\. Scope\?/)
    const labels = (await ui.findAll({ type: 'Button' })).filter((b: any) => b.key.startsWith('opt:')).map((b: any) => [b.key, b.props.label])
    expect(labels).toEqual([
      ['opt:0:0', '○ Map-based LRU'], ['opt:0:1', '○ lru-cache package'], ['opt:1:0', '○ both'], ['opt:1:1', '○ reads only'],
    ])
    expect(await ui.find({ key: 'draft' })).toBeUndefined()
    expect(await textOf(ui, 'esc-actions')).toMatch(/0 of 2 answered/)
  })

  test(`escalation: pressing an option picks it; pressing it again clears it (${surface})`, async ($, on) => {
    const store = seed(on, [needs()])
    const ui = await mount($)
    await ui.press({ key: 'opt:0:1' })
    expect(store.get('drafts')).toEqual({ e1: { picks: ['lru-cache package', null], note: '' } })
    await ui.redraw(PANE)
    expect((await ui.find({ key: 'opt:0:1' }))?.props?.label).toBe('◉ lru-cache package')
    expect((await ui.find({ key: 'opt:0:0' }))?.props?.dimColor).toBe(true)
    expect(await textOf(ui, 'esc-actions')).toMatch(/1 of 2 answered/)
    await ui.press({ key: 'opt:0:1' })
    expect(store.get('drafts')).toEqual({ e1: { picks: [null, null], note: '' } })
  })

  test(`escalation: a draft for an escalation no lane carries is dropped on the next pick (${surface})`, async ($, on) => {
    const store = seed(on, [needs()], { drafts: { gone: { picks: ['x'], note: '' } } })
    const ui = await mount($)
    await ui.press({ key: 'opt:1:0' })
    expect(store.get('drafts')).toEqual({ e1: { picks: [null, 'both'], note: '' } })
  })

  test(`escalation: the note Input writes the draft's note (${surface})`, async ($, on) => {
    const store = seed(on, [needs()])
    const ui = await mount($)
    await ui.input({ key: 'note', text: 'keep it small', kind: 'change' })
    expect(store.get('drafts')).toEqual({ e1: { picks: [null, null], note: 'keep it small' } })
  })

  test(`escalation: a free-text question gets an Input whose text is its answer (${surface})`, async ($, on) => {
    const store = seed(on, [needs({ escalation: { ...ESC, subQuestions: [{ question: 'Why?', options: [] }] } })])
    const ui = await mount($)
    await ui.input({ key: 'free:0', text: 'because' })
    expect(store.get('drafts')).toEqual({ e1: { picks: ['because'], note: '' } })
  })

  test(`escalation: once every question is answered the Draft answer button replaces the count (${surface})`, async ($, on) => {
    seed(on, [needs()], { drafts: { e1: { picks: ['Map-based LRU', 'both'], note: '' } } })
    const ui = await mount($)
    const draft = await ui.find({ key: 'draft' })
    expect(draft?.props).toMatchObject({ label: 'Draft answer', hotkey: 'd', variant: 'primary' })
    expect(await textOf(ui, 'esc-actions')).not.toMatch(/answered/)
    expect(await textOf(ui, 'esc-actions')).toMatch(/Ready/)
  })

  test(`escalation: a single question with its options, no sub-questions, is not numbered (${surface})`, async ($, on) => {
    seed(on, [needs({ escalation: { question: 'Include unverifiable gates?', options: ['a) include', 'b) exclude'], raisedAt: NOW, escalationId: 'e2', role: null } })])
    const ui = await mount($)
    const card = (await textOf(ui, 'escalation'))!
    expect(card).toMatch(/An agent needs you/)
    expect(card).toMatch(/Include unverifiable gates\?/)
    expect(card).not.toMatch(/1\. Include/)
    expect((await ui.find({ key: 'opt:0:1' }))?.props?.label).toBe('○ exclude')
    expect(await textOf(ui, 'esc-actions')).toMatch(/0 of 1 answered/)
  })

  test(`escalation: a pending answer hides the options, note and draft and says it is answered (${surface})`, async ($, on) => {
    seed(on, [needs({ pendingAnswer: { answer: 'b' } })], { drafts: { e1: { picks: ['Map-based LRU', 'both'], note: '' } } })
    const ui = await mount($)
    expect(await textOf(ui, 'escalation')).toMatch(/Answered\. Waiting for the orchestrator/)
    expect((await ui.findAll({ type: 'Button' })).filter((b: any) => b.key.startsWith('opt:'))).toEqual([])
    expect(await ui.find({ key: 'draft' })).toBeUndefined()
    expect(await ui.find({ key: 'esc-actions' })).toBeUndefined()
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
  })

  // ── gates, ticket, recent ────────────────────────────────────────────────────────────────────

  test(`gates: one chip per gate coloured by status; the failing gate's first error under them (${surface})`, async ($, on) => {
    seed(on, [lane({ phase: null, gates: [
      { name: 'phase:design', status: 'pass', durationMs: null, firstError: null },
      { name: 'lint', status: 'fail', durationMs: null, firstError: 'src/a.ts:3 unused import' },
      { name: 'test', status: 'pending', durationMs: null, firstError: null },
    ] })])
    const ui = await mount($)
    // With no phase the stepper draws only ○ cells, so the ✓/✕/… Texts are the gate chips, in order.
    const chip = async (i: number) => (await ui.findAll({ type: 'Text', text: /^[✓✕…] / }))[i]!
    expect((await chip(0)).text).toBe('✓ design')
    expect((await chip(0)).props.color).toBe('success')
    expect((await chip(1)).text).toBe('✕ lint')
    expect((await chip(1)).props.color).toBe('error')
    expect((await chip(2)).text).toBe('… test')
    expect((await chip(2)).props.color).toBe('subtle')
    expect(await textOf(ui, 'gates')).toMatch(/src\/a\.ts:3 unused import/)
  })

  test(`gates: no gates, no block (${surface})`, async ($, on) => {
    seed(on, [lane({ gates: [] })])
    const ui = await mount($)
    expect(await ui.find({ key: 'gates' })).toBeUndefined()
  })

  test(`recent: humanised events, consecutive evidence folded, the last six only (${surface})`, async ($, on) => {
    seed(on, [lane({ timeline: [
      { t: NOW - 20 * MIN, kind: 'run.start' },
      { t: NOW - 19 * MIN, kind: 'phase.enter', phase: 'Setup', cycle: 1 },
      { t: NOW - 18 * MIN, kind: 'phase.enter', phase: 'Planning', cycle: 1 },
      { t: NOW - 10 * MIN, kind: 'evidence', label: 'design.md' },
      { t: NOW - 9 * MIN, kind: 'evidence', label: 'plan.md' },
      { t: NOW - 8 * MIN, kind: 'verdict', role: 'skeptic', verdict: 'ESCALATION', gate: 'design' },
      { t: NOW - 7 * MIN, kind: 'gate.result', gate: 'phase:design', status: 'fail' },
      { t: NOW - 6 * MIN, kind: 'phase.enter', phase: 'Execution', cycle: 2 },
      { t: NOW - 5 * MIN, kind: 'pr', url: 'https://github.com/x/y/pull/1' },
    ] })])
    const ui = await mount($)
    const tl = (await textOf(ui, 'timeline'))!
    expect(tl).toMatch(/^Recent/)
    expect(tl).not.toMatch(/run started/)
    expect(tl).not.toMatch(/Setup started/)
    expect(tl).toMatch(/Planning started/)
    expect(tl).toMatch(/evidence: design\.md, plan\.md/)
    expect(tl).toMatch(/skeptic: ESCALATION \(design\)/)
    expect(tl).toMatch(/gate design fail/)
    expect(tl).toMatch(/Execution started \(cycle 2\)/)
    expect(tl).toMatch(/PR opened/)
    const all = await texts(ui)
    expect(all.find(x => x.text === 'skeptic: ESCALATION (design)')?.props?.color).toBe('warning')
    expect(all.find(x => x.text === 'gate design fail')?.props?.color).toBe('error')
    expect(all.find(x => x.text === 'PR opened')?.props?.color).toBe('merged')
  })

  // ── detail tabs ──────────────────────────────────────────────────────────────────────────────

  const DESC = [
    '## Description', '', 'Add an LRU cache', 'in front of the store.', '', 'More detail.', '',
    '## Acceptance criteria', '- [x] Hits are served from memory', '- [ ] Misses fall through', '', '## Notes', 'Behind a flag.',
  ].join('\n')
  const META = {
    fetchedAt: NOW - 2 * MIN, id: 'u', identifier: 'CON-1', title: 'Linear title', description: DESC, url: 'https://linear.app/x/CON-1',
    state: { name: 'In Progress', type: 'started' }, assignee: 'Matt', priority: 2, estimate: 3, labels: ['perf'], epic: 'Caching',
    source: 'linear' as const, commentsTruncated: false,
    comments: [{ id: 'c1', author: 'Ann', body: 'First', createdAt: NOW - 5 * MIN }, { id: 'c2', author: 'Bob', body: 'Second', createdAt: NOW - MIN }],
  }
  const tabBtn = async (ui: any, t: string) => (await ui.find({ key: `tab:${t}` }))!

  test(`tabs: Overview, Ticket, Activity and Comments buttons with hotkeys; the active one is not dimmed (${surface})`, async ($, on) => {
    seed(on, [lane({})])
    const ui = await mount($)
    const tabs = (await ui.findAll({ type: 'Button' })).filter((b: any) => b.key.startsWith('tab:'))
    expect(tabs.map((b: any) => [b.key, b.props.label, b.props.hotkey, !!b.props.dimColor])).toEqual([
      ['tab:overview', 'Overview', 'o', false], ['tab:ticket', 'Ticket', 't', true],
      ['tab:activity', 'Activity', 'a', true], ['tab:comments', 'Comments', 'c', true],
    ])
    expect(await ui.find({ key: 'stepper' })).toBeDefined()
  })

  test(`tabs: pressing a tab switches the detail body (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket_meta: META })])
    const ui = await mount($)
    await ui.press({ key: 'tab:ticket' })
    expect(store.get('detailTab')).toBe('ticket')
    await ui.redraw(PANE)
    expect((await tabBtn(ui, 'ticket')).props.dimColor).toBeFalsy()
    expect((await tabBtn(ui, 'overview')).props.dimColor).toBe(true)
    expect(await ui.find({ key: 'stepper' })).toBeUndefined()
    expect(await ui.find({ key: 'ticket-body' })).toBeDefined()
    await ui.press({ key: 'tab:activity' })
    expect(store.get('detailTab')).toBe('activity')
    await ui.redraw(PANE)
    expect(await ui.find({ key: 'ticket-body' })).toBeUndefined()
    expect(await ui.find({ key: 'span:0' })).toBeDefined()
    await ui.press({ key: 'tab:overview' })
    expect(store.get('detailTab')).toBe('overview')
  })

  test(`overview: the Ticket block has chips, the summary and a button to the Ticket tab (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket_meta: META })])
    const ui = await mount($)
    const block = (await textOf(ui, 'ticket-summary'))!
    expect(block).toMatch(/^Ticket/)
    expect(block).toMatch(/In Progress/)
    expect(block).toMatch(/Add an LRU cache in front of the store\./)
    expect(block).not.toMatch(/More detail/)
    expect((await ui.find({ key: 'to-ticket' }))?.props?.label).toBe('2 acceptance criteria · 2 comments · full ticket')
    expect(await ui.find({ key: 'ticket-chips' })).toBeDefined()
    await ui.press({ key: 'to-ticket' })
    expect(store.get('detailTab')).toBe('ticket')
  })

  test(`overview: one comment is singular; nothing more reads "Full ticket" (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'A', ticket_meta: { ...META, description: 'Only this.', comments: [META.comments[0]!] } }),
      lane({ ticket: 'B', ticket_meta: null, ticket_doc: { title: 't', excerpt: 'Local summary.' } })], { selected: 'A' })
    const ui = await mount($)
    expect((await ui.find({ key: 'to-ticket' }))?.props?.label).toBe('1 comment · full ticket')
    store.set('selected', 'B')
    await ui.redraw(PANE)
    expect((await ui.find({ key: 'to-ticket' }))?.props?.label).toBe('Full ticket')
    expect(await textOf(ui, 'ticket-summary')).toMatch(/Local summary\./)
    expect(await ui.find({ key: 'ticket-chips' })).toBeUndefined()
  })

  test(`overview: the summary is cut to 400 characters; no meta and no excerpt, no block (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'A', ticket_meta: null, ticket_doc: { title: 't', excerpt: 'w'.repeat(500) } }),
      lane({ ticket: 'B', ticket_meta: null, ticket_doc: { title: 't', excerpt: null } })], { selected: 'A' })
    const ui = await mount($)
    const summary = (await texts(ui)).find(x => /^w+…?$/.test(x.text))!
    expect(summary.text).toHaveLength(400)
    expect(summary.text.endsWith('…')).toBe(true)
    store.set('selected', 'B')
    await ui.redraw(PANE)
    expect(await ui.find({ key: 'ticket-summary' })).toBeUndefined()
  })

  test(`ticket tab: chips for state, priority, epic, labels, assignee, estimate, link and staleness (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket_meta: META })], { detailTab: 'ticket' })
    const ui = await mount($)
    const chips = (await ui.find({ key: 'ticket-chips' }))!
    expect(chips.text).toBe('In ProgressHighepic Caching#perf@Matt3 ptsOpen in Linearfetched 2m ago')
    const all = await texts(ui)
    const colour = (t: string) => all.find(x => x.text === t)?.props?.color
    expect(colour('In Progress')).toBe('success')
    expect(colour('High')).toBe('warning')
    expect(colour('epic Caching')).toBe('permission')
    expect(colour('#perf')).toBe('subtle')
    expect(colour('@Matt')).toBe('suggestion')
    expect(colour('3 pts')).toBe('subtle')
    expect(colour('fetched 2m ago')).toBe('subtle')
    const link = (await ui.findAll({ type: 'Link' })).find((l: any) => l.props?.label === 'Open in Linear')
    expect(link?.props?.href).toBe('https://linear.app/x/CON-1')
  })

  test(`ticket tab: a local ticket says "Open ticket" and is never marked stale; Urgent is error (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket_meta: { ...META, source: 'local', url: 'file:///r/tickets/CON-1.md', fetchedAt: NOW - 600 * MIN, priority: 1, epic: null, labels: [], assignee: null, estimate: null } })], { detailTab: 'ticket' })
    const ui = await mount($)
    expect((await ui.find({ key: 'ticket-chips' }))?.text).toBe('In ProgressUrgentOpen ticket')
    expect((await texts(ui)).find(x => x.text === 'Urgent')?.props?.color).toBe('error')
  })

  test(`ticket tab: the body as Markdown without the acceptance section, then the criteria rows (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket_meta: META })], { detailTab: 'ticket' })
    const ui = await mount($)
    const md = (await ui.findAll({ type: 'Markdown' })).map((m: any) => m.props.text as string)
    expect(md[0]).toBe('## Description\n\nAdd an LRU cache\nin front of the store.\n\nMore detail.\n\n## Notes\nBehind a flag.')
    const ac = (await textOf(ui, 'acceptance'))!
    expect(ac).toMatch(/^Acceptance criteria · 2/)
    const all = await texts(ui)
    expect(all.find(x => x.text === '☑')?.props?.color).toBe('success')
    expect(all.find(x => x.text === '☐')?.props?.color).toBe('subtle')
    expect((await textOf(ui, 'ac:0'))).toBe('☑Hits are served from memory')
    expect((await textOf(ui, 'ac:1'))).toBe('☐Misses fall through')
    // Comments live in their own tab now: the Ticket tab only points there.
    expect(await ui.find({ key: 'comments' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Markdown' })).some((m: any) => m.props.text === 'First')).toBe(false)
    expect((await ui.find({ key: 'to-comments' }))?.props?.label).toBe('2 comments · open Comments')
    expect(await ui.find({ type: 'Text', text: /evidence copy/ })).toBeUndefined()
  })

  test(`ticket tab: an empty description reads (no description); no criteria, no section (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket_meta: { ...META, description: '  \n', comments: [] } })], { detailTab: 'ticket' })
    const ui = await mount($)
    expect(await textOf(ui, 'ticket-body')).toBe('(no description)')
    expect(await ui.find({ key: 'acceptance' })).toBeUndefined()
    expect(await ui.find({ key: 'comments' })).toBeUndefined()
  })

  test(`ticket tab: without meta, the evidence excerpt with a note that it may be cut short (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'A', ticket_meta: null, ticket_meta_error: 'linear: HTTP 429', ticket_doc: { title: 't', excerpt: 'Line one.\n\n## Acceptance\n- [ ] works' } }),
      lane({ ticket: 'B', ticket_meta: null, ticket_doc: { title: 't', excerpt: null } })], { detailTab: 'ticket', selected: 'A' })
    const ui = await mount($)
    expect(await ui.find({ key: 'ticket-chips' })).toBeUndefined()
    expect(await textOf(ui, 'meta-error')).toMatch(/429/)
    expect((await ui.find({ type: 'Markdown' }))?.props?.text).toBe('Line one.')
    expect(await ui.find({ type: 'Text', text: "From the run's evidence copy; may be cut short." })).toBeDefined()
    expect(await textOf(ui, 'ac:0')).toBe('☐works')
    store.set('selected', 'B')
    await ui.redraw(PANE)
    expect(await textOf(ui, 'ticket-body')).toBe('(no description)')
    expect(await ui.find({ type: 'Text', text: /evidence copy/ })).toBeUndefined()
  })

  test(`activity tab: a span per phase with cycle, start and duration; the open one "so far"; evidence folded (${surface})`, async ($, on) => {
    seed(on, [lane({ timeline: [
      { t: NOW - 40 * MIN, kind: 'run.start' },
      { t: NOW - 30 * MIN, kind: 'phase.enter', phase: 'Planning', cycle: 1 },
      { t: NOW - 29 * MIN, kind: 'evidence', label: 'design.md' },
      { t: NOW - 28 * MIN, kind: 'evidence', label: 'plan.md' },
      { t: NOW - 27 * MIN, kind: 'verdict', role: 'skeptic', verdict: 'PASS' },
      { t: NOW - 20 * MIN, kind: 'phase.enter', phase: 'Execution', cycle: 2 },
      { t: NOW - 19 * MIN, kind: 'agent.spawn', agent: 'executor' },
    ] })], { detailTab: 'activity' })
    const ui = await mount($)
    expect(await textOf(ui, 'span:0')).toMatch(/^Setup\d\d:\d\d · 10m\d\d:\d\drun started$/)
    expect(await textOf(ui, 'span:1')).toMatch(/^Planningcycle 1\d\d:\d\d · 10m\d\d:\d\devidence: design\.md, plan\.md\d\d:\d\dskeptic: PASS$/)
    expect(await textOf(ui, 'span:2')).toMatch(/^Executioncycle 2\d\d:\d\d · 20m so far\d\d:\d\dexecutor started$/)
    expect(await ui.find({ key: 'span:3' })).toBeUndefined()
    expect((await ui.find({ key: 'ev:0' }))?.props?.marginLeft).toBe(2)
    const all = await texts(ui)
    expect(all.find(x => x.text === 'Planning')?.props?.bold).toBe(true)
    expect(all.find(x => x.text === 'skeptic: PASS')?.props?.color).toBe('success')
    expect(await ui.find({ key: 'activity-cut' })).toBeUndefined()
  })

  test(`activity tab: an ended run closes its last span; a cut timeline says so (${surface})`, async ($, on) => {
    seed(on, [lane({ status: 'done', endStatus: 'merged', endedAt: NOW - 5 * MIN, timelineTruncated: true, timeline: [
      { t: NOW - 20 * MIN, kind: 'phase.enter', phase: 'Delivery', cycle: 1 }, { t: NOW - 5 * MIN, kind: 'run.end', status: 'merged' },
    ] }, 'none')], { detailTab: 'activity', showAll: true })
    const ui = await mount($)
    expect(await textOf(ui, 'activity-cut')).toBe('Older events not shown.')
    expect(await textOf(ui, 'span:0')).toMatch(/^Deliverycycle 1\d\d:\d\d · 15m\d\d:\d\dfinished \(merged\)$/)
  })

  test(`activity tab: no events yet (${surface})`, async ($, on) => {
    seed(on, [lane({ timeline: [] })], { detailTab: 'activity' })
    const ui = await mount($)
    expect(await textOf(ui, 'activity-empty')).toBe('No events yet.')
    expect(await ui.find({ key: 'span:0' })).toBeUndefined()
  })
  // ── comments tab ─────────────────────────────────────────────────────────────────────────────

  const commentsLabel = async (ui: any) => (await tabBtn(ui, 'comments')).props.label

  test(`comments tab label: the count, '+' when cut, "(K new)" when unseen and not active (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'A', ticket_meta: META }), lane({ ticket: 'B', ticket_meta: { ...META, commentsTruncated: true } })],
      { selected: 'A', seenComments: { A: NOW - 3 * MIN, B: NOW - 3 * MIN } })
    const ui = await mount($)
    expect(await commentsLabel(ui)).toBe('Comments · 2 (1 new)')
    store.set('seenComments', { A: NOW - MIN })
    await ui.redraw(PANE)
    expect(await commentsLabel(ui)).toBe('Comments · 2')
    store.set('seenComments', {})
    await ui.redraw(PANE)
    expect(await commentsLabel(ui)).toBe('Comments · 2')           // never baselined: nothing counts as new
    store.set('seenComments', { A: NOW - 3 * MIN })
    store.set('detailTab', 'comments')
    await ui.redraw(PANE)
    expect(await commentsLabel(ui)).toBe('Comments · 2')           // the active tab shows no new count
    store.set('selected', 'B')
    store.set('detailTab', 'overview')
    store.set('seenComments', { B: NOW - 3 * MIN })
    await ui.redraw(PANE)
    expect(await commentsLabel(ui)).toBe('Comments · 2 (1 new)')
    store.set('seenComments', { B: NOW })
    await ui.redraw(PANE)
    expect(await commentsLabel(ui)).toBe('Comments · 2+')
  })

  test(`comments tab label: no meta or no comments, the plain label (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'A', ticket_meta: null }), lane({ ticket: 'B', ticket_meta: { ...META, comments: [] } })], { selected: 'A' })
    const ui = await mount($)
    expect(await commentsLabel(ui)).toBe('Comments')
    store.set('selected', 'B')
    await ui.redraw(PANE)
    expect(await commentsLabel(ui)).toBe('Comments')
  })

  test(`comments tab: pressing it opens the tab and marks the lane's comments seen up to the newest (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'con-1', ticket_meta: META })], { seenComments: { 'CON-1': NOW - 3 * MIN, OTHER: 5 } })
    const ui = await mount($)
    await ui.press({ key: 'tab:ticket' })
    expect(store.get('seenComments')).toEqual({ 'CON-1': NOW - 3 * MIN, OTHER: 5 })   // other tabs mark nothing
    await ui.press({ key: 'tab:comments' })
    expect(store.get('detailTab')).toBe('comments')
    expect(store.get('seenComments')).toEqual({ 'CON-1': NOW - MIN, OTHER: 5 })
  })

  test(`comments tab: a later mark is never lowered (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket_meta: META })], { seenComments: { 'CON-1': NOW } })
    const ui = await mount($)
    await ui.press({ key: 'tab:comments' })
    expect(store.get('seenComments')).toEqual({ 'CON-1': NOW })
  })

  test(`overview: "Latest comment" opens the comments tab and marks them seen (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket_meta: META })], { seenComments: { 'CON-1': 0 } })
    const ui = await mount($)
    expect((await ui.find({ key: 'to-comments' }))?.props?.label).toBe('Latest comment: Bob, 1m ago')
    await ui.press({ key: 'to-comments' })
    expect(store.get('detailTab')).toBe('comments')
    expect(store.get('seenComments')).toEqual({ 'CON-1': NOW - MIN })
  })

  test(`overview: no comments, no "Latest comment"; an unknown author reads someone (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'A', ticket_meta: { ...META, comments: [] } }),
      lane({ ticket: 'B', ticket_meta: { ...META, comments: [{ id: 'x', author: null, body: 'b', createdAt: null }] } })], { selected: 'A' })
    const ui = await mount($)
    expect(await ui.find({ key: 'to-comments' })).toBeUndefined()
    store.set('selected', 'B')
    await ui.redraw(PANE)
    expect((await ui.find({ key: 'to-comments' }))?.props?.label).toBe('Latest comment: someone')
  })

  test(`ticket tab: the comments pointer is singular, carries '+', and opens the tab (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'A', ticket_meta: { ...META, comments: [META.comments[0]!] } }),
      lane({ ticket: 'B', ticket_meta: { ...META, commentsTruncated: true } })], { selected: 'A', detailTab: 'ticket' })
    const ui = await mount($)
    expect((await ui.find({ key: 'to-comments' }))?.props?.label).toBe('1 comment · open Comments')
    store.set('selected', 'B')
    await ui.redraw(PANE)
    expect((await ui.find({ key: 'to-comments' }))?.props?.label).toBe('2+ comments · open Comments')
    await ui.press({ key: 'to-comments' })
    expect(store.get('detailTab')).toBe('comments')
    expect(store.get('seenComments')).toEqual({ B: NOW - MIN })
  })

  test(`comments tab: newest first, author bold, "ago · hh:mm", a "new" tag past the seen mark, Markdown bodies (${surface})`, async ($, on) => {
    const comments = [
      { id: 'c1', author: 'Ann', body: 'First\r\nline two', createdAt: NOW - 5 * MIN },
      { id: 'c3', author: 'Cat', body: '  ', createdAt: NOW - 2 * MIN },
      { id: 'c2', author: 'Bob', body: 'Second', createdAt: NOW - MIN },
    ]
    seed(on, [lane({ ticket_meta: { ...META, url: null, comments } })], { detailTab: 'comments', seenComments: { 'CON-1': NOW - 3 * MIN } })
    const ui = await mount($)
    expect(await textOf(ui, 'cm:0')).toMatch(/^Bob1m ago · \d\d:\d\dnewSecond$/)
    expect(await textOf(ui, 'cm:1')).toMatch(/^Cat2m ago · \d\d:\d\dnew\(empty\)$/)
    expect(await textOf(ui, 'cm:2')).toMatch(/^Ann5m ago · \d\d:\d\dFirst\nline two$/)
    expect(await ui.find({ key: 'cm:3' })).toBeUndefined()
    const all = await texts(ui)
    expect(all.find(x => x.text === 'Bob')?.props).toMatchObject({ bold: true, color: 'suggestion' })
    expect(all.filter(x => x.text === 'new').map(x => x.props.color)).toEqual(['warning', 'warning'])
    expect(all.find(x => x.text === '(empty)')?.props?.dimColor).toBe(true)
    expect((await ui.findAll({ type: 'Markdown' })).map((m: any) => m.props.text)).toEqual(['Second', 'First\nline two'])
    expect(await ui.find({ key: 'comments-more' })).toBeUndefined()
  })

  test(`comments tab: every comment is listed, not only the newest five (${surface})`, async ($, on) => {
    const comments = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, author: `A${i}`, body: `b${i}`, createdAt: NOW - (8 - i) * MIN }))
    seed(on, [lane({ ticket_meta: { ...META, comments } })], { detailTab: 'comments' })
    const ui = await mount($)
    expect(await ui.find({ key: 'cm:7' })).toBeDefined()
    expect(await textOf(ui, 'cm:0')).toMatch(/^A7/)
    expect(await textOf(ui, 'cm:7')).toMatch(/^A0/)
    expect(await ui.find({ type: 'Text', text: 'new' })).toBeUndefined()   // no seen mark: nothing is new
  })

  test(`comments tab: the footer says "Showing the newest N" when cut and links the ticket (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'A', ticket_meta: { ...META, commentsTruncated: true } }), lane({ ticket: 'B', ticket_meta: META })],
      { detailTab: 'comments', selected: 'A' })
    const ui = await mount($)
    expect(await textOf(ui, 'comments-more')).toBe('Showing the newest 2 · Open in Linear')
    expect((await ui.findAll({ type: 'Link' })).find((l: any) => l.props.label === 'Open in Linear' && l.props.href === META.url)).toBeDefined()
    store.set('selected', 'B')
    await ui.redraw(PANE)
    expect(await textOf(ui, 'comments-more')).toBe('Open in Linear')
  })

  test(`comments tab: empty states for no meta, a meta error, a local ticket and no comments (${surface})`, async ($, on) => {
    const store = seed(on, [
      lane({ ticket: 'A', ticket_meta: null }),
      lane({ ticket: 'B', ticket_meta: null, ticket_meta_error: 'linear: HTTP 429' }),
      lane({ ticket: 'C', ticket_meta: { ...META, source: 'local', comments: [] } }),
      lane({ ticket: 'D', ticket_meta: { ...META, comments: [] } }),
    ], { detailTab: 'comments', selected: 'A' })
    const ui = await mount($)
    const empties: [string, string][] = [
      ['A', 'Comments appear once the ticket has been fetched.'], ['B', 'linear: HTTP 429'],
      ['C', "No comments. Local tickets don't store comments yet."], ['D', 'No comments yet.'],
    ]
    for (const [ticket, said] of empties) {
      store.set('selected', ticket)
      await ui.redraw(PANE)
      expect(await textOf(ui, 'comments-empty')).toBe(said)
      expect(await ui.find({ key: 'cm:0' })).toBeUndefined()
    }
  })

  // ── usage and cost ───────────────────────────────────────────────────────────────────────────

  const RESET = new Date(new Date(NOW).getFullYear(), new Date(NOW).getMonth(), new Date(NOW).getDate(), 23, 30).toISOString()
  const LIMITS = [
    { kind: 'five_hour', percentUsed: 42.4, resetsAt: RESET }, { kind: 'seven_day', percentUsed: 75 }, { kind: 'spend_limit', percentUsed: 95 },
  ]

  test(`usage: one coloured Text per window with its reset when wide, then the API-equivalent cost (${surface})`, async ($, on) => {
    seed(on, [lane({})], { account: { rateLimits: LIMITS, usd: 12.3 } })
    const ui = await mount($)
    const row = (await ui.find({ key: 'usage' }))!
    expect(row.text).toBe('5h 42% · resets 23:307d 75%spend 95%$12 API-equivalent')
    const all = await texts(ui)
    expect(all.find(x => x.text === '5h 42% · resets 23:30')?.props?.color).toBe('subtle')
    expect(all.find(x => x.text === '7d 75%')?.props?.color).toBe('warning')
    expect(all.find(x => x.text === 'spend 95%')?.props?.color).toBe('error')
    expect(all.find(x => x.text === '$12 API-equivalent')?.props?.dimColor).toBe(true)
    // Directly under the header.
    const boxes = (await ui.findAll({ type: 'Box' })).map((b: any) => b.key).filter(Boolean)
    expect(boxes.indexOf('usage')).toBe(boxes.indexOf('header') + 1)
  })

  test(`usage: below WIDE columns the reset times are dropped (${surface})`, async ($, on) => {
    seed(on, [lane({})], { account: { rateLimits: LIMITS, usd: 1.5 } })
    const ui = await mount($, { ...PANE, bodyColumns: 47 })
    expect(await textOf(ui, 'usage')).toBe('5h 42%7d 75%spend 95%$1.50 API-equivalent')
  })

  test(`usage: the cost alone, the limits alone, or no row at all (${surface})`, async ($, on) => {
    const store = seed(on, [lane({})], { account: { rateLimits: [], usd: 0.42 } })
    const ui = await mount($)
    expect(await textOf(ui, 'usage')).toBe('$0.42 API-equivalent')
    store.set('account', { rateLimits: [{ kind: 'seven_day', percentUsed: 10 }], usd: null })
    await ui.redraw(PANE)
    expect(await textOf(ui, 'usage')).toBe('7d 10%')
    store.set('account', { rateLimits: [], usd: null })
    await ui.redraw(PANE)
    expect(await ui.find({ key: 'usage' })).toBeUndefined()
    store.set('account', null)
    await ui.redraw(PANE)
    expect(await ui.find({ key: 'usage' })).toBeUndefined()
  })

  const metaText = async (ui: any) => (await ui.find({ type: 'Text', text: /^feature\// }))?.text

  test(`cost: the run's own cost wins over metered usage (${surface})`, async ($, on) => {
    seed(on, [lane({ costUsd: 12.6 })], { laneUsage: { 'CON-1': { tokens: 15000, weight: 25, turns: 3 } },
      usageMeter: { weight: 100, usdAtStart: 2 }, account: { rateLimits: [], usd: 6 } })
    const ui = await mount($)
    expect(await metaText(ui)).toBe('feature/thing/CON-1 · driven here · orchestrator running · $13 · 12m')
  })

  test(`cost: metered tokens, share of the session and the dollar estimate (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'con-1', costUsd: null })], { laneUsage: { 'CON-1': { tokens: 15000, weight: 25, turns: 3 } },
      usageMeter: { weight: 100, usdAtStart: 2 }, account: { rateLimits: [], usd: 6 } })
    const ui = await mount($)
    expect(await metaText(ui)).toBe('feature/thing/CON-1 · driven here · orchestrator running · 15k tokens · 25% of session · ≈$1.00 · 12m')
    // No session cost known yet: tokens and share only.
    store.set('account', null)
    await ui.redraw(PANE)
    expect(await metaText(ui)).toBe('feature/thing/CON-1 · driven here · orchestrator running · 15k tokens · 25% of session · 12m')
  })

  test(`cost: nothing metered for the lane, no cost words (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ costUsd: null })], { laneUsage: { 'OTHER': { tokens: 5, weight: 5, turns: 1 } }, usageMeter: { weight: 5, usdAtStart: 0 } })
    const ui = await mount($)
    expect(await metaText(ui)).toBe('feature/thing/CON-1 · driven here · orchestrator running · 12m')
    store.set('laneUsage', { 'CON-1': { tokens: 0, weight: 0, turns: 1 } })
    await ui.redraw(PANE)
    expect(await metaText(ui)).toBe('feature/thing/CON-1 · driven here · orchestrator running · 12m')
  })

  test(`inline placement draws the list only (${surface})`, async ($, on) => {
    seed(on, [lane({})])
    const ui = await mount($, { ...PANE, placement: 'inline' })
    expect(await ui.find({ key: 'lane:CON-1' })).toBeDefined()
    expect(await ui.find({ key: 'detail' })).toBeUndefined()
  })

  test(`detail: follows view.agentId over the selection (${surface})`, async ($, on) => {
    seed(on, [{ ...lane({ ticket: 'A' }), agentId: 'ag-a' }, { ...lane({ ticket: 'B', ticket_doc: { title: 'Bee', excerpt: null } }), agentId: 'ag-b' }], { selected: 'A' })
    const ui = await mount($, { ...PANE, view: { agentId: 'ag-b' } })
    expect(await textOf(ui, 'detail-header')).toMatch(/^B.*Bee/)
    await ui.redraw(PANE)
    expect(await textOf(ui, 'detail-header')).toMatch(/^A.*Add the thing/)
  })
}

test('unseenComments: comments after the seen mark; 0 with no meta or no mark; undated ones never count', async () => {
  const c = (createdAt: number | null) => ({ id: null, author: null, body: '', createdAt })
  const meta = { fetchedAt: 0, id: null, identifier: null, title: '', description: '', url: null, state: { name: null, type: null },
    assignee: null, priority: null, estimate: null, labels: [], commentsTruncated: false, comments: [c(1), c(5), c(9), c(null)] }
  expect(unseenComments(meta, 4)).toBe(2)
  expect(unseenComments(meta, 5)).toBe(1)
  expect(unseenComments(meta, 9)).toBe(0)
  expect(unseenComments(meta, 0)).toBe(3)
  expect(unseenComments(meta, undefined)).toBe(0)
  expect(unseenComments(null, 0)).toBe(0)
})
