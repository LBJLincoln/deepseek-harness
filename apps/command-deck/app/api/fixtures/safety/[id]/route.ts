import { NextResponse } from 'next/server'
import type { SafetyReview } from '@/lib/contract'
import { readFixtureJson } from '@/lib/fixtures.server'

/** The fixture routes read files at request time, so nothing is prerendered. */
export const dynamic = 'force-dynamic'

/**
 * `GET /api/fixtures/safety/:id` — the replay mirror of the feed's
 * `GET /safety/:id`.
 * @param _request - Unused; the route is keyed entirely on the path.
 * @param context - Next's route context carrying the review id.
 * @returns The committed review, or 404 when no fixture carries that id.
 */
export function GET(_request: Request, context: { params: { id: string } }): NextResponse {
  try {
    return NextResponse.json(readFixtureJson<SafetyReview>(`safety/${context.params.id}.json`))
  } catch {
    // An id with no committed review is a missing fixture, not a server fault.
    return NextResponse.json({ error: 'no recorded review for this id' }, { status: 404 })
  }
}
