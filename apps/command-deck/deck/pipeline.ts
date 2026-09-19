/**
 * The program pipeline the process view draws.
 *
 * Four stages, left to right, are fixed: work is produced in departments,
 * executed against checks by Verification, scored by Judging, and merged by
 * Integration. Which lanes exist in the first stage is read from the run
 * itself, so a code-safety run shows its six safety departments and a program
 * run shows its four department goals.
 *
 * The scene metrics live here as well, because the gates, the lane rails, the
 * floor grid, the time plane and the camera must all agree on one coordinate
 * system: the pipeline runs along +x, the lanes are spread along z, and the
 * gates stand vertically in y.
 */

import type { Agent, RunEvent } from './contract.ts'
import { divisionColor, EDGE_COLOR } from './palette.ts'

/** One stage of the pipeline. */
export interface Stage {
  id: string
  name: string
  /** Scene x of the stage's gate; for `departments`, of the lane origin. */
  x: number
  /** Hex colour of the gate's edges, floor pool and arrivals. */
  color: string
}

/**
 * The four stages, in order.
 *
 * The three gates take the colour of the roster edge kind that names what they
 * do — `verifies`, `judges`, `merges` — so a gate and the relationship it
 * stands for read as one colour across the deck. Departments have no gate; the
 * neutral is the lane origin's own glow, behind the per-lane rail colours.
 */
export const STAGES: readonly Stage[] = [
  { id: 'departments', name: 'Departments', x: -78, color: '#6d80a8' },
  { id: 'verification', name: 'Verification', x: -26, color: EDGE_COLOR.verifies },
  { id: 'judging', name: 'Judging', x: 14, color: EDGE_COLOR.judges },
  { id: 'integration', name: 'Integration', x: 54, color: EDGE_COLOR.merges },
]

/** Scene metrics every part of the process view measures against. */
export const PIPELINE = {
  /** x where the lane rails begin, left of the lane origin. */
  railStart: -106,
  /** x where the lane rails end, right of the Integration gate. */
  railEnd: 74,
  /** Distance between two neighbouring lane rails. */
  laneSpan: 16,
  /** y of the lane rails; the comets ride just above them. */
  railY: 0,
  /** y of the floor grid the gates stand on. */
  floorY: -12,
  /** y of a gate's top beam. */
  gateTop: 30,
  /** How far a gate reaches in z beyond the outermost lane. */
  gateMargin: 7,
} as const

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
function laneOf(event: RunEvent, agent: Agent | undefined): string {
  if (agent?.department !== undefined) return agent.department
  if (agent !== undefined) return agent.division
  return event.agentId.split('/')[0] ?? 'unknown'
}

/** One department lane of the first stage. */
interface Lane {
  key: string
  /** Roster name of the agent that emitted most of the lane's events. */
  label: string
  /** The lane's rail colour. */
  color: string
  /** Every agent seen on the lane, which is what the activity clock is read for. */
  agentIds: readonly string[]
}

/** Lanes discovered in a run, in first-appearance order. */
export interface Lanes {
  list: readonly Lane[]
  /** Lane key to its position in `list`. */
  index: ReadonlyMap<string, number>
}

/** How many first-stage lanes the pipeline draws before it stops adding. */
const MAX_LANES = 8

/**
 * How many events lane discovery reads.
 *
 * Lanes, their members and their busiest agent settle in the opening minute of
 * a run, so the scan stops well inside the event window and the lane set stops
 * moving underneath the scene while the rest of the run streams in.
 */
const LANE_SCAN = 1_000

/** Total hue spread, in degrees, given to lanes that share one division colour. */
const LANE_HUE_BAND = 84

/**
 * Split one hex colour into its unit red, green and blue channels.
 * @param hex - A `#rrggbb` colour.
 * @returns The three channels, each in `0..1`.
 */
function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

/**
 * One channel of an HSL colour back in RGB.
 * @param p - The lower bound the hue interpolates from.
 * @param q - The upper bound the hue interpolates to.
 * @param t - Hue position, wrapped into `0..1`.
 * @returns The channel value in `0..1`.
 */
function hueChannel(p: number, q: number, t: number): number {
  const wrapped = (t + 1) % 1
  if (wrapped < 1 / 6) return p + ((q - p) * 6 * wrapped)
  if (wrapped < 1 / 2) return q
  if (wrapped < 2 / 3) return p + ((q - p) * ((2 / 3) - wrapped) * 6)
  return p
}

/**
 * Rotate one colour around the hue circle, keeping its saturation and lightness.
 * @param hex - A `#rrggbb` colour.
 * @param degrees - Hue offset, in degrees.
 * @returns The rotated colour as `#rrggbb`.
 */
function shiftHue(hex: string, degrees: number): string {
  if (degrees === 0) return hex
  const [red, green, blue] = channels(hex)
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  if (max === min) return hex
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  const base = max === red
    ? ((green - blue) / delta) + (green < blue ? 6 : 0)
    : max === green ? ((blue - red) / delta) + 2 : ((red - green) / delta) + 4
  const hue = (base / 6) + (degrees / 360)
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - (lightness * saturation)
  const p = (2 * lightness) - q
  const byte = (value: number): string => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')
  return `#${byte(hueChannel(p, q, hue + (1 / 3)))}${byte(hueChannel(p, q, hue))}${byte(hueChannel(p, q, hue - (1 / 3)))}`
}

/**
 * Title-case one lane key, used when the roster does not name the lane's agent.
 * @param key - The lane key, such as `dependencies` or `code-safety`.
 * @returns The key with each word capitalised.
 */
function titled(key: string): string {
  return key.replace(
    /(^|-)([a-z])/g,
    (_, lead: string, letter: string) => `${lead === '-' ? ' ' : ''}${letter.toUpperCase()}`,
  )
}

/** A lane under construction while the discovery scan runs. */
interface LaneDraft {
  key: string
  division: string
  /** Events per agent seen on the lane, in first-appearance order. */
  counts: Map<string, number>
}

/**
 * Discover the first-stage lanes of one run.
 *
 * Every lane takes its division's colour. Divisions that own several lanes —
 * the six code-safety departments are one division — spread their lanes across
 * a narrow hue band around that colour, so the division stays recognisable
 * while its departments stay apart.
 * @param events - The run's event window, oldest first.
 * @param agents - The roster index.
 * @returns The lanes in first-appearance order.
 */
export function discoverLanes(events: readonly RunEvent[], agents: Map<string, Agent>): Lanes {
  const drafts = new Map<string, LaneDraft>()
  const order: string[] = []

  for (const event of events.slice(0, LANE_SCAN)) {
    const agent = agents.get(event.agentId)
    if (stageOf(event, agent) !== 0) continue
    const key = laneOf(event, agent)
    let draft = drafts.get(key)
    if (draft === undefined) {
      if (order.length >= MAX_LANES) continue
      draft = { key, division: agent?.division ?? key, counts: new Map() }
      drafts.set(key, draft)
      order.push(key)
    }
    draft.counts.set(event.agentId, (draft.counts.get(event.agentId) ?? 0) + 1)
  }

  const shared = new Map<string, string[]>()
  for (const key of order) {
    const base = divisionColor(drafts.get(key)?.division ?? key)
    const group = shared.get(base) ?? []
    group.push(key)
    shared.set(base, group)
  }
  const colors = new Map<string, string>()
  for (const [base, group] of shared) {
    for (const [position, key] of group.entries()) {
      const spread = group.length < 2 ? 0 : ((position / (group.length - 1)) - 0.5) * LANE_HUE_BAND
      colors.set(key, shiftHue(base, spread))
    }
  }

  const list = order.map((key) => {
    const draft = drafts.get(key)
    const agentIds = [...(draft?.counts.keys() ?? [])]
    let principal = agentIds[0]
    let best = 0
    for (const [agentId, total] of draft?.counts ?? []) {
      if (total <= best) continue
      best = total
      principal = agentId
    }
    return {
      key,
      label: (principal === undefined ? undefined : agents.get(principal)?.name) ?? titled(key),
      color: colors.get(key) ?? divisionColor(key),
      agentIds,
    }
  })

  return { list, index: new Map(list.map((lane, position) => [lane.key, position])) }
}

/**
 * Scene z of one lane.
 * @param index - Lane position in `Lanes.list`.
 * @param total - How many lanes the pipeline holds.
 * @returns The lane's z, centred on the pipeline axis; the first lane is the
 * farthest from the camera, so the lanes read top to bottom as the panel lists them.
 */
export function laneZ(index: number, total: number): number {
  return (index - ((total - 1) / 2)) * PIPELINE.laneSpan
}

/**
 * Half the width in z that a gate, the floor pool and the time plane span.
 * @param total - How many lanes the pipeline holds.
 * @returns The half-width, always wide enough to clear the outermost lane.
 */
export function pipelineHalfWidth(total: number): number {
  return (Math.max(total - 1, 1) * PIPELINE.laneSpan / 2) + PIPELINE.gateMargin
}

/** Where one event travels, in stage terms. */
export interface Flight {
  /** The stage the event was logged at. */
  stage: number
  /** Lane position for departmental work, `-1` for anything later in the pipeline. */
  lane: number
  /** Scene x the comet leaves from. */
  fromX: number
  /** Scene x of the gate the comet arrives at. */
  toX: number
  /** The stage whose gate the comet arrives at. */
  arrival: number
}

/**
 * The flight one event's comet takes.
 *
 * Work travels to the next gate. An event logged at Integration has no next
 * gate, so it is drawn arriving at Integration from Judging: a merge is only
 * ever seen landing.
 * @param event - The event to place.
 * @param agent - The acting agent, when the roster knows it.
 * @param lanes - The discovered lanes, which place departmental work.
 * @returns The flight's stages and its two x positions.
 */
export function flightOf(event: RunEvent, agent: Agent | undefined, lanes: Lanes): Flight {
  const stage = stageOf(event, agent)
  const last = STAGES.length - 1
  const arrival = Math.min(stage + 1, last)
  const source = stage === last ? last - 1 : stage
  return {
    stage,
    lane: stage === 0 ? lanes.index.get(laneOf(event, agent)) ?? -1 : -1,
    fromX: STAGES[source]?.x ?? 0,
    toX: STAGES[arrival]?.x ?? 0,
    arrival,
  }
}

/**
 * How many events each lane has produced.
 * @param events - The events the timeline admits.
 * @param agents - The roster index.
 * @param lanes - The discovered lanes.
 * @returns One total per lane, indexed as `Lanes.list`.
 */
export function laneTotals(
  events: readonly RunEvent[],
  agents: Map<string, Agent>,
  lanes: Lanes,
): number[] {
  const totals = lanes.list.map(() => 0)
  for (const event of events) {
    const agent = agents.get(event.agentId)
    if (stageOf(event, agent) !== 0) continue
    const position = lanes.index.get(laneOf(event, agent))
    if (position === undefined) continue
    totals[position] = (totals[position] ?? 0) + 1
  }
  return totals
}
