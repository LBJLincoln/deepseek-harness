/**
 * Daliesk command-deck mirror: the public read side of the feed.
 *
 * Serves the read side of the feed contract the deck reads — `GET /roster`, `GET /runs`,
 * `GET /programs`, `GET /safety/:id`, `GET /ops`, and the Server-Sent Events
 * streams `GET /runs/:id/events` and `GET /ops/events` — from the rows the
 * `ingest` function stores. It serves reads only: every other method answers
 * 405, so nothing reachable without the ingest token can start work on the
 * pushing machine. One event stream stays open for at most STREAM_MS, under
 * the runtime's wall-clock limit; the browser's EventSource reconnects with
 * the last row id it saw and the stream resumes from there. `/ops/events`
 * streams the rows stored under the run id `ops`; a connection without a last
 * id starts OPS_BACKLOG rows before the newest, because that stream only grows.
 */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const REST = `${SUPABASE_URL}/rest/v1`
const AUTH = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID',
}
const STREAM_MS = 140_000
const POLL_MS = 500
const PING_MS = 15_000
const PAGE = 2000
const OPS_RUN = 'ops'
const OPS_BACKLOG = 200

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** The route below the function name, with `/functions/v1/feed` stripped when the gateway leaves it in. */
function routeOf(url: URL): string {
  const path = url.pathname.replace(/^\/functions\/v1/, '').replace(/^\/feed/, '')
  return path === '' ? '/' : path
}

async function restGet<T>(path: string): Promise<T> {
  const res = await fetch(`${REST}${path}`, { headers: AUTH })
  if (!res.ok) throw new Error(`GET ${path} answered ${res.status}`)
  return await res.json() as T
}

async function snapshot(path: string): Promise<unknown> {
  const rows = await restGet<{ body: unknown }[]>(`/feed_json?path=eq.${encodeURIComponent(path)}&select=body`)
  return rows[0]?.body
}

interface EventRow { id: number; body: unknown }

function eventsAfter(runId: string, after: number): Promise<EventRow[]> {
  return restGet<EventRow[]>(`/feed_events?run_id=eq.${encodeURIComponent(runId)}&id=gt.${after}&order=id.asc&limit=${PAGE}&select=id,body`)
}

/** The row id OPS_BACKLOG rows before the newest `ops` row, where a fresh `/ops/events` connection starts. */
async function opsStart(): Promise<number> {
  const rows = await restGet<{ id: number }[]>(`/feed_events?run_id=eq.${OPS_RUN}&order=id.desc&limit=1&offset=${OPS_BACKLOG}&select=id`)
  return rows[0]?.id ?? 0
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function streamEvents(runId: string, since: number): Response {
  const encoder = new TextEncoder()
  let open = true
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string): void => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          open = false
        }
      }
      const started = Date.now()
      let after = since
      let pinged = Date.now()
      write(': daliesk mirror\n\n')
      while (open && Date.now() - started < STREAM_MS) {
        let rows: EventRow[] = []
        try {
          rows = await eventsAfter(runId, after)
        } catch {
          rows = []
        }
        for (const row of rows) {
          write(`id: ${row.id}\ndata: ${JSON.stringify(row.body)}\n\n`)
          after = row.id
        }
        if (rows.length === PAGE) continue
        if (Date.now() - pinged >= PING_MS) {
          write(': ping\n\n')
          pinged = Date.now()
        }
        await sleep(POLL_MS)
      }
      if (open) {
        open = false
        try {
          controller.close()
        } catch {
          // The client closed first.
        }
      }
    },
    cancel() {
      open = false
    },
  })
  return new Response(stream, {
    headers: { ...CORS, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'GET') return json(405, { error: 'the relay serves reads only' })
  const url = new URL(req.url)
  const route = routeOf(url)
  try {
    if (req.method === 'GET' && (route === '/roster' || route === '/runs' || route === '/programs' || route === '/ops')) {
      const body = await snapshot(route)
      return body === undefined ? json(503, { error: 'the mirror has not received this snapshot yet' }) : json(200, body)
    }
    const safety = /^\/safety\/([^/]+)$/.exec(route)
    if (req.method === 'GET' && safety !== null) {
      const body = await snapshot(`/safety/${decodeURIComponent(safety[1])}`)
      return body === undefined ? json(404, { error: `no code-safety run "${safety[1]}"` }) : json(200, body)
    }
    if (req.method === 'GET' && route === '/ops/events') {
      const last = req.headers.get('last-event-id') ?? url.searchParams.get('since')
      const since = last === null ? await opsStart() : Number(last)
      return streamEvents(OPS_RUN, Number.isFinite(since) ? since : 0)
    }
    const events = /^\/runs\/([^/]+)\/events$/.exec(route)
    if (req.method === 'GET' && events !== null) {
      const since = Number(req.headers.get('last-event-id') ?? url.searchParams.get('since') ?? '0')
      return streamEvents(decodeURIComponent(events[1]), Number.isFinite(since) ? since : 0)
    }
    if (req.method === 'GET' && route === '/health') {
      const rows = await restGet<{ path: string; updated_at: string }[]>('/feed_json?select=path,updated_at&order=updated_at.desc&limit=1')
      return json(200, { ok: true, lastSnapshot: rows[0] ?? null })
    }
    return json(404, { error: `no route for ${req.method} ${route}` })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : String(error) })
  }
})
