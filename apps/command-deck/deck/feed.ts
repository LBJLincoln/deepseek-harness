/**
 * The deck's HTTP client for the feed, and the replay fallback.
 *
 * One base URL drives every read. When the configured feed does not answer,
 * `resolveFeed` returns the deck's own fixture routes, which serve the same
 * paths with the same payloads — so nothing downstream knows which it is
 * reading, beyond the `mode` the status bar shows.
 */

import type { Roster, Run, SafetyReview } from './contract.ts'

/** Whether the deck is reading a live feed or the committed fixtures. */
type FeedMode = 'live' | 'replay'

/** Where the deck reads from, and how it got there. */
export interface FeedSource {
  mode: FeedMode
  /** Base URL every path is appended to, without a trailing slash. */
  base: string
  /** The configured feed URL, shown in the status bar in both modes. */
  configured: string
  /** Why the deck fell back, shown in the status bar in replay mode. */
  reason?: string
}

/** Base URL of the deck's own fixture routes, which mirror the feed's paths. */
const FIXTURE_BASE = '/api/fixtures'

/** The configured feed URL, or the documented default. */
function feedUrl(): string {
  const configured = process.env.NEXT_PUBLIC_FEED_URL
  return (configured === undefined || configured === '' ? 'http://localhost:4711' : configured)
    .replace(/\/+$/, '')
}

/**
 * How long the deck waits for the live feed before falling back to fixtures.
 * A cold feed answers `GET /roster` in about 1.5 s on a tree with fifty runs,
 * so the probe allows several times that.
 */
const PROBE_TIMEOUT_MS = 5_000

/**
 * Decide where this session reads from.
 *
 * The probe is one `GET /roster` against the configured feed. Any failure —
 * refused connection, timeout, non-2xx, blocked cross-origin request — selects
 * replay, because a demo must never show an empty deck.
 * @returns The selected source, with the fallback reason when it fell back.
 */
export async function resolveFeed(): Promise<FeedSource> {
  const configured = feedUrl()
  try {
    const response = await fetch(`${configured}/roster`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!response.ok) {
      return { mode: 'replay', base: FIXTURE_BASE, configured, reason: `feed answered ${response.status}` }
    }
    return { mode: 'live', base: configured, configured }
  } catch (error) {
    return { mode: 'replay', base: FIXTURE_BASE, configured, reason: probeFailure(error) }
  }
}

/**
 * Say why the probe failed in terms a viewer can act on.
 *
 * `fetch` reports a refused connection, a blocked cross-origin request and a
 * DNS failure all as one opaque `TypeError`, so the deck states the one thing
 * it does know — that nothing answered — instead of repeating the browser's
 * wording.
 * @param error - Whatever the probe threw.
 * @returns A short reason for the status bar.
 */
function probeFailure(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'feed timed out'
  if (error instanceof Error && error.name === 'AbortError') return 'feed timed out'
  return 'feed unreachable'
}

/**
 * Read one JSON payload from the selected source.
 * @param base - Base URL from {@link resolveFeed}.
 * @param path - Path starting with `/`.
 * @returns The parsed payload.
 */
async function readJson<T>(base: string, path: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return await response.json() as T
}

/**
 * `GET /roster`.
 * @param base - Base URL from {@link resolveFeed}.
 * @returns The enterprise roster.
 */
export function getRoster(base: string): Promise<Roster> {
  return readJson<Roster>(base, '/roster')
}

/**
 * `GET /runs`.
 * @param base - Base URL from {@link resolveFeed}.
 * @returns Every run the feed knows about.
 */
export function getRuns(base: string): Promise<Run[]> {
  return readJson<Run[]>(base, '/runs')
}

/**
 * `GET /safety/:id`.
 * @param base - Base URL from {@link resolveFeed}.
 * @param id - Run id of the review.
 * @returns The review, its findings, and its certificate.
 */
export function getSafety(base: string, id: string): Promise<SafetyReview> {
  return readJson<SafetyReview>(base, `/safety/${encodeURIComponent(id)}`)
}

/**
 * `POST /safety` — start a review of one target.
 * @param base - Base URL from {@link resolveFeed}.
 * @param target - Path of the repository to review.
 * @param model - Optional model override for the review's agents.
 * @returns The started run's id.
 */
export async function startSafety(base: string, target: string, model?: string): Promise<string> {
  const response = await fetch(`${base}/safety`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(model === undefined || model === '' ? { target } : { target, model }),
  })
  if (!response.ok) throw new Error(`POST /safety answered ${response.status}`)
  const body = await response.json() as { id?: unknown }
  if (typeof body.id !== 'string') throw new Error('POST /safety returned no run id')
  return body.id
}
