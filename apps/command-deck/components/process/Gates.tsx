'use client'

import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { AdditiveBlending, Color, DoubleSide, MeshBasicMaterial, type Mesh } from 'three'
import { usePrefersReducedMotion } from '@/deck/motion'
import { PIPELINE, STAGES, type Stage } from '@/deck/pipeline'
import { createPaneMaterial, createPoolMaterial } from './materials'
import type { PipelineHeat } from './heat'
import styles from './process.module.css'

/** Brightness a gate holds when nothing has arrived at it. */
const GATE_REST = 0.34

/** Extra brightness at the moment of an arrival, decaying over `FLARE_MS`. */
const GATE_FLARE = 1.5

/** How long one arrival keeps a gate bright, in milliseconds. */
const FLARE_MS = 1_700

/** Extra brightness the Integration gate holds once a merge has landed. */
const GATE_HELD = 0.7

/** Thickness of a gate's posts and beams, in scene units. */
const BAR = 1.7

/** How many rings can expand at the gates at once. */
const RING_POOL = 7

/**
 * One luminous gate: a glass frame, its floor pool, and its name.
 *
 * The frame's edges are additive, so the bloom pass turns them into the light
 * the gate appears to cast; the pane and the pool follow the same brightness,
 * so an arrival lifts the whole gate rather than only its outline. Under
 * reduced motion the gate holds one level, raised once and for all when the
 * stage has admitted work, because nothing may flicker.
 * @param props - The stage the gate stands for, the pipeline's half-width, the
 * shared frame state, and how many events have reached the stage.
 * @returns The gate.
 */
function Gate({
  stage,
  halfWidth,
  heat,
  arrivals,
}: {
  stage: Stage
  halfWidth: number
  heat: PipelineHeat
  arrivals: number
}): ReactNode {
  const reduced = usePrefersReducedMotion()
  const base = useMemo(() => new Color(stage.color), [stage.color])
  const edge = useMemo(
    () => new MeshBasicMaterial({
      color: new Color(stage.color),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    [stage.color],
  )
  const pane = useMemo(() => createPaneMaterial(stage.color), [stage.color])
  const pool = useMemo(() => createPoolMaterial(stage.color), [stage.color])

  useEffect(() => () => {
    edge.dispose()
    pane.material.dispose()
    pool.material.dispose()
  }, [edge, pane, pool])

  const height = PIPELINE.gateTop - PIPELINE.floorY
  const centre = (PIPELINE.gateTop + PIPELINE.floorY) / 2
  const beam = (halfWidth * 2) + BAR

  useFrame(({ clock }) => {
    const held = stage.id === 'integration' && (heat.merged || heat.completed) ? GATE_HELD : 0
    let level = GATE_REST + held
    if (reduced) {
      level += arrivals > 0 ? 0.5 : 0
    } else {
      const since = performance.now() - (heat.gates.get(stage.id) ?? -Infinity)
      const warm = Math.max(0, 1 - (since / FLARE_MS))
      level += (warm * warm * GATE_FLARE) + (Math.sin(clock.elapsedTime * 0.8) * 0.04)
    }
    edge.color.copy(base).multiplyScalar(level)
    pane.gain.value = level * 0.8
    pool.gain.value = 0.28 + (level * 0.6)
  })

  return (
    <group position={[stage.x, 0, 0]}>
      <mesh material={edge} position={[0, centre, -halfWidth]} renderOrder={3}>
        <boxGeometry args={[BAR, height, BAR]} />
      </mesh>
      <mesh material={edge} position={[0, centre, halfWidth]} renderOrder={3}>
        <boxGeometry args={[BAR, height, BAR]} />
      </mesh>
      <mesh material={edge} position={[0, PIPELINE.gateTop, 0]} renderOrder={3}>
        <boxGeometry args={[BAR, BAR, beam]} />
      </mesh>
      <mesh material={edge} position={[0, PIPELINE.floorY + 0.5, 0]} renderOrder={3}>
        <boxGeometry args={[BAR * 1.6, 1, beam]} />
      </mesh>

      <mesh
        material={pane.material}
        position={[0, centre, 0]}
        rotation={[0, Math.PI / 2, 0]}
        renderOrder={2}
      >
        <planeGeometry args={[halfWidth * 2, height]} />
      </mesh>

      <mesh
        material={pool.material}
        position={[0, PIPELINE.floorY + 0.08, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={1}
      >
        <planeGeometry args={[46, (halfWidth * 2) + 38]} />
      </mesh>

      <Html
        center
        position={[0, PIPELINE.gateTop + 5.5, 0]}
        zIndexRange={[12, 4]}
        style={{ pointerEvents: 'none' }}
      >
        <div className={styles.gate} style={{ '--tone': stage.color } as CSSProperties}>
          {stage.name}
        </div>
      </Html>
    </group>
  )
}

/** One ring expanding in the plane of a gate. */
interface LiveRing {
  x: number
  color: Color
  started: number
  life: number
  radius: number
}

/**
 * Rings expanding in the plane of a gate.
 *
 * The pool drains the queue the comet layer fills, so a ring is spent the
 * moment it is drawn and nothing repeats on its own: a certificate rings once
 * where it lands, and a finished run rings once at Integration.
 * @param props - The shared frame state holding the queue.
 * @returns The ring pool.
 */
function GateRings({ heat }: { heat: PipelineHeat }): ReactNode {
  const meshes = useRef<(Mesh | null)[]>([])
  const live = useRef<LiveRing[]>([])
  const materials = useMemo(
    () => Array.from({ length: RING_POOL }, () => new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })),
    [],
  )

  useEffect(() => () => {
    for (const material of materials) material.dispose()
  }, [materials])

  useFrame(() => {
    const now = performance.now()
    while (heat.rings.length > 0) {
      const request = heat.rings.shift()
      if (request === undefined) break
      live.current.push({
        x: request.x,
        color: new Color(request.color),
        started: now,
        life: request.life,
        radius: request.radius,
      })
      if (live.current.length > RING_POOL) live.current.shift()
    }

    for (const [index, material] of materials.entries()) {
      const mesh = meshes.current[index]
      if (mesh === null || mesh === undefined) continue
      const entry = live.current[index]
      const age = entry === undefined ? 1 : (now - entry.started) / entry.life
      if (entry === undefined || age >= 1) {
        mesh.visible = false
        continue
      }
      const eased = 1 - ((1 - age) * (1 - age) * (1 - age))
      mesh.visible = true
      mesh.position.x = entry.x
      mesh.scale.setScalar(2 + (eased * entry.radius))
      material.color.copy(entry.color)
      material.opacity = (1 - age) * (1 - age) * 0.95
    }

    live.current = live.current.filter(entry => now - entry.started < entry.life)
  })

  return (
    <group position={[0, PIPELINE.railY, 0]}>
      {materials.map((material, index) => (
        <mesh
          key={index}
          ref={(mesh) => { meshes.current[index] = mesh }}
          material={material}
          rotation={[0, Math.PI / 2, 0]}
          renderOrder={7}
          visible={false}
        >
          <ringGeometry args={[0.9, 1, 72]} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * The three gates of the pipeline and the rings that break over them.
 * @param props - The pipeline's half-width, the shared frame state, and how
 * many events have arrived at each stage.
 * @returns The gates.
 */
export function Gates({
  halfWidth,
  heat,
  arrivals,
}: {
  halfWidth: number
  heat: PipelineHeat
  arrivals: readonly number[]
}): ReactNode {
  return (
    <group>
      {STAGES.slice(1).map((stage, index) => (
        <Gate
          key={stage.id}
          stage={stage}
          halfWidth={halfWidth}
          heat={heat}
          arrivals={arrivals[index + 1] ?? 0}
        />
      ))}
      <GateRings heat={heat} />
    </group>
  )
}
