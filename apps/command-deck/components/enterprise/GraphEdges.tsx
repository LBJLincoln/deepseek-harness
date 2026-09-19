'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Vector3,
  type LineBasicMaterial,
  type Points,
} from 'three'
import type { Roster } from '@/deck/contract'
import type { GraphLayout } from '@/deck/layout-enterprise'
import { usePrefersReducedMotion } from '@/deck/motion'
import { useDeck } from '@/deck/store'
import { createGlowMaterial } from '@/components/three/glow'
import { FLOW_WINDOW_MS, sinceLast } from './activity.ts'
import { arcPoint, buildArcs, buildEdgeGeometry, type EdgeArc } from './arcs.ts'

/** How many traffic particles the scene keeps, shared out over the edges that are carrying work. */
const PARTICLES = 320

/** How many particles one edge carries at once. */
const PER_EDGE = 3

/** How often the set of edges carrying traffic is recomputed, in milliseconds. */
const LIVE_REFRESH_MS = 220

/** Slowest and fastest crossing of one edge, in seconds. */
const CROSSING = { slow: 2.4, fast: 1.3 }

/** Particle size in the point material's units. */
const PARTICLE_SIZE = 7.5

/** Standing opacity of the edge layer. */
const EDGE_OPACITY = 0.26

/** How far the edge layer breathes around its standing opacity. */
const BREATH = 0.075

/** Breaths per second: slow enough to read as light, never as traffic. */
const BREATH_RATE = 0.62

/** How far an edge unrelated to the selected agent falls back. */
const DIM = 0.3

const SCRATCH_POINT = new Vector3()

/**
 * The traffic on the graph: one particle layer that moves only where the run
 * is moving.
 *
 * A particle rides an edge from its source to its target when either endpoint
 * has acted inside the activity window, and carries the edge's own kind
 * colour. With nothing live no particle is drawn: an idle enterprise looks
 * idle, and the slow breath of the edge layer is the only thing that moves.
 * @param props - The arcs to carry traffic, and the selection mask that dims the rest.
 * @returns The traffic layer.
 */
function EdgeTraffic({ arcs, mask }: { arcs: readonly EdgeArc[]; mask: Uint8Array | undefined }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const activity = useDeck(state => state.activity)
  const points = useRef<Points>(null)

  const geometry = useMemo(() => {
    const built = new BufferGeometry()
    built.setAttribute('position', new BufferAttribute(new Float32Array(PARTICLES * 3), 3))
    built.setAttribute('aColor', new BufferAttribute(new Float32Array(PARTICLES * 3), 3))
    built.setAttribute('aSize', new BufferAttribute(new Float32Array(PARTICLES), 1))
    built.setAttribute('aGain', new BufferAttribute(new Float32Array(PARTICLES), 1))
    return built
  }, [])

  const material = useMemo(createGlowMaterial, [])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  const pool = useMemo(() => ({
    edge: new Int32Array(PARTICLES).fill(-1),
    progress: new Float32Array(PARTICLES),
    speed: new Float32Array(PARTICLES),
    live: new Int32Array(Math.max(1, arcs.length)),
    liveCount: 0,
    checkedAt: 0,
    cursor: 0,
  }), [arcs.length])

  useFrame((_, delta) => {
    const layer = points.current
    if (layer === null) return
    const now = performance.now()
    const positions = geometry.getAttribute('position')
    const colors = geometry.getAttribute('aColor')
    const sizes = geometry.getAttribute('aSize')
    const gains = geometry.getAttribute('aGain')

    // The live set changes only as events land, so it is recomputed on its own
    // slow clock rather than once per frame.
    if (now - pool.checkedAt > LIVE_REFRESH_MS) {
      pool.checkedAt = now
      let count = 0
      if (!reduced) {
        for (const [index, arc] of arcs.entries()) {
          const from = sinceLast(activity, arc.fromId, now)
          const to = sinceLast(activity, arc.toId, now)
          if (Math.min(from, to) < FLOW_WINDOW_MS) {
            pool.live[count] = index
            count += 1
          }
        }
      }
      pool.liveCount = count
    }

    const capacity = Math.min(PARTICLES, pool.liveCount * PER_EDGE)
    let riding = 0
    let recoloured = false

    for (let particle = 0; particle < PARTICLES; particle++) {
      let edge = pool.edge[particle] ?? -1
      let progress = pool.progress[particle] ?? 0

      if (edge >= 0) {
        progress += (pool.speed[particle] ?? 0.5) * delta
        if (progress > 1) edge = -1
      }

      if (edge < 0 && riding < capacity) {
        pool.cursor = (pool.cursor + 1) % Math.max(1, pool.liveCount)
        edge = pool.live[pool.cursor] ?? -1
        // A new particle enters on a stagger, so a busy edge reads as a stream
        // of separate packets rather than one wall of light.
        progress = -Math.random() * 0.85
        pool.speed[particle] = 1 / (CROSSING.fast + (Math.random() * (CROSSING.slow - CROSSING.fast)))
        const arc = arcs[edge]
        if (arc !== undefined) {
          colors.setXYZ(particle, arc.colour.r, arc.colour.g, arc.colour.b)
          recoloured = true
        }
      }

      pool.edge[particle] = edge
      pool.progress[particle] = progress

      const arc = edge < 0 ? undefined : arcs[edge]
      if (arc === undefined || progress < 0 || progress > 1) {
        sizes.setX(particle, 0)
        gains.setX(particle, 0)
        if (edge >= 0) riding += 1
        continue
      }

      riding += 1
      arcPoint(arc, progress, SCRATCH_POINT)
      positions.setXYZ(particle, SCRATCH_POINT.x, SCRATCH_POINT.y, SCRATCH_POINT.z)
      sizes.setX(particle, PARTICLE_SIZE)
      const ends = Math.min(1, progress * 7, (1 - progress) * 7)
      gains.setX(particle, ends * 1.5 * (mask === undefined || mask[edge] === 1 ? 1 : DIM))
    }

    positions.needsUpdate = true
    sizes.needsUpdate = true
    gains.needsUpdate = true
    if (recoloured) colors.needsUpdate = true
  })

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />
}

/**
 * The roster's relationships: one additive line layer for the graph, a
 * brighter layer for the selected agent's own edges, and the traffic on top.
 * @param props - The roster and its computed layout.
 * @returns The edge scene contents.
 */
export function GraphEdges({ roster, layout }: { roster: Roster; layout: GraphLayout }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const selectedId = useDeck(state => state.selectedAgentId)
  const base = useRef<LineBasicMaterial>(null)

  const arcs = useMemo(() => buildArcs(roster.edges, layout), [roster.edges, layout])

  const geometry = useMemo(() => buildEdgeGeometry(arcs), [arcs])
  useEffect(() => () => geometry.dispose(), [geometry])

  const selectedArcs = useMemo(
    () => (selectedId === undefined
      ? []
      : arcs.filter(arc => arc.fromId === selectedId || arc.toId === selectedId)),
    [arcs, selectedId],
  )

  const selectedGeometry = useMemo(() => buildEdgeGeometry(selectedArcs), [selectedArcs])
  useEffect(() => () => selectedGeometry.dispose(), [selectedGeometry])

  const mask = useMemo(() => {
    if (selectedId === undefined) return undefined
    const flags = new Uint8Array(arcs.length)
    for (const [index, arc] of arcs.entries()) {
      flags[index] = arc.fromId === selectedId || arc.toId === selectedId ? 1 : 0
    }
    return flags
  }, [arcs, selectedId])

  useFrame(({ clock }) => {
    const material = base.current
    if (material === null) return
    // Breathing, not traffic: one brightness for the whole layer, slow enough
    // that it never suggests an agent is at work.
    const breath = reduced ? 0 : Math.sin(clock.elapsedTime * BREATH_RATE) * BREATH
    material.opacity = selectedId === undefined ? EDGE_OPACITY + breath : EDGE_OPACITY * DIM
  })

  return (
    <group>
      <lineSegments geometry={geometry} frustumCulled={false}>
        <lineBasicMaterial
          ref={base}
          vertexColors
          transparent
          opacity={EDGE_OPACITY}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <lineSegments geometry={selectedGeometry} frustumCulled={false}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={1}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <EdgeTraffic arcs={arcs} mask={mask} />
    </group>
  )
}
