/**
 * The enterprise graph's 3D layout.
 *
 * The layout is computed once per roster and then cached: it is a force
 * relaxation, not an animation, so running it every frame would buy nothing
 * and cost the frame budget the scene needs. Division clusters are placed on a
 * fixed ring first, then nodes relax inside their cluster under edge springs
 * and local repulsion, which keeps each division readable as a body while the
 * cross-division edges still pull related agents towards each other.
 */

import type { Roster } from './contract.ts'

/** One node's resolved position and its cluster. */
interface GraphNode {
  id: string
  x: number
  y: number
  z: number
  division: string
}

/** A division's cluster centre and label anchor. */
interface GraphCluster {
  id: string
  name: string
  x: number
  y: number
  z: number
  count: number
}

/** The laid-out graph the scene renders. */
export interface GraphLayout {
  nodes: GraphNode[]
  clusters: GraphCluster[]
  /** Index of each node id in `nodes`, for edge and selection lookups. */
  index: Map<string, number>
  /** Radius of the sphere that contains every node, for camera framing. */
  extent: number
}

/** Radius of the shell the division clusters sit on. */
const SHELL_RADIUS = 66

/** How far the shell is flattened vertically, so the graph reads as a body. */
const SHELL_FLATTEN = 0.56

/** Relaxation passes; enough for a stable picture, cheap enough to run on mount. */
const PASSES = 260

/**
 * Deterministic 32-bit PRNG, so the same roster always lays out identically.
 * @param seed - Any 32-bit integer.
 * @returns A function returning the next float in `[0, 1)`.
 */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Lay out one roster.
 * @param roster - The roster to place.
 * @returns Node positions, cluster anchors, and the index the scene reads.
 */
export function layoutRoster(roster: Roster): GraphLayout {
  const next = rng(0xc0ffee)
  const divisions = roster.divisions.map(entry => entry.id)
  const centres = new Map<string, { x: number; y: number; z: number }>()

  // Clusters sit on a flattened Fibonacci shell: evenly spread in every
  // direction, so no orbit angle stacks two divisions on top of each other,
  // while the flattening keeps the whole graph inside a readable frame.
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (const [ordinal, id] of divisions.entries()) {
    const height = 1 - ((ordinal / Math.max(1, divisions.length - 1)) * 2)
    const ring = Math.sqrt(Math.max(0, 1 - (height * height)))
    const angle = golden * ordinal
    centres.set(id, {
      x: Math.cos(angle) * ring * SHELL_RADIUS,
      y: height * SHELL_RADIUS * SHELL_FLATTEN,
      z: Math.sin(angle) * ring * SHELL_RADIUS,
    })
  }

  const nodes: GraphNode[] = roster.agents.map((agent) => {
    const centre = centres.get(agent.division) ?? { x: 0, y: 0, z: 0 }
    return {
      id: agent.id,
      division: agent.division,
      x: centre.x + (next() - 0.5) * 22,
      y: centre.y + (next() - 0.5) * 22,
      z: centre.z + (next() - 0.5) * 22,
    }
  })

  const index = new Map<string, number>()
  for (const [ordinal, node] of nodes.entries()) index.set(node.id, ordinal)

  const springs = roster.edges
    .map(edge => ({ a: index.get(edge.from), b: index.get(edge.to) }))
    .filter((pair): pair is { a: number; b: number } => pair.a !== undefined && pair.b !== undefined)

  // Repulsion runs inside a division only: 147 nodes squared every pass is
  // affordable, but keeping it local is what preserves the cluster reading.
  const byDivision = new Map<string, number[]>()
  for (const [ordinal, node] of nodes.entries()) {
    const list = byDivision.get(node.division) ?? []
    list.push(ordinal)
    byDivision.set(node.division, list)
  }

  for (let pass = 0; pass < PASSES; pass++) {
    const cooling = 1 - (pass / PASSES)

    for (const group of byDivision.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const firstIndex = group[i]
          const secondIndex = group[j]
          if (firstIndex === undefined || secondIndex === undefined) continue
          const first = nodes[firstIndex]
          const second = nodes[secondIndex]
          if (first === undefined || second === undefined) continue
          const dx = second.x - first.x
          const dy = second.y - first.y
          const dz = second.z - first.z
          const distanceSquared = (dx * dx) + (dy * dy) + (dz * dz) + 0.01
          const push = (34 / distanceSquared) * cooling
          const distance = Math.sqrt(distanceSquared)
          const ux = (dx / distance) * push
          const uy = (dy / distance) * push
          const uz = (dz / distance) * push
          first.x -= ux
          first.y -= uy
          first.z -= uz
          second.x += ux
          second.y += uy
          second.z += uz
        }
      }
    }

    for (const spring of springs) {
      const first = nodes[spring.a]
      const second = nodes[spring.b]
      if (first === undefined || second === undefined) continue
      const dx = second.x - first.x
      const dy = second.y - first.y
      const dz = second.z - first.z
      const distance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz)) + 0.001
      const pull = ((distance - 13) / distance) * 0.008 * cooling
      first.x += dx * pull
      first.y += dy * pull
      first.z += dz * pull
      second.x -= dx * pull
      second.y -= dy * pull
      second.z -= dz * pull
    }

    for (const node of nodes) {
      const centre = centres.get(node.division) ?? { x: 0, y: 0, z: 0 }
      node.x += (centre.x - node.x) * 0.02
      node.y += (centre.y - node.y) * 0.02
      node.z += (centre.z - node.z) * 0.02
    }
  }

  // Recentre on the node cloud's own centroid: cluster sizes differ, so the
  // shell's geometric centre is not where the graph actually sits, and the
  // camera frames what it is told is the origin.
  const centroid = nodes.reduce(
    (acc, node) => ({ x: acc.x + node.x, y: acc.y + node.y, z: acc.z + node.z }),
    { x: 0, y: 0, z: 0 },
  )
  centroid.x /= nodes.length
  centroid.y /= nodes.length
  centroid.z /= nodes.length
  for (const node of nodes) {
    node.x -= centroid.x
    node.y -= centroid.y
    node.z -= centroid.z
  }

  // A label sits outside its own cloud, pushed radially away from the graph
  // centre by the cluster's own radius, so it never lands on top of a node.
  const clusters: GraphCluster[] = roster.divisions.map((entry) => {
    const members = nodes.filter(node => node.division === entry.id)
    const count = Math.max(members.length, 1)
    const centre = members.reduce(
      (acc, node) => ({ x: acc.x + node.x, y: acc.y + node.y, z: acc.z + node.z }),
      { x: 0, y: 0, z: 0 },
    )
    centre.x /= count
    centre.y /= count
    centre.z /= count
    const radius = members.reduce((acc, node) => Math.max(
      acc,
      Math.hypot(node.x - centre.x, node.y - centre.y, node.z - centre.z),
    ), 6)
    const distance = Math.hypot(centre.x, centre.y, centre.z) || 1
    const push = (radius + 7) / distance
    return {
      id: entry.id,
      name: entry.name,
      x: centre.x * (1 + push),
      y: (centre.y * (1 + push)) + 4,
      z: centre.z * (1 + push),
      count: members.length,
    }
  })

  const extent = nodes.reduce(
    (acc, node) => Math.max(acc, Math.sqrt((node.x * node.x) + (node.y * node.y) + (node.z * node.z))),
    1,
  )

  return { nodes, clusters, index, extent }
}
