/**
 * The followed run's own workflow graph, derived from its event stream.
 *
 * A node is one session of the run, named by the seat that acted in it, or by
 * the program member its id names when the feed attributes it to no seat. The
 * relationships between sessions are not carried by any frame: the feed folds
 * a program run's sessions under one id — the root is `program-<digest>`, a
 * department is `program-<digest>-<department>` and the integration session is
 * the `@integration` child, which the feed decodes from the `~0040` escape the
 * session directory is written with. This module reads that naming and nothing
 * else, so a run whose sessions are not named that way — a fleet or an
 * experiment, whose cells are `environment-<uuid>` — falls back to the pipeline
 * stage each session's work was logged at, and draws no spawn edges, because
 * nothing in the run states who started whom.
 *
 * Everything here is a pure function of the events the timeline admits, so
 * scrubbing or replaying the timeline rebuilds the graph as it stood then.
 */

import { actorOf, seatOf, type Agent, type RunEvent } from './contract.ts'
import { divisionColor } from './palette.ts'
import { discoverLanes, stageOf } from './pipeline.ts'
import { eventTimeMs } from './store.ts'

/**
 * A program run's session ids: the kind, the program's content digest, and the
 * department or `@integration` suffix of a child.
 */
const PROGRAM_SESSION = /^(program-[0-9a-f]{8,})(?:-.+)?$/

/** The integration suffix, after the `@` or its `~0040` escape is stripped. */
const INTEGRATION = 'integration'

/** Distance between two tiers, along +x. */
const TIER_SPAN = 76

/** Distance between two nodes of one tier, along y, where the tier has room. */
const NODE_SPAN = 32

/**
 * How much room in y one tier is given.
 *
 * A tier packs its nodes closer rather than growing past this, because a fleet
 * run opens dozens of cells at once and a graph the camera cannot frame shows
 * nothing at all.
 */
const TIER_HEIGHT = 300

/** Spacing below which a node's name would sit on its neighbour's. */
const NAME_SPACING = 18

/** Clear space kept around the graph when the camera frames it. */
const MARGIN = 22

/** Colour of a node the roster places in no division. */
const NEUTRAL = '#8296b8'

/** One session of the run. */
export interface WorkflowNode {
  /** The session id, which is the node's identity across rebuilds. */
  id: string
  /**
   * Roster name of the seat that acted most in the session; for a session no
   * seat is attributed to, the program member its id names, else its short id.
   */
  label: string
  /**
   * The actor that acted most in the session (see `actorOf`): its seat's id, or
   * the session's own id when it occupies no seat; `undefined` for an implied node.
   */
  agentId: string | undefined
  tier: number
  x: number
  y: number
  color: string
  /** How many admitted frames the session logged. */
  events: number
  certificates: number
  merges: number
  refusals: number
  directives: number
  /** Whether the session's work is the run's integration step. */
  integration: boolean
  /** When the session's newest admitted frame was logged, or `NaN` with none. */
  lastMs: number
  /** The newest admitted frame's label, or `undefined` with none. */
  lastLabel: string | undefined
  /**
   * Whether the session is named only by its children's ids.
   *
   * A run's root emits little and late, so a cut of the timeline that has not
   * reached its first frame still has to draw the parent its children hang off.
   */
  implied: boolean
}

/** A directed relationship the graph draws between two sessions. */
interface WorkflowEdge {
  id: string
  from: string
  to: string
  /** `spawn` is the naming relationship; `merge` is a certified result joining integration. */
  kind: 'spawn' | 'merge'
  /**
   * Whether the parent logged the delegation itself.
   *
   * A logged `delegation` names the relationship at the moment it is made, so
   * its edge is drawn at once instead of growing as the child's first frame
   * arrives.
   */
  immediate: boolean
}

/** The graph one cut of the timeline produces. */
export interface WorkflowGraph {
  nodes: readonly WorkflowNode[]
  edges: readonly WorkflowEdge[]
  byId: ReadonlyMap<string, WorkflowNode>
  /** How many admitted frames carry a certificate, across every session. */
  certificates: number
  /** How many admitted frames carry a merge, across every session. */
  merges: number
  /** The largest event count on any node; the node meters are read against it. */
  busiest: number
  /**
   * Whether a tier had to pack its nodes closer than a name needs.
   *
   * The scene drops the names at that point and leaves the sessions to the
   * hover card and the panel, rather than printing them over each other.
   */
  dense: boolean
  /** Half the graph's reach in x and y, which is what the camera frames. */
  extent: { x: number; y: number }
}

/** One session under construction while the scan runs. */
interface Draft {
  id: string
  /** Frames per actor, in first-appearance order. */
  counts: Map<string, number>
  events: number
  certificates: number
  merges: number
  refusals: number
  directives: number
  lastMs: number
  lastLabel: string | undefined
  /** The lowest pipeline stage the session's work was logged at. */
  stage: number
}

/**
 * The integration suffix in any of the forms a session directory carries it.
 * @param suffix - The session id's suffix under the run root.
 * @returns Whether the suffix names the integration session.
 */
function isIntegration(suffix: string): boolean {
  return suffix.replace(/^(@|~0040)/, '') === INTEGRATION
}

/**
 * What one session id carries under the run root.
 * @param id - The session id.
 * @param root - The run root, when the ids state one.
 * @returns The suffix, empty for the root itself and for a run with no root.
 */
function suffixOf(id: string, root: string | undefined): string {
  return root === undefined || id === root ? '' : id.slice(root.length + 1)
}

/**
 * The run root every session hangs off, when the ids state one.
 * @param ids - Every session id the admitted events carry.
 * @returns The root session id, or `undefined` when the run names no hierarchy.
 */
function rootOf(ids: readonly string[]): string | undefined {
  let root: string | undefined
  for (const id of ids) {
    const match = PROGRAM_SESSION.exec(id)
    if (match === null) return undefined
    const candidate = match[1]
    if (candidate === undefined) return undefined
    if (root === undefined) root = candidate
    // Two programs folded into one stream share no root, so neither owns the graph.
    else if (root !== candidate) return undefined
  }
  return root
}

/**
 * A short, stable name for a session no admitted frame acts in.
 * @param id - The session id.
 * @returns The id truncated to its kind and the head of its digest.
 */
function shortId(id: string): string {
  return id.length <= 24 ? id : `${id.slice(0, 22)}…`
}

/**
 * The session one session was started under.
 *
 * The longest id the child's own id extends is the parent, so a grandchild
 * hangs off its own parent rather than off the run root. Matching on the whole
 * parent id rather than on the suffix's separators is what keeps a department
 * whose name carries a hyphen in the tier its parent puts it in.
 * @param id - The child session id.
 * @param ids - Every session id the graph holds.
 * @returns The parent session id, or `undefined` for a session that extends none.
 */
function parentOf(id: string, ids: readonly string[]): string | undefined {
  let parent: string | undefined
  for (const candidate of ids) {
    if (candidate === id || !id.startsWith(`${candidate}-`)) continue
    if (parent === undefined || candidate.length > parent.length) parent = candidate
  }
  return parent
}

/**
 * Scan the admitted events into one draft per session.
 * @param events - The events the timeline admits, in any order.
 * @param agents - The roster index, which places each frame in the pipeline.
 * @returns The drafts, in first-appearance order.
 */
function draftSessions(events: readonly RunEvent[], agents: Map<string, Agent>): Draft[] {
  const drafts = new Map<string, Draft>()
  for (const event of events) {
    let draft = drafts.get(event.sessionId)
    if (draft === undefined) {
      draft = {
        id: event.sessionId,
        counts: new Map(),
        events: 0,
        certificates: 0,
        merges: 0,
        refusals: 0,
        directives: 0,
        lastMs: Number.NaN,
        lastLabel: undefined,
        stage: stageOf(event, seatOf(event, agents)),
      }
      drafts.set(event.sessionId, draft)
    }
    draft.events += 1
    const actor = actorOf(event)
    draft.counts.set(actor, (draft.counts.get(actor) ?? 0) + 1)
    if (event.kind === 'certificate') draft.certificates += 1
    if (event.kind === 'merge') draft.merges += 1
    if (event.kind === 'refusal') draft.refusals += 1
    if (event.kind === 'directive') draft.directives += 1
    draft.stage = Math.min(draft.stage, stageOf(event, seatOf(event, agents)))
    const at = eventTimeMs(event)
    if (Number.isNaN(draft.lastMs) || (!Number.isNaN(at) && at >= draft.lastMs)) {
      draft.lastMs = at
      draft.lastLabel = event.label
    }
  }
  return [...drafts.values()]
}

/**
 * The seat that did most of one session's work.
 * @param counts - Frames per acting agent.
 * @returns The agent id, or `undefined` when the session logged nothing.
 */
function principalOf(counts: ReadonlyMap<string, number>): string | undefined {
  let principal: string | undefined
  let best = 0
  for (const [agentId, total] of counts) {
    if (total <= best) continue
    best = total
    principal = agentId
  }
  return principal
}

/**
 * Lane colour per acting agent, so a department reads in the same colour here
 * as on its rail in the process view.
 * @param events - The events the timeline admits.
 * @param agents - The roster index.
 * @returns One colour per agent id the lanes cover.
 */
function laneColors(events: readonly RunEvent[], agents: Map<string, Agent>): Map<string, string> {
  const colors = new Map<string, string>()
  for (const lane of discoverLanes(events, agents).list) {
    for (const agentId of lane.agentIds) colors.set(agentId, lane.color)
  }
  return colors
}

/**
 * Tier each session sits in, left to right.
 *
 * Under a program root the tier is the depth of the id's prefix chain, and the
 * integration session is pushed past the deepest department whatever its own
 * depth, because integration is the last thing the run does. With no root the
 * tier is the pipeline stage the session's earliest work was logged at.
 * @param drafts - The scanned sessions.
 * @param root - The run root, when the ids state one.
 * @param parents - The parent session id per child, where the ids state one.
 * @returns The tier per session id.
 */
function tiersOf(drafts: readonly Draft[], root: string | undefined, parents: ReadonlyMap<string, string>): Map<string, number> {
  const tiers = new Map<string, number>()
  if (root === undefined) {
    for (const draft of drafts) tiers.set(draft.id, draft.stage)
    return tiers
  }

  const depthOf = (id: string): number => {
    let depth = 0
    let walk = parents.get(id)
    while (walk !== undefined) {
      depth += 1
      walk = parents.get(walk)
    }
    return depth
  }

  const integration: string[] = []
  let deepest = 0
  for (const draft of drafts) {
    if (isIntegration(suffixOf(draft.id, root))) {
      integration.push(draft.id)
      continue
    }
    const depth = depthOf(draft.id)
    deepest = Math.max(deepest, depth)
    tiers.set(draft.id, depth)
  }
  for (const id of integration) tiers.set(id, deepest + 1)
  return tiers
}

/**
 * The workflow graph of one cut of a run.
 * @param events - The events the timeline admits, in any order.
 * @param agents - The roster index, which names the seat acting in each session.
 * @returns The nodes, the edges between them, and what the camera frames.
 */
export function layoutWorkflow(events: readonly RunEvent[], agents: Map<string, Agent>): WorkflowGraph {
  // Frames arrive in the order the feed folds its sessions, not the order they
  // were logged, so the scan reads the logged order: a tier then fans its
  // sessions out in the order they first reported, and a department takes the
  // same lane colour here as it does on its rail in the process view.
  const logged = [...events].sort((left, right) => eventTimeMs(left) - eventTimeMs(right))
  const drafts = draftSessions(logged, agents)
  const root = rootOf(drafts.map(draft => draft.id))
  // The root emits its merges last, so a cut short of them still has to draw it.
  if (root !== undefined && !drafts.some(draft => draft.id === root)) {
    drafts.unshift({
      id: root,
      counts: new Map(),
      events: 0,
      certificates: 0,
      merges: 0,
      refusals: 0,
      directives: 0,
      lastMs: Number.NaN,
      lastLabel: undefined,
      stage: 0,
    })
  }

  const ids = drafts.map(draft => draft.id)
  const parents = new Map<string, string>()
  for (const id of ids) {
    const parent = parentOf(id, ids)
    if (parent !== undefined) parents.set(id, parent)
  }

  const tiers = tiersOf(drafts, root, parents)
  const colors = laneColors(logged, agents)
  const perTier = new Map<number, Draft[]>()
  for (const draft of drafts) {
    const tier = tiers.get(draft.id) ?? 0
    const row = perTier.get(tier) ?? []
    row.push(draft)
    perTier.set(tier, row)
  }
  const spread = [...perTier.keys()].sort((left, right) => left - right)

  const nodes: WorkflowNode[] = []
  let dense = false
  for (const [column, tier] of spread.entries()) {
    const row = perTier.get(tier) ?? []
    const span = Math.min(NODE_SPAN, TIER_HEIGHT / Math.max(1, row.length - 1))
    dense = dense || (row.length > 1 && span < NAME_SPACING)
    for (const [index, draft] of row.entries()) {
      const principal = principalOf(draft.counts)
      const agent = principal === undefined ? undefined : agents.get(principal)
      const member = suffixOf(draft.id, root)
      const unseated = principal === undefined || principal === draft.id
      nodes.push({
        id: draft.id,
        label: agent?.name ?? (unseated ? (member === '' ? shortId(draft.id) : member) : principal),
        agentId: principal,
        tier: column,
        x: (column - ((spread.length - 1) / 2)) * TIER_SPAN,
        y: (((row.length - 1) / 2) - index) * span,
        color: (principal === undefined ? undefined : colors.get(principal))
          ?? (agent === undefined ? NEUTRAL : divisionColor(agent.division)),
        events: draft.events,
        certificates: draft.certificates,
        merges: draft.merges,
        refusals: draft.refusals,
        directives: draft.directives,
        integration: isIntegration(suffixOf(draft.id, root)),
        lastMs: draft.lastMs,
        lastLabel: draft.lastLabel,
        implied: draft.events === 0,
      })
    }
  }

  const byId = new Map(nodes.map(node => [node.id, node]))
  const delegating = new Set(
    logged.filter(event => event.kind === 'delegation').map(event => event.sessionId),
  )
  const edges: WorkflowEdge[] = []
  for (const node of nodes) {
    const parent = parents.get(node.id)
    if (parent === undefined) continue
    edges.push({
      id: `spawn:${node.id}`,
      from: parent,
      to: node.id,
      kind: 'spawn',
      immediate: delegating.has(parent),
    })
  }

  const merges = nodes.reduce((total, node) => total + node.merges, 0)
  const integration = nodes.find(node => node.integration)
  if (merges > 0 && integration !== undefined) {
    for (const node of nodes) {
      if (node.integration || node.id === root || node.certificates === 0) continue
      edges.push({ id: `merge:${node.id}`, from: node.id, to: integration.id, kind: 'merge', immediate: false })
    }
  }

  return {
    nodes,
    edges,
    byId,
    certificates: nodes.reduce((total, node) => total + node.certificates, 0),
    merges,
    busiest: nodes.reduce((most, node) => Math.max(most, node.events), 0),
    dense,
    extent: {
      x: nodes.reduce((reach, node) => Math.max(reach, Math.abs(node.x)), 0) + MARGIN,
      y: nodes.reduce((reach, node) => Math.max(reach, Math.abs(node.y)), 0) + MARGIN,
    },
  }
}
