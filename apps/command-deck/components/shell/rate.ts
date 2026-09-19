'use client'

import { useEffect, useState } from 'react'
import type { RunEvent } from '@/deck/contract'
import { useDeck } from '@/deck/store'

/** The window the rate is measured over: the last minute of the stream. */
const WINDOW_MS = 60_000

/** How often a live deck re-reads the clock, so a quiet feed's rate falls. */
const TICK_MS = 5_000

/**
 * A timestamp that advances on its own.
 *
 * A rate measured against the wall clock has to keep being recomputed or it
 * freezes at whatever it read when the last event arrived, and a feed that has
 * gone quiet would go on reporting the rate it had.
 * @param enabled - Whether to tick; a stopped clock returns a fixed mount time.
 * @returns Milliseconds since the epoch, re-read every {@link TICK_MS}.
 */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [enabled])

  return now
}

/**
 * Count the events whose timestamps fall in the minute before `anchorMs`.
 *
 * The scan runs backwards from the newest frame and stops at the first one
 * outside the window, because the stream arrives in sequence order.
 * @param events - The event window, oldest first.
 * @param anchorMs - The instant the window ends at.
 * @returns Events in the window.
 */
function countInWindow(events: readonly RunEvent[], anchorMs: number): number {
  const floor = anchorMs - WINDOW_MS
  let count = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) break
    const at = Date.parse(event.ts)
    if (Number.isNaN(at)) continue
    if (at < floor) break
    if (at <= anchorMs) count += 1
  }
  return count
}

/**
 * The rate the followed run is producing events at, in events per minute.
 *
 * The window ends at the wall clock on a live feed, so a feed that stops
 * reporting decays to nothing within the minute. In replay it ends at the
 * newest frame instead, because the committed fixtures carry the timestamps
 * the run had when it was recorded and a wall-clock window over them would
 * always be empty. Either way the number is counted from the timestamps the
 * feed sent; nothing is extrapolated.
 * @returns The count, or `undefined` when no event falls in the window.
 */
export function useEventRate(): number | undefined {
  const events = useDeck(state => state.events)
  const live = useDeck(state => state.source?.mode) === 'live'
  const now = useNow(live)

  const newest = events.at(-1)
  if (newest === undefined) return undefined
  const anchor = live ? now : Date.parse(newest.ts)
  if (Number.isNaN(anchor)) return undefined

  const count = countInWindow(events, anchor)
  return count === 0 ? undefined : count
}
