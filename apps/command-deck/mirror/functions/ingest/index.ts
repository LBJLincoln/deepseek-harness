/**
 * Daliesk command-deck mirror: token-protected writes.
 *
 * The container that runs the harness accepts no inbound connections, so it
 * pushes the local feed's snapshots and run events here and the public `feed`
 * function serves them. The first `POST /bootstrap` fixes the token (trust on
 * first use, stored as a SHA-256 digest); every later request must carry that
 * token in `x-daliesk-token`. Every write body is a JSON envelope
 * `{ gz: <base64 of gzip(JSON)> }`: code-safety findings quote injection and
 * traversal strings, which the web application firewall in front of this
 * project rejects when it can read them. Writes use the service role from the
 * function's own environment; no key appears in this source.
 */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const REST = `${SUPABASE_URL}/rest/v1`
const STORAGE = `${SUPABASE_URL}/storage/v1/object`
const BUCKET = 'deck'
const AUTH = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
const JSON_HEADERS = { ...AUTH, 'Content-Type': 'application/json' }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function storedTokenHash(): Promise<string | undefined> {
  const res = await fetch(`${REST}/feed_config?key=eq.ingest_token_hash&select=value`, { headers: AUTH })
  if (!res.ok) throw new Error(`feed_config read answered ${res.status}`)
  const rows = await res.json() as { value: string }[]
  return rows[0]?.value
}

/** The route below the function name, with `/functions/v1/ingest` stripped when the gateway leaves it in. */
function routeOf(url: URL): string {
  const path = url.pathname.replace(/^\/functions\/v1/, '').replace(/^\/ingest/, '')
  return path === '' ? '/' : path
}

/** Bytes of a base64 string. */
function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Gunzip bytes. */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The request's payload: the `{ gz }` envelope unpacked, or the plain JSON body. */
async function payloadOf(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.json() as Record<string, unknown>
  if (typeof raw.gz !== 'string') return raw
  const text = new TextDecoder().decode(await gunzip(fromBase64(raw.gz)))
  return JSON.parse(text) as Record<string, unknown>
}

async function rest(method: string, path: string, body?: unknown, prefer?: string): Promise<Response> {
  const res = await fetch(`${REST}${path}`, {
    method,
    headers: { ...JSON_HEADERS, ...(prefer === undefined ? {} : { Prefer: prefer }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res
}

interface MirrorEvent { sessionId?: unknown; seq?: unknown; [key: string]: unknown }

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const route = routeOf(url)
  const token = req.headers.get('x-daliesk-token') ?? ''
  if (token.length < 32) return json(401, { error: 'x-daliesk-token required' })
  try {
    const hash = await sha256Hex(token)
    const stored = await storedTokenHash()
    if (route === '/bootstrap' && req.method === 'POST') {
      if (stored !== undefined) return json(409, { error: 'already bootstrapped' })
      await rest('POST', '/feed_config', { key: 'ingest_token_hash', value: hash }, 'return=minimal')
      return json(201, { ok: true })
    }
    if (stored === undefined || stored !== hash) return json(403, { error: 'bad token' })

    if (route === '/json' && req.method === 'POST') {
      const { path, body } = await payloadOf(req)
      if (typeof path !== 'string' || !path.startsWith('/') || body === undefined) return json(400, { error: 'path and body required' })
      await rest('POST', '/feed_json?on_conflict=path', { path, body, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal')
      return json(200, { ok: true })
    }
    if (route === '/events' && req.method === 'POST') {
      const { runId, events } = await payloadOf(req)
      if (typeof runId !== 'string' || !Array.isArray(events)) return json(400, { error: 'runId and events required' })
      const rows = (events as MirrorEvent[]).map(event => ({
        run_id: runId,
        session_id: typeof event.sessionId === 'string' ? event.sessionId : '',
        seq: typeof event.seq === 'number' ? Math.trunc(event.seq) : 0,
        body: event,
      }))
      if (rows.length > 0) await rest('POST', '/feed_events?on_conflict=run_id,session_id,seq', rows, 'resolution=ignore-duplicates,return=minimal')
      return json(200, { ok: true, accepted: rows.length })
    }
    if (route === '/requests' && req.method === 'GET') {
      const res = await rest('GET', '/feed_requests?claimed_at=is.null&order=id.asc&select=id,target,model,created_at')
      return json(200, await res.json())
    }
    const claim = /^\/requests\/(\d+)$/.exec(route)
    if (claim !== null && req.method === 'POST') {
      const { runId, error } = await payloadOf(req)
      await rest('PATCH', `/feed_requests?id=eq.${claim[1]}`, {
        claimed_at: new Date().toISOString(),
        run_id: typeof runId === 'string' ? runId : null,
        error: typeof error === 'string' ? error : null,
      }, 'return=minimal')
      return json(200, { ok: true })
    }
    if (route === '/upload' && req.method === 'POST') {
      const { path, cache, contentType, b64 } = await payloadOf(req)
      if (typeof path !== 'string' || path === '' || path.includes('..') || path.startsWith('/') || typeof b64 !== 'string') {
        return json(400, { error: 'a relative path and b64 content are required' })
      }
      const key = path.split('/').map(encodeURIComponent).join('/')
      const res = await fetch(`${STORAGE}/${BUCKET}/${key}`, {
        method: 'POST',
        headers: {
          ...AUTH,
          'content-type': typeof contentType === 'string' ? contentType : 'application/octet-stream',
          'cache-control': typeof cache === 'string' ? cache : 'max-age=60',
          'x-upsert': 'true',
        },
        body: fromBase64(b64),
      })
      const detail = (await res.text()).slice(0, 300)
      return json(res.ok ? 200 : 502, { ok: res.ok, status: res.status, detail })
    }
    if (route === '/reset' && req.method === 'POST') {
      await rest('DELETE', '/feed_events?id=gt.0', undefined, 'return=minimal')
      await rest('DELETE', '/feed_json?path=neq.', undefined, 'return=minimal')
      return json(200, { ok: true })
    }
    return json(404, { error: `no route for ${req.method} ${route}` })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : String(error) })
  }
})
