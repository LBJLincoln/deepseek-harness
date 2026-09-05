/**
 * Pure fold of one session log into {@link SessionFacts}. Every field comes
 * from a named session event: the identity group from `environment/run` and
 * `request/header`, the outcome group from `goal/change`, the five
 * `verification/*` events and `budget/breach`, the efficiency group from
 * `turn/start`, `step/start`, and the usage of `assistant/message`, and the
 * tool group from `tool/call` and `tool/result`.
 *
 * The outcome group is decided by the folds that already own those streams —
 * `foldTrajectoryReward`, `foldVerification`, and `foldGoal` — so the events
 * they read are kept in the accumulator and refolded whenever one arrives.
 *
 * @module @deepseek-ai/dsh-scorekeeper
 */

import { decodeEnvironmentRun } from '@deepseek-ai/dsh-environments'
import { foldGoal } from '@deepseek-ai/dsh-goal'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
// Type-only: the `budget/breach` SessionEventMap merge this fold reads.
import type {} from '@deepseek-ai/dsh-budget-policy'
import { TOOL_TIMEOUT } from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import { foldTrajectoryReward } from '@deepseek-ai/dsh-trajectories'
import { foldVerification } from '@deepseek-ai/dsh-verification'
import type {
  SessionFacts,
  SessionFactsEfficiency,
  SessionFactsIdentity,
  SessionFactsOutcome,
  SessionFactsRecord,
  SessionFactsTools,
} from './types.ts'

/** The outcome group of a log that recorded no goal and no standard. */
const EMPTY_OUTCOME: SessionFactsOutcome = {
  reward: null,
  rewardBasis: 'none',
  certified: false,
  runsRecorded: 0,
  attempts: 0,
  directives: 0,
  relaxations: 0,
  goalRoundsStarted: 0,
}

/** The facts of the empty log. */
const EMPTY_FACTS: SessionFacts = {
  identity: {},
  outcome: EMPTY_OUTCOME,
  efficiency: {
    turns: 0,
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    wallMs: 0,
  },
  tools: { toolCalls: 0, toolCallsByName: {}, toolErrors: 0, toolTimeouts: 0, toolAborts: 0 },
}

/**
 * Accumulator of the session-facts fold. Plain JSON throughout, so the
 * projection registry can persist and restore it.
 */
export interface SessionFactsState {
  /** Facts covering every event folded so far. */
  readonly facts: SessionFacts
  /** The goal, verification, and budget events the outcome group refolds from. */
  readonly outcomeEvents: readonly SessionEvent[]
  /** Time of the first folded event, absent for the empty log. */
  readonly firstTime?: number
}

/**
 * Build an empty accumulator.
 * @returns state whose facts are those of the empty log.
 */
export function emptySessionFactsState(): SessionFactsState {
  return { facts: EMPTY_FACTS, outcomeEvents: [] }
}

/** Whether the outcome group folds from this event. */
function isOutcomeEvent(event: SessionEvent): boolean {
  switch (event.type) {
    case 'goal/change':
    case 'verification/standard':
    case 'verification/relaxation':
    case 'verification/run':
    case 'verification/certificate':
    case 'verification/directive':
    case 'budget/breach':
      return true
    // An admitted continuation round is a user message; the goal fold counts it.
    case 'user/message':
      return event.data.source.kind === 'goal'
    default:
      return false
  }
}

/** The cap of the last recorded breach, absent when the events hold none. */
function breachCap(events: readonly SessionEvent[]): Pick<SessionFactsOutcome, 'budgetBreachCap'> {
  let cap: SessionFactsOutcome['budgetBreachCap']
  for (const event of events) {
    if (event.type === 'budget/breach') cap = event.data.cap
  }
  return cap === undefined ? {} : { budgetBreachCap: cap }
}

/**
 * Fold the outcome group from the goal, verification, and budget events.
 * @param events - the kept outcome events in sequence order.
 * @returns the outcome group.
 * @throws when a kept event violates the strict goal or verification stream.
 */
function foldOutcome(events: readonly SessionEvent[]): SessionFactsOutcome {
  const reward = foldTrajectoryReward(events)
  const verification = foldVerification(events)
  const goal = foldGoal(events)
  return {
    reward: reward.outcome,
    rewardBasis: reward.basis,
    certified: verification.certificate !== undefined,
    ...verification.certificate === undefined
      ? {}
      : { certificateRevision: verification.certificate.standard.revision },
    runsRecorded: verification.runsRecorded,
    attempts: verification.lastRun?.attempt ?? 0,
    directives: reward.directives,
    relaxations: reward.relaxations,
    ...goal.goal === undefined ? {} : { goalPhase: goal.goal.phase, goalRoundsCap: goal.goal.maxGoalRounds },
    goalRoundsStarted: goal.roundsStarted,
    ...breachCap(events),
  }
}

/** Replace the identity group. */
function withIdentity(state: SessionFactsState, identity: SessionFactsIdentity): SessionFactsState {
  return { ...state, facts: { ...state.facts, identity: { ...state.facts.identity, ...identity } } }
}

/** Replace the efficiency group. */
function withEfficiency(state: SessionFactsState, efficiency: Partial<SessionFactsEfficiency>): SessionFactsState {
  return { ...state, facts: { ...state.facts, efficiency: { ...state.facts.efficiency, ...efficiency } } }
}

/** Replace the tool group. */
function withTools(state: SessionFactsState, tools: Partial<SessionFactsTools>): SessionFactsState {
  return { ...state, facts: { ...state.facts, tools: { ...state.facts.tools, ...tools } } }
}

/** Extend the log's time span with one event, so `wallMs` spans first to last. */
function withEventTime(state: SessionFactsState, event: SessionEvent): SessionFactsState {
  const firstTime = state.firstTime ?? event.time
  return { ...withEfficiency(state, { wallMs: event.time - firstTime }), firstTime }
}

/** Add one run stamp's fields to the identity group. */
function withStamp(state: SessionFactsState, event: SessionEvent<'environment/run'>): SessionFactsState {
  // The durable boundary validates the stamp; a malformed one fails the fold loudly.
  const stamp = decodeEnvironmentRun(event.data)
  /* v8 ignore next -- the event's declared payload always identifies itself as a run stamp. */
  if (stamp === undefined) return state
  return withIdentity(state, {
    environment: {
      environmentId: stamp.environmentId,
      environmentKind: stamp.environmentKind,
      heldOut: stamp.heldOut,
      repetition: stamp.repetition,
      ...stamp.group === undefined ? {} : { group: stamp.group },
      contentSha256: stamp.contentSha256,
      provider: stamp.model.provider,
      model: stamp.model.model,
      isolation: stamp.isolation,
    },
  })
}

/**
 * Add one assistant message's provider accounting. Only `assistant/message`
 * carries a step's final usage, so the earlier `assistant/chunk` sample for the
 * same step is deliberately ignored rather than counted twice.
 */
function withUsage(state: SessionFactsState, event: SessionEvent<'assistant/message'>): SessionFactsState {
  const usage = event.data.usage
  if (usage === undefined) return state
  const totals = state.facts.efficiency
  return withEfficiency(state, {
    inputTokens: totals.inputTokens + usage.inputTokens,
    outputTokens: totals.outputTokens + usage.outputTokens,
    cacheReadTokens: totals.cacheReadTokens + (usage.cacheReadTokens ?? 0),
    cacheWriteTokens: totals.cacheWriteTokens + (usage.cacheWriteTokens ?? 0),
    reasoningTokens: totals.reasoningTokens + (usage.reasoningTokens ?? 0),
  })
}

/** Count one tool result that reported an error, classified by its recorded code. */
function withToolResult(state: SessionFactsState, event: SessionEvent<'tool/result'>): SessionFactsState {
  const [block] = event.data.message.content
  if (block.isError !== true) return state
  const code = event.data.error?.code
  const tools = state.facts.tools
  const aborted = code === TOOL_ABORTED || code === TOOL_ABORTED_BEFORE_DISPATCH
  return withTools(state, {
    toolErrors: tools.toolErrors + 1,
    toolTimeouts: tools.toolTimeouts + (code === TOOL_TIMEOUT ? 1 : 0),
    toolAborts: tools.toolAborts + (aborted ? 1 : 0),
  })
}

/**
 * Fold one event into the accumulator.
 * @param state - the accumulator covering every prior event.
 * @param event - the next event in sequence order.
 * @returns the next accumulator; every event moves the log's time span, so the reference always changes.
 * @throws when the event is a goal or verification change the strict folds reject.
 */
export function applySessionFacts(state: SessionFactsState, event: SessionEvent): SessionFactsState {
  const timed = withEventTime(state, event)
  if (isOutcomeEvent(event)) {
    const outcomeEvents = [...timed.outcomeEvents, event]
    return { ...timed, outcomeEvents, facts: { ...timed.facts, outcome: foldOutcome(outcomeEvents) } }
  }
  switch (event.type) {
    case 'turn/start':
      return withEfficiency(timed, { turns: timed.facts.efficiency.turns + 1 })
    case 'step/start':
      return withEfficiency(timed, { steps: timed.facts.efficiency.steps + 1 })
    case 'assistant/message':
      return withUsage(timed, event)
    case 'environment/run':
      return withStamp(timed, event)
    case 'request/header':
      return withIdentity(timed, {
        requestProvider: event.data.header.config.provider,
        requestModel: event.data.header.config.model,
      })
    case 'tool/call': {
      const tools = timed.facts.tools
      const calls = tools.toolCallsByName[event.data.name] ?? 0
      return withTools(timed, {
        toolCalls: tools.toolCalls + 1,
        toolCallsByName: { ...tools.toolCallsByName, [event.data.name]: calls + 1 },
      })
    }
    case 'tool/result':
      return withToolResult(timed, event)
    // SessionEventMap is merge-extensible: every other event moves only the time span.
    default:
      return timed
  }
}

/**
 * Fold a whole session log into its accumulator.
 * @param events - the session's contiguous event log.
 * @returns the accumulator covering every event.
 * @throws when a goal or verification change violates its strict stream.
 */
export function foldSessionFactsState(events: readonly SessionEvent[]): SessionFactsState {
  let state = emptySessionFactsState()
  for (const event of events) state = applySessionFacts(state, event)
  return state
}

/**
 * Fold one persisted session into its facts record.
 * @param meta - the stored session header.
 * @param events - the session's contiguous event log.
 * @returns the four fact groups with the header's identity; deterministic for the same inputs.
 * @throws when a goal or verification change violates its strict stream.
 */
export function foldSessionFacts(meta: SessionHeader, events: readonly SessionEvent[]): SessionFactsRecord {
  const facts = foldSessionFactsState(events).facts
  return { ...facts, identity: { sessionId: meta.id, createdAt: meta.createdAt, ...facts.identity } }
}
