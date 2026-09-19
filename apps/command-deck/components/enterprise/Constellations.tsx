'use client'

import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  Vector3,
  type InstancedMesh,
} from 'three'
import type { Roster } from '@/deck/contract'
import type { GraphLayout } from '@/deck/layout-enterprise'
import { divisionColor } from '@/deck/palette'
import { useDeck } from '@/deck/store'
import { FLOW_WINDOW_MS, sinceLast } from './activity.ts'
import { stageClamped } from './labels.ts'
import { createNebulaTexture } from './sprites.ts'
import styles from './labels.module.css'

/** Nebula width, as a multiple of the cluster's own radius. */
const NEBULA_SPREAD = 3.1

/** Standing nebula brightness, before any of the division's agents act. */
const NEBULA_BASE = 0.14

/** Smallest nebula, so a six-agent division still reads as a constellation. */
const NEBULA_FLOOR = 11

/** How much brighter a division's nebula burns when all of its agents are working. */
const NEBULA_ACTIVE = 0.26

/** How far a division unrelated to the selected agent falls back. */
const DIM = 0.32

/** Where a leader line stops short of the cluster it points at, as a share of its radius. */
const LEADER_CLEARANCE = 0.85

/** Opacity of the leader lines; they are a pointer, not part of the graph. */
const LEADER_OPACITY = 0.75

/** Half the division label's size, in pixels, for the stage clamp. */
const LABEL = { width: 74, height: 20 }

const SCRATCH_MATRIX = new Matrix4()
const SCRATCH_SCALE = new Vector3()
const SCRATCH_POSITION = new Vector3()
const SCRATCH_COLOR = new Color()
const SCRATCH_DIRECTION = new Vector3()

/**
 * The ten division clusters as constellations.
 *
 * Each division gets one soft nebula in its own colour, a leader line from its
 * name down to the centre of its cloud, and the name itself. The nebula's
 * brightness is the share of that division's agents that have acted inside the
 * activity window, so a working division is visibly the bright one.
 * @param props - The roster and its computed layout.
 * @returns The constellation scene contents.
 */
export function Constellations({ roster, layout }: { roster: Roster; layout: GraphLayout }): ReactNode {
  const nebulae = useRef<InstancedMesh>(null)
  const { camera } = useThree()
  const activity = useDeck(state => state.activity)
  const selectedId = useDeck(state => state.selectedAgentId)

  const clusters = layout.clusters
  const selectedDivision = useMemo(
    () => roster.agents.find(agent => agent.id === selectedId)?.division,
    [roster.agents, selectedId],
  )

  const texture = useMemo(createNebulaTexture, [])
  useEffect(() => () => texture.dispose(), [texture])

  // Division membership is fixed for a roster, so the frame loop counts into a
  // prepared slot per division rather than grouping agents again.
  const membership = useMemo(() => {
    const slots = new Map(clusters.map((cluster, index) => [cluster.id, index]))
    const ids: string[][] = clusters.map(() => [])
    for (const agent of roster.agents) {
      const slot = slots.get(agent.division)
      if (slot !== undefined) ids[slot]?.push(agent.id)
    }
    return ids
  }, [clusters, roster.agents])

  const leaders = useMemo(() => {
    const positions = new Float32Array(clusters.length * 6)
    const colors = new Float32Array(clusters.length * 6)
    for (const [index, cluster] of clusters.entries()) {
      const anchor = SCRATCH_POSITION.set(cluster.x, cluster.y, cluster.z)
      SCRATCH_DIRECTION.set(cluster.cx - cluster.x, cluster.cy - cluster.y, cluster.cz - cluster.z)
      const span = Math.max(0, SCRATCH_DIRECTION.length() - (cluster.radius * LEADER_CLEARANCE))
      SCRATCH_DIRECTION.normalize()
      SCRATCH_COLOR.set(divisionColor(cluster.id))
      positions[index * 6] = anchor.x + (SCRATCH_DIRECTION.x * 1.6)
      positions[(index * 6) + 1] = anchor.y + (SCRATCH_DIRECTION.y * 1.6)
      positions[(index * 6) + 2] = anchor.z + (SCRATCH_DIRECTION.z * 1.6)
      positions[(index * 6) + 3] = anchor.x + (SCRATCH_DIRECTION.x * span)
      positions[(index * 6) + 4] = anchor.y + (SCRATCH_DIRECTION.y * span)
      positions[(index * 6) + 5] = anchor.z + (SCRATCH_DIRECTION.z * span)
      // The line fades as it leaves the name and reaches the cloud.
      colors[index * 6] = SCRATCH_COLOR.r * 0.55
      colors[(index * 6) + 1] = SCRATCH_COLOR.g * 0.55
      colors[(index * 6) + 2] = SCRATCH_COLOR.b * 0.55
      colors[(index * 6) + 3] = SCRATCH_COLOR.r * 0.08
      colors[(index * 6) + 4] = SCRATCH_COLOR.g * 0.08
      colors[(index * 6) + 5] = SCRATCH_COLOR.b * 0.08
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('color', new BufferAttribute(colors, 3))
    return geometry
  }, [clusters])

  useEffect(() => () => leaders.dispose(), [leaders])

  // `setColorAt` is what allocates the instance colour buffer; seeding it
  // before the first frame is what keeps the nebulae off the material's white.
  useLayoutEffect(() => {
    const mesh = nebulae.current
    if (mesh === null) return
    for (const [index, cluster] of clusters.entries()) {
      mesh.setColorAt(index, SCRATCH_COLOR.set(divisionColor(cluster.id)).multiplyScalar(NEBULA_BASE))
    }
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
  }, [clusters])

  useFrame(() => {
    const mesh = nebulae.current
    if (mesh === null) return
    const now = performance.now()
    const colors = mesh.instanceColor

    for (const [index, cluster] of clusters.entries()) {
      const members = membership[index] ?? []
      let live = 0
      for (const id of members) {
        if (sinceLast(activity, id, now) < FLOW_WINDOW_MS) live += 1
      }
      const share = members.length === 0 ? 0 : live / members.length
      const weight = selectedDivision === undefined || selectedDivision === cluster.id ? 1 : DIM

      SCRATCH_POSITION.set(cluster.cx, cluster.cy, cluster.cz)
      SCRATCH_SCALE.setScalar(Math.max(cluster.radius, NEBULA_FLOOR) * NEBULA_SPREAD)
      SCRATCH_MATRIX.compose(SCRATCH_POSITION, camera.quaternion, SCRATCH_SCALE)
      mesh.setMatrixAt(index, SCRATCH_MATRIX)

      if (colors !== null) {
        SCRATCH_COLOR
          .set(divisionColor(cluster.id))
          .multiplyScalar((NEBULA_BASE + (share * NEBULA_ACTIVE)) * weight)
        mesh.setColorAt(index, SCRATCH_COLOR)
      }
    }

    mesh.instanceMatrix.needsUpdate = true
    if (colors !== null) colors.needsUpdate = true
  })

  const labelPosition = useMemo(() => stageClamped(LABEL.width, LABEL.height), [])

  return (
    <group>
      <instancedMesh
        ref={nebulae}
        args={[undefined, undefined, clusters.length]}
        frustumCulled={false}
        renderOrder={-1}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={texture}
          transparent
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>

      <lineSegments geometry={leaders} frustumCulled={false}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={LEADER_OPACITY}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>

      {clusters.map((cluster) => {
        const division = roster.divisions.find(entry => entry.id === cluster.id)
        const dimmed = selectedDivision !== undefined && selectedDivision !== cluster.id
        return (
          <Html
            key={cluster.id}
            position={[cluster.x, cluster.y, cluster.z]}
            center
            zIndexRange={[12, 4]}
            calculatePosition={labelPosition}
            style={{ pointerEvents: 'none' }}
          >
            <div className={dimmed ? `${styles.division} ${styles.divisionDim}` : styles.division}>
              <div className={styles.divisionName} style={{ color: divisionColor(cluster.id) }}>
                {division?.name ?? cluster.id}
              </div>
              <div className={styles.divisionCount}>{cluster.count} agents</div>
            </div>
          </Html>
        )
      })}
    </group>
  )
}
