/**
 * The Operations view's store: the reading it shows, how often it re-reads,
 * and the activity frames it plays onto the scene.
 *
 * Frames are played against their own clock. A live frame is shown at its
 * `ts` plus {@link liveDelayMs}, one push interval and a margin behind the
 * machine, because the relay receives a batch per interval; frames therefore
 * arrive in bursts and play back continuously in their recorded order and
 * spacing. A recent snapshot's frames are a replay: they play at their
 * recorded spacing, compressed to at most {@link REPLAY_SPAN_MS}, and loop.
 *
 * Frame state (`flashes`, `pulses`) is mutated in place and read from
 * `useFrame`, as the deck's main store does, so the scene never re-renders React.
 */

'use client'

import { create } from 'zustand'
import type { OpsSnapshot, RunEvent } from './contract.ts'
import { frameKey, ledgerStation, opsEventsUrl, readOps, stationOf, type OpsReading, type Station } from './ops.ts'

/** How often a live view re-reads the snapshot when the producer states no interval. */
const DEFAULT_INTERVAL_MS = 15_000

/** How often a view that is not live asks the feed again, so it goes live when the loop restarts. */
const RETRY_MS = 60_000

/** The longest a replayed snapshot's frames take to play once. */
const REPLAY_SPAN_MS = 90_000

/** How far past its slot a live frame may arrive and still be played. */
const LATE_MS = 3_000

/** How many played frames the ticker keeps. */
const TICKER_LIMIT = 14

/** How often the player releases due frames. */
const TICK_MS = 250

/** How long a frame keeps a seat or a station lit, read by the scene. */
export const FLASH_MS = 2_600

/** Connection state of the activity stream. */
type OpsStreamState = 'idle' | 'open' | 'retrying' | 'replay' | 'closed'

/** A frame on its way to the scene, with where it lands. */
interface PlayedFrame {
  frame: RunEvent
  /** The seat or operator agent it lights. */
  target: string
  station?: Station
}

/** A completion the scene rings once, then drops. */
interface Pulse {
  station: Station
  at: number
}

/** One frame's comet: from the seat or agent that logged it to the station it works at. */
interface Launch {
  target: string
  station: Station
  at: number
}

/** Everything the Operations view holds. */
interface OpsState {
  reading: OpsReading | undefined
  booted: boolean
  streamState: OpsStreamState
  /** `Date.now()` of the last read, for the age the view counts up from. */
  readAt: number | undefined
  /** The newest played frames, newest first, for the ticker. */
  ticker: PlayedFrame[]
  /** Last `performance.now()` each seat or operator agent was lit; mutated in place. */
  flashes: Map<string, number>
  /** Last `performance.now()` each station was lit; mutated in place. */
  stationFlashes: Map<Station, number>
  /** Completion pulses the scene has not drawn yet; mutated in place. */
  pulses: Pulse[]
  /** Comets the scene has not launched yet; mutated in place. */
  launches: Launch[]
  boot: () => void
  /** Read the snapshot again now. */
  refresh: () => Promise<void>
}

/**
 * The delay a live frame is played behind the machine: one producer interval
 * and five seconds.
 * @param snapshot - The live snapshot.
 * @returns Milliseconds.
 */
export function liveDelayMs(snapshot: OpsSnapshot | undefined): number {
  return ((snapshot?.intervalSeconds ?? DEFAULT_INTERVAL_MS / 1000) * 1000) + 5_000
}

/**
 * Where one frame lands on the scene.
 * @param frame - The frame.
 * @param snapshot - The snapshot whose agents name the frame's session.
 * @returns The seat or agent it lights and the station it rings, or `undefined` for a frame no agent or seat names.
 */
export function placeFrame(frame: RunEvent, snapshot: OpsSnapshot | undefined): PlayedFrame | undefined {
  if (frame.sessionId === 'ledger') {
    return frame.agentId === undefined ? undefined : { frame, target: frame.agentId, station: ledgerStation(frame) }
  }
  const agent = snapshot?.agents.find(entry => entry.id === frame.sessionId)
  const station = agent === undefined ? undefined : stationOf(agent.kind, agent.label)
  const target = frame.agentId ?? agent?.seat ?? frame.sessionId
  return { frame, target, ...station === undefined ? {} : { station } }
}

let queue: { due: number; frame: RunEvent }[] = []
const seen = new Set<string>()
let player: ReturnType<typeof setInterval> | undefined
let poll: ReturnType<typeof setTimeout> | undefined
let source: EventSource | undefined
let replayTimer: ReturnType<typeof setTimeout> | undefined

export const useOps = create<OpsState>((set, get) => {
  /** Queue a live frame once, due one delay after its own time. */
  const enqueueLive = (frame: RunEvent): void => {
    const key = frameKey(frame)
    if (seen.has(key)) return
    seen.add(key)
    const late = Date.now() - (frame.ts + liveDelayMs(get().reading?.snapshot))
    // A frame already past its slot (the backlog a first read or a reconnection brings) is not played as if it were happening now.
    if (late > LATE_MS) return
    queue.push({ due: performance.now() - late, frame })
  }

  /** Play a recent snapshot's frames at their recorded spacing, compressed, then loop. */
  const replay = (snapshot: OpsSnapshot): void => {
    if (replayTimer !== undefined) clearTimeout(replayTimer)
    const frames = [...snapshot.activity].sort((a, b) => a.ts - b.ts)
    const first = frames[0]
    const last = frames.at(-1)
    if (first === undefined || last === undefined) return
    const span = Math.max(1, last.ts - first.ts)
    const scale = Math.min(1, REPLAY_SPAN_MS / span)
    const start = performance.now() + 600
    for (const frame of frames) queue.push({ due: start + ((frame.ts - first.ts) * scale), frame })
    replayTimer = setTimeout(() => replay(snapshot), (span * scale) + 4_000)
  }

  const release = (): void => {
    const now = performance.now()
    const due = queue.filter(entry => entry.due <= now)
    if (due.length === 0) return
    queue = queue.filter(entry => entry.due > now)
    const { reading, flashes, stationFlashes, pulses, launches } = get()
    const played: PlayedFrame[] = []
    for (const { frame } of due.sort((a, b) => a.due - b.due)) {
      const placed = placeFrame(frame, reading?.snapshot)
      if (placed === undefined) continue
      flashes.set(placed.target, now)
      if (placed.station !== undefined) {
        stationFlashes.set(placed.station, now)
        launches.push({ target: placed.target, station: placed.station, at: now })
        if (frame.kind === 'merge' || frame.kind === 'certificate') pulses.push({ station: placed.station, at: now })
      }
      played.push(placed)
    }
    if (played.length > 0) set(state => ({ ticker: [...played.reverse(), ...state.ticker].slice(0, TICKER_LIMIT) }))
  }

  const openStream = (feed: string): void => {
    if (source !== undefined || typeof EventSource === 'undefined') return
    const next = new EventSource(opsEventsUrl(feed))
    source = next
    next.onopen = () => set({ streamState: 'open' })
    next.onmessage = (message: MessageEvent<string>) => {
      let value: unknown
      try {
        value = JSON.parse(message.data)
      } catch {
        // A heartbeat or torn frame: the next one carries the next event.
        return
      }
      const frame = value as Partial<RunEvent>
      if (typeof frame.ts !== 'number' || typeof frame.seq !== 'number' || typeof frame.sessionId !== 'string' || typeof frame.label !== 'string') return
      enqueueLive(frame as RunEvent)
    }
    next.onerror = () => set({ streamState: next.readyState === EventSource.CLOSED ? 'closed' : 'retrying' })
  }

  const closeStream = (): void => {
    source?.close()
    source = undefined
  }

  const schedule = (reading: OpsReading): void => {
    if (poll !== undefined) clearTimeout(poll)
    const wait = reading.mode === 'live' ? Math.max(10_000, (reading.snapshot?.intervalSeconds ?? 15) * 1000) : RETRY_MS
    poll = setTimeout(() => { void get().refresh() }, wait)
  }

  return {
    reading: undefined,
    booted: false,
    streamState: 'idle',
    readAt: undefined,
    ticker: [],
    flashes: new Map<string, number>(),
    stationFlashes: new Map<Station, number>(),
    pulses: [],
    launches: [],

    boot: () => {
      if (get().booted) return
      set({ booted: true })
      player = setInterval(release, TICK_MS)
      void get().refresh()
    },

    refresh: async () => {
      const previous = get().reading
      const reading = await readOps()
      set({ reading, readAt: Date.now() })
      const snapshot = reading.snapshot
      if (reading.mode === 'live' && snapshot !== undefined) {
        if (previous?.mode !== 'live') {
          if (replayTimer !== undefined) clearTimeout(replayTimer)
          queue = []
        }
        for (const frame of snapshot.activity) enqueueLive(frame)
        openStream(reading.feed)
      } else {
        closeStream()
        const replayed = previous?.snapshot?.generatedAt === snapshot?.generatedAt && previous?.mode === reading.mode
        if (!replayed) {
          queue = []
          if (snapshot !== undefined) replay(snapshot)
        }
        set({ streamState: snapshot === undefined ? 'closed' : 'replay' })
      }
      schedule(reading)
    },
  }
})

/**
 * Stop the store's timers and stream; the view calls it when it unmounts.
 */
export function stopOps(): void {
  if (player !== undefined) clearInterval(player)
  if (poll !== undefined) clearTimeout(poll)
  if (replayTimer !== undefined) clearTimeout(replayTimer)
  source?.close()
  source = undefined
  player = undefined
  poll = undefined
  replayTimer = undefined
  queue = []
  seen.clear()
  useOps.setState({ booted: false, streamState: 'idle' })
}
