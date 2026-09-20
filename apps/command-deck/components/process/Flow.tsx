'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { BufferAttribute, BufferGeometry, Color, Vector3, type Mesh, type Points } from 'three'
import type { Agent, EventKind, RunEvent } from '@/deck/contract'
import { usePrefersReducedMotion } from '@/deck/motion'
import { flightOf, laneZ, PIPELINE, STAGES, type Lanes } from '@/deck/pipeline'
import { playbackClock } from '@/deck/playback'
import { createGlowMaterial } from '@/components/three/glow'
import { createTrailMaterial } from './materials'
import { lookOf } from './kinds'
import type { PipelineHeat, RingRequest } from './heat'

/** How many comets can be in flight at once. */
const FLIGHTS = 96

/** How many head points the layer holds; the surplus carries the reduced-motion dots. */
const POINTS = 360

/** How many points one trail ribbon is sampled at. */
const SEGMENTS = 14

/**
 * How many comets leave per second of real time, at recorded speed.
 *
 * A run's history reaches the deck in one burst, and a burst launched in one
 * frame is a single flash rather than work travelling. The launch queue
 * therefore releases at a fixed rate, so every logged event is seen to travel.
 * Playback multiplies that rate by its own speed, because a queue that kept
 * releasing ten a second while the cursor ran sixty times faster would fall
 * behind the run it is drawing.
 */
const LAUNCH_PER_SECOND = 10

/** How many events wait to be launched; a longer burst shows its latest events. */
const QUEUE = 720

/** How far a comet is nudged off its lane centre, so simultaneous work stays apart. */
const LANE_JITTER = 4.2

/** How far towards the pipeline axis a lane's work converges as it reaches the gate. */
const CONVERGENCE = 0.38

/** Where along a lane the reduced-motion row of still dots begins, clear of its label. */
const STILL_START = 0.12

/** Rings the arrival of one event sets off, by kind. */
const ARRIVAL_RING: Partial<Record<EventKind, { life: number; radius: number }>> = {
  certificate: { life: 1_500, radius: 34 },
  merge: { life: 1_800, radius: 42 },
}

/** One event in flight between two stages. */
interface Comet {
  started: number
  flightMs: number
  fromX: number
  toX: number
  fromZ: number
  toZ: number
  lift: number
  span: number
  width: number
  size: number
  color: Color
  /** Stage id of the gate this comet arrives at. */
  gate: string
  /** The ring the arrival sets off, when the kind sets one off. */
  ring: RingRequest | undefined
  /** Whether the arrival has already been reported to the gates. */
  flared: boolean
}

const HEAD = new Vector3()
const AHEAD = new Vector3()

/**
 * Where one comet is at a point of its flight.
 * @param comet - The comet in flight.
 * @param t - Flight position, `0` at its stage and `1` at the gate.
 * @param out - The vector the position is written into.
 * @returns The same vector, for chaining.
 */
function pathAt(comet: Comet, t: number, out: Vector3): Vector3 {
  const eased = t * t * (3 - (2 * t))
  return out.set(
    comet.fromX + ((comet.toX - comet.fromX) * eased),
    PIPELINE.railY + (comet.lift * Math.sin(Math.PI * eased)),
    comet.fromZ + ((comet.toZ - comet.fromZ) * eased),
  )
}

/**
 * The comet one event flies as.
 * @param event - The event being launched.
 * @param agent - The acting agent, when the roster knows it.
 * @param lanes - The discovered lanes, which place departmental work.
 * @param started - When the comet leaves, in `performance.now()` milliseconds.
 * @param spread - Offset from the lane centre, in `-0.5..0.5`.
 * @returns The comet, ready to be animated.
 */
function cometOf(
  event: RunEvent,
  agent: Agent | undefined,
  lanes: Lanes,
  started: number,
  spread: number,
): Comet {
  const flight = flightOf(event, agent, lanes)
  const look = lookOf(event)
  const jitter = spread * LANE_JITTER
  const fromZ = (flight.lane >= 0 ? laneZ(flight.lane, lanes.list.length) : 0) + jitter
  const ring = ARRIVAL_RING[event.kind]
  return {
    started,
    flightMs: look.flightMs,
    fromX: flight.fromX,
    toX: flight.toX,
    fromZ,
    toZ: flight.lane >= 0 ? fromZ * CONVERGENCE : jitter * 0.5,
    lift: look.lift,
    span: look.span,
    width: look.width,
    size: look.size,
    color: new Color(look.color),
    gate: STAGES[flight.arrival]?.id ?? 'integration',
    ring: ring === undefined
      ? undefined
      : { x: flight.toX, color: look.color, life: ring.life, radius: ring.radius },
    flared: false,
  }
}

/**
 * The events in flight: one point layer for the heads, one mesh for the trails.
 *
 * Both layers are fixed-size buffers written from the frame loop, so the number
 * of draw calls never depends on how busy the run is. A trail is not a recorded
 * history of where its comet has been: the flight path is a function of time,
 * so every point of the ribbon is that same function evaluated slightly in the
 * past, which costs one buffer write and no per-comet state.
 *
 * Under reduced motion nothing moves. The most recent events the point layer
 * has room for instead stand as still dots on their own rails, spaced by their
 * position in the lane's work, and the trail layer stays dark.
 * @param props - The events the timeline admits, the roster index, the
 * discovered lanes, and the shared frame state arrivals are reported through.
 * @returns The comet layers.
 */
export function Flow({
  events,
  agents,
  lanes,
  heat,
}: {
  events: readonly RunEvent[]
  agents: Map<string, Agent>
  lanes: Lanes
  heat: PipelineHeat
}): ReactNode {
  const reduced = usePrefersReducedMotion()
  const points = useRef<Points>(null)
  const ribbons = useRef<Mesh>(null)
  const live = useRef<Comet[]>([])
  const queue = useRef<RunEvent[]>([])
  const emitted = useRef(0)
  const released = useRef(0)

  const headGeometry = useMemo(() => {
    const built = new BufferGeometry()
    built.setAttribute('position', new BufferAttribute(new Float32Array(POINTS * 3), 3))
    built.setAttribute('aColor', new BufferAttribute(new Float32Array(POINTS * 3), 3))
    built.setAttribute('aSize', new BufferAttribute(new Float32Array(POINTS).fill(11), 1))
    built.setAttribute('aGain', new BufferAttribute(new Float32Array(POINTS), 1))
    return built
  }, [])

  const trailGeometry = useMemo(() => {
    const vertices = FLIGHTS * SEGMENTS * 2
    const built = new BufferGeometry()
    built.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3))
    built.setAttribute('aTangent', new BufferAttribute(new Float32Array(vertices * 3), 3))
    built.setAttribute('aColor', new BufferAttribute(new Float32Array(vertices * 3), 3))
    built.setAttribute('aSide', new BufferAttribute(new Float32Array(vertices), 1))
    built.setAttribute('aWidth', new BufferAttribute(new Float32Array(vertices), 1))
    built.setAttribute('aGain', new BufferAttribute(new Float32Array(vertices), 1))
    const side = built.getAttribute('aSide')
    const indices: number[] = []
    for (let flight = 0; flight < FLIGHTS; flight++) {
      for (let segment = 0; segment < SEGMENTS; segment++) {
        const pair = ((flight * SEGMENTS) + segment) * 2
        side.setX(pair, -1)
        side.setX(pair + 1, 1)
        if (segment === SEGMENTS - 1) continue
        indices.push(pair, pair + 1, pair + 2, pair + 1, pair + 3, pair + 2)
      }
    }
    built.setIndex(indices)
    return built
  }, [])

  const headMaterial = useMemo(createGlowMaterial, [])
  const trailMaterial = useMemo(createTrailMaterial, [])

  useEffect(() => () => {
    headGeometry.dispose()
    trailGeometry.dispose()
    headMaterial.dispose()
    trailMaterial.dispose()
  }, [headGeometry, trailGeometry, headMaterial, trailMaterial])

  // The timeline can jump backwards; only forward movement queues anything.
  useEffect(() => {
    if (reduced) return
    if (events.length < emitted.current) {
      emitted.current = events.length
      live.current = []
      queue.current = []
      heat.gates.clear()
      return
    }
    queue.current.push(...events.slice(emitted.current))
    emitted.current = events.length
    if (queue.current.length > QUEUE) queue.current.splice(0, queue.current.length - QUEUE)
  }, [events, heat, reduced])

  // Slots past the flight pool only ever carry reduced-motion dots.
  useEffect(() => {
    if (reduced) return
    const gain = headGeometry.getAttribute('aGain')
    for (let index = FLIGHTS; index < POINTS; index++) gain.setX(index, 0)
    gain.needsUpdate = true
  }, [reduced, headGeometry])

  // Reduced motion: every event stands still on the rail it was logged on.
  useEffect(() => {
    if (!reduced) return
    const layer = headGeometry
    const position = layer.getAttribute('position')
    const colour = layer.getAttribute('aColor')
    const size = layer.getAttribute('aSize')
    const gain = layer.getAttribute('aGain')
    const still = events.slice(-POINTS)
    const keys = still.map((event) => {
      const flight = flightOf(event, agents.get(event.agentId), lanes)
      return `${flight.stage}:${flight.lane}`
    })
    const totals = new Map<string, number>()
    for (const key of keys) totals.set(key, (totals.get(key) ?? 0) + 1)
    const ranks = new Map<string, number>()
    const place = new Vector3()
    for (const [index, event] of still.entries()) {
      const key = keys[index] ?? '0:-1'
      const rank = ranks.get(key) ?? 0
      ranks.set(key, rank + 1)
      // A still dot must not move between renders, so the offset comes from the
      // event's own sequence number rather than from a random draw.
      const comet = cometOf(event, agents.get(event.agentId), lanes, 0, ((event.seq * 37) % 11) / 11 - 0.5)
      // A still dot sits on its rail: the arc belongs to travelling. The row
      // starts clear of the lane label rather than under it.
      comet.lift = 0
      const along = rank / Math.max(1, (totals.get(key) ?? 1) - 1)
      pathAt(comet, STILL_START + (along * (1 - STILL_START)), place)
      position.setXYZ(index, place.x, place.y, place.z)
      colour.setXYZ(index, comet.color.r, comet.color.g, comet.color.b)
      size.setX(index, comet.size * 0.62)
      gain.setX(index, 1.05)
    }
    for (let index = still.length; index < POINTS; index++) gain.setX(index, 0)
    position.needsUpdate = true
    colour.needsUpdate = true
    size.needsUpdate = true
    gain.needsUpdate = true

    const trailGain = trailGeometry.getAttribute('aGain')
    for (let vertex = 0; vertex < trailGain.count; vertex++) trailGain.setX(vertex, 0)
    trailGain.needsUpdate = true
  }, [reduced, events, agents, lanes, headGeometry, trailGeometry])

  useFrame((_, delta) => {
    if (reduced) return
    const heads = points.current
    const trails = ribbons.current
    if (heads === null || trails === null) return
    const now = performance.now()

    const rate = LAUNCH_PER_SECOND * playbackClock.speed
    released.current += delta * rate
    while (released.current >= 1 && queue.current.length > 0 && live.current.length < FLIGHTS) {
      released.current -= 1
      const event = queue.current.shift()
      if (event === undefined) break
      live.current.push(cometOf(event, agents.get(event.agentId), lanes, now, Math.random() - 0.5))
    }
    released.current = Math.min(released.current, rate)

    live.current = live.current.filter((comet) => {
      const t = (now - comet.started) / comet.flightMs
      if (t >= 1 && !comet.flared) {
        comet.flared = true
        heat.gates.set(comet.gate, now)
        if (comet.ring !== undefined) heat.rings.push(comet.ring)
      }
      return t < 1
    })

    const position = heads.geometry.getAttribute('position')
    const colour = heads.geometry.getAttribute('aColor')
    const size = heads.geometry.getAttribute('aSize')
    const gain = heads.geometry.getAttribute('aGain')
    const trailPosition = trails.geometry.getAttribute('position')
    const trailTangent = trails.geometry.getAttribute('aTangent')
    const trailColour = trails.geometry.getAttribute('aColor')
    const trailWidth = trails.geometry.getAttribute('aWidth')
    const trailGain = trails.geometry.getAttribute('aGain')

    for (let slot = 0; slot < FLIGHTS; slot++) {
      const comet = live.current[slot]
      const t = comet === undefined ? -1 : (now - comet.started) / comet.flightMs
      if (comet === undefined || t < 0) {
        gain.setX(slot, 0)
        for (let segment = 0; segment < SEGMENTS; segment++) {
          const pair = ((slot * SEGMENTS) + segment) * 2
          trailGain.setX(pair, 0)
          trailGain.setX(pair + 1, 0)
        }
        continue
      }

      const head = Math.min(1, t * 12) * Math.min(1, (1 - t) * 6)
      pathAt(comet, t, HEAD)
      position.setXYZ(slot, HEAD.x, HEAD.y, HEAD.z)
      colour.setXYZ(slot, comet.color.r, comet.color.g, comet.color.b)
      size.setX(slot, comet.size)
      gain.setX(slot, head * 1.6)

      for (let segment = 0; segment < SEGMENTS; segment++) {
        const back = segment / (SEGMENTS - 1)
        const at = Math.max(0, t - (back * comet.span))
        pathAt(comet, at, HEAD)
        pathAt(comet, Math.min(1, at + 0.01), AHEAD)
        AHEAD.sub(HEAD)
        if (AHEAD.lengthSq() < 1e-8) AHEAD.set(1, 0, 0)
        const taper = comet.width * ((1 - back) ** 0.7)
        const fade = head * ((1 - back) ** 1.6)
        const pair = ((slot * SEGMENTS) + segment) * 2
        trailPosition.setXYZ(pair, HEAD.x, HEAD.y, HEAD.z)
        trailPosition.setXYZ(pair + 1, HEAD.x, HEAD.y, HEAD.z)
        trailTangent.setXYZ(pair, AHEAD.x, AHEAD.y, AHEAD.z)
        trailTangent.setXYZ(pair + 1, AHEAD.x, AHEAD.y, AHEAD.z)
        trailColour.setXYZ(pair, comet.color.r, comet.color.g, comet.color.b)
        trailColour.setXYZ(pair + 1, comet.color.r, comet.color.g, comet.color.b)
        trailWidth.setX(pair, taper)
        trailWidth.setX(pair + 1, taper)
        trailGain.setX(pair, fade)
        trailGain.setX(pair + 1, fade)
      }
    }

    position.needsUpdate = true
    colour.needsUpdate = true
    size.needsUpdate = true
    gain.needsUpdate = true
    trailPosition.needsUpdate = true
    trailTangent.needsUpdate = true
    trailColour.needsUpdate = true
    trailWidth.needsUpdate = true
    trailGain.needsUpdate = true
  })

  return (
    <group>
      <mesh
        ref={ribbons}
        geometry={trailGeometry}
        material={trailMaterial}
        renderOrder={5}
        frustumCulled={false}
      />
      <points
        ref={points}
        geometry={headGeometry}
        material={headMaterial}
        renderOrder={6}
        frustumCulled={false}
      />
    </group>
  )
}
