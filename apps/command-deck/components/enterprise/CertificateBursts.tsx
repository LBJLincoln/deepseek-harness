'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
  type InstancedMesh,
} from 'three'
import type { GraphLayout } from '@/deck/layout-enterprise'
import { usePrefersReducedMotion } from '@/deck/motion'
import { useDeck } from '@/deck/store'
import { createBeamGeometry } from './sprites.ts'

/** How many certificate bursts can be on screen at once. */
const BURST_POOL = 8

/** Lifetime of one certificate burst, in milliseconds. */
const BURST_MS = 1_600

/** The colour a certificate is issued in, matching the deck's `--green`. */
const BURST_COLOR = '#49e0a6'

/** Radius the ring starts and ends at, in world units. */
const RING = { from: 1.4, to: 9.5 }

/** Width and height of the light beam at full rise, in world units. */
const BEAM = { width: 2.2, height: 19 }

/** Peak brightness of the ring and of the beam, before the burst fades. */
const RING_GAIN = 0.62
const BEAM_GAIN = 0.4

const SCRATCH_MATRIX = new Matrix4()
const SCRATCH_SCALE = new Vector3()
const SCRATCH_POSITION = new Vector3()
const SCRATCH_QUATERNION = new Quaternion()
const SCRATCH_EULER = new Euler()
const SCRATCH_COLOR = new Color()
const BASE_COLOR = new Color(BURST_COLOR)
const ZERO_SCALE = new Vector3(0, 0, 0)

/**
 * Where a certificate was just issued: an expanding ring around the agent and
 * a short beam of light standing on it.
 *
 * Both are instanced over one pool, so a run that certifies six agents at once
 * still costs two draw calls. Under `prefers-reduced-motion` the ring and the
 * beam hold their size and then cut, instead of expanding and fading.
 *
 * While the cold open is assembling the graph the queue is drained without
 * drawing: a certificate landing on an agent that is not lit yet reads as a
 * fault, and the burst is a moment rather than a record — the panel and the
 * event feed still carry it.
 * @param props - The computed layout, used to place each burst on its agent.
 * @returns The burst layers.
 */
export function CertificateBursts({ layout }: { layout: GraphLayout }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const bursts = useDeck(state => state.bursts)
  const opening = useDeck(state => state.openingFrame)
  const rings = useRef<InstancedMesh>(null)
  const beams = useRef<InstancedMesh>(null)
  const { camera } = useThree()

  const beamGeometry = useMemo(createBeamGeometry, [])
  useEffect(() => () => beamGeometry.dispose(), [beamGeometry])

  const pool = useMemo(() => ({
    position: new Float32Array(BURST_POOL * 3),
    started: new Float64Array(BURST_POOL),
    cursor: 0,
  }), [])

  // Seeding both instance colour buffers before the first frame is what keeps
  // the first certificate of a run from compiling a shader as it lands.
  useLayoutEffect(() => {
    const ring = rings.current
    const beam = beams.current
    if (ring === null || beam === null) return
    SCRATCH_COLOR.setScalar(0)
    for (let slot = 0; slot < BURST_POOL; slot++) {
      ring.setColorAt(slot, SCRATCH_COLOR)
      beam.setColorAt(slot, SCRATCH_COLOR)
    }
    if (ring.instanceColor !== null) ring.instanceColor.needsUpdate = true
    if (beam.instanceColor !== null) beam.instanceColor.needsUpdate = true
  }, [])

  useFrame(() => {
    const ring = rings.current
    const beam = beams.current
    if (ring === null || beam === null) return
    const now = performance.now()
    const igniting = opening.reveal < 1

    // Drain the store's queue: every burst is drawn once, then forgotten.
    while (bursts.length > 0) {
      const burst = bursts.shift()
      if (burst === undefined) break
      if (igniting) continue
      const node = layout.nodes[layout.index.get(burst.agentId) ?? -1]
      if (node === undefined) continue
      const slot = pool.cursor
      pool.position[slot * 3] = node.x
      pool.position[(slot * 3) + 1] = node.y
      pool.position[(slot * 3) + 2] = node.z
      pool.started[slot] = now
      pool.cursor = (pool.cursor + 1) % BURST_POOL
    }

    for (let slot = 0; slot < BURST_POOL; slot++) {
      const started = pool.started[slot] ?? 0
      const age = started === 0 ? 1 : (now - started) / BURST_MS
      if (age >= 1) {
        SCRATCH_MATRIX.compose(SCRATCH_POSITION.set(0, 0, 0), SCRATCH_QUATERNION.identity(), ZERO_SCALE)
        ring.setMatrixAt(slot, SCRATCH_MATRIX)
        beam.setMatrixAt(slot, SCRATCH_MATRIX)
        continue
      }

      SCRATCH_POSITION.set(
        pool.position[slot * 3] ?? 0,
        pool.position[(slot * 3) + 1] ?? 0,
        pool.position[(slot * 3) + 2] ?? 0,
      )
      const spread = reduced ? 0.55 : 1 - ((1 - age) ** 2)
      const fade = reduced ? 1 : (1 - age) ** 1.4

      SCRATCH_SCALE.setScalar(RING.from + (spread * (RING.to - RING.from)))
      SCRATCH_MATRIX.compose(SCRATCH_POSITION, camera.quaternion, SCRATCH_SCALE)
      ring.setMatrixAt(slot, SCRATCH_MATRIX)
      ring.setColorAt(slot, SCRATCH_COLOR.copy(BASE_COLOR).multiplyScalar(fade * RING_GAIN))

      // The beam stands upright and turns on its own axis to face the camera,
      // so it reads as a shaft of light rather than a card.
      const yaw = Math.atan2(camera.position.x - SCRATCH_POSITION.x, camera.position.z - SCRATCH_POSITION.z)
      SCRATCH_QUATERNION.setFromEuler(SCRATCH_EULER.set(0, yaw, 0))
      SCRATCH_SCALE.set(BEAM.width, BEAM.height * (reduced ? 1 : Math.min(1, age * 3.2)), 1)
      SCRATCH_MATRIX.compose(SCRATCH_POSITION, SCRATCH_QUATERNION, SCRATCH_SCALE)
      beam.setMatrixAt(slot, SCRATCH_MATRIX)
      beam.setColorAt(slot, SCRATCH_COLOR.copy(BASE_COLOR).multiplyScalar(fade * BEAM_GAIN))
    }

    ring.instanceMatrix.needsUpdate = true
    beam.instanceMatrix.needsUpdate = true
    if (ring.instanceColor !== null) ring.instanceColor.needsUpdate = true
    if (beam.instanceColor !== null) beam.instanceColor.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={rings} args={[undefined, undefined, BURST_POOL]} frustumCulled={false}>
        <ringGeometry args={[0.84, 1, 48]} />
        <meshBasicMaterial
          transparent
          side={DoubleSide}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>

      <instancedMesh ref={beams} args={[beamGeometry, undefined, BURST_POOL]} frustumCulled={false}>
        <meshBasicMaterial
          vertexColors
          transparent
          side={DoubleSide}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  )
}
