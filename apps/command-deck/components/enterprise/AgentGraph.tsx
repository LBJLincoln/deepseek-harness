'use client'

import { Html } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
  type InstancedMesh,
  type Points,
} from 'three'
import type { AgentStatus, Roster } from '@/deck/contract'
import type { GraphLayout } from '@/deck/layout-enterprise'
import { usePrefersReducedMotion } from '@/deck/motion'
import { divisionColor } from '@/deck/palette'
import { useDeck } from '@/deck/store'
import { createGlowMaterial } from '@/components/three/glow'
import { decay, FLOW_WINDOW_MS, PULSE_WINDOW_MS, sinceLast } from './activity.ts'
import { stageClamped } from './labels.ts'
import styles from './labels.module.css'

/** Core radius of one agent node before its status scale. */
const NODE_RADIUS = 1.15

/** Node scale per roster status; a certified agent reads as the largest. */
const STATUS_SCALE: Record<AgentStatus, number> = {
  defined: 0.86,
  active: 1.12,
  certified: 1.34,
  failed: 0.98,
}

/** Halo size per roster status, in the point material's units. */
const STATUS_GLOW: Record<AgentStatus, number> = {
  defined: 15,
  active: 22,
  certified: 27,
  failed: 17,
}

/** Standing halo brightness per roster status, before any activity. */
const STATUS_GAIN: Record<AgentStatus, number> = {
  defined: 0,
  active: 0.22,
  certified: 0.22,
  failed: 0.06,
}

/** The rim colour a status carries, for the two statuses that carry one. */
const RIM_COLOR: Partial<Record<AgentStatus, string>> = {
  certified: '#ffb257',
  failed: '#ff3f6b',
}

/** How bright each rim burns; a failure is stated, not shouted. */
const RIM_GAIN: Partial<Record<AgentStatus, number>> = {
  certified: 0.62,
  failed: 0.3,
}

/** Rim radius, as a multiple of the core radius. */
const RIM_RADIUS = 1.95

/** Orbital ring radius, as a multiple of the core radius. */
const ORBIT_RADIUS = 2.9

/** How far an unrelated node falls back while one agent is selected. */
const DIM = 0.3

/** How far a node one edge away from the selection falls back. */
const NEIGHBOUR = 0.62

/** Half the hover label's size, in pixels, for the stage clamp. */
const HOVER_LABEL = { width: 110, height: 16 }

const SCRATCH_MATRIX = new Matrix4()
const SCRATCH_SCALE = new Vector3()
const SCRATCH_POSITION = new Vector3()
const SCRATCH_QUATERNION = new Quaternion()
const SCRATCH_EULER = new Euler()
const SCRATCH_COLOR = new Color()
const ZERO_SCALE = new Vector3(0, 0, 0)
const NO_ROTATION = new Quaternion()

/**
 * The agent graph: instanced cores, the halo layer behind them, the orbital
 * ring an agent wears while it is working, and the standing rim a certified or
 * failed agent wears.
 *
 * Each of the four is one draw call over every agent, and every frame writes
 * typed arrays rather than React state: at 147 agents the scene animates a
 * buffer, never a component tree.
 * @param props - The roster and its computed layout.
 * @returns The graph scene contents.
 */
export function AgentGraph({ roster, layout }: { roster: Roster; layout: GraphLayout }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const cores = useRef<InstancedMesh>(null)
  const glow = useRef<Points>(null)
  const orbits = useRef<InstancedMesh>(null)
  const rims = useRef<InstancedMesh>(null)
  const { camera } = useThree()
  const selectedId = useDeck(state => state.selectedAgentId)
  const selectAgent = useDeck(state => state.selectAgent)
  const activity = useDeck(state => state.activity)
  const [hovered, setHovered] = useState<number | undefined>(undefined)

  const nodes = layout.nodes
  const agents = roster.agents

  // One weight per node, recomputed only when the selection moves: the frame
  // loop reads it, so selection dimming costs nothing per frame.
  const focus = useMemo(() => {
    const weights = new Float32Array(nodes.length).fill(1)
    if (selectedId === undefined) return weights
    const neighbours = new Set<string>()
    for (const edge of roster.edges) {
      if (edge.from === selectedId) neighbours.add(edge.to)
      if (edge.to === selectedId) neighbours.add(edge.from)
    }
    for (const [index, node] of nodes.entries()) {
      weights[index] = node.id === selectedId ? 1 : neighbours.has(node.id) ? NEIGHBOUR : DIM
    }
    return weights
  }, [nodes, roster.edges, selectedId])

  const glowGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    const positions = new Float32Array(nodes.length * 3)
    const colors = new Float32Array(nodes.length * 3)
    const sizes = new Float32Array(nodes.length)
    const gains = new Float32Array(nodes.length)
    for (const [index, node] of nodes.entries()) {
      positions[index * 3] = node.x
      positions[(index * 3) + 1] = node.y
      positions[(index * 3) + 2] = node.z
      SCRATCH_COLOR.set(divisionColor(node.division))
      colors[index * 3] = SCRATCH_COLOR.r
      colors[(index * 3) + 1] = SCRATCH_COLOR.g
      colors[(index * 3) + 2] = SCRATCH_COLOR.b
      sizes[index] = STATUS_GLOW[agents[index]?.status ?? 'defined']
      gains[index] = 0.45
    }
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('aColor', new BufferAttribute(colors, 3))
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1))
    geometry.setAttribute('aGain', new BufferAttribute(gains, 1))
    return geometry
  }, [nodes, agents])

  const glowMaterial = useMemo(createGlowMaterial, [])

  useEffect(() => () => {
    glowGeometry.dispose()
    glowMaterial.dispose()
  }, [glowGeometry, glowMaterial])

  // Core and rim colours change only with the selection; the frame loop moves
  // the matrices and leaves both colour buffers alone. `setColorAt` is also
  // what allocates an instance colour buffer, so the orbital rings are seeded
  // here to keep the frame loop's writes off the material's white.
  useLayoutEffect(() => {
    const mesh = cores.current
    const rim = rims.current
    const orbit = orbits.current
    if (mesh === null || rim === null || orbit === null) return
    for (const [index, node] of nodes.entries()) {
      orbit.setColorAt(index, SCRATCH_COLOR.set(divisionColor(node.division)))
      const weight = focus[index] ?? 1
      SCRATCH_COLOR.set(divisionColor(node.division)).multiplyScalar(weight)
      mesh.setColorAt(index, SCRATCH_COLOR)
      const status = agents[index]?.status ?? 'defined'
      const rimColour = RIM_COLOR[status]
      SCRATCH_COLOR
        .set(rimColour ?? '#000000')
        .multiplyScalar((RIM_GAIN[status] ?? 0) * weight)
      rim.setColorAt(index, SCRATCH_COLOR)
    }
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
    if (rim.instanceColor !== null) rim.instanceColor.needsUpdate = true
    if (orbit.instanceColor !== null) orbit.instanceColor.needsUpdate = true
  }, [agents, focus, nodes])

  useFrame(({ clock }) => {
    const mesh = cores.current
    const orbit = orbits.current
    const rim = rims.current
    if (mesh === null || orbit === null || rim === null) return
    const now = performance.now()
    const time = clock.elapsedTime
    const gains = glow.current?.geometry.getAttribute('aGain')
    const orbitColors = orbit.instanceColor

    for (const [index, node] of nodes.entries()) {
      const agent = agents[index]
      const status = agent?.status ?? 'defined'
      const since = sinceLast(activity, node.id, now)
      const pulse = decay(since, PULSE_WINDOW_MS)
      const working = Math.max(decay(since, FLOW_WINDOW_MS), status === 'active' ? 0.5 : 0)
      const weight = focus[index] ?? 1
      const emphasis = node.id === selectedId ? 0.9 : hovered === index ? 0.5 : 0
      const wave = reduced ? 0.5 : (Math.sin((time * 4.2) + (index * 0.7)) * 0.5) + 0.5

      SCRATCH_POSITION.set(node.x, node.y, node.z)
      const scale = STATUS_SCALE[status] * (1 + (pulse * 0.55 * (0.5 + (wave * 0.5))) + (emphasis * 0.35))
      SCRATCH_SCALE.setScalar(NODE_RADIUS * scale)
      SCRATCH_MATRIX.compose(SCRATCH_POSITION, NO_ROTATION, SCRATCH_SCALE)
      mesh.setMatrixAt(index, SCRATCH_MATRIX)

      if (gains !== undefined) {
        const idle = reduced ? 0 : Math.sin((time * 1.1) + (index * 1.7)) * 0.05
        const gain = 0.42 + STATUS_GAIN[status] + idle + (pulse * 1.2) + emphasis
        gains.setX(index, Math.min(1.8, gain) * weight)
      }

      // The orbital ring is worn only while the agent is working: it spins on
      // a tilt so it reads as an orbit rather than a halo seen edge-on.
      if (working > 0.02) {
        const spin = reduced ? index * 0.9 : (time * 1.15) + (index * 0.9)
        SCRATCH_EULER.set(1.12, spin, 0.38)
        SCRATCH_QUATERNION.setFromEuler(SCRATCH_EULER)
        SCRATCH_SCALE.setScalar(NODE_RADIUS * ORBIT_RADIUS * STATUS_SCALE[status])
        SCRATCH_MATRIX.compose(SCRATCH_POSITION, SCRATCH_QUATERNION, SCRATCH_SCALE)
        if (orbitColors !== null) {
          SCRATCH_COLOR.set(divisionColor(node.division)).multiplyScalar((0.35 + (working * 0.9)) * weight)
          orbit.setColorAt(index, SCRATCH_COLOR)
        }
      } else {
        SCRATCH_MATRIX.compose(SCRATCH_POSITION, NO_ROTATION, ZERO_SCALE)
      }
      orbit.setMatrixAt(index, SCRATCH_MATRIX)

      if (RIM_GAIN[status] === undefined) {
        SCRATCH_MATRIX.compose(SCRATCH_POSITION, NO_ROTATION, ZERO_SCALE)
      } else {
        SCRATCH_SCALE.setScalar(NODE_RADIUS * RIM_RADIUS * STATUS_SCALE[status])
        SCRATCH_MATRIX.compose(SCRATCH_POSITION, camera.quaternion, SCRATCH_SCALE)
      }
      rim.setMatrixAt(index, SCRATCH_MATRIX)
    }

    mesh.instanceMatrix.needsUpdate = true
    orbit.instanceMatrix.needsUpdate = true
    rim.instanceMatrix.needsUpdate = true
    if (orbitColors !== null) orbitColors.needsUpdate = true
    if (gains !== undefined) gains.needsUpdate = true
  })

  const onMove = (event: ThreeEvent<PointerEvent>): void => {
    event.stopPropagation()
    setHovered(event.instanceId)
    document.body.style.cursor = event.instanceId === undefined ? 'auto' : 'pointer'
  }

  const onOut = (): void => {
    setHovered(undefined)
    document.body.style.cursor = 'auto'
  }

  const onClick = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation()
    const agent = event.instanceId === undefined ? undefined : agents[event.instanceId]
    selectAgent(agent?.id)
  }

  const hoverPosition = useMemo(() => stageClamped(HOVER_LABEL.width, HOVER_LABEL.height), [])
  const hoveredAgent = hovered === undefined ? undefined : agents[hovered]
  const hoveredNode = hovered === undefined ? undefined : nodes[hovered]

  return (
    <group>
      <instancedMesh
        ref={cores}
        args={[undefined, undefined, nodes.length]}
        frustumCulled={false}
        onPointerMove={onMove}
        onPointerOut={onOut}
        onClick={onClick}
      >
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={0.42} metalness={0.15} toneMapped={false} />
      </instancedMesh>

      <points ref={glow} geometry={glowGeometry} material={glowMaterial} frustumCulled={false} />

      <instancedMesh ref={orbits} args={[undefined, undefined, nodes.length]} frustumCulled={false}>
        <ringGeometry args={[0.93, 1, 48]} />
        <meshBasicMaterial
          transparent
          side={DoubleSide}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>

      <instancedMesh ref={rims} args={[undefined, undefined, nodes.length]} frustumCulled={false}>
        <ringGeometry args={[0.95, 1, 48]} />
        <meshBasicMaterial
          transparent
          side={DoubleSide}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>

      {hoveredAgent === undefined || hoveredNode === undefined ? null : (
        <Html
          position={[hoveredNode.x, hoveredNode.y + 3.4, hoveredNode.z]}
          center
          zIndexRange={[40, 20]}
          calculatePosition={hoverPosition}
          style={{ pointerEvents: 'none' }}
        >
          <div className={styles.agent}>
            {hoveredAgent.name}
            <span className={styles.agentRole}>{hoveredAgent.role}</span>
          </div>
        </Html>
      )}
    </group>
  )
}
