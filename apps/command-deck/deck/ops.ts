/**
 * The Operations view's reader: which operations snapshot the view shows, and
 * which of its three modes it is in.
 *
 * - `live`: the configured feed (the mirror relay on the hosted deck) answered
 *   `GET /ops` with a snapshot younger than {@link liveLimitMs};
 * - `recent`: no live snapshot, so the view shows the newest one it could read
 *   (the feed's stale one, or the `fixtures/ops.json` the enterprise cycle
 *   commits), labelled with its age and as a replay;
 * - `offline`: no snapshot could be read at all.
 *
 * The decision is {@link chooseReading}, a pure function of what the two reads
 * returned and the viewer's clock, so the view never claims more freshness
 * than the snapshot's own `generatedAt` states.
 */

import { OPS_SCHEMA, type OpsAgentKind, type OpsSnapshot, type OpsSourceId, type RunEvent } from './contract.ts'
import { FIXTURE_BASE, feedUrl } from './feed.ts'

/** Which snapshot the view shows, and how it knows. */
type OpsMode = 'live' | 'recent' | 'offline'

/** One read's outcome: a snapshot, or why there is none. */
export interface OpsFetch {
  snapshot?: OpsSnapshot
  reason?: string
}

/** What the view shows and how it got there. */
export interface OpsReading {
  mode: OpsMode
  snapshot?: OpsSnapshot
  /** Where `snapshot` came from. */
  origin?: 'feed' | 'fixture'
  /** The feed URL the deck asked. */
  feed: string
  /** Why the view is not live; absent in live mode. */
  reason?: string
}

/** How long the deck waits for the feed's `/ops` before it gives up. */
const PROBE_TIMEOUT_MS = 5_000

/** The youngest a snapshot's age limit for `live` can be, whatever its producer's interval. */
const LIVE_FLOOR_MS = 90_000

/** How many of the producer's intervals a snapshot may miss before it stops counting as live. */
const LIVE_INTERVALS = 6

/**
 * How old a snapshot may be and still count as live: six of its producer's
 * intervals, and never less than ninety seconds, so one slow tick of the loop
 * does not flip the view out of live.
 * @param snapshot - The snapshot.
 * @returns Milliseconds.
 */
export function liveLimitMs(snapshot: OpsSnapshot): number {
  return Math.max(LIVE_FLOOR_MS, (snapshot.intervalSeconds ?? 0) * 1000 * LIVE_INTERVALS)
}

/**
 * Whether a decoded body is an operations snapshot this deck reads: the
 * schema it was built for, and the collections the view iterates.
 * @param value - The decoded body.
 * @returns `true` for a readable snapshot.
 */
export function isOpsSnapshot(value: unknown): value is OpsSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Partial<OpsSnapshot>
  return body.schema === OPS_SCHEMA
    && typeof body.generatedAt === 'string'
    && Array.isArray(body.agents)
    && Array.isArray(body.attention)
    && Array.isArray(body.runs)
    && Array.isArray(body.activity)
    && Array.isArray(body.sources)
    && Array.isArray(body.heartbeats)
    && typeof body.big === 'object' && body.big !== null
}

/**
 * When the facts a panel shows were current: the oldest `asOf` of the
 * sources it reads, or the snapshot's own time for a panel that reads the
 * whole snapshot.
 * @param snapshot - The snapshot.
 * @param ids - The sources the panel's figures are counted from; empty for the whole snapshot.
 * @returns ISO time, or `undefined` when one of the sources was not read.
 */
export function factsAsOf(snapshot: OpsSnapshot, ids: readonly OpsSourceId[] = []): string | undefined {
  if (ids.length === 0) return snapshot.generatedAt
  let oldest: string | undefined
  for (const id of ids) {
    const asOf = snapshot.sources.find(source => source.id === id)?.asOf
    if (asOf === undefined) return undefined
    if (oldest === undefined || asOf < oldest) oldest = asOf
  }
  return oldest
}

/**
 * Milliseconds since a snapshot was generated, by the viewer's clock.
 * @param snapshot - The snapshot.
 * @param now - Epoch milliseconds.
 * @returns Its age; `Infinity` when its time does not parse.
 */
export function snapshotAge(snapshot: OpsSnapshot, now: number): number {
  const at = Date.parse(snapshot.generatedAt)
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : Math.max(0, now - at)
}

/**
 * Say how long ago something was, in the largest unit that keeps it short.
 * @param ms - Milliseconds.
 * @returns `12 s`, `4 min`, `2 h`, `3 h 5 min` or `2 d`.
 */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms)) return 'an unknown time'
  const seconds = Math.round(ms / 1000)
  if (seconds < 90) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 120) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
  return `${Math.floor(hours / 24)} d`
}

/**
 * Decide what the view shows.
 * @param feed - What `GET /ops` on the feed returned.
 * @param fixture - What the bundled `fixtures/ops.json` returned.
 * @param now - The viewer's clock, epoch milliseconds.
 * @param url - The feed asked, for the reading.
 * @returns The reading.
 */
export function chooseReading(feed: OpsFetch, fixture: OpsFetch, now: number, url: string): OpsReading {
  if (feed.snapshot !== undefined && snapshotAge(feed.snapshot, now) <= liveLimitMs(feed.snapshot)) {
    return { mode: 'live', snapshot: feed.snapshot, origin: 'feed', feed: url }
  }
  const feedWhy = feed.snapshot === undefined
    ? feed.reason ?? 'the feed has no snapshot'
    : `the feed's newest snapshot is ${formatAge(snapshotAge(feed.snapshot, now))} old, so the operations loop is not pushing`
  const candidates = ([['feed', feed.snapshot], ['fixture', fixture.snapshot]] as const)
    .filter((entry): entry is readonly ['feed' | 'fixture', OpsSnapshot] => entry[1] !== undefined)
    .sort((a, b) => snapshotAge(a[1], now) - snapshotAge(b[1], now))
  const newest = candidates[0]
  if (newest === undefined) {
    return { mode: 'offline', feed: url, reason: `${feedWhy}; ${fixture.reason ?? 'no snapshot is bundled with the deck'}` }
  }
  return { mode: 'recent', snapshot: newest[1], origin: newest[0], feed: url, reason: feedWhy }
}

/**
 * Read one snapshot from a URL.
 * @param url - `…/ops` or `…/fixtures/ops.json`.
 * @param what - How the reason names the source.
 * @returns The snapshot, or why there is none.
 */
async function fetchSnapshot(url: string, what: string): Promise<OpsFetch> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!response.ok) return { reason: `${what} answered ${response.status}` }
    const body = await response.json() as unknown
    return isOpsSnapshot(body) ? { snapshot: body } : { reason: `${what} is not an operations snapshot of schema ${OPS_SCHEMA}` }
  } catch (error) {
    // A refused connection, a blocked cross-origin read, a timeout and a body that is not JSON all end here.
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    return { reason: `${what} ${timedOut ? 'timed out' : 'is unreachable'}` }
  }
}

/**
 * Read the feed's snapshot and, unless it is live, the bundled one, and decide.
 * @returns The reading.
 */
export async function readOps(): Promise<OpsReading> {
  const url = feedUrl()
  const feed = await fetchSnapshot(`${url}/ops`, 'the feed')
  const live = feed.snapshot !== undefined && snapshotAge(feed.snapshot, Date.now()) <= liveLimitMs(feed.snapshot)
  const fixture = live ? {} : await fetchSnapshot(`${FIXTURE_BASE}/ops.json`, 'the bundled snapshot')
  return chooseReading(feed, fixture, Date.now(), url)
}

/**
 * The URL of the feed's agent-activity stream.
 * @param feed - The feed's base URL.
 * @returns `…/ops/events`.
 */
export function opsEventsUrl(feed: string): string {
  return `${feed}/ops/events`
}

/** The five stations the scene's pipeline runs through, in order. */
export const STATIONS = ['intake', 'shift', 'review', 'ci', 'ship'] as const

/** One station of the pipeline. */
export type Station = typeof STATIONS[number]

/** Station names as the view prints them. */
export const STATION_NAME: Record<Station, string> = {
  intake: 'Intake',
  shift: 'Shift',
  review: 'Review',
  ci: 'CI',
  ship: 'Ship',
}

/** The station an agent kind works at; bench cells and the operator's agents work off the pipeline. */
const KIND_STATION: Record<OpsAgentKind, Station | undefined> = {
  coordinator: 'intake',
  department: 'shift',
  reviewer: 'review',
  'function-gate': 'ci',
  'cycle-step': undefined,
  'bench-cell': undefined,
  'operator-agent': undefined,
}

/** The station each cycle step runs at. */
const STEP_STATION: Record<string, Station> = {
  pull: 'intake',
  intake: 'intake',
  'intake-push': 'intake',
  shift: 'shift',
  'pull-after-shift': 'shift',
  functions: 'ci',
  roster: 'ship',
  publish: 'ship',
  record: 'ship',
  push: 'ship',
}

/**
 * The station a cycle agent is at, from its label `cycle-… · <step>`.
 * @param label - The agent's label.
 * @returns The station, or `undefined` for a step the table does not know.
 */
export function cycleStation(label: string): Station | undefined {
  const step = label.split(' · ').at(-1) ?? ''
  return STEP_STATION[step]
}

/**
 * The station one agent works at.
 * @param kind - The agent's kind.
 * @param label - Its label, which names a cycle agent's step.
 * @returns The station, or `undefined` for work off the pipeline.
 */
export function stationOf(kind: OpsAgentKind, label: string): Station | undefined {
  return kind === 'cycle-step' ? cycleStation(label) : KIND_STATION[kind]
}

/**
 * The station a ledger frame lands at: a shipped ticket at `ship`, a CI
 * verdict at `ci`, any other ticket outcome at `review`, a gate at `ci`.
 * @param frame - A frame whose `sessionId` is `ledger`.
 * @returns The station.
 */
export function ledgerStation(frame: RunEvent): Station {
  if (/ shipped$/.test(frame.label)) return 'ship'
  if (/^T-\d{4} /.test(frame.label)) return 'review'
  return 'ci'
}

/**
 * The deduplication key of one activity frame, as the stream client keys run frames.
 * @param frame - The frame.
 * @returns Its session and sequence number.
 */
export function frameKey(frame: RunEvent): string {
  return `${frame.sessionId}\u0000${String(frame.seq)}`
}

/**
 * What each station's label counts, every figure read from the snapshot: the
 * agents working there now and the queue or outcome that station owns.
 * @param snapshot - The snapshot.
 * @returns Per station, the agents working there and the lines to print.
 */
export function stationCounts(snapshot: OpsSnapshot): Record<Station, { busy: number; lines: string[] }> {
  const busy = (station: Station): number => snapshot.agents.filter(agent => stationOf(agent.kind, agent.label) === station).length
  const tickets = snapshot.big.tickets
  const ci = snapshot.big.ci
  const unknown = 'unknown'
  const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`
  return {
    intake: { busy: busy('intake'), lines: [`${plural(busy('intake'), 'agent')} now`, tickets === null ? `queue ${unknown}` : `${tickets.queued} queued`] },
    shift: { busy: busy('shift'), lines: [`${plural(busy('shift'), 'agent')} now`, tickets === null ? `halts ${unknown}` : `${tickets.halted} halted`] },
    review: { busy: busy('review'), lines: [`${plural(busy('review'), 'agent')} now`, tickets === null ? `rejections ${unknown}` : `${tickets.rejected} rejected · 24 h`] },
    ci: {
      busy: busy('ci'),
      lines: [
        `${plural(busy('ci'), 'gate')} now`,
        ci === null ? `Branch CI ${unknown}` : ci.latest === undefined ? 'no completed run' : `${ci.latest.conclusion} · ${ci.latest.commit.slice(0, 7)}`,
      ],
    },
    ship: { busy: busy('ship'), lines: [tickets === null ? `shipped ${unknown}` : `${tickets.shipped} shipped · 24 h`] },
  }
}
