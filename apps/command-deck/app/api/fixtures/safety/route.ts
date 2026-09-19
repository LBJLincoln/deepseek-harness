import { NextResponse } from 'next/server'
import type { Run } from '@/lib/contract'
import { readFixtureJson } from '@/lib/fixtures.server'

/** The fixture routes read files at request time, so nothing is prerendered. */
export const dynamic = 'force-dynamic'

/**
 * `POST /api/fixtures/safety` — the replay mirror of the feed's `POST /safety`.
 *
 * Replay cannot start a review, so it answers with the recorded one. The deck
 * then follows that run exactly as it would follow a freshly started live one,
 * which keeps the "Start review" control demonstrable without a feed.
 * @returns The recorded code-safety run's id.
 */
export function POST(): NextResponse {
  const runs = readFixtureJson<Run[]>('runs.json')
  const recorded = runs.find(run => run.kind === 'code-safety')
  if (recorded === undefined) {
    return NextResponse.json({ error: 'no recorded code-safety run' }, { status: 404 })
  }
  return NextResponse.json({ id: recorded.id, replay: true })
}
