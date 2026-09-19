'use client'

import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import { AdditiveBlending, DoubleSide, Vector3, type Mesh } from 'three'
import type { Roster } from '@/deck/contract'
import { layoutRoster, type GraphLayout } from '@/deck/layout-enterprise'
import { divisionColor } from '@/deck/palette'
import { useDeck } from '@/deck/store'
import { Stage } from '@/components/three/Stage'
import { AgentGraph } from './AgentGraph'
import { CameraRig } from './CameraRig'
import { GraphEdges } from './GraphEdges'

/** How many certificate bursts can be on screen at once. */
const BURST_POOL = 8

/** Lifetime of one certificate burst, in milliseconds. */
const BURST_MS = 1_300

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
