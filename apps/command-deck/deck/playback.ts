/**
 * Replaying a recorded run against its own clock.
 *
 * The deck receives a finished run's history in one burst, so a reviewer sees
 * the result rather than the work. Playback walks the timeline cursor along the
 * recorded `ts` of the admitted frames at a multiple of real time, which is
 * what turns a twenty-minute review into a minute of screen time: every view
 * that reads `eventsUpTo` rebuilds itself as the run rebuilt itself.
 *
 * It drives the shared cursor and nothing else, so whichever views are mounted
 * replay together and a scrub during playback is picked up rather than fought.
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunEvent } from './contract.ts'
import { eventTimeMs, useDeck } from './store.ts'

/** The speeds playback offers, slowest first. */
export const PLAYBACK_SPEEDS = [1, 10, 30, 60] as const

/** How much faster than the recording playback is running. */
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

/**
 * Frame state the scenes read: how fast recorded time is passing.
 *
 * A scene that meters work out at a fixed rate has to scale that rate with
 * playback or it falls behind the cursor and stops being a picture of the run.
 * It is mutated in place and read from `useFrame`, because a sixty-times-a-second
 * render pass must not go through React.
 */
export const playbackClock = { speed: 1 }

/** How long the cursor may go unwritten while playback runs, in milliseconds. */
const MIN_WRITE_MS = 120

/** Elements that own their own keystrokes, where playback's shortcuts must not fire. */
const TYPING = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']

/** What the playback controls show and drive. */
export interface Playback {
  playing: boolean
  speed: PlaybackSpeed
  /** Recorded milliseconds the cursor has passed. */
  elapsedMs: number
  /** Recorded milliseconds still ahead of the cursor. */
  remainingMs: number
  /** The whole recorded span, in milliseconds. */
  spanMs: number
  /** Whether the deck is following the head rather than a point of the timeline. */
  atHead: boolean
  /** Whether the run holds a span long enough to play. */
  ready: boolean
  /** Start playing from the cursor, or pause where it has reached. */
  toggle: () => void
  setSpeed: (speed: PlaybackSpeed) => void
  /** Move to the next or previous speed; the ends hold. */
  stepSpeed: (delta: number) => void
  /** Stop playing and return to following the head. */
  stop: () => void
}

/** The two ends of a run's recorded span. */
interface Span {
  first: number | undefined
  last: number | undefined
}

/**
 * The ends of the recorded span, which is what playback walks between.
 *
 * Frames arrive in the order the feed folds its sessions rather than in the
 * order they were logged, so the ends are the extremes of the whole window and
 * not its first and last frame.
 * @param events - The run's event window.
 * @returns The oldest and newest parsable timestamps.
 */
function spanOf(events: readonly RunEvent[]): Span {
  let first: number | undefined
  let last: number | undefined
  for (const event of events) {
    const at = eventTimeMs(event)
    if (Number.isNaN(at)) continue
    if (first === undefined || at < first) first = at
    if (last === undefined || at > last) last = at
  }
  return { first, last }
}

/**
 * Playback over the followed run's recorded span.
 *
 * `Space` plays and pauses, `[` and `]` step the speed; both are live only
 * while a view that mounts this hook is on screen, and neither fires while the
 * viewer is typing in a control. Playback starts at the cursor, or at the first
 * recorded frame when the deck is following the head, and returns to following
 * the head when it reaches the end — a run still producing therefore carries on
 * live the moment playback catches up with it.
 * @returns The playback state and its controls.
 */
export function usePlayback(): Playback {
  const events = useDeck(state => state.events)
  const cursor = useDeck(state => state.cursor)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)

  const { first, last } = useMemo(() => spanOf(events), [events])
  const ready = first !== undefined && last !== undefined && last > first

  const at = useRef(0)
  const written = useRef<number | undefined>(undefined)

  useEffect(() => { playbackClock.speed = playing ? speed : 1 }, [playing, speed])
  useEffect(() => () => { playbackClock.speed = 1 }, [])

  const stop = useCallback(() => {
    setPlaying(false)
    written.current = undefined
    useDeck.getState().setCursor(undefined)
  }, [])

  const toggle = useCallback(() => {
    setPlaying((was) => {
      if (was) return false
      const from = useDeck.getState().cursor
      at.current = from ?? first ?? 0
      written.current = from
      return true
    })
  }, [first])

  const stepSpeed = useCallback((delta: number) => {
    setSpeed((was) => {
      const index = PLAYBACK_SPEEDS.indexOf(was)
      const next = Math.min(PLAYBACK_SPEEDS.length - 1, Math.max(0, index + delta))
      return PLAYBACK_SPEEDS[next] ?? was
    })
  }, [])

  useEffect(() => {
    if (!playing || !ready) return undefined
    let frame = 0
    // Recorded time is measured from an anchor rather than summed over frames,
    // so the speed the viewer chose is the speed they get: a scene rendering at
    // two frames a second replays the run just as fast as one at sixty, it
    // simply draws fewer of the steps between.
    let anchorAt = at.current
    let anchorWall = performance.now()
    let lastWrite = 0

    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick)
      // A scrub while playback runs moves the cursor under it; playback carries
      // on from where the viewer left it rather than snapping back.
      const live = useDeck.getState().cursor
      if (live !== written.current && live !== undefined) {
        anchorAt = live
        anchorWall = now
      }
      at.current = anchorAt + ((now - anchorWall) * speed)
      if (last !== undefined && at.current >= last) {
        stop()
        return
      }
      if (now - lastWrite < MIN_WRITE_MS) return
      lastWrite = now
      written.current = at.current
      useDeck.getState().setCursor(at.current)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, ready, speed, last, stop])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && TYPING.includes(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === ' ') {
        event.preventDefault()
        toggle()
        return
      }
      if (event.key === '[') stepSpeed(-1)
      if (event.key === ']') stepSpeed(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepSpeed, toggle])

  const spanMs = ready && first !== undefined && last !== undefined ? last - first : 0
  const elapsedMs = cursor === undefined || first === undefined
    ? spanMs
    : Math.min(spanMs, Math.max(0, cursor - first))

  return {
    playing,
    speed,
    elapsedMs,
    remainingMs: spanMs - elapsedMs,
    spanMs,
    atHead: cursor === undefined,
    ready,
    toggle,
    setSpeed,
    stepSpeed,
    stop,
  }
}
