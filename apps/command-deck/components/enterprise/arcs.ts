/**
 * The curve every relationship is drawn on.
 *
 * Edges bow towards the centre of the graph instead of cutting straight across
 * it: with four hundred relationships, straight chords read as noise, while
 * arcs separate into readable strands. The line layer and the traffic layer
 * evaluate the same quadratic Bézier, so a particle always rides the drawn
 * strand rather than a parallel path.
 */

import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three'
import type { RosterEdge } from '@/deck/contract'
import type { GraphLayout } from '@/deck/layout-enterprise'
import { EDGE_COLOR } from '@/deck/palette'
import { edgeLightsAt, type Ignition } from './reveal.ts'

/** Segments each curved edge is drawn with. */
const EDGE_SEGMENTS = 10

/** How far an edge bows towards the graph centre, as a share of its length. */
const EDGE_SAG = 0.22

/** One relationship as the arc both the line layer and the traffic layer ride. */
export interface EdgeArc {
  /** The source agent's node position; traffic starts here. */
  from: Vector3
  /** The Bézier control point, pulled towards the graph centre. */
  mid: Vector3
  /** The target agent's node position; traffic ends here. */
  to: Vector3
  colour: Color
  fromId: string
  toId: string
  /** Where the cold open threads this edge in, from {@link edgeLightsAt}. */
  lightsAt: number
}

const SCRATCH_MID = new Vector3()

/**
 * Resolve the roster's relationships onto the laid-out graph.
 * @param edges - The relationships to place.
 * @param layout - The computed layout supplying node positions.
 * @param ignition - The cold open's clock, which dates each edge to the later of its two divisions.
 * @returns One arc per edge whose endpoints both exist in the layout.
 */
export function buildArcs(
  edges: readonly RosterEdge[],
  layout: GraphLayout,
  ignition: Ignition,
): EdgeArc[] {
  const arcs: EdgeArc[] = []
  for (const edge of edges) {
    const fromIndex = layout.index.get(edge.from) ?? -1
    const toIndex = layout.index.get(edge.to) ?? -1
    const a = layout.nodes[fromIndex]
    const b = layout.nodes[toIndex]
    if (a === undefined || b === undefined) continue
    const from = new Vector3(a.x, a.y, a.z)
    const to = new Vector3(b.x, b.y, b.z)
    const mid = SCRATCH_MID.copy(from).add(to).multiplyScalar(0.5 * (1 - EDGE_SAG)).clone()
    arcs.push({
      from,
      mid,
      to,
      colour: new Color(EDGE_COLOR[edge.kind]),
      fromId: edge.from,
      toId: edge.to,
      lightsAt: edgeLightsAt(ignition, fromIndex, toIndex),
    })
  }
  return arcs
}

/**
 * Evaluate one arc.
 * @param arc - The arc to sample.
 * @param t - Position along the arc, `0` at the source and `1` at the target.
 * @param out - Vector the result is written into.
 * @returns `out`, for chaining.
 */
export function arcPoint(arc: EdgeArc, t: number, out: Vector3): Vector3 {
  const inverse = 1 - t
  return out.set(0, 0, 0)
    .addScaledVector(arc.from, inverse * inverse)
    .addScaledVector(arc.mid, 2 * inverse * t)
    .addScaledVector(arc.to, t * t)
}

/**
 * Build one line-segment geometry for a set of arcs.
 *
 * Each arc dims towards its middle, so the endpoints — the agents — stay the
 * brightest thing in the layer. Every vertex also carries when its edge lights
 * and where it sits along its own arc, which is all the edge material needs to
 * thread the relationship out from its source.
 * @param arcs - The arcs to draw.
 * @returns A geometry with `position`, `color`, `aLightsAt` and `aT` attributes.
 */
export function buildEdgeGeometry(arcs: readonly EdgeArc[]): BufferGeometry {
  const vertices = arcs.length * EDGE_SEGMENTS * 2
  const positions = new Float32Array(vertices * 3)
  const colors = new Float32Array(vertices * 3)
  const lightsAt = new Float32Array(vertices)
  const along = new Float32Array(vertices)
  const point = new Vector3()
  let cursor = 0

  for (const arc of arcs) {
    for (let segment = 0; segment < EDGE_SEGMENTS; segment++) {
      for (const end of [segment / EDGE_SEGMENTS, (segment + 1) / EDGE_SEGMENTS]) {
        arcPoint(arc, end, point)
        const fade = 0.25 + (Math.abs(end - 0.5) * 1.5)
        positions[cursor * 3] = point.x
        positions[(cursor * 3) + 1] = point.y
        positions[(cursor * 3) + 2] = point.z
        colors[cursor * 3] = arc.colour.r * fade
        colors[(cursor * 3) + 1] = arc.colour.g * fade
        colors[(cursor * 3) + 2] = arc.colour.b * fade
        lightsAt[cursor] = arc.lightsAt
        along[cursor] = end
        cursor += 1
      }
    }
  }

  const built = new BufferGeometry()
  built.setAttribute('position', new BufferAttribute(positions, 3))
  built.setAttribute('color', new BufferAttribute(colors, 3))
  built.setAttribute('aLightsAt', new BufferAttribute(lightsAt, 1))
  built.setAttribute('aT', new BufferAttribute(along, 1))
  return built
}
