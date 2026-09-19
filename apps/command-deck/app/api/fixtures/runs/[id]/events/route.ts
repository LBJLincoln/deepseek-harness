import { readRunEvents } from '@/deck/fixtures.server'

/** The replay stream is written per request and never cached. */
export const dynamic = 'force-dynamic'

/** Share of the recorded stream delivered immediately, as the history replay. */
const BACKFILL_SHARE = 0.55

/** Delay between the paced frames that follow the backfill. */
const PACE_MS = 330

/** Heartbeat interval once the recording is exhausted and the stream stays open. */
const HEARTBEAT_MS = 15_000

/**
 * `GET /api/fixtures/runs/:id/events` — the replay mirror of the feed's
 * Server-Sent Events stream.
 *
 * It behaves like the live endpoint: history first, then frames as they
 * happen, then an open connection. Pacing the tail is what makes a keyless
 * demo look like a running enterprise rather than a static file.
 * @param _request - Unused; the route is keyed entirely on the path.
 * @param context - Next's route context carrying the run id.
 * @returns The event stream response.
 */
export function GET(_request: Request, context: { params: { id: string } }): Response {
  let events
  try {
    events = readRunEvents(context.params.id)
  } catch {
    // An id with no recorded stream is a missing fixture, not a server fault.
    return new Response('no recorded stream for this run', { status: 404 })
  }

  const encoder = new TextEncoder()
  const backfill = Math.floor(events.length * BACKFILL_SHARE)
  let cursor = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: string): void => controller.enqueue(encoder.encode(payload))

      for (; cursor < backfill; cursor++) {
        send(`data: ${JSON.stringify(events[cursor])}\n\n`)
      }

      const tick = (): void => {
        const event = events[cursor]
        if (event === undefined) {
          heartbeat = setInterval(() => send(': keep-alive\n\n'), HEARTBEAT_MS)
          return
        }
        send(`data: ${JSON.stringify(event)}\n\n`)
        cursor += 1
        timer = setTimeout(tick, PACE_MS)
      }

      timer = setTimeout(tick, PACE_MS)
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer)
      if (heartbeat !== undefined) clearInterval(heartbeat)
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
}
