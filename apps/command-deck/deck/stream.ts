/**
 * The run event stream client.
 *
 * `GET /runs/:id/events` replays history and then stays open, so a reconnect
 * receives frames the deck already holds. Every frame carries a `seq` that
 * counts from one inside its own session, so deduplication keys on the pair of
 * `sessionId` and `seq`: the caller's `onEvent` sees each pair exactly once for
 * the life of the subscription, across any number of reconnections. Keying on
 * `seq` alone kept 404 of the 1,079 frames of a seven-session review.
 */

import type { RunEvent } from './contract.ts'

/** Connection state the status bar reports. */
export type StreamState = 'idle' | 'connecting' | 'open' | 'retrying' | 'closed'

/** Callbacks a subscription reports through. */
export interface StreamHandlers {
  onEvent: (event: RunEvent) => void
  onState: (state: StreamState) => void
}

/** Reconnection backoff, in milliseconds, indexed by consecutive failure count. */
const BACKOFF_MS = [800, 1_600, 3_200, 6_400, 10_000] as const

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
  if (
    typeof event.seq !== 'number'
    || typeof event.sessionId !== 'string'
    || typeof event.kind !== 'string'
    || typeof event.agentId !== 'string'
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
 *
 * The subscription owns its own `EventSource`: `EventSource` reconnects on its
 * own after a network drop, and this wrapper additionally reopens after an
 * error that closed the source for good, with bounded backoff.
 * @param base - Base URL from `resolveFeed`.
 * @param runId - The run to follow.
 * @param handlers - Event and state callbacks.
 * @returns A disposer that closes the stream and stops any pending retry.
 */
export function subscribeRun(base: string, runId: string, handlers: StreamHandlers): () => void {
  const url = `${base}/runs/${encodeURIComponent(runId)}/events`
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
