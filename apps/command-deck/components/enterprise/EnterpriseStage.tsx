'use client'

import { Html, OrbitControls } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ElementRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Matrix4,
  Vector3,
  type InstancedMesh,
  type Mesh,
  type Points,
} from 'three'
import type { Roster, RosterEdge } from '@/deck/contract'
import { layoutRoster, type GraphLayout } from '@/deck/layout-enterprise'
import { usePrefersReducedMotion } from '@/deck/motion'
import { divisionColor, EDGE_COLOR } from '@/deck/palette'
import { useDeck } from '@/deck/store'
import { createGlowMaterial } from '@/components/three/glow'
import { Stage } from '@/components/three/Stage'

/** Core radius of one agent node before its status scale. */
const NODE_RADIUS = 1.15

/** How long an agent keeps pulsing after its last event, in milliseconds. */
const PULSE_WINDOW_MS = 2_600

/** How many certificate bursts can be on screen at once. */
const BURST_POOL = 8

/** Lifetime of one certificate burst, in milliseconds. */
const BURST_MS = 1_300

/** Node scale per roster status; a certified agent reads as the largest. */
const STATUS_SCALE: Record<string, number> = {
  defined: 0.86,
  active: 1.12,
  certified: 1.34,
  failed: 0.98,
}

/** Base glow size per roster status, in the point material's units. */
const STATUS_GLOW: Record<string, number> = {
  defined: 13,
  active: 19,
  certified: 23,
  failed: 15,
}

const SCRATCH_MATRIX = new Matrix4()
const SCRATCH_SCALE = new Vector3()
const SCRATCH_POSITION = new Vector3()

/**
 * The agent graph: instanced cores, an additive glow layer, and the edges.
 * @param props - The roster and its computed layout.
 * @returns The graph scene contents.
 */
function AgentGraph({ roster, layout }: { roster: Roster; layout: GraphLayout }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const cores = useRef<InstancedMesh>(null)
  const glow = useRef<Points>(null)
  const selectedId = useDeck(state => state.selectedAgentId)
  const selectAgent = useDeck(state => state.selectAgent)
  const activity = useDeck(state => state.activity)
  const [hovered, setHovered] = useState<number | undefined>(undefined)

  const nodes = layout.nodes
  const agents = roster.agents

  const glowGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    const positions = new Float32Array(nodes.length * 3)
    const colors = new Float32Array(nodes.length * 3)
    const sizes = new Float32Array(nodes.length)
    const gains = new Float32Array(nodes.length)
    const colour = new Color()
    for (const [index, node] of nodes.entries()) {
      positions[index * 3] = node.x
      positions[(index * 3) + 1] = node.y
      positions[(index * 3) + 2] = node.z
      colour.set(divisionColor(node.division))
      colors[index * 3] = colour.r
      colors[(index * 3) + 1] = colour.g
      colors[(index * 3) + 2] = colour.b
      sizes[index] = STATUS_GLOW[agents[index]?.status ?? 'defined'] ?? 7
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

  // Instance colours are static; only the matrices move, so set them once.
  useEffect(() => {
    const mesh = cores.current
    if (mesh === null) return
    const colour = new Color()
    for (const [index, node] of nodes.entries()) {
      colour.set(divisionColor(node.division))
      mesh.setColorAt(index, colour)
    }
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
  }, [nodes])

  useFrame(({ clock }) => {
    const mesh = cores.current
    if (mesh === null) return
    const now = performance.now()
    const time = clock.elapsedTime
    const gains = glow.current?.geometry.getAttribute('aGain')

    for (const [index, node] of nodes.entries()) {
      const agent = agents[index]
      const status = agent?.status ?? 'defined'
      const base = STATUS_SCALE[status] ?? 1
      const since = now - (activity.get(node.id) ?? -Infinity)
      const busy = since < PULSE_WINDOW_MS
      const decay = busy ? 1 - (since / PULSE_WINDOW_MS) : 0
      const wave = reduced ? 0 : Math.sin((time * 4.2) + (index * 0.7)) * 0.5 + 0.5
      const selected = agent !== undefined && agent.id === selectedId
      const emphasis = selected ? 0.9 : hovered === index ? 0.5 : 0

      const scale = base * (1 + (decay * 0.55 * (0.5 + (wave * 0.5))) + (emphasis * 0.35))
      SCRATCH_POSITION.set(node.x, node.y, node.z)
      SCRATCH_SCALE.setScalar(NODE_RADIUS * scale)
      SCRATCH_MATRIX.identity().scale(SCRATCH_SCALE).setPosition(SCRATCH_POSITION)
      mesh.setMatrixAt(index, SCRATCH_MATRIX)

      if (gains !== undefined) {
        const active = status === 'active' || status === 'certified' ? 0.22 : 0
        const idle = reduced ? 0 : Math.sin((time * 1.1) + (index * 1.7)) * 0.05
        gains.setX(index, Math.min(1.8, 0.42 + active + idle + (decay * 1.2) + emphasis))
      }
    }

    mesh.instanceMatrix.needsUpdate = true
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

  const hoveredAgent = hovered === undefined ? undefined : agents[hovered]
  const hoveredNode = hovered === undefined ? undefined : nodes[hovered]

  return (
    <group>
      <instancedMesh
        ref={cores}
        args={[undefined, undefined, nodes.length]}
        onPointerMove={onMove}
        onPointerOut={onOut}
        onClick={onClick}
      >
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={0.42} metalness={0.15} toneMapped={false} />
      </instancedMesh>

      <points ref={glow} geometry={glowGeometry} material={glowMaterial} frustumCulled={false} />

      {hoveredAgent === undefined || hoveredNode === undefined ? null : (
        <Html
          position={[hoveredNode.x, hoveredNode.y + 3.4, hoveredNode.z]}
          center
          zIndexRange={[40, 20]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              whiteSpace: 'nowrap',
              padding: '4px 9px',
              borderRadius: 7,
              border: '1px solid rgba(122,152,205,0.3)',
              background: 'rgba(6,10,18,0.92)',
              color: '#e8eefc',
              fontSize: 11,
              transform: 'translateY(-4px)',
            }}
          >
            {hoveredAgent.name}
            <span style={{ color: '#64749a', marginLeft: 8, fontSize: 10 }}>{hoveredAgent.role}</span>
          </div>
        </Html>
      )}
    </group>
  )
}

/** Segments each curved edge is drawn with. */
const EDGE_SEGMENTS = 10

/** How far an edge bows towards the graph centre, as a share of its length. */
const EDGE_SAG = 0.22

/**
 * Build one line-segment geometry for a set of edges.
 *
 * Edges bow towards the centre of the graph instead of cutting straight
 * across it: with four hundred relationships, straight chords read as noise,
 * while arcs separate into readable strands. Each arc dims towards its middle,
 * so the endpoints — the agents — stay the brightest thing in the layer.
 * @param edges - The relationships to draw.
 * @param layout - The computed layout supplying node positions.
 * @returns A geometry with `position` and `color` attributes.
 */
function buildEdgeGeometry(edges: readonly RosterEdge[], layout: GraphLayout): BufferGeometry {
  const usable = edges.filter(edge => layout.index.has(edge.from) && layout.index.has(edge.to))
  const vertices = usable.length * EDGE_SEGMENTS * 2
  const positions = new Float32Array(vertices * 3)
  const colors = new Float32Array(vertices * 3)
  const colour = new Color()
  const from = new Vector3()
  const to = new Vector3()
  const mid = new Vector3()
  const point = new Vector3()
  let cursor = 0

  for (const edge of usable) {
    const a = layout.nodes[layout.index.get(edge.from) ?? -1]
    const b = layout.nodes[layout.index.get(edge.to) ?? -1]
    if (a === undefined || b === undefined) continue
    from.set(a.x, a.y, a.z)
    to.set(b.x, b.y, b.z)
    mid.copy(from).add(to).multiplyScalar(0.5)
    mid.multiplyScalar(1 - EDGE_SAG)
    colour.set(EDGE_COLOR[edge.kind])

    for (let segment = 0; segment < EDGE_SEGMENTS; segment++) {
      for (const end of [segment / EDGE_SEGMENTS, (segment + 1) / EDGE_SEGMENTS]) {
        // Quadratic Bézier through the pulled-in midpoint.
        const inverse = 1 - end
        point.set(0, 0, 0)
          .addScaledVector(from, inverse * inverse)
          .addScaledVector(mid, 2 * inverse * end)
          .addScaledVector(to, end * end)
        const fade = 0.25 + (Math.abs(end - 0.5) * 1.5)
        positions[cursor * 3] = point.x
        positions[(cursor * 3) + 1] = point.y
        positions[(cursor * 3) + 2] = point.z
        colors[cursor * 3] = colour.r * fade
        colors[(cursor * 3) + 1] = colour.g * fade
        colors[(cursor * 3) + 2] = colour.b * fade
        cursor += 1
      }
    }
  }

  const built = new BufferGeometry()
  built.setAttribute('position', new BufferAttribute(positions.subarray(0, cursor * 3), 3))
  built.setAttribute('color', new BufferAttribute(colors.subarray(0, cursor * 3), 3))
  return built
}

/**
 * The roster edges as one additive line layer, plus a brighter layer for the
 * selected agent's own relationships.
 * @param props - The roster and its computed layout.
 * @returns The edge scene contents.
 */
function GraphEdges({ roster, layout }: { roster: Roster; layout: GraphLayout }): ReactNode {
  const selectedId = useDeck(state => state.selectedAgentId)

  const geometry = useMemo(() => buildEdgeGeometry(roster.edges, layout), [roster.edges, layout])
  useEffect(() => () => geometry.dispose(), [geometry])

  const selectedGeometry = useMemo(
    () => buildEdgeGeometry(
      selectedId === undefined
        ? []
        : roster.edges.filter(edge => edge.from === selectedId || edge.to === selectedId),
      layout,
    ),
    [roster.edges, layout, selectedId],
  )
  useEffect(() => () => selectedGeometry.dispose(), [selectedGeometry])

  return (
    <group>
      <lineSegments geometry={geometry} frustumCulled={false}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={selectedId === undefined ? 0.26 : 0.08}
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
    </group>
  )
}

/**
 * Division names, anchored above each cluster.
 * @param props - The computed layout and the roster's division records.
 * @returns The label overlays.
 */
function DivisionLabels({ roster, layout }: { roster: Roster; layout: GraphLayout }): ReactNode {
  const selectAgent = useDeck(state => state.selectAgent)
  return (
    <group>
      {layout.clusters.map((cluster) => {
        const division = roster.divisions.find(entry => entry.id === cluster.id)
        return (
          <Html
            key={cluster.id}
            position={[cluster.x, cluster.y, cluster.z]}
            center
            zIndexRange={[12, 4]}
            style={{ pointerEvents: 'none' }}
          >
            <div
              onClick={() => selectAgent(undefined)}
              style={{
                whiteSpace: 'nowrap',
                textAlign: 'center',
                transform: 'translateY(-6px)',
                padding: '3px 9px 4px',
                borderRadius: 7,
                background: 'rgba(4,6,11,0.66)',
                border: '1px solid rgba(122,152,205,0.14)',
                backdropFilter: 'blur(3px)',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: divisionColor(cluster.id),
                  fontWeight: 600,
                }}
              >
                {division?.name ?? cluster.id}
              </div>
              <div style={{ fontSize: 9, color: 'rgba(160,178,206,0.6)', letterSpacing: '0.1em' }}>
                {cluster.count} agents
              </div>
            </div>
          </Html>
        )
      })}
    </group>
  )
}

/** One live certificate burst. */
interface LiveBurst {
  position: Vector3
  started: number
}

/**
 * Expanding rings where a certificate was just issued.
 * @param props - The computed layout, used to place each burst on its agent.
 * @returns The burst rings.
 */
function CertificateBursts({ layout }: { layout: GraphLayout }): ReactNode {
  const bursts = useDeck(state => state.bursts)
  const live = useRef<LiveBurst[]>([])
  const rings = useRef<(Mesh | null)[]>([])
  const { camera } = useThree()

  useFrame(() => {
    // Drain the store's queue: every burst is drawn once, then forgotten.
    while (bursts.length > 0) {
      const burst = bursts.shift()
      if (burst === undefined) break
      const node = layout.nodes[layout.index.get(burst.agentId) ?? -1]
      if (node === undefined) continue
      live.current.push({ position: new Vector3(node.x, node.y, node.z), started: performance.now() })
      if (live.current.length > BURST_POOL) live.current.shift()
    }

    const now = performance.now()
    for (const [index, ring] of rings.current.entries()) {
      if (ring === null) continue
      const burst = live.current[index]
      if (burst === undefined) {
        ring.visible = false
        continue
      }
      const age = (now - burst.started) / BURST_MS
      if (age >= 1) {
        ring.visible = false
        continue
      }
      ring.visible = true
      ring.position.copy(burst.position)
      ring.quaternion.copy(camera.quaternion)
      ring.scale.setScalar(1.5 + (age * 13))
      const material = ring.material
      if (!Array.isArray(material) && 'opacity' in material) material.opacity = (1 - age) * 0.8
    }

    live.current = live.current.filter(burst => now - burst.started < BURST_MS)
  })

  return (
    <group>
      {Array.from({ length: BURST_POOL }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => { rings.current[index] = mesh }}
          visible={false}
        >
          <ringGeometry args={[0.84, 1, 48]} />
          <meshBasicMaterial
            color="#49e0a6"
            transparent
            opacity={0}
            side={DoubleSide}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Camera behaviour: a slow orbit at rest, and a flight to the selected agent.
 * @param props - The computed layout, which supplies the flight target.
 * @returns The controls.
 */
function CameraRig({ layout }: { layout: GraphLayout }): ReactNode {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null)
  const reduced = usePrefersReducedMotion()
  const selectedId = useDeck(state => state.selectedAgentId)
  const { camera } = useThree()
  const goal = useRef<{ position: Vector3; target: Vector3 } | undefined>(undefined)

  useEffect(() => {
    if (selectedId === undefined) {
      goal.current = {
        position: new Vector3(0, layout.extent * 0.26, layout.extent * 2.2),
        target: new Vector3(0, 0, 0),
      }
      return
    }
    const node = layout.nodes[layout.index.get(selectedId) ?? -1]
    if (node === undefined) return
    const target = new Vector3(node.x, node.y, node.z)
    const outward = target.clone().normalize().multiplyScalar(34)
    goal.current = {
      position: target.clone().add(outward).add(new Vector3(0, 12, 0)),
      target,
    }
  }, [selectedId, layout])

  useFrame((_, delta) => {
    const control = controls.current
    if (control === null) return
    const destination = goal.current
    if (destination !== undefined) {
      const step = Math.min(1, delta * 2.6)
      camera.position.lerp(destination.position, step)
      control.target.lerp(destination.target, step)
      if (camera.position.distanceTo(destination.position) < 0.35) goal.current = undefined
    }
    control.update()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.06}
      rotateSpeed={0.5}
      zoomSpeed={0.7}
      minDistance={18}
      maxDistance={420}
      autoRotate={!reduced && selectedId === undefined && goal.current === undefined}
      autoRotateSpeed={0.28}
    />
  )
}

/**
 * The enterprise scene.
 * @param props - The roster to draw.
 * @returns The canvas and its contents.
 */
export function EnterpriseStage({ roster }: { roster: Roster }): ReactNode {
  const layout = useMemo(() => layoutRoster(roster), [roster])

  return (
    <Stage camera={{ position: [0, layout.extent * 0.26, layout.extent * 2.2], fov: 44 }} fogNear={210} fogFar={720}>
      <GraphEdges roster={roster} layout={layout} />
      <AgentGraph roster={roster} layout={layout} />
      <DivisionLabels roster={roster} layout={layout} />
      <CertificateBursts layout={layout} />
      <CameraRig layout={layout} />
    </Stage>
  )
}
