/**
 * Daliesk command-deck mirror: the public read side of the feed.
 *
 * Serves the feed contract the deck reads — `GET /roster`, `GET /runs`,
 * `GET /safety/:id`, and the Server-Sent Events stream `GET /runs/:id/events` —
 * from the rows the `ingest` function stores, and turns `POST /safety` into a
 * request the pushing container claims and answers with the run id it
 * started. One event stream stays open for at most STREAM_MS, under the
 * runtime's wall-clock limit; the browser's EventSource reconnects with the
 * last row id it saw and the stream resumes from there.
 */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const REST = `${SUPABASE_URL}/rest/v1`
const AUTH = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID',
}
const STREAM_MS = 140_000
const POLL_MS = 500
const PING_MS = 15_000
const PAGE = 2000
const REQUEST_WAIT_MS = 25_000

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

async function startReview(req: Request): Promise<Response> {
  let body: { target?: unknown; model?: unknown }
  try {
    body = await req.json() as { target?: unknown; model?: unknown }
  } catch {
    return json(400, { error: 'JSON body required' })
  }
  if (typeof body.target !== 'string' || body.target.length === 0) return json(400, { error: 'POST /safety requires a non-empty "target"' })
  const model = typeof body.model === 'string' && body.model.length > 0 ? body.model : null
  const created = await fetch(`${REST}/feed_requests`, {
    method: 'POST',
    headers: { ...AUTH, 'content-type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ target: body.target, model }),
  })
  if (!created.ok) return json(500, { error: `request not stored (${created.status})` })
  const [row] = await created.json() as { id: number }[]
  if (row === undefined) return json(500, { error: 'request not stored' })
  const deadline = Date.now() + REQUEST_WAIT_MS
  while (Date.now() < deadline) {
    await sleep(1000)
    const [state] = await restGet<{ run_id: string | null; error: string | null }[]>(`/feed_requests?id=eq.${row.id}&select=run_id,error`)
    if (state?.run_id) return json(202, { id: state.run_id })
    if (state?.error) return json(400, { error: state.error })
  }
  return json(504, { error: 'no harness claimed the request: the pushing container is not connected' })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = new URL(req.url)
  const route = routeOf(url)
  try {
    if (req.method === 'GET' && (route === '/roster' || route === '/runs')) {
      const body = await snapshot(route)
      return body === undefined ? json(503, { error: 'the mirror has not received this snapshot yet' }) : json(200, body)
    }
    const safety = /^\/safety\/([^/]+)$/.exec(route)
    if (req.method === 'GET' && safety !== null) {
      const body = await snapshot(`/safety/${decodeURIComponent(safety[1])}`)
      return body === undefined ? json(404, { error: `no code-safety run "${safety[1]}"` }) : json(200, body)
    }
    const events = /^\/runs\/([^/]+)\/events$/.exec(route)
    if (req.method === 'GET' && events !== null) {
      const since = Number(req.headers.get('last-event-id') ?? url.searchParams.get('since') ?? '0')
      return streamEvents(decodeURIComponent(events[1]), Number.isFinite(since) ? since : 0)
    }
    if (req.method === 'POST' && route === '/safety') return await startReview(req)
    if (req.method === 'GET' && route === '/health') {
      const rows = await restGet<{ path: string; updated_at: string }[]>('/feed_json?select=path,updated_at&order=updated_at.desc&limit=1')
      return json(200, { ok: true, lastSnapshot: rows[0] ?? null })
    }
    return json(404, { error: `no route for ${req.method} ${route}` })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : String(error) })
  }
})
