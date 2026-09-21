/**
 * Snapshot the committed replay fixtures under `public/fixtures/` from a running feed.
 *
 * Replay mode shows recorded reality, never invented data: the roster is the
 * feed's own `GET /roster`, the runs are committed records the feed discovers
 * under `data/code-safety/` and `data/proving-ground/`, the event streams are
 * their session logs folded by the feed, and each review is the feed's
 * `GET /safety/:id` for the record. Point the feed at the repository (the
 * default `pnpm run feed`), then run `pnpm --dir apps/command-deck fixtures`.
 *
 * Only committed record ids are eligible: a live `.code-safety/<id>` run is
 * refused, because its session logs are not redacted before they are recorded.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Roster, Run, RunEvent, SafetyReview } from '../deck/contract.ts'

const here = dirname(new URL(import.meta.url).pathname)
const fixtures = resolve(here, '..', 'public', 'fixtures')

/** The feed to snapshot from; `FEED_URL` overrides the default local feed. */
const FEED = (process.env['FEED_URL'] ?? 'http://localhost:4711').replace(/\/+$/, '')

/**
 * The records the replay carries: the newest NodeGoat review, the Java review,
 * one tier-5 fleet, one paired experiment, one program. Every id names a
 * committed record directory; the deck opens on the first code-safety run.
 */
const RUN_IDS = [
  '2026-09-19-nodegoat-2',
  '2026-09-19-dvja',
  '2026-09-19-bench-h3-baseline-sonnet-t5',
  '2026-09-19-bench-e7-attempts-5-t5-2',
  '2026-09-19-csv-tools-program',
] as const

/** How long a stream may stay silent before its replay is considered complete. */
const STREAM_IDLE_MS = 2_500

/**
 * Fetch one JSON payload from the feed.
 * @param path - Path starting with `/`.
 * @returns The parsed payload.
 */
async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(`${FEED}${path}`)
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return await response.json() as T
}

/**
 * Read one run's Server-Sent Events replay until the stream goes idle.
 *
 * The feed replays history and then keeps the connection open, polling the
 * session files for appended lines, so a completed run's replay is the frames
 * that arrive before the first idle gap.
 * @param runId - The run to read.
 * @returns Every replayed event, in arrival order.
 */
async function readEvents(runId: string): Promise<RunEvent[]> {
  const controller = new AbortController()
  const response = await fetch(`${FEED}/runs/${encodeURIComponent(runId)}/events`, { signal: controller.signal })
  if (!response.ok || response.body === null) throw new Error(`/runs/${runId}/events answered ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events: RunEvent[] = []
  let buffer = ''
  let idle: ReturnType<typeof setTimeout> | undefined
  const armIdle = (): void => {
    if (idle !== undefined) clearTimeout(idle)
    idle = setTimeout(() => controller.abort(), STREAM_IDLE_MS)
  }
  armIdle()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      armIdle()
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const data = frame.split('\n').find(line => line.startsWith('data:'))
        if (data !== undefined) events.push(JSON.parse(data.slice(5).trim()) as RunEvent)
      }
    }
  } catch (error) {
    // The idle timer aborts the request once the replay has caught up; any other failure is reported.
    if (!(error instanceof Error && error.name === 'AbortError')) throw error
  } finally {
    if (idle !== undefined) clearTimeout(idle)
  }
  return events
}

/**
 * Write one fixture as two-space JSON with a trailing newline.
 * @param relative - Path under `public/fixtures/`.
 * @param value - The payload.
 */
function writeJson(relative: string, value: unknown): void {
  const path = resolve(fixtures, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const roster = await readJson<Roster>('/roster')
const listed = await readJson<Run[]>('/runs')
const runs = RUN_IDS.map((id) => {
  const run = listed.find(entry => entry.id === id)
  if (run === undefined) throw new Error(`the feed lists no run "${id}"; record it under data/ first`)
  if (!run.path.startsWith('data/')) throw new Error(`"${id}" is a live run at ${run.path}, not a committed record; refusing to snapshot it`)
  return run
})

rmSync(resolve(fixtures, 'events'), { recursive: true, force: true })
rmSync(resolve(fixtures, 'safety'), { recursive: true, force: true })
writeJson('roster.json', roster)
writeJson('runs.json', runs)
console.log(`roster: ${roster.agents.length} agents, ${roster.edges.length} edges; runs: ${runs.length}`)

for (const run of runs) {
  const events = await readEvents(run.id)
  const path = resolve(fixtures, 'events', `${run.id}.jsonl`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, events.map(event => JSON.stringify(event)).join('\n') + (events.length > 0 ? '\n' : ''))
  console.log(`${run.id}: ${events.length} events`)
  if (run.kind === 'code-safety') {
    const review = await readJson<SafetyReview>(`/safety/${encodeURIComponent(run.id)}`)
    writeJson(`safety/${run.id}.json`, review)
    console.log(`${run.id}: ${review.target.files.length} files, ${review.findings.length} findings, verified ${review.certificate.verified}`)
  }
}
console.log(`fixtures: ${readdirSync(fixtures).join(', ')}`)
