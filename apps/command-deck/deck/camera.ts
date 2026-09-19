/**
 * The deck's shared camera moves.
 *
 * Every scene orbits its own subject through drei's `OrbitControls`, so a move
 * has to write the camera position and the orbit target together or the next
 * `update()` snaps the camera back. {@link flyTo} does both from one eased
 * parameter and allocates only when the flight is created, which is what lets a
 * scene drive it from `useFrame` without producing garbage sixty times a
 * second.
 */

import type { Vector3 } from 'three'

/**
 * The part of drei's `OrbitControls` a flight writes to.
 *
 * Typed structurally rather than imported, because the controls instance is
 * `three-stdlib`'s and the scenes hold it behind their own refs.
 */
export interface OrbitLikeControls {
  /** The camera the controls drive. */
  object: { position: Vector3 }
  /** The point the camera orbits, in world space. */
  target: Vector3
  /** Applies `object.position` and `target` to the camera. */
  update: () => void
}

/** A flight in progress, stepped by the scene's frame loop. */
export interface Flight {
  /**
   * Advance the flight and write the camera position and orbit target.
   * @param elapsedMs - Milliseconds since the flight was created.
   * @returns `true` while the flight is still moving, `false` once it has landed.
   */
  step: (elapsedMs: number) => boolean
}

/**
 * Cubic ease in and out over the unit interval.
 *
 * The deck's one easing curve: it leaves and arrives at zero velocity, so a
 * camera move starts and settles without a visible cut at either end.
 * @param t - Progress, clamped by the caller to `0..1`.
 * @returns The eased progress.
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2
}

/**
 * Begin a camera flight along a straight line, easing at both ends.
 *
 * The orbit target is interpolated from wherever the controls are pointing when
 * the flight is created, so a flight started mid-orbit does not jerk. `from`,
 * `to` and `target` are read every step and never written, so a caller may keep
 * one vector per scene and re-aim it between flights.
 * @param controls - The controls to drive; its camera and target are written in place.
 * @param from - Camera position the flight leaves from.
 * @param to - Camera position the flight arrives at.
 * @param target - Orbit target the flight arrives at.
 * @param durationMs - Length of the flight; zero or less lands immediately.
 * @returns The flight to step from `useFrame`.
 */
export function flyTo(
  controls: OrbitLikeControls,
  from: Vector3,
  to: Vector3,
  target: Vector3,
  durationMs: number,
): Flight {
  const targetFrom = controls.target.clone()
  return {
    step: (elapsedMs: number): boolean => {
      const progress = durationMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / durationMs))
      const eased = easeInOutCubic(progress)
      controls.object.position.lerpVectors(from, to, eased)
      controls.target.lerpVectors(targetFrom, target, eased)
      controls.update()
      return progress < 1
    },
  }
}

/** How a scene opens before it settles into its resting frame. */
export interface EstablishingShot {
  /**
   * Per-axis multiplier applied to the resting camera position to place the
   * opening frame: further out and higher up, looking down on the subject.
   */
  offset: readonly [number, number, number]
  /** How long the move from the opening frame to the resting frame takes. */
  durationMs: number
}

/**
 * The deck's opening move, shared so the three scenes arrive the same way.
 *
 * The opening frame sits well above and behind the resting one; over
 * {@link EstablishingShot.durationMs} the camera descends into place, which
 * reads as the subject assembling rather than appearing.
 */
export const establishingShot: EstablishingShot = {
  offset: [1.18, 2.6, 1.55],
  durationMs: 2_800,
}

/**
 * Place the opening frame for one resting camera position.
 * @param rest - The resting camera position.
 * @param out - Vector written with the opening position; may be `rest` itself.
 * @param shot - The shot to apply; the deck's own by default.
 * @returns `out`, for chaining into {@link flyTo}.
 */
export function establishingFrom(
  rest: Vector3,
  out: Vector3,
  shot: EstablishingShot = establishingShot,
): Vector3 {
  const [x, y, z] = shot.offset
  return out.set(rest.x * x, rest.y * y, rest.z * z)
}
