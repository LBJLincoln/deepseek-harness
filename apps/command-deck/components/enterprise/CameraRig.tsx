'use client'

import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ElementRef, type ReactNode } from 'react'
import { Vector3 } from 'three'
import type { GraphLayout } from '@/deck/layout-enterprise'
import { usePrefersReducedMotion } from '@/deck/motion'
import { useDeck } from '@/deck/store'

/** Duration of the opening flight from the establishing shot down to rest, in milliseconds. */
const ESTABLISH_MS = 2_500

/** Duration of a flight to a selected agent, and of the flight back, in milliseconds. */
const FOCUS_MS = 1_200

/** How far outside a selected agent the camera settles, in world units. */
const FOCUS_DISTANCE = 62

/** How far above a selected agent the camera settles, in world units. */
const FOCUS_LIFT = 16

/** Where the camera points from and at. */
interface Shot {
  position: Vector3
  target: Vector3
}

/** One timed move between two shots. */
interface Flight {
  from: Shot
  to: Shot
  started: number
  duration: number
}

/**
 * Cubic ease-in-out.
 * @param t - Progress in `[0, 1]`.
 * @returns The eased progress, starting and ending at rest.
 */
function cubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((((-2 * t) + 2) ** 3) / 2)
}

/**
 * The shot the graph sits in when nothing is selected.
 * @param layout - The computed layout, whose extent frames the whole roster.
 * @returns The resting shot.
 */
function restingShot(layout: GraphLayout): Shot {
  return {
    position: new Vector3(0, layout.extent * 0.26, layout.extent * 2.2),
    target: new Vector3(0, 0, 0),
  }
}

/**
 * The shot the deck opens on: far enough out that the graph reads as one body
 * in the haze, and high enough that the flight down has somewhere to go.
 * @param layout - The computed layout, whose extent sets the distance.
 * @returns The establishing shot.
 */
function establishingShot(layout: GraphLayout): Shot {
  return {
    position: new Vector3(layout.extent * 0.85, layout.extent * 1.35, layout.extent * 3),
    target: new Vector3(0, 0, 0),
  }
}

/**
 * The shot that frames one agent.
 *
 * The approach keeps the direction the camera is already looking from: the
 * agent was clicked because it was visible, so nothing stands between that
 * direction and it, and the flight reads as closing in on what was picked
 * rather than as a cut to somewhere else.
 * @param x - The agent's world x.
 * @param y - The agent's world y.
 * @param z - The agent's world z.
 * @param from - Where the camera is now.
 * @returns A shot looking at the agent from just outside it.
 */
function focusShot(x: number, y: number, z: number, from: Vector3): Shot {
  const target = new Vector3(x, y, z)
  const approach = from.clone().sub(target)
  if (approach.lengthSq() < 1) approach.copy(target).normalize()
  approach.normalize().multiplyScalar(FOCUS_DISTANCE)
  return { position: target.clone().add(approach).add(new Vector3(0, FOCUS_LIFT, 0)), target }
}

/**
 * Camera behaviour: the opening flight, a slow orbit at rest, and a flight to
 * and back from the selected agent.
 *
 * Every move is a timed cubic ease rather than a per-frame approach, so the
 * opening shot lands on the beat it was written for instead of drifting with
 * the frame rate. Under `prefers-reduced-motion` the deck opens at rest and
 * selection cuts straight to its shot.
 * @param props - The computed layout, which supplies every shot.
 * @returns The controls.
 */
export function CameraRig({ layout }: { layout: GraphLayout }): ReactNode {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null)
  const reduced = usePrefersReducedMotion()
  const selectedId = useDeck(state => state.selectedAgentId)
  const { camera } = useThree()
  const flight = useRef<Flight | undefined>(undefined)
  const opened = useRef(false)
  const [resting, setResting] = useState(false)

  // The hook's first value is `false` so a server render and the first client
  // render agree; the opening shot is decided before that resolves, so it asks
  // the media query itself.
  const [reducedAtMount] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const resting3D = useMemo(() => restingShot(layout), [layout])

  useLayoutEffect(() => {
    if (reducedAtMount) return
    const opening = establishingShot(layout)
    camera.position.copy(opening.position)
  }, [camera, layout, reducedAtMount])

  useEffect(() => {
    const control = controls.current
    if (control === null) return
    const node = selectedId === undefined ? undefined : layout.nodes[layout.index.get(selectedId) ?? -1]
    if (selectedId !== undefined && node === undefined) return
    const to = node === undefined ? resting3D : focusShot(node.x, node.y, node.z, camera.position)
    const first = !opened.current
    opened.current = true

    if (reduced) {
      flight.current = undefined
      camera.position.copy(to.position)
      control.target.copy(to.target)
      setResting(true)
      return
    }

    flight.current = {
      from: { position: camera.position.clone(), target: control.target.clone() },
      to,
      started: performance.now(),
      duration: first ? ESTABLISH_MS : FOCUS_MS,
    }
    setResting(false)
  }, [camera, layout, reduced, resting3D, selectedId])

  useFrame(() => {
    const control = controls.current
    if (control === null) return
    const move = flight.current
    if (move !== undefined) {
      const progress = Math.min(1, (performance.now() - move.started) / move.duration)
      const eased = cubicInOut(progress)
      camera.position.lerpVectors(move.from.position, move.to.position, eased)
      control.target.lerpVectors(move.from.target, move.to.target, eased)
      if (progress >= 1) {
        flight.current = undefined
        setResting(true)
      }
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
      // A drag takes the camera over: the opening flight is a shot, not a lock,
      // and the orbit it was flying into resumes from wherever the drag ends.
      onStart={() => {
        flight.current = undefined
        setResting(true)
      }}
      autoRotate={!reduced && resting && selectedId === undefined}
      autoRotateSpeed={0.28}
    />
  )
}
