/**
 * The program pipeline the process view draws.
 *
 * Four stages, left to right, are fixed: work is produced in departments,
 * executed against checks by Verification, scored by Judging, and merged by
 * Integration. Which lanes exist in the first stage is read from the run
 * itself, so a code-safety run shows its six safety departments and a program
 * run shows its four department goals.
 */

import type { Agent, RunEvent } from './contract.ts'

/** One stage of the pipeline. */
export interface Stage {
  id: string
  name: string
  /** Scene x of the stage's column. */
  x: number
}

/** The four stages, in order. */
export const STAGES: readonly Stage[] = [
  { id: 'departments', name: 'Departments', x: -52 },
  { id: 'verification', name: 'Verification', x: -16 },
  { id: 'judging', name: 'Judging', x: 18 },
  { id: 'integration', name: 'Integration', x: 52 },
]

/**
 * Which stage one event belongs to.
 * @param event - The event to place.
 * @param agent - The acting agent, when the roster knows it.
 * @returns The stage index, `0` when the event is departmental work.
 */
export function stageOf(event: RunEvent, agent: Agent | undefined): number {
  if (event.kind === 'merge') return 3
  const division = agent?.division ?? event.agentId.split('/')[0] ?? ''
  if (division === 'verification') return 1
  if (division === 'judging') return 2
  if (division === 'governance') return 3
  if (division === 'curation') return 3
  if (event.agentId.includes('integration') || event.agentId.includes('release')) return 3
  return 0
}

/**
 * Which first-stage lane one event belongs to.
 * @param event - The event to place.
 * @param agent - The acting agent, when the roster knows it.
 * @returns The lane key: a department where the agent has one, else its division.
 */
export function laneOf(event: RunEvent, agent: Agent | undefined): string {
  if (agent?.department !== undefined) return agent.department
  if (agent !== undefined) return agent.division
  return event.agentId.split('/')[0] ?? 'unknown'
}

/** Lanes discovered in a run, in first-appearance order. */
export interface Lanes {
  keys: string[]
  labels: Map<string, string>
}

/** How many first-stage lanes the pipeline draws before it stops adding. */
const MAX_LANES = 8

/**
 * Discover the first-stage lanes of one run.
 * @param events - Every event seen so far.
 * @param agents - The roster index.
 * @returns The lane keys in first-appearance order, with display labels.
 */
export function discoverLanes(events: readonly RunEvent[], agents: Map<string, Agent>): Lanes {
  const keys: string[] = []
  const labels = new Map<string, string>()
  for (const event of events) {
    const agent = agents.get(event.agentId)
    if (stageOf(event, agent) !== 0) continue
    const key = laneOf(event, agent)
    if (labels.has(key)) continue
    labels.set(key, key.replace(/(^|-)([a-z])/g, (_, lead: string, letter: string) => `${lead === '-' ? ' ' : ''}${letter.toUpperCase()}`))
    keys.push(key)
    if (keys.length >= MAX_LANES) break
  }
  return { keys, labels }
}

/**
 * Scene y of one lane.
 * @param index - Lane position in `Lanes.keys`.
 * @param total - How many lanes the pipeline holds.
 * @returns The lane's y, centred on the stage.
 */
export function laneY(index: number, total: number): number {
  const span = 9.5
  return ((total - 1) / 2 - index) * span
}
