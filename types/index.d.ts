// The fleet pane's state contract (docs/superpowers/specs/2026-10-06-fleet-pane-design.md).
export type TicketComment = { id: string | null; author: string | null; body: string; createdAt: number | null }
export type TicketMeta = {
  fetchedAt: number
  id: string | null
  identifier: string | null
  title: string
  description: string
  url: string | null
  state: { name: string | null; type: string | null }
  assignee: string | null
  priority: number | null
  estimate: number | null
  labels: string[]
  comments: TicketComment[]
  commentsTruncated: boolean
  /** The ticket's epic (local provider frontmatter); absent for Linear. */
  epic?: string | null
  /** Which provider built it. */
  source?: 'local' | 'linear'
}

export type RunStatus = 'needs-you' | 'failed' | 'running' | 'unknown' | 'done'

export type Gate = { name: string; status: string; durationMs: number | null; firstError: string | null }

export type SubQuestion = { question: string; options: string[] }

export type Escalation = {
  question: string
  options: string[]
  subQuestions?: SubQuestion[]
  raisedAt: number
  escalationId: string | null
  role: string | null
  /** Background the raiser attached, bounded by the CLI; absent on older logs. */
  context?: string | null
  /** The gate that raised it (`design`, `final`, ...), when recorded. */
  gate?: string | null
}

export type TimelineEvent = {
  t: number
  kind: string
  phase?: string
  cycle?: number
  agent?: string
  role?: string
  verdict?: string
  gate?: string
  status?: string
  url?: string
  label?: string
}

export type PendingAnswer =
  | { answer: string }
  | { subAnswers: unknown[]; total: number; complete: boolean }
  | null

/** One run as `concertino fleet --json` prints it: the reducer's model minus `events`. */
export type Run = {
  ticket: string
  changeName: string | null
  branch: string | null
  worktree: string | null
  phase: string | null
  cycle: number | null
  gates: Gate[]
  lastVerdict: { role: string; verdict: string; ref: string | null } | null
  escalation: Escalation | null
  costUsd: number | null
  startedAt: number | null
  endedAt: number | null
  endStatus: string | null
  elapsedMs: number | null
  status: RunStatus
  malformed: number
  ticket_doc: { title: string | null; excerpt: string | null }
  pendingAnswer: PendingAnswer
  timeline: TimelineEvent[]
  currentAgent: string | null
  ticket_meta: TicketMeta | null
  ticket_meta_error: string | null
  /** The newest event's `session`: the driver session's CLAUDE_CODE_SESSION_ID. Null or absent when none was recorded. */
  driverSession?: string | null
  /** The newest PR url anywhere in the log (older CLIs omit it; the pane falls back to the timeline). */
  prUrl?: string | null
  /** True when the CLI dropped older events: runs named in --tickets keep up to 300, others the newest 20. */
  timelineTruncated?: boolean
}

/** `project`: config `project.name`, else the root's basename (older CLIs omit it). */
export type Snapshot = { generatedAt: number; root: string; project?: string; runs: Run[] }

/** Who drives a run: `run.driverSession` against this session's id; `none` when no session was recorded. */
export type Driver = 'here' | 'other' | 'none'

/**
 * For a run driven here and not ended, its orchestrator agent: `stalled` = matched once and now
 * ended or dropped from the agent list; `unseen` = no orchestrator agent matched at all.
 */
export type AgentFact = 'running' | 'waiting' | 'stalled' | 'unseen'

export type Lane = {
  run: Run
  driver: Driver
  agent?: AgentFact
  agentId?: string
  /** Mirrors claude-code's AgentStatus (the contract must not import). */
  agentStatus?: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
}

/** Which view the detail block shows. */
export type DetailTab = 'overview' | 'ticket' | 'activity' | 'comments'

/** The person's in-progress answer to one escalation: the picked option per question (or typed text) and a note. */
export type AnswerDraft = { picks: (string | null)[]; note: string }

export type FleetState = {
  lanes: Lane[]
  error: string | null
  fingerprint: string
  generatedAt: number
  root: string
  project: string
}

declare module 'claude-code' {
  interface PluginState {
    concertino: {
      fleet: FleetState
      selected: string | null
      seenEscalations: string[]
      /** Whether the pane was opened unasked once a run existed. */
      paneOffered: boolean
      /** Whether the pane draws every lane (`/fleet all`) instead of only live and recent ones. */
      showAll: boolean
      /** Orchestrator agent id per ticket once matched, so a later drop from the agent list reads `stalled`. */
      knownAgents: Record<string, string>
      /** Escalation answer drafts, keyed by escalation key. */
      drafts: Record<string, AnswerDraft>
      /** Collapsed lane groups the person has opened (`done`, `failed`). */
      openGroups: string[]
      /** The detail block's tab. */
      detailTab: DetailTab
      /** Per ticket (upper-cased), the newest comment's createdAt the person has seen on the Comments tab. */
      seenComments: Record<string, number>
    }
  }
}
