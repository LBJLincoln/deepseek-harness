'use client'

import { Html, OrbitControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Vector3,
  type Mesh,
  type Points,
} from 'three'
import type { Agent, RunEvent } from '@/deck/contract'
import { usePrefersReducedMotion } from '@/deck/motion'
import { SEVERITY_COLOR } from '@/deck/palette'
import { discoverLanes, laneOf, laneY, stageOf, STAGES } from '@/deck/pipeline'
import { createGlowMaterial } from '@/components/three/glow'
import { Stage as Canvas3D } from '@/components/three/Stage'

/** How many particles can be in flight at once. */
const POOL = 420

/** Flight time of one particle between two stages, in milliseconds. */
const FLIGHT_MS = 2_300

/** Colour per event kind for the particles and the lane pulses. */
const KIND_COLOR: Record<string, string> = {
  step: '#5fa8ff',
  tool: '#4fd8ff',
  delegation: '#9b7bff',
  directive: '#ffbe5c',
  certificate: '#49e0a6',
  finding: '#ff3f6b',
  merge: '#ff8a6b',
  refusal: '#ff8a3d',
}

/** Point sizes of one event's comet: head first, then its two followers. */
const TRAIL = [14, 9.5, 6] as const

/** One particle in flight along the pipeline. */
interface Particle {
  from: Vector3
  to: Vector3
  started: number
  color: Color
  size: number
}

/** Width and depth of one lane slab. */
const SLAB = { width: 16, height: 4.4, depth: 4.4 }

/**
 * The slabs: one per department lane in the first stage, one per later stage.
 * @param props - Lane keys and labels, plus the per-lane activity clock.
 * @returns The slab meshes and their labels.
 */
function Slabs({
  lanes,
  labels,
  heat,
}: {
  lanes: string[]
  labels: Map<string, string>
  heat: Map<string, number>
}): ReactNode {
  const meshes = useRef<Map<string, Mesh>>(new Map())
  const reduced = usePrefersReducedMotion()

  useFrame(({ clock }) => {
    const now = performance.now()
    for (const [key, mesh] of meshes.current) {
      const since = now - (heat.get(key) ?? -Infinity)
      const warm = Math.max(0, 1 - (since / 2_400))
      const breathe = reduced ? 0 : (Math.sin(clock.elapsedTime * 1.6) * 0.5 + 0.5) * 0.06
      const material = mesh.material
      if (!Array.isArray(material) && 'emissiveIntensity' in material) {
        material.emissiveIntensity = 0.14 + (warm * 0.75) + breathe
      }
    }
  })

  const register = (key: string) => (mesh: Mesh | null): void => {
    if (mesh === null) meshes.current.delete(key)
    else meshes.current.set(key, mesh)
  }

  return (
    <group>
      {lanes.map((lane, index) => (
        <group key={lane} position={[STAGES[0]?.x ?? -52, laneY(index, lanes.length), 0]}>
          <mesh ref={register(`lane:${lane}`)}>
            <boxGeometry args={[SLAB.width, SLAB.height, SLAB.depth]} />
            <meshStandardMaterial
              color="#0e1626"
              emissive="#4fd8ff"
              emissiveIntensity={0.16}
              roughness={0.55}
              metalness={0.2}
            />
          </mesh>
          <Html center position={[0, 0, (SLAB.depth / 2) + 0.4]} zIndexRange={[12, 4]} style={{ pointerEvents: 'none' }}>
            <div style={{
              whiteSpace: 'nowrap',
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: '#cfe0ff',
              textShadow: '0 0 12px rgba(4,6,11,0.95)',
            }}>
              {labels.get(lane) ?? lane}
            </div>
          </Html>
        </group>
      ))}

      {STAGES.slice(1).map((stage) => {
        const height = Math.max(14, (laneY(0, lanes.length) * 2) + SLAB.height)
        return (
          <group key={stage.id} position={[stage.x, 0, 0]}>
            <mesh ref={register(`stage:${stage.id}`)}>
              <boxGeometry args={[5.4, height, 5.4]} />
              <meshStandardMaterial
                color="#0c1422"
                emissive="#9b7bff"
                emissiveIntensity={0.16}
                roughness={0.45}
                metalness={0.3}
              />
            </mesh>
            <Html
              center
              position={[0, (height / 2) + 4, 0]}
              zIndexRange={[12, 4]}
              style={{ pointerEvents: 'none' }}
            >
              <div style={{
                whiteSpace: 'nowrap',
                fontSize: 10,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: '#e0d8ff',
                textShadow: '0 0 12px rgba(4,6,11,0.95)',
              }}>
                {stage.name}
              </div>
            </Html>
          </group>
        )
      })}
    </group>
  )
}

/**
 * The rails between the stages.
 * @param props - How many lanes the first stage holds.
 * @returns The rail lines.
 */
function Rails({ lanes }: { lanes: number }): ReactNode {
  const geometry = useMemo(() => {
    const points: number[] = []
    const colors: number[] = []
    const colour = new Color('#3c5686')
    const first = STAGES[0]?.x ?? -52
    for (let index = 0; index < lanes; index++) {
      const y = laneY(index, lanes)
      points.push(first + SLAB.width / 2, y, 0, (STAGES[1]?.x ?? -16) - 5.5, y, 0)
      colors.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b)
    }
    for (let index = 1; index < STAGES.length - 1; index++) {
      const from = STAGES[index]?.x ?? 0
      const to = STAGES[index + 1]?.x ?? 0
      points.push(from + 5.5, 0, 0, to - 5.5, 0, 0)
      colors.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b)
    }
    const built = new BufferGeometry()
    built.setAttribute('position', new BufferAttribute(new Float32Array(points), 3))
    built.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    return built
  }, [lanes])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent opacity={0.6} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
    </lineSegments>
  )
}

/**
 * Events in flight between the stages.
 * @param props - The events admitted by the timeline and the roster index.
 * @returns The particle layer.
 */
function Flow({
  events,
  agents,
  lanes,
  heat,
}: {
  events: readonly RunEvent[]
  agents: Map<string, Agent>
  lanes: string[]
  heat: Map<string, number>
}): ReactNode {
  const points = useRef<Points>(null)
  const live = useRef<Particle[]>([])
  const emitted = useRef(0)

  const geometry = useMemo(() => {
    const built = new BufferGeometry()
    built.setAttribute('position', new BufferAttribute(new Float32Array(POOL * 3), 3))
    built.setAttribute('aColor', new BufferAttribute(new Float32Array(POOL * 3), 3))
    built.setAttribute('aSize', new BufferAttribute(new Float32Array(POOL).fill(11), 1))
    built.setAttribute('aGain', new BufferAttribute(new Float32Array(POOL), 1))
    return built
  }, [])

  const material = useMemo(createGlowMaterial, [])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  // The timeline can jump backwards; only forward movement emits.
  useEffect(() => {
    if (events.length < emitted.current) {
      emitted.current = events.length
      live.current = []
      return
    }
    const fresh = events.slice(emitted.current)
    emitted.current = events.length
    const now = performance.now()
    for (const [index, event] of fresh.slice(-24).entries()) {
      const agent = agents.get(event.agentId)
      const stage = stageOf(event, agent)
      const lane = laneOf(event, agent)
      const laneIndex = lanes.indexOf(lane)
      const y = stage === 0 && laneIndex >= 0 ? laneY(laneIndex, lanes.length) : 0
      const fromX = STAGES[stage]?.x ?? 0
      const toX = STAGES[Math.min(stage + 1, STAGES.length - 1)]?.x ?? 0
      heat.set(stage === 0 ? `lane:${lane}` : `stage:${STAGES[stage]?.id ?? ''}`, now)
      const from = new Vector3(fromX + 6, y, (Math.random() - 0.5) * 2.4)
      const to = new Vector3(toX - 6, stage === 0 ? y * 0.35 : 0, (Math.random() - 0.5) * 2.4)
      const color = new Color(
        event.severity !== undefined && event.kind === 'finding'
          ? SEVERITY_COLOR[event.severity]
          : KIND_COLOR[event.kind] ?? '#5fa8ff',
      )
      // One event is one comet: a head with two dimmer followers, so a sparse
      // stream still reads as movement rather than as scattered dots.
      for (const [trail, size] of TRAIL.entries()) {
        live.current.push({ from, to, color, size, started: now + (index * 55) + (trail * 120) })
      }
      if (live.current.length > POOL) live.current.splice(0, live.current.length - POOL)
    }
  }, [events, agents, lanes, heat])

  useFrame(() => {
    const layer = points.current
    if (layer === null) return
    const position = layer.geometry.getAttribute('position')
    const colour = layer.geometry.getAttribute('aColor')
    const gain = layer.geometry.getAttribute('aGain')
    const size = layer.geometry.getAttribute('aSize')
    const now = performance.now()

    live.current = live.current.filter(particle => now - particle.started < FLIGHT_MS)

    for (let index = 0; index < POOL; index++) {
      const particle = live.current[index]
      if (particle === undefined) {
        gain.setX(index, 0)
        continue
      }
      const raw = (now - particle.started) / FLIGHT_MS
      if (raw < 0) {
        gain.setX(index, 0)
        continue
      }
      const t = Math.min(1, raw)
      const eased = t * t * (3 - (2 * t))
      position.setXYZ(
        index,
        particle.from.x + ((particle.to.x - particle.from.x) * eased),
        particle.from.y + ((particle.to.y - particle.from.y) * eased) + (Math.sin(eased * Math.PI) * 1.6),
        particle.from.z + ((particle.to.z - particle.from.z) * eased),
      )
      colour.setXYZ(index, particle.color.r, particle.color.g, particle.color.b)
      size.setX(index, particle.size)
      gain.setX(index, Math.sin(t * Math.PI) * 1.5)
    }

    position.needsUpdate = true
    colour.needsUpdate = true
    size.needsUpdate = true
    gain.needsUpdate = true
  })

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />
}

/**
 * The process scene.
 * @param props - The events admitted by the timeline and the roster index.
 * @returns The canvas and its contents.
 */
export function ProcessStage({
  events,
  agents,
}: {
  events: readonly RunEvent[]
  agents: Map<string, Agent>
}): ReactNode {
  const heat = useMemo(() => new Map<string, number>(), [])
  const lanes = useMemo(() => discoverLanes(events.slice(0, 400), agents), [events, agents])
  const keys = lanes.keys.length > 0 ? lanes.keys : ['departments']
  // Frame the whole pipeline: its width is fixed, its height follows the lanes.
  const span = Math.max(118, (laneY(0, keys.length) * 2) + 34)
  const distance = span * 1.62

  return (
    <Canvas3D camera={{ position: [0, span * 0.19, distance], fov: 40 }} fogNear={distance * 0.9} fogFar={distance * 3.2}>
      <group rotation={[0, -0.22, 0]}>
        <Rails lanes={keys.length} />
        <Slabs lanes={keys} labels={lanes.labels} heat={heat} />
        <Flow events={events} agents={agents} lanes={keys} heat={heat} />
        <gridHelper
          args={[300, 30, '#16233a', '#0c1422']}
          position={[0, -laneY(0, keys.length) - 9, 0]}
        />
      </group>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.07}
        rotateSpeed={0.42}
        zoomSpeed={0.7}
        minDistance={50}
        maxDistance={distance * 2.4}
        maxPolarAngle={Math.PI * 0.62}
        target={[0, 0, 0]}
      />
    </Canvas3D>
  )
}
