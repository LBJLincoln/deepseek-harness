#!/usr/bin/env node
/**
 * Mirrors the local harness feed into the hosted relay.
 *
 * Every JSON_EVERY_MS the pusher reads GET /runs, GET /roster and, for each
 * code-safety run, GET /safety/:id from the local feed and pushes each to the
 * relay's `ingest` function when its content changed. Every run on the local
 * feed is followed on its Server-Sent Events stream and the folded events are
 * forwarded in batches from one queue per run: running runs first, then
 * code-safety reviews, then the rest newest first, with IN_FLIGHT batches
 * sending at once. The relay ignores duplicates, so a restart re-sends safely,
 * and a batch the relay rejects is split down to the one event at fault, which
 * is dropped after MAX_REFUSALS so the rest keeps flowing. Every
 * REQUESTS_EVERY_MS the pusher claims review requests the hosted deck posted,
 * starts them on the local feed when the target is under TARGET_ROOT and the
 * model is a known short name, and reports the run id back.
 *
 * Every write body is the relay's envelope `{ gz: base64(gzip(JSON)) }`, so
 * the web application firewall in front of the relay never reads the
 * exploit-like strings a code-safety review quotes.
 *
 * Environment: LOCAL_FEED (default http://127.0.0.1:4711), INGEST_URL,
 * INGEST_TOKEN_FILE, TARGET_ROOT (default $HOME/targets).
 */
import { readFileSync } from 'node:fs'
import { get } from 'node:http'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const LOCAL = (process.env.LOCAL_FEED ?? 'http://127.0.0.1:4711').replace(/\/+$/, '')
const INGEST = (process.env.INGEST_URL ?? '').replace(/\/+$/, '')
const TOKEN = process.env.INGEST_TOKEN_FILE ? readFileSync(process.env.INGEST_TOKEN_FILE, 'utf8').trim() : ''
const TARGET_ROOT = resolve(process.env.TARGET_ROOT ?? `${process.env.HOME ?? '/root'}/targets`)
const MODELS = new Set(['sonnet', 'opus', 'haiku'])
const JSON_EVERY_MS = 3_000
const REQUESTS_EVERY_MS = 2_000
const FLUSH_EVERY_MS = 500
const BATCH = 500
const IN_FLIGHT = 4
const MAX_REFUSALS = 3

if (INGEST === '' || TOKEN === '') {
  console.error('pusher: INGEST_URL and INGEST_TOKEN_FILE are required')
  process.exit(2)
}

const log = (...parts) => console.log(new Date().toISOString(), ...parts)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function envelope(body) {
  return JSON.stringify({ gz: gzipSync(Buffer.from(JSON.stringify(body))).toString('base64') })
}

async function ingest(path, body, method = 'POST') {
  const res = await fetch(`${INGEST}${path}`, {
    method,
    headers: { 'x-daliesk-token': TOKEN, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: envelope(body) }),
  })
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 160)}`)
  return res
}

async function local(path, init) {
  const res = await fetch(`${LOCAL}${path}`, init)
  if (!res.ok) throw new Error(`local ${path} answered ${res.status}`)
  return res
}

const hashes = new Map()
async function pushIfChanged(path, body) {
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  if (hashes.get(path) === hash) return false
  await ingest('/json', { path, body })
  hashes.set(path, hash)
  return true
}

const stats = { snapshots: 0, events: 0, dropped: 0, requests: 0 }

/** One run's outgoing events and send state. */
class RunQueue {
  constructor(run) {
    this.runId = run.id
    this.events = []
    this.inflight = false
    this.batchSize = BATCH
    this.refusals = 0
    this.rank(run)
  }

  rank(run) {
    this.priority = [run.status === 'running' ? 0 : run.kind === 'code-safety' ? 1 : 2, -Date.parse(run.startedAt) || 0]
  }
}

const queues = new Map()

async function syncJson() {
  const runs = await (await local('/runs')).json()
  if (await pushIfChanged('/runs', runs)) stats.snapshots += 1
  if (await pushIfChanged('/roster', await (await local('/roster')).json())) stats.snapshots += 1
  for (const run of runs) {
    follow(run)
    if (run.kind !== 'code-safety') continue
    try {
      const detail = await (await local(`/safety/${encodeURIComponent(run.id)}`)).json()
      if (await pushIfChanged(`/safety/${run.id}`, detail)) stats.snapshots += 1
    } catch (error) {
      log('safety', run.id, error.message)
    }
  }
}

function follow(run) {
  const known = queues.get(run.id)
  if (known !== undefined) {
    known.rank(run)
    return
  }
  const queue = new RunQueue(run)
  queues.set(run.id, queue)
  void (async () => {
    for (;;) {
      try {
        await streamRun(queue)
      } catch (error) {
        log('stream', run.id, error.message)
      }
      await sleep(5_000)
    }
  })()
}

/**
 * Follow one run's Server-Sent Events on the local feed until the connection
 * ends. Uses `node:http` rather than `fetch`: a recorded run's stream is
 * silent after its replay, and the fetch client's body timeout would end it
 * every five minutes, replaying the whole run on each reconnect.
 */
function streamRun(queue) {
  return new Promise((_, reject) => {
    const request = get(`${LOCAL}/runs/${encodeURIComponent(queue.runId)}/events`, { headers: { accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`local events answered ${res.statusCode}`))
        return
      }
      res.setEncoding('utf8')
      let buffer = ''
      res.on('data', (chunk) => {
        buffer += chunk
        let end
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
          if (data === '') continue
          try {
            queue.events.push(JSON.parse(data))
          } catch {
            // A torn frame; the next one is whole.
          }
        }
      })
      res.on('end', () => reject(new Error('stream ended')))
      res.on('error', reject)
    })
    request.on('error', reject)
  })
}

function comparePriority(a, b) {
  return a.priority[0] - b.priority[0] || a.priority[1] - b.priority[1]
}

async function sendBatch(queue) {
  queue.inflight = true
  const batch = queue.events.splice(0, queue.batchSize)
  try {
    await ingest('/events', { runId: queue.runId, events: batch })
    stats.events += batch.length
    queue.batchSize = BATCH
    queue.refusals = 0
  } catch (error) {
    log('events', queue.runId, `${batch.length} event(s):`, error.message)
    if (batch.length > 1) {
      queue.batchSize = Math.max(1, Math.floor(batch.length / 2))
      queue.events.unshift(...batch)
    } else {
      queue.refusals += 1
      if (queue.refusals >= MAX_REFUSALS) {
        stats.dropped += 1
        log('dropped', queue.runId, `session ${batch[0]?.sessionId} seq ${batch[0]?.seq} after ${MAX_REFUSALS} refusals`)
        queue.refusals = 0
        queue.batchSize = BATCH
      } else {
        queue.events.unshift(...batch)
        await sleep(2_000)
      }
    }
  } finally {
    queue.inflight = false
  }
}

function flush() {
  const inflight = [...queues.values()].filter((queue) => queue.inflight).length
  const ready = [...queues.values()].filter((queue) => !queue.inflight && queue.events.length > 0).sort(comparePriority)
  for (const queue of ready.slice(0, Math.max(0, IN_FLIGHT - inflight))) void sendBatch(queue)
}

async function relayRequests() {
  const rows = await (await ingest('/requests', undefined, 'GET')).json()
  for (const row of rows) {
    const target = resolve(String(row.target ?? '').replace(/^~(?=\/|$)/, process.env.HOME ?? '/root'))
    const model = row.model ?? undefined
    let outcome
    if (!target.startsWith(`${TARGET_ROOT}/`)) outcome = { error: `target must be under ${TARGET_ROOT}` }
    else if (model !== undefined && !MODELS.has(model)) outcome = { error: 'model must be sonnet, opus or haiku' }
    else {
      try {
        const res = await fetch(`${LOCAL}/safety`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(model === undefined ? { target } : { target, model }),
        })
        const body = await res.json()
        outcome = res.ok && typeof body.id === 'string' ? { runId: body.id } : { error: body.error ?? `local feed answered ${res.status}` }
      } catch (error) {
        outcome = { error: error.message }
      }
    }
    await ingest(`/requests/${row.id}`, outcome)
    stats.requests += 1
    log('request', row.id, row.target, JSON.stringify(outcome))
  }
}

function every(ms, task, name) {
  let busy = false
  setInterval(() => {
    if (busy) return
    busy = true
    Promise.resolve().then(task).catch((error) => log(name, error.message)).finally(() => { busy = false })
  }, ms)
}

log(`pusher: ${LOCAL} -> ${INGEST} (targets under ${TARGET_ROOT})`)
every(JSON_EVERY_MS, syncJson, 'sync')
every(FLUSH_EVERY_MS, flush, 'flush')
every(REQUESTS_EVERY_MS, relayRequests, 'requests')
setInterval(() => {
  const queued = [...queues.values()].reduce((sum, queue) => sum + queue.events.length, 0)
  log(`stats snapshots=${stats.snapshots} events=${stats.events} dropped=${stats.dropped} requests=${stats.requests} queued=${queued} runs=${queues.size}`)
}, 30_000)
