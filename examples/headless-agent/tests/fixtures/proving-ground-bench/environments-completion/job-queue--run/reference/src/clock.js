/** The clock the simulation runs on: it only ever moves forward, and only when asked. */

/**
 * A clock starting at zero.
 * @returns {{now: () => number, advanceTo: (instant: number) => void}} the clock.
 */
export function createClock() {
  let instant = 0
  return {
    now: () => instant,
    advanceTo: (target) => {
      if (target > instant) instant = target
    },
  }
}
