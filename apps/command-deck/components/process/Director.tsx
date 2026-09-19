'use client'

import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ElementRef, type ReactNode } from 'react'
import { Vector3 } from 'three'
import { usePrefersReducedMotion } from '@/deck/motion'
import { PIPELINE } from '@/deck/pipeline'

/** One camera placement the director can hold. */
export interface Pose {
  position: Vector3
  target: Vector3
}

/** The wide shot the establishing move opens on, and the camera the canvas starts at. */
export const ESTABLISH: Pose = {
  position: new Vector3(4, 196, 250),
  target: new Vector3(0, 0, 0),
}

/** The angle the pipeline is read from: departments near, Integration away. */
const WORKING: Pose = {
  position: new Vector3(-92, 48, 140),
  target: new Vector3(-24, 3, 0),
}

/** The wider angle a finished run is framed from, every lane and the lit gate included. */
const FINISHED: Pose = {
  position: new Vector3(-36, 70, 200),
  target: new Vector3(-10, 2, 0),
}

/** The one angle the pipeline is held at for a viewer who asked for reduced motion. */
const STILL: Pose = {
  position: new Vector3(-44, 62, 198),
  target: new Vector3(-12, 3, 0),
}

/** How long the establishing move takes, in milliseconds. */
const ESTABLISH_MS = 2_500

/** How far, and how slowly, the camera drifts along a running pipeline. */
const DRIFT = { reach: 17, seconds: 52 }

/** How long the viewer keeps the camera after touching the controls. */
const HANDOVER_MS = 12_000

/** The reusable goal the director eases towards; nothing is allocated per frame. */
const GOAL: Pose = { position: new Vector3(), target: new Vector3() }

/**
 * Cubic ease in and out.
 * @param t - Progress, in `0..1`.
 * @returns The eased progress.
 */
function cubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (((-2 * t) + 2) ** 3 / 2)
}

/**
 * The camera over the pipeline.
 *
 * It opens on a wide establishing move, drifts along the pipeline while the run
 * is still producing, pulls back to frame every lane and the lit Integration
 * gate once the run has finished, and follows the time plane while the timeline
 * scrubber is off the head. Touching the controls hands the camera to the
 * viewer; it is taken back only after the viewer has let go of it. Under
 * reduced motion the camera holds one angle over the whole pipeline and never
 * moves.
 * @param props - Whether the run has finished, and the cursor's position in the
 * run when the timeline is off the head.
 * @returns The controls.
 */
export function Director({
  completed,
  progress,
}: {
  completed: boolean
  progress: number | undefined
}): ReactNode {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null)
  const reduced = usePrefersReducedMotion()
  const { camera } = useThree()
  const opened = useRef(0)
  const touched = useRef(-Infinity)
  const held = useRef(0)
  const span = useMemo(() => PIPELINE.railEnd - PIPELINE.railStart, [])

  useEffect(() => {
    const control = controls.current
    if (control === null) return undefined
    // `start` is the viewer reaching for the camera; `change` also fires for
    // every move the director itself makes, so it cannot mean the same thing.
    const onStart = (): void => { touched.current = performance.now() }
    control.addEventListener('start', onStart)
    return () => control.removeEventListener('start', onStart)
  }, [])

  useFrame((state, delta) => {
    const control = controls.current
    if (control === null) return
    const now = performance.now()

    if (reduced) {
      camera.position.copy(STILL.position)
      control.target.copy(STILL.target)
      control.update()
      return
    }

    if (now - touched.current < HANDOVER_MS) {
      control.update()
      return
    }

    if (opened.current === 0) opened.current = now
    const opening = (now - opened.current) / ESTABLISH_MS
    if (opening < 1) {
      const eased = cubic(Math.max(0, opening))
      camera.position.lerpVectors(ESTABLISH.position, WORKING.position, eased)
      control.target.lerpVectors(ESTABLISH.target, WORKING.target, eased)
      control.update()
      return
    }

    if (progress !== undefined) {
      held.current = progress
      // A gentle pan, not a chase: the plane moves the framing along the
      // pipeline while the camera keeps the distance a viewer reads gates at.
      const plane = PIPELINE.railStart + 12 + (held.current * (span - 24))
      const offset = plane - ((PIPELINE.railStart + PIPELINE.railEnd) / 2)
      GOAL.position.set(FINISHED.position.x + (offset * 0.28), 60, 190)
      GOAL.target.set(FINISHED.target.x + (offset * 0.34), 3, 0)
    } else if (completed) {
      GOAL.position.copy(FINISHED.position)
      GOAL.target.copy(FINISHED.target)
    } else {
      const sway = Math.sin((state.clock.elapsedTime * Math.PI * 2) / DRIFT.seconds) * DRIFT.reach
      GOAL.position.copy(WORKING.position)
      GOAL.position.x += sway
      GOAL.target.copy(WORKING.target)
      GOAL.target.x += sway * 0.7
    }

    const step = Math.min(1, delta * 1.3)
    camera.position.lerp(GOAL.position, step)
    control.target.lerp(GOAL.target, step)
    control.update()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      rotateSpeed={0.42}
      zoomSpeed={0.7}
      minDistance={40}
      maxDistance={420}
      maxPolarAngle={Math.PI * 0.495}
    />
  )
}
