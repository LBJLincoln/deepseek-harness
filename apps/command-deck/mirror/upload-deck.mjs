#!/usr/bin/env node
/**
 * Uploads a static export directory to the relay's `deck` bucket through the
 * ingest function's `/upload` route, with a content type per extension and a
 * cache policy per path (hashed `_next/static` assets immutable, HTML and
 * route payloads never cached, everything else one minute). Each file travels
 * base64 inside the relay's gzip envelope.
 *
 * Usage: node upload-deck.mjs <out dir>   (INGEST_URL, INGEST_TOKEN_FILE)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

const OUT = process.argv[2]
const INGEST = (process.env.INGEST_URL ?? '').replace(/\/+$/, '')
const TOKEN = process.env.INGEST_TOKEN_FILE ? readFileSync(process.env.INGEST_TOKEN_FILE, 'utf8').trim() : ''
if (!OUT || INGEST === '' || TOKEN === '') {
  console.error('usage: INGEST_URL=… INGEST_TOKEN_FILE=… node upload-deck.mjs <out dir>')
  process.exit(2)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
}

function cacheFor(path) {
  if (path.endsWith('.html') || path.endsWith('.txt')) return 'no-cache'
  if (path.startsWith('_next/static/')) return 'public, max-age=31536000, immutable'
  return 'max-age=60'
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function envelope(body) {
  return JSON.stringify({ gz: gzipSync(Buffer.from(JSON.stringify(body))).toString('base64') })
}

const files = walk(OUT).map((full) => relative(OUT, full).split('\\').join('/')).sort()
let failed = 0
const CONCURRENCY = 4
let cursor = 0
async function worker() {
  while (cursor < files.length) {
    const path = files[cursor]
    cursor += 1
    try {
      const res = await fetch(`${INGEST}/upload`, {
        method: 'POST',
        headers: { 'x-daliesk-token': TOKEN, 'content-type': 'application/json' },
        body: envelope({
          path,
          cache: cacheFor(path),
          contentType: MIME[extname(path)] ?? 'application/octet-stream',
          b64: readFileSync(join(OUT, path)).toString('base64'),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok !== true) {
        failed += 1
        console.error(`FAIL ${path}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
      }
    } catch (error) {
      failed += 1
      console.error(`FAIL ${path}: ${error.message}`)
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
console.log(`uploaded ${files.length - failed}/${files.length} files${failed > 0 ? `, ${failed} failed` : ''}`)
process.exit(failed > 0 ? 1 : 0)
