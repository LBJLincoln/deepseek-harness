/** The clock the simulation runs on: it only ever moves forward, and only when asked. */

/**
 * A clock starting at zero.
 * @returns {{now: () => number, advanceTo: (instant: number) => void}} the clock.
 */
export function createClock() {
  throw new Error('not implemented')
}
