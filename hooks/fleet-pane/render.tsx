// hooks/fleet-pane/render.tsx
// Pure drawing: a PaneModel in, a tree out. `els` is `$.ui.resolve(e)`.
import type { Elements, RenderSurface, RenderElement, ThemeKey } from 'claude-code'
import type { FleetState, Lane, TimelineEvent, TicketMeta } from '../../types'
import { summaryParts, displayStatus, partition, newestComments, pickDetailLane } from './lanes'

type PaneEls = Elements[RenderSurface]

export type PaneModel = {
  fleet: FleetState
  selected: string | null
  showAll: boolean
  viewAgentId?: string
  bodyColumns: number
  placement: 'dock' | 'inline'
  now: number
  onSelect: (ticket: string) => void
}

export const PHASE_ORDER = ['Setup', 'Planning', 'Execution', 'Evaluation', 'Delivery', 'Cleanup']

export function truncate(s: string, max: number): string {
  const n = Math.max(0, max)
  return s.length <= n ? s : n <= 1 ? s.slice(0, n) : s.slice(0, n - 1) + '…'
}

export function phaseBar(phase: string | null): string {
  const i = phase ? PHASE_ORDER.indexOf(phase) : -1
  return PHASE_ORDER.map((_, j) => (j <= i ? '■' : '□')).join('')
}

export function fmtElapsed(ms: number | null): string {
  if (ms == null) return '-'
  const m = Math.floor(ms / 60000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export const fmtAgo = (ms: number) => fmtElapsed(Math.max(0, ms)) + ' ago'

// A needs-you row is already yellow and the orchestrator's pause is expected, so it is never "stalled".
function agentLabel(lane: Lane): string {
  if (lane.liveness === 'stalled' && lane.run.status !== 'needs-you') return `${lane.run.currentAgent ?? ''} stalled`.trim()
  if (lane.liveness === 'external') return 'external'
  return lane.run.currentAgent ?? ''
}

const dimmed = (lane: Lane) =>
  ((lane.liveness === 'external' || lane.liveness === 'stalled') && lane.run.status !== 'needs-you') || displayStatus(lane) === 'unknown'

function rowParts(lane: Lane, now: number) {
  const r = lane.run
  const elapsed = r.startedAt != null ? (r.endedAt ?? now) - r.startedAt : r.elapsedMs
  const passed = r.gates.filter(g => g.status === 'pass').length
  const filled = r.phase ? Math.max(0, PHASE_ORDER.indexOf(r.phase) + 1) : 0
  return {
    ticket: r.ticket.padEnd(9), status: displayStatus(lane).padEnd(10), phase: (r.phase ?? '-').padEnd(10),
    cycle: `c${r.cycle ?? '-'}`.padEnd(3), filled, empty: PHASE_ORDER.length - filled,
    gates: `${passed}/${r.gates.length}`, gatesOk: r.gates.every(g => g.status === 'pass'),
    elapsed: fmtElapsed(elapsed), agent: agentLabel(lane),
  }
}

type Seg = { text: string; color?: ThemeKey; bold?: boolean; dim?: boolean }

/** Clip a run of segments to `max` columns in total, marking the cut with an ellipsis. */
function clipSegs(segs: Seg[], max: number): Seg[] {
  const total = segs.reduce((n, s) => n + s.text.length, 0)
  if (total <= max) return segs
  const out: Seg[] = []
  let left = Math.max(0, max)
  for (const s of segs) {
    if (left <= 0) break
    out.push(s.text.length <= left ? s : { ...s, text: s.text.slice(0, left) })
    left -= s.text.length
  }
  const last = out.at(-1)
  if (last && last.text.length > 0) last.text = max <= 1 ? last.text : last.text.slice(0, -1) + '…'
  return out
}

const statusColour = (s: string): ThemeKey =>
  s === 'running' ? 'success' : s === 'needs-you' ? 'warning' : s === 'failed' ? 'error' : 'inactive'

function visibleLanes(model: PaneModel): { visible: Lane[]; hidden: number } {
  const { shown, hidden } = partition(model.fleet.lanes, model.now)
  return { visible: model.showAll ? model.fleet.lanes : shown, hidden }
}

export function pickDetail(model: PaneModel): Lane | undefined {
  return pickDetailLane(model.fleet.lanes, model.selected, model.viewAgentId, model.showAll, model.now)
}

export function renderPane(els: PaneEls, model: PaneModel): RenderElement {
  const { Box, Text, Button } = els
  const { fleet, bodyColumns: w } = model
  const { visible, hidden } = visibleLanes(model)
  const detail = pickDetail(model)
  const suffix = model.showAll ? ' · all' : hidden > 0 ? ` · ${hidden} hidden` : ''
  const rule = '─'.repeat(Math.max(1, w))
  const headSegs: Seg[] = [{ text: 'Fleet · concertino', color: 'claude', bold: true }]
  summaryParts(visible).forEach((p, i) => {
    headSegs.push(i === 0 ? { text: '  ' } : { text: ' · ', color: 'subtle' }, { text: p.label, color: p.color })
  })
  if (suffix) headSegs.push({ text: suffix, color: 'subtle' })
  return (
    <Box flexDirection="column">
      <Box key="header" flexDirection="row">
        {clipSegs(headSegs, w).map((s, i) => (
          <Text key={i} {...(s.color ? { color: s.color } : {})} {...(s.bold ? { bold: true } : {})}>{s.text}</Text>
        ))}
      </Box>
      <Text dimColor>{rule}</Text>
      {fleet.error && <Box key="error"><Text color="error">{truncate(fleet.error, w)}</Text></Box>}
      {fleet.lanes.length === 0 && !fleet.error && (
        <Box key="empty"><Text dimColor>{truncate(`No concertino runs under ${fleet.root}/.concertino/runs`, w)}</Text></Box>
      )}
      {fleet.lanes.length > 0 && visible.length === 0 && (
        <Box key="empty"><Text dimColor>{truncate(`No live lanes · ${hidden} hidden (/fleet all)`, w)}</Text></Box>
      )}
      {visible.map((lane, i) => {
        const colour = colourOf(lane)
        const p = rowParts(lane, model.now)
        const dim = dimmed(lane)
        const marker: Seg = { text: detail === lane ? '▶ ' : '● ', ...(colour ? { color: colour } : {}) }
        const ticket: Seg = { text: p.ticket }
        const segs: Seg[] = clipSegs([
          marker, ticket,
          { text: ' ' + p.status, color: statusColour(displayStatus(lane)) },
          { text: ' ' + p.phase, color: 'text' },
          { text: ' ' + p.cycle, color: 'subtle' },
          { text: ' ' + '■'.repeat(p.filled), color: 'success' },
          { text: '□'.repeat(p.empty), color: 'subtle' },
          { text: ' ' + (p.agent || p.elapsed.length ? p.gates.padEnd(4) : p.gates), color: p.gatesOk ? 'subtle' : 'warning' },
          { text: ' ' + (p.agent ? p.elapsed.padEnd(7) : p.elapsed), color: 'subtle' },
          ...(p.agent ? [{ text: ' ' + p.agent, color: 'suggestion' as ThemeKey, dim }] : []),
        ], w)
        const [mk, tk, ...rest] = segs
        return (
          <Box key={`row:${lane.run.ticket}`} flexDirection="row">
            {mk && <Text {...(mk.color ? { color: mk.color } : {})} {...(dimmed(lane) ? { dimColor: true } : {})}>{mk.text}</Text>}
            {tk && (
              <Button
                key={`lane:${lane.run.ticket}`}
                plain
                {...(i < 9 ? { hotkey: String(i + 1) } : {})}
                dimColor={dim}
                label={tk.text}
                onPress={() => model.onSelect(lane.run.ticket)}
              />
            )}
            {rest.map((s, j) => (
              <Text key={j} {...(s.color ? { color: s.color } : {})} {...(s.dim ? { dimColor: true } : {})}>{s.text}</Text>
            ))}
          </Box>
        )
      })}
      {model.placement === 'dock' && detail && <Text dimColor>{rule}</Text>}
      {model.placement === 'dock' && detail && renderDetail(els, model, detail)}
    </Box>
  )
}

const colourOf = (lane: Lane): ThemeKey | undefined => {
  const s = displayStatus(lane)
  return s === 'needs-you' ? 'warning' : s === 'failed' ? 'error' : undefined
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const lettered = (options: string[]) => options.map((o, i) => `${LETTERS[i] ?? '?'}) ${o}`).join('   ')

function answeredLine(lane: Lane): string | null {
  const a = lane.run.pendingAnswer
  if (!a) return null
  if ('answer' in a) return `answered: ${a.answer}`
  return `answered: ${a.subAnswers.filter(x => x != null).length}/${a.total}${a.complete ? '' : ' (in progress)'}`
}

export function metaLine(m: TicketMeta): string {
  const parts = [
    m.state.name,
    m.assignee,
    m.priority != null ? `P${m.priority}` : null,
    m.estimate != null ? `${m.estimate} pts` : null,
    m.labels.length ? `labels: ${m.labels.join(', ')}` : null,
    m.url,
  ].filter((p): p is string => !!p)
  return parts.join(' · ')
}

/** Plain-text rows for a pane `width`: CRLF normalised, empty lines dropped, markdown links and leading #'s stripped, words greedily wrapped (an over-long word is hard-split). */
export function wrapRows(text: string, width: number): string[] {
  const w = Math.max(1, Math.floor(width))
  const rows: string[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*#+\s*/, '').trim()
    if (!line) continue
    let cur = ''
    for (let word of line.split(/\s+/)) {
      while (word.length > w) {
        if (cur) { rows.push(cur); cur = '' }
        rows.push(word.slice(0, w))
        word = word.slice(w)
      }
      if (!word) continue
      if (!cur) cur = word
      else if (cur.length + 1 + word.length <= w) cur += ' ' + word
      else { rows.push(cur); cur = word }
    }
    if (cur) rows.push(cur)
  }
  return rows
}

export const NO_DESC = '(no description)'

export function descriptionRows(meta: TicketMeta | null, excerpt: string | null, w: number): { title: 'DESCRIPTION' | 'TICKET'; rows: string[] } {
  if (meta) {
    // The body goes to Markdown whole; `rows` only carries it (or the placeholder) to the caller.
    return { title: 'DESCRIPTION', rows: [meta.description.trim() ? meta.description : NO_DESC] }
  }
  return { title: 'TICKET', rows: wrapRows(excerpt ?? '', w).slice(0, 8) }
}


function timelineLine(ev: TimelineEvent, w: number): string {
  const d = new Date(ev.t)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const rest = [ev.kind, ev.agent, ev.role && ev.kind === 'verdict' ? ev.role : undefined, ev.verdict, ev.phase, ev.gate,
    ev.status, ev.cycle != null ? `c${ev.cycle}` : undefined, ev.label].filter(Boolean).join(' ')
  return truncate(`${hhmm} ${rest}`, w)
}

const VERDICT_OK = new Set(['PASS', 'MERGE', 'CONFIRM'])
const VERDICT_BAD = new Set(['FAIL', 'BLOCKER', 'REFUTE'])
function timelineColour(ev: TimelineEvent): ThemeKey {
  if (ev.kind === 'verdict') {
    const v = (ev.verdict ?? '').toUpperCase()
    return VERDICT_OK.has(v) ? 'success' : VERDICT_BAD.has(v) ? 'error' : v === 'ESCALATION' ? 'warning' : 'subtle'
  }
  return ev.kind === 'pr' ? 'merged' : ev.kind === 'escalation.raised' ? 'warning' : 'subtle'
}

function stateColour(type: string | null): ThemeKey {
  switch (type) {
    case 'started': return 'success'
    case 'unstarted': case 'backlog': case 'triage': return 'subtle'
    case 'completed': return 'merged'
    case 'canceled': return 'error'
    default: return 'text'
  }
}
const priorityColour = (p: number): ThemeKey => (p <= 1 ? 'error' : p === 2 ? 'warning' : 'subtle')

export function renderDetail(els: PaneEls, model: PaneModel, lane: Lane): RenderElement {
  const { Box, Text, Link, Markdown } = els
  const w = model.bodyColumns
  const r = lane.run
  const colour = colourOf(lane)
  const pr = r.timeline.filter(ev => ev.kind === 'pr' && ev.url).at(-1)
  const desc = descriptionRows(r.ticket_meta, r.ticket_doc.excerpt, w)
  const meta = r.ticket_meta
  const shown = meta ? newestComments(meta.comments, 5) : []
  const truncated = !!meta?.commentsTruncated
  const more = meta ? meta.comments.length - shown.length : 0
  const staleMs = meta ? model.now - meta.fetchedAt : 0
  const esc = r.escalation
  const answered = answeredLine(lane)
  return (
    <Box key="detail" flexDirection="column">
      <Box key="detail-header" flexDirection="row">
        {clipSegs([
          { text: r.ticket, color: 'claude', bold: true },
          { text: '  ' },
          { text: r.ticket_meta?.title || r.ticket_doc.title || r.changeName || '', color: 'text', bold: true },
          { text: `  ${r.branch ?? ''}`, color: 'subtle' },
        ], w).map((sg, i) => <Text key={i} {...(sg.color ? { color: sg.color } : {})} {...(sg.bold ? { bold: true } : {})}>{sg.text}</Text>)}
      </Box>
      <Text>{truncate(`Phase ${r.phase ?? '-'} · cycle ${r.cycle ?? '-'} · agent ${lane.liveness} · worktree ${r.worktree ?? '-'}`, w)}</Text>
      {meta && (
        <Box key="meta" flexDirection="row" flexWrap="wrap">
          {metaItems(meta, staleMs > 60_000 ? `fetched ${fmtAgo(staleMs)}` : null).map((it, i) => (
            <Box key={`m:${i}`}>
              {i > 0 && <Text color="subtle">{' · '}</Text>}
              {it.link ? <Link href={it.link} label={it.link} /> : <Text color={it.color}>{it.text}</Text>}
            </Box>
          ))}
        </Box>
      )}
      {r.ticket_meta_error && <Box key="meta-error"><Text dimColor>{truncate(r.ticket_meta_error, w)}</Text></Box>}
      {esc && (
        <Box key="escalation" flexDirection="column" marginTop={1}>
          <Text bold color="warning">{truncate(`ESCALATION (${esc.role ?? 'unknown'}, ${fmtAgo(model.now - esc.raisedAt)})`, w)}</Text>
          <Text wrap="wrap">{esc.question}</Text>
          {esc.options.length > 0 && <Text wrap="wrap">{lettered(esc.options)}</Text>}
          {(esc.subQuestions ?? []).map((sq, i) => (
            <Box flexDirection="column" key={`sq:${i}`}>
              <Text wrap="wrap">{`${i + 1}. ${sq.question}`}</Text>
              <Text wrap="wrap">{'   ' + lettered(sq.options)}</Text>
            </Box>
          ))}
          {answered && <Text dimColor>{truncate(answered, w)}</Text>}
        </Box>
      )}
      {desc.rows.length > 0 && (
        <Box key="ticket" flexDirection="column" marginTop={1}>
          <Text bold color="claude">{desc.title}</Text>
          {meta && desc.rows.length > 0 && desc.rows[0] !== NO_DESC
            ? <Markdown text={meta.description.replace(/\r\n?/g, '\n')} />
            : <Text>{desc.rows.join('\n')}</Text>}
        </Box>
      )}
      {r.timeline.length > 0 && (
        <Box key="timeline" flexDirection="column" marginTop={1}>
          <Text bold color="claude">TIMELINE</Text>
          {r.timeline.slice(-8).map((ev, i) => <Text key={`tl:${i}`} color={timelineColour(ev)}>{timelineLine(ev, w)}</Text>)}
        </Box>
      )}
      {(pr || r.costUsd != null) && (
        <Box key="pr" marginTop={1} flexDirection="row">
          {pr?.url && <Text>{'PR '}</Text>}
          {pr?.url && <Link href={pr.url} label={pr.url} />}
          {r.costUsd != null && <Text color="subtle">{`${pr ? '   ' : ''}cost $${r.costUsd.toFixed(2)}`}</Text>}
        </Box>
      )}
      {meta && meta.comments.length > 0 && (
        <Box key="comments" flexDirection="column" marginTop={1}>
          <Text bold color="claude">{`COMMENTS (${meta.comments.length}${truncated ? '+' : ''})`}</Text>
          {shown.map((c, i) => (
            <Box key={`cm:${i}`} flexDirection="column">
              <Box flexDirection="row">
                <Text color="suggestion">{c.author ?? 'someone'}</Text>
                <Text color="subtle">{` · ${c.createdAt != null ? fmtAgo(model.now - c.createdAt) : ''}`.trimEnd()}</Text>
              </Box>
              {c.body.trim() && <Markdown text={c.body.replace(/\r\n?/g, '\n')} />}
            </Box>
          ))}
          {(more > 0 || truncated) && (
            <Box flexDirection="row" flexWrap="wrap">
              <Text color="subtle">{`${more}${truncated ? '+' : ''} more${meta.url ? ' — ' : ''}`}</Text>
              {meta.url && <Link href={meta.url} label={meta.url} />}
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

type MetaItem = { text: string; color: ThemeKey; link?: string }

function metaItems(m: TicketMeta, stale: string | null): MetaItem[] {
  const out: MetaItem[] = []
  if (m.state.name) out.push({ text: m.state.name, color: stateColour(m.state.type) })
  if (m.assignee) out.push({ text: m.assignee, color: 'suggestion' })
  if (m.priority != null) out.push({ text: `P${m.priority}`, color: priorityColour(m.priority) })
  if (m.estimate != null) out.push({ text: `${m.estimate} pts`, color: 'subtle' })
  if (m.labels.length) out.push({ text: `labels: ${m.labels.join(', ')}`, color: 'permission' })
  if (m.url) out.push({ text: m.url, color: 'text', link: m.url })
  if (stale) out.push({ text: stale, color: 'subtle' })
  return out
}
