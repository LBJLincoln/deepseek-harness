/**
 * Pure projection of one session log into a {@link Trajectory}: surface
 * messages with their source seqs, per-step usage, the reward the log's goal
 * and verification events decide, the weighted pass rate of the last recorded
 * run beside it, and the components in play.
 * @module @deepseek-ai/dsh-trajectories
 */

import { ComponentId } from '@deepseek-ai/dsh-components'
import type { ComponentId as ComponentIdType } from '@deepseek-ai/dsh-components/types'
import { decodeEnvironmentRun } from '@deepseek-ai/dsh-environments'
import type { EnvironmentRunStamp } from '@deepseek-ai/dsh-environments/types'
import { decodeGoalChange } from '@deepseek-ai/dsh-goal'
import type { GoalSnapshot } from '@deepseek-ai/dsh-goal/types'
import type { ContentBlock, ToolCallBlock } from '@deepseek-ai/dsh-llm'
import { foldSurface } from '@deepseek-ai/dsh-session'
import type { EpochHeader, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { foldVerification } from '@deepseek-ai/dsh-verification'
import type {
  Trajectory,
  TrajectoryMessage,
  TrajectoryReward,
  TrajectoryStep,
  TrajectoryToolCall,
} from './types.ts'

/** The record format tag every exported line carries. */
export const TRAJECTORY_FORMAT = 'dsh-trajectory/1'

/** Position of a surface event inside the turn/step structure. */
interface StepPosition {
  readonly turn: number
  readonly step: number
}

/** Everything one sequential pass over the log collects before the surface is projected. */
interface LogScan {
  header?: EpochHeader
  agentPreset?: string
  environment?: EnvironmentRunStamp
  readonly positions: Map<number, StepPosition>
  readonly steps: TrajectoryStep[]
  readonly toolNames: string[]
}

/**
 * Read the preset selection from a log-only event this package does not
 * declare. The event belongs to `dsh-agent-presets`; reading it by name keeps
 * the fold free of that dependency, and the payload check is the durable-log
 * boundary's own validation.
 */
function presetOf(event: SessionEvent): string | undefined {
  if ((event.type as string) !== 'agent-preset/selected') return undefined
  const data = event.data as { agentPreset?: unknown }
  return typeof data.agentPreset === 'string' ? data.agentPreset : undefined
}

/** One ordered pass over every event, collecting what the projection needs. */
function scanLog(events: readonly SessionEvent[]): LogScan {
  const scan: LogScan = {
    positions: new Map(),
    steps: [],
    toolNames: [],
  }
  let position: StepPosition | undefined
  for (const event of events) {
    switch (event.type) {
      case 'request/header':
        scan.header = event.data.header
        break
      case 'step/start':
        position = { turn: event.data.turn, step: event.data.step }
        scan.steps.push(position)
        break
      case 'step/end':
        position = undefined
        break
      case 'user/message':
      case 'tool/result':
        if (position !== undefined) scan.positions.set(event.seq, position)
        break
      case 'assistant/message': {
        if (position !== undefined) scan.positions.set(event.seq, position)
        const usage = event.data.usage
        if (usage !== undefined) {
          const index = scan.steps.findIndex(step => step.turn === event.data.turn && step.step === event.data.step)
          if (index !== -1) scan.steps[index] = { ...scan.steps[index] as TrajectoryStep, usage }
        }
        break
      }
      case 'tool/call':
        if (!scan.toolNames.includes(event.data.name)) scan.toolNames.push(event.data.name)
        break
      case 'environment/run': {
        // The durable boundary validates the stamp; a malformed one fails the fold loudly.
        const stamp = decodeEnvironmentRun(event.data)
        if (stamp !== undefined) scan.environment = stamp
        break
      }
      default: {
        const preset = presetOf(event)
        if (preset !== undefined) scan.agentPreset = preset
      }
    }
  }
  return scan
}

/** Tool calls an assistant message requested, from its own blocks. */
function toolCallsOf(content: readonly ContentBlock[]): TrajectoryToolCall[] {
  return content
    .filter((block): block is ToolCallBlock => block.type === 'tool-call')
    .map(block => ({ id: block.id, name: block.name, arguments: block.arguments }))
}

/** Project one surface event to a trajectory message, or nothing for an empty assistant step. */
function projectMessage(event: SessionEvent, position: StepPosition | undefined): TrajectoryMessage | undefined {
  const at = position === undefined ? {} : { turn: position.turn, step: position.step }
  switch (event.type) {
    case 'user/message':
      return { role: 'user', seq: event.seq, ...at, content: event.data.content, sourceKind: event.data.source.kind }
    case 'assistant/message': {
      const message = event.data.message
      if (message.content.length === 0) return undefined
      const toolCalls = toolCallsOf(message.content)
      return {
        role: 'assistant',
        seq: event.seq,
        ...at,
        content: message.content,
        sourceKind: message.source.kind,
        ...toolCalls.length === 0 ? {} : { toolCalls },
      }
    }
    case 'tool/result': {
      const [block] = event.data.message.content
      return {
        role: 'tool',
        seq: event.seq,
        ...at,
        content: block.content,
        sourceKind: event.data.message.source.kind,
        toolCallId: block.toolCallId,
        ...block.isError === true ? { isError: true } : {},
      }
    }
    /* v8 ignore next 2 -- the surface fold admits only the three message-producing types. */
    default:
      return undefined
  }
}

/** The goal the reward measures, as the last non-clear mutation left it. */
interface RewardGoal {
  goal?: GoalSnapshot
  completed: boolean
}

/** Fold the current goal and whether the log completed it. */
function scanGoal(events: readonly SessionEvent[]): RewardGoal {
  const scanned: RewardGoal = { completed: false }
  for (const event of events) {
    if (event.type !== 'goal/change') continue
    const change = decodeGoalChange(event.data)
    if (change === undefined || change.operation === 'clear') continue
    scanned.goal = change.goal
    scanned.completed = change.operation === 'complete'
  }
  return scanned
}

/**
 * Decide one session's reward from its goal and verification events alone: a
 * tampered last run outranks everything, the verifier decides whenever a
 * standard exists, an uncertified completion is undecided, and a log without a
 * goal is unmeasured.
 * @param events - the session's contiguous event log.
 * @returns the reward outcome with its basis, the measured goal, the covering certificate, and the counts behind them.
 */
export function foldTrajectoryReward(events: readonly SessionEvent[]): TrajectoryReward {
  const verification = foldVerification(events)
  const scanned = scanGoal(events)
  const goal = scanned.goal === undefined
    ? {}
    : { goal: { id: scanned.goal.id, objective: scanned.goal.objective, phase: scanned.goal.phase } }
  const counts = {
    directives: verification.directivesIssued,
    relaxations: verification.standard?.relaxed.length ?? 0,
    attempts: verification.runsRecorded,
  }
  // A tampered run means the checks stopped describing the task, so no
  // certificate and no goal phase in the same log can earn credit for it.
  if (verification.lastRun?.verdict === 'tampered') return { outcome: 0, basis: 'tamper', ...goal, ...counts }
  if (verification.standard !== undefined) {
    return verification.certificate === undefined
      ? { outcome: 0, basis: 'certificate', ...goal, ...counts }
      : { outcome: 1, basis: 'certificate', ...goal, certificate: verification.certificate, ...counts }
  }
  if (scanned.completed) return { outcome: null, basis: 'uncertified-completion', ...goal, ...counts }
  return { outcome: null, basis: 'none', ...goal, ...counts }
}

/** Component ids in play, in the component registry's id scheme. */
function componentsOf(scan: LogScan): ComponentIdType[] {
  const ids: string[] = []
  if (scan.agentPreset !== undefined) ids.push(`composition:${scan.agentPreset}`)
  if (scan.environment !== undefined) ids.push(`environment:${scan.environment.environmentId}`)
  if (scan.header !== undefined) ids.push(`model-provider:${scan.header.config.provider}`)
  for (const name of scan.toolNames) ids.push(`tool:${name}`)
  return ids.map(ComponentId)
}

/**
 * Fold one session into its trajectory.
 * @param meta - the session header.
 * @param events - the session's contiguous event log.
 * @returns the trajectory; deterministic for the same inputs.
 */
export function foldTrajectory(meta: SessionHeader, events: readonly SessionEvent[]): Trajectory {
  const scan = scanLog(events)
  const bySeq = new Map(events.map(event => [event.seq, event] as const))
  const messages: TrajectoryMessage[] = []
  for (const seq of foldSurface(events).nodes) {
    const event = bySeq.get(seq)
    /* v8 ignore next -- surface nodes cite seqs of the log they were folded from. */
    if (event === undefined) continue
    const message = projectMessage(event, scan.positions.get(seq))
    if (message !== undefined) messages.push(message)
  }
  const reward = foldTrajectoryReward(events)
  const parity = foldVerification(events).lastRun?.parity
  const header = scan.header
  return {
    format: TRAJECTORY_FORMAT,
    id: meta.id,
    source: {
      sessionId: meta.id,
      createdAt: meta.createdAt,
      ...meta.cwd === undefined ? {} : { cwd: meta.cwd },
      ...meta.parentSession === undefined ? {} : { parentSession: meta.parentSession },
      ...scan.agentPreset === undefined ? {} : { agentPreset: scan.agentPreset },
    },
    ...scan.environment === undefined ? {} : { environment: scan.environment },
    ...header === undefined ? {} : { config: header.config },
    ...header?.system === undefined ? {} : { system: header.system },
    ...header?.tools === undefined ? {} : { tools: header.tools },
    messages,
    steps: scan.steps,
    reward,
    ...parity === undefined ? {} : { parity },
    provenance: {
      components: componentsOf(scan),
      toolNames: scan.toolNames,
      ...reward.certificate === undefined ? {} : { isolation: reward.certificate.isolation },
    },
  }
}
