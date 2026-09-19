'use client'

import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { BufferAttribute, BufferGeometry, Color, type Mesh } from 'three'
import { usePrefersReducedMotion } from '@/deck/motion'
import { laneZ, PIPELINE, STAGES, type Lanes } from '@/deck/pipeline'
import { useDeck } from '@/deck/store'
import { createRailMaterial, createTimePlaneMaterial } from './materials'
import styles from './process.module.css'

/**
 * Scene x the lane labels are anchored at.
 *
 * They sit left of the lane origin and read rightwards from it, so a label
 * clears the events standing on its rail and cannot run off the left edge of
 * the canvas however near its lane is to the camera.
 */
const LABEL_X = (STAGES[0]?.x ?? 0) - 15

/** How long a lane keeps its light after its last event, in milliseconds. */
const LANE_WINDOW_MS = 4_000

/** Rail brightness for a lane that has produced work, before any recent event. */
const LANE_REST = 0.3

/** Rail brightness for a lane the timeline has not reached yet. */
const LANE_SILENT = 0.09

/** Extra rail brightness while the lane's agents are acting. */
const LANE_ACTIVE = 1.05

/** Half-widths of a lane's two strips: the rail itself, then its halo. */
const STRIP_WIDTH = [0.6, 3.4] as const

/** Vertices one lane contributes to the rail mesh: four per strip. */
const LANE_VERTICES = STRIP_WIDTH.length * 4

/**
 * How bright one lane should be this frame.
 * @param last - When the lane's agents last acted, in `performance.now()` ms.
 * @param total - How many events the lane has produced up to the cursor.
 * @param reduced - Whether the viewer asked for reduced motion.
 * @returns The lane's brightness.
 */
function laneLevel(last: number, total: number, reduced: boolean): number {
  const rest = total > 0 ? LANE_REST : LANE_SILENT
  if (reduced) return total > 0 ? rest + 0.35 : rest
  const warm = Math.max(0, 1 - ((performance.now() - last) / LANE_WINDOW_MS))
  return rest + (warm * warm * LANE_ACTIVE)
}

/**
 * When each lane's agents last acted.
 * @param lanes - The discovered lanes.
 * @param activity - The store's per-agent activity clock.
 * @returns One timestamp per lane, `-Infinity` for a lane that never acted.
 */
function laneClocks(lanes: Lanes, activity: Map<string, number>): number[] {
  return lanes.list.map((lane) => {
    let last = -Infinity
    for (const agentId of lane.agentIds) last = Math.max(last, activity.get(agentId) ?? -Infinity)
    return last
  })
}

/**
 * The lane rails: one mesh carrying every lane's strip and halo.
 *
 * A rail runs the whole length of the pipeline and through all three gates, so
 * the lanes read as the tracks the work travels on rather than as bars stopping
 * at the first gate. Brightness is a per-vertex attribute the frame loop
 * rewrites, which keeps the whole set in one draw call.
 * @param props - The discovered lanes and their event totals at the cursor.
 * @returns The rail mesh.
 */
function Rails({ lanes, totals }: { lanes: Lanes; totals: readonly number[] }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const activity = useDeck(state => state.activity)
  const mesh = useRef<Mesh>(null)
  const counts = useRef<readonly number[]>(totals)

  useEffect(() => { counts.current = totals }, [totals])

  const material = useMemo(createRailMaterial, [])

  const geometry = useMemo(() => {
    const count = lanes.list.length
    const vertices = count * LANE_VERTICES
    const position = new Float32Array(vertices * 3)
    const color = new Float32Array(vertices * 3)
    const gain = new Float32Array(vertices)
    const axis = new Float32Array(vertices)
    const across = new Float32Array(vertices)
    const halo = new Float32Array(vertices)
    const indices: number[] = []
    const tint = new Color()

    for (const [lane, entry] of lanes.list.entries()) {
      const z = laneZ(lane, count)
      tint.set(entry.color)
      for (const [strip, width] of STRIP_WIDTH.entries()) {
        const first = (lane * LANE_VERTICES) + (strip * 4)
        const corners = [
          { x: PIPELINE.railStart, side: -1 },
          { x: PIPELINE.railStart, side: 1 },
          { x: PIPELINE.railEnd, side: -1 },
          { x: PIPELINE.railEnd, side: 1 },
        ]
        for (const [corner, { x, side }] of corners.entries()) {
          const vertex = first + corner
          position[vertex * 3] = x
          position[(vertex * 3) + 1] = PIPELINE.railY
          position[(vertex * 3) + 2] = z + (side * width)
          color[vertex * 3] = tint.r
          color[(vertex * 3) + 1] = tint.g
          color[(vertex * 3) + 2] = tint.b
          axis[vertex] = x === PIPELINE.railStart ? 0 : 1
          across[vertex] = side
          halo[vertex] = strip
        }
        indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2)
      }
    }

    const built = new BufferGeometry()
    built.setAttribute('position', new BufferAttribute(position, 3))
    built.setAttribute('aColor', new BufferAttribute(color, 3))
    built.setAttribute('aGain', new BufferAttribute(gain, 1))
    built.setAttribute('aAxis', new BufferAttribute(axis, 1))
    built.setAttribute('aAcross', new BufferAttribute(across, 1))
    built.setAttribute('aHalo', new BufferAttribute(halo, 1))
    built.setIndex(indices)
    return built
  }, [lanes])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const layer = mesh.current
    if (layer === null) return
    const gain = layer.geometry.getAttribute('aGain')
    const clocks = laneClocks(lanes, activity)
    for (const [lane] of lanes.list.entries()) {
      const level = laneLevel(clocks[lane] ?? -Infinity, counts.current[lane] ?? 0, reduced)
      for (let vertex = 0; vertex < LANE_VERTICES; vertex++) {
        gain.setX((lane * LANE_VERTICES) + vertex, level)
      }
    }
    gain.needsUpdate = true
  })

  return <mesh ref={mesh} geometry={geometry} material={material} renderOrder={1} frustumCulled={false} />
}

/**
 * One label per lane: the agent that works it, and how much it has produced.
 *
 * The lit state is written straight onto the element from the frame loop, so a
 * lane brightening never costs a React render.
 * @param props - The discovered lanes and their event totals at the cursor.
 * @returns The lane labels.
 */
function LaneLabels({ lanes, totals }: { lanes: Lanes; totals: readonly number[] }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const activity = useDeck(state => state.activity)
  const elements = useRef<(HTMLDivElement | null)[]>([])

  useFrame(() => {
    const clocks = laneClocks(lanes, activity)
    for (const [lane] of lanes.list.entries()) {
      const element = elements.current[lane]
      if (element === null || element === undefined) continue
      const recent = performance.now() - (clocks[lane] ?? -Infinity) < LANE_WINDOW_MS
      element.dataset.lit = String(!reduced && recent && (totals[lane] ?? 0) > 0)
    }
  })

  return (
    <group>
      {lanes.list.map((lane, index) => (
        <Html
          key={lane.key}
          center
          position={[LABEL_X, PIPELINE.railY + 5.5, laneZ(index, lanes.list.length)]}
          zIndexRange={[11, 4]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            ref={(element) => { elements.current[index] = element }}
            className={`${styles.lane} ${(totals[index] ?? 0) === 0 ? styles.laneSilent : ''}`}
            style={{ '--tone': lane.color } as CSSProperties}
            data-lit="false"
          >
            <i className={styles.laneDot} />
            {lane.label}
            <span className={styles.laneCount}>{totals[index] ?? 0}</span>
          </div>
        </Html>
      ))}
    </group>
  )
}

/**
 * The plane the timeline scrubber drags along the pipeline.
 *
 * It only exists while the cursor is off the head: at the head there is no
 * past to stand in, so the plane fades out where it was left.
 * @param props - The pipeline's half-width and the cursor's position in the
 * run, `undefined` while the deck follows the head.
 * @returns The time plane.
 */
function TimePlane({
  halfWidth,
  progress,
}: {
  halfWidth: number
  progress: number | undefined
}): ReactNode {
  const reduced = usePrefersReducedMotion()
  const mesh = useRef<Mesh>(null)
  const held = useRef(0)
  const presence = useRef(0)
  const pane = useMemo(createTimePlaneMaterial, [])

  useEffect(() => () => pane.material.dispose(), [pane])

  useFrame((_, delta) => {
    const layer = mesh.current
    if (layer === null) return
    if (progress !== undefined) held.current = progress
    const target = progress === undefined ? 0 : 1
    presence.current = reduced
      ? target
      : presence.current + ((target - presence.current) * Math.min(1, delta * 4))
    pane.gain.value = presence.current
    layer.visible = presence.current > 0.01
    layer.position.x = PIPELINE.railStart + 12
      + (held.current * (PIPELINE.railEnd - PIPELINE.railStart - 24))
  })

  return (
    <mesh
      ref={mesh}
      material={pane.material}
      position={[0, (PIPELINE.gateTop + PIPELINE.floorY) / 2, 0]}
      rotation={[0, Math.PI / 2, 0]}
      renderOrder={4}
      visible={false}
    >
      <planeGeometry args={[halfWidth * 2, PIPELINE.gateTop - PIPELINE.floorY]} />
    </mesh>
  )
}

/**
 * Everything the pipeline stands on: the floor grid, the lane rails, the lane
 * labels, and the time plane the scrubber drags.
 * @param props - The discovered lanes, their event totals at the cursor, the
 * pipeline's half-width, and the cursor's position in the run.
 * @returns The ground layer.
 */
export function Ground({
  lanes,
  totals,
  halfWidth,
  progress,
}: {
  lanes: Lanes
  totals: readonly number[]
  halfWidth: number
  progress: number | undefined
}): ReactNode {
  return (
    <group>
      <gridHelper args={[520, 52, '#2a4468', '#16243a']} position={[0, PIPELINE.floorY, 0]} />
      <Rails lanes={lanes} totals={totals} />
      <LaneLabels lanes={lanes} totals={totals} />
      <TimePlane halfWidth={halfWidth} progress={progress} />
    </group>
  )
}
