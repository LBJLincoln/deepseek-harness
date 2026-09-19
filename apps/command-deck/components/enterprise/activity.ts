/**
 * How the enterprise scene reads the run's activity.
 *
 * `store.activity` holds one `performance.now()` timestamp per agent, written
 * by the shell as events arrive. Every moving thing in the scene — the node
 * pulse, the orbital rings, the traffic on an edge — takes its intensity from
 * those timestamps, so a still graph means a still run and nothing on screen
 * animates on its own account.
 */

/** How long an agent keeps pulsing after its last event, in milliseconds. */
export const PULSE_WINDOW_MS = 2_600

/** How long an edge keeps carrying traffic after either endpoint acted, in milliseconds. */
export const FLOW_WINDOW_MS = 5_000

/**
 * How long ago one agent last acted.
 * @param activity - The store's last-event timestamp per agent id.
 * @param id - The agent to read.
 * @param now - The current `performance.now()` reading.
 * @returns Milliseconds since that agent's last event, or `Infinity` when it has not acted.
 */
export function sinceLast(activity: ReadonlyMap<string, number>, id: string, now: number): number {
  const at = activity.get(id)
  return at === undefined ? Infinity : now - at
}

/**
 * Fade one activity age across a window.
 * @param since - Milliseconds since the event, as `sinceLast` reports it.
 * @param window - The window the fade spans, in milliseconds.
 * @returns `1` at the moment of the event, falling linearly to `0` at the end of the window.
 */
export function decay(since: number, window: number): number {
  return since >= window ? 0 : 1 - (since / window)
}
