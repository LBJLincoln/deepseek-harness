/**
 * Daliesk command-deck mirror: serves the deck's static export from the
 * public `deck` storage bucket under one path prefix, so the deck, its
 * fixtures and the feed share an origin and a reload on any view works. The
 * content type comes from the extension, because the storage service answers
 * `text/plain` for HTML it holds, and the body is re-read here so its length
 * is the runtime's to compute: the upstream answer may arrive compressed.
 */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const OBJECTS = `${SUPABASE_URL}/storage/v1/object/public/deck`
const PREFIX = '/functions/v1/deck'
const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  woff: 'font/woff',
  webmanifest: 'application/manifest+json',
  map: 'application/json',
}

/** The object key a request names: `index.html` for a directory, `undefined` for the bare prefix. */
function objectPath(url: URL): string | undefined {
  let path = url.pathname.replace(/^\/functions\/v1/, '').replace(/^\/deck/, '')
  if (path === '') return undefined
  if (path.endsWith('/')) path += 'index.html'
  return path.replace(/^\/+/, '')
}

function fetchObject(path: string): Promise<Response> {
  return fetch(`${OBJECTS}/${path.split('/').map(encodeURIComponent).join('/')}`)
}

function cacheControl(path: string): string {
  if (path.endsWith('.html') || path.endsWith('.txt')) return 'no-cache'
  if (path.startsWith('_next/static/')) return 'public, max-age=31536000, immutable'
  return 'public, max-age=60'
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  let path = objectPath(url)
  if (path === undefined) return new Response(null, { status: 308, headers: { location: `${PREFIX}/` } })
  let upstream = await fetchObject(path)
  if (!upstream.ok && !/\.[a-z0-9]+$/i.test(path)) {
    path = `${path}/index.html`
    upstream = await fetchObject(path)
  }
  if (!upstream.ok) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  const body = await upstream.arrayBuffer()
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const headers = new Headers({
    'content-type': TYPES[extension] ?? upstream.headers.get('content-type') ?? 'application/octet-stream',
    'cache-control': cacheControl(path),
    'content-length': String(body.byteLength),
  })
  const etag = upstream.headers.get('etag')
  if (etag !== null) headers.set('etag', etag)
  return new Response(body, { status: 200, headers })
})
