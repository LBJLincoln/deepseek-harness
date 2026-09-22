/**
 * The run event stream client.
 *
 * `GET /runs/:id/events` replays history and then stays open, so a reconnect
 * receives frames the deck already holds. Every frame carries a `seq` that
 * counts from one inside its own session, so deduplication keys on the pair of
 * `sessionId` and `seq`: the caller's `onEvent` sees each pair exactly once for
 * the life of the subscription, across any number of reconnections. Keying on
 * `seq` alone kept 404 of the 1,079 frames of a seven-session review.
 *
 * In replay the same subscription reads a committed recording once and paces
 * it the way the feed would have streamed it, so the views cannot tell the two
 * apart; a recording is read once, so it is not deduplicated.
 */

import type { RunEvent } from './contract.ts'
import { eventsUrl, type FeedSource } from './feed.ts'

/** Connection state the status bar reports. */
export type StreamState = 'idle' | 'connecting' | 'open' | 'retrying' | 'closed'

/** Callbacks a subscription reports through. */
export interface StreamHandlers {
  onEvent: (event: RunEvent) => void
  onState: (state: StreamState) => void
}

/** Reconnection backoff, in milliseconds, indexed by consecutive failure count. */
const BACKOFF_MS = [800, 1_600, 3_200, 6_400, 10_000] as const

/** Share of a recording delivered at once, as the history a live stream replays first. */
const BACKFILL_SHARE = 0.55

/** Delay between the paced frames that follow a recording's backfill. */
const PACE_MS = 330

/**
 * Parse one `data:` frame.
 * @param data - The frame's payload.
 * @returns The event, or `undefined` when the frame is not a usable event.
 */
function parseFrame(data: string): RunEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    // A truncated or heartbeat frame is not an error: the stream stays open and
    // the next frame carries the next sequence number.
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const event = value as Partial<RunEvent>
  // `agentId` is absent on a frame whose session occupies no seat; present, it must name one.
  if (
    typeof event.seq !== 'number'
    || typeof event.sessionId !== 'string'
    || typeof event.kind !== 'string'
    || (event.agentId !== undefined && typeof event.agentId !== 'string')
  ) {
    return undefined
  }
  return event as RunEvent
}

/**
 * The deduplication key of one frame.
 * @param event - A parsed frame.
 * @returns Its session and sequence number, which together name it once per run.
 */
function frameKey(event: RunEvent): string {
  return `${event.sessionId}\u0000${String(event.seq)}`
}

/**
 * Subscribe to one run's events until the returned disposer is called.
 * @param source - Source from `resolveFeed`; it decides between the live
 * stream and a paced recording.
 * @param runId - The run to follow.
 * @param handlers - Event and state callbacks.
 * @returns A disposer that closes the stream and stops any pending retry or
 * paced frame.
 */
export function subscribeRun(source: FeedSource, runId: string, handlers: StreamHandlers): () => void {
  const url = eventsUrl(source, runId)
  return source.mode === 'live' ? subscribeLive(url, handlers) : subscribeRecorded(url, handlers)
}

/**
 * Follow the feed's Server-Sent Events stream.
 *
 * The subscription owns its own `EventSource`: `EventSource` reconnects on its
 * own after a network drop, and this wrapper additionally reopens after an
 * error that closed the source for good, with bounded backoff.
 * @param url - The stream's URL.
 * @param handlers - Event and state callbacks.
 * @returns A disposer that closes the stream and stops any pending retry.
 */
function subscribeLive(url: string, handlers: StreamHandlers): () => void {
  const seen = new Set<string>()
  let source: EventSource | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let disposed = false

  const open = (): void => {
    if (disposed) return
    handlers.onState(failures === 0 ? 'connecting' : 'retrying')
    const next = new EventSource(url)
    source = next

    next.onopen = () => {
      failures = 0
      handlers.onState('open')
    }

    next.onmessage = (message: MessageEvent<string>) => {
      const event = parseFrame(message.data)
      if (event === undefined) return
      const key = frameKey(event)
      if (seen.has(key)) return
      seen.add(key)
      handlers.onEvent(event)
    }

    next.onerror = () => {
      // EventSource retries a dropped connection itself and only reports
      // CLOSED when it has given up; anything else is a transient reconnect.
      if (next.readyState !== EventSource.CLOSED) {
        handlers.onState('retrying')
        return
      }
      next.close()
      if (disposed) return
      const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 10_000
      failures += 1
      handlers.onState('retrying')
      retry = setTimeout(open, wait)
    }
  }

  open()

  return () => {
    disposed = true
    if (retry !== undefined) clearTimeout(retry)
    source?.close()
    handlers.onState('closed')
  }
}

/**
 * Replay one committed recording the way the feed streams a run: the first
 * BACKFILL_SHARE of its frames at once, as the history a live stream replays on
 * connect, then one frame every PACE_MS, then silence with the subscription
 * open. A keyless demo therefore shows an enterprise at work rather than a
 * static file.
 * @param url - The JSON Lines recording's URL.
 * @param handlers - Event and state callbacks.
 * @returns A disposer that stops the paced frames.
 */
function subscribeRecorded(url: string, handlers: StreamHandlers): () => void {
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  handlers.onState('connecting')
  void fetch(url, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`${url} answered ${response.status}`)
      return await response.text()
    })
    .then((text) => {
      if (disposed) return
      const events = text.split('\n').map(parseFrame).filter((event): event is RunEvent => event !== undefined)
      handlers.onState('open')
      const backfill = Math.floor(events.length * BACKFILL_SHARE)
      for (const event of events.slice(0, backfill)) handlers.onEvent(event)
      let cursor = backfill
      const tick = (): void => {
        const event = events[cursor]
        if (disposed || event === undefined) return
        handlers.onEvent(event)
        cursor += 1
        timer = setTimeout(tick, PACE_MS)
      }
      timer = setTimeout(tick, PACE_MS)
    })
    .catch(() => {
      // A recording that cannot be read leaves the run without events: the
      // status bar shows the closed stream and the views keep the roster.
      if (!disposed) handlers.onState('closed')
    })
  return () => {
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
    handlers.onState('closed')
  }
}
