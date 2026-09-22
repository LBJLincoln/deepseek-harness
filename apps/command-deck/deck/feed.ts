/**
 * The deck's HTTP client for the feed, and the replay fallback.
 *
 * One `FeedSource` drives every read. When the configured feed does not
 * answer, `resolveFeed` selects the committed fixtures under `public/fixtures`,
 * static files holding the payloads the feed's paths return — so nothing
 * downstream knows which it is reading, beyond the `mode` the status bar
 * shows. Replay needs no server, which is what lets the deck ship as a static
 * export.
 */

import type { Comparison, Roster, Run, SafetyReview } from './contract.ts'

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

/**
 * The path prefix the deck is served under: empty unless the build set
 * `NEXT_PUBLIC_BASE_PATH`, as the GitHub Pages export does because a
 * repository site lives at `/<repository>`. Public files are reached through it.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/** Base URL of the committed fixtures, static files that mirror the feed's paths. */
const FIXTURE_BASE = `${BASE_PATH}/fixtures`

/** Query parameter naming the feed for one browser tab: `?feed=https://feed.example`. */
const FEED_PARAM = 'feed'

/** Where the tab remembers a feed named by {@link FEED_PARAM}, so client navigation and a reload keep it. */
const FEED_STORAGE_KEY = 'dsh-deck-feed'

/**
 * The feed named on the page URL, if any, or the one this tab was given
 * earlier. A hosted deck follows any feed the viewer's browser can reach this
 * way, without a rebuild; the build's `NEXT_PUBLIC_FEED_URL` stays the default.
 * @returns The feed URL, or `undefined` outside a browser and when none was named.
 */
function feedOverride(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const named = new URLSearchParams(window.location.search).get(FEED_PARAM)
  try {
    if (named !== null && named !== '') {
      window.sessionStorage.setItem(FEED_STORAGE_KEY, named)
      return named
    }
    return window.sessionStorage.getItem(FEED_STORAGE_KEY) ?? undefined
  } catch {
    // Storage can be unavailable (a private window, blocked site data); the query alone still names the feed for this load.
    return named ?? undefined
  }
}

/** The feed named for this tab, else the configured feed URL, else the documented default. */
function feedUrl(): string {
  const configured = feedOverride() ?? process.env.NEXT_PUBLIC_FEED_URL
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
 * The URL of one feed path on the selected source: the path itself on a live
 * feed, the committed JSON file that mirrors it in replay.
 * @param source - Source from {@link resolveFeed}.
 * @param path - Feed path starting with `/`.
 * @returns The URL to fetch.
 */
function urlOf(source: FeedSource, path: string): string {
  return source.mode === 'live' ? `${source.base}${path}` : `${source.base}${path}.json`
}

/**
 * Read one JSON payload from the selected source.
 * @param source - Source from {@link resolveFeed}.
 * @param path - Feed path starting with `/`.
 * @returns The parsed payload.
 */
async function readJson<T>(source: FeedSource, path: string): Promise<T> {
  const response = await fetch(urlOf(source, path), { cache: 'no-store' })
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return await response.json() as T
}

/**
 * `GET /roster`.
 * @param source - Source from {@link resolveFeed}.
 * @returns The enterprise roster.
 */
export function getRoster(source: FeedSource): Promise<Roster> {
  return readJson<Roster>(source, '/roster')
}

/**
 * `GET /runs`.
 * @param source - Source from {@link resolveFeed}.
 * @returns Every run the feed knows about.
 */
export function getRuns(source: FeedSource): Promise<Run[]> {
  return readJson<Run[]>(source, '/runs')
}

/**
 * `GET /safety/:id`.
 * @param source - Source from {@link resolveFeed}.
 * @param id - Run id of the review.
 * @returns The review, its findings, and its certificate.
 */
export function getSafety(source: FeedSource, id: string): Promise<SafetyReview> {
  return readJson<SafetyReview>(source, `/safety/${encodeURIComponent(id)}`)
}

/**
 * The committed comparison for one target slug, or `undefined` when none is
 * bundled. A comparison is a static record (a target reviewed three ways and
 * scored against one ground truth), identical in live and replay, so it is
 * always read from the committed fixtures under `public/fixtures/comparison`,
 * never from the feed.
 * @param slug - The target slug, e.g. `nodegoat`.
 * @returns The comparison, or `undefined` when the target has none.
 */
export async function getComparison(slug: string): Promise<Comparison | undefined> {
  try {
    const response = await fetch(`${FIXTURE_BASE}/comparison/${encodeURIComponent(slug)}.json`, { cache: 'no-store' })
    if (!response.ok) return undefined
    return await response.json() as Comparison
  } catch {
    // No comparison bundled for this target, or the fetch failed: the deck hides the tab.
    return undefined
  }
}

/**
 * The comparison target slug a review's name maps to, or `undefined` when the
 * target has no bundled comparison. The review's name is its run id, which
 * carries the target name; a slug matches when the id contains it.
 * @param reviewName - The review's `target.name`, the run id.
 * @returns The slug to pass to {@link getComparison}, or `undefined`.
 */
export function comparisonSlugFor(reviewName: string): string | undefined {
  const lower = reviewName.toLowerCase()
  return ['nodegoat', 'dvja'].find(slug => lower.includes(slug))
}

/**
 * The URL of one run's event stream: the feed's Server-Sent Events endpoint on
 * a live feed, the committed JSON Lines recording in replay.
 * @param source - Source from {@link resolveFeed}.
 * @param runId - The run to follow.
 * @returns The URL the stream client opens.
 */
export function eventsUrl(source: FeedSource, runId: string): string {
  const id = encodeURIComponent(runId)
  return source.mode === 'live' ? `${source.base}/runs/${id}/events` : `${source.base}/events/${id}.jsonl`
}

/**
 * `POST /safety` — start a review of one target.
 *
 * Replay cannot start a review, so it reopens the recorded one instead; the
 * form says so in replay mode, and the deck then follows that run exactly as
 * it would follow a freshly started live one.
 * @param source - Source from {@link resolveFeed}.
 * @param target - Path of the repository to review.
 * @param model - Optional model override for the review's agents.
 * @returns The started run's id.
 */
export async function startSafety(source: FeedSource, target: string, model?: string): Promise<string> {
  if (source.mode === 'replay') {
    const recorded = (await getRuns(source)).find(run => run.kind === 'code-safety')
    if (recorded === undefined) throw new Error('no recorded code-safety run to reopen')
    return recorded.id
  }
  const response = await fetch(`${source.base}/safety`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(model === undefined || model === '' ? { target } : { target, model }),
  })
  if (!response.ok) throw new Error(`POST /safety answered ${response.status}`)
  const body = await response.json() as { id?: unknown }
  if (typeof body.id !== 'string') throw new Error('POST /safety returned no run id')
  return body.id
}
