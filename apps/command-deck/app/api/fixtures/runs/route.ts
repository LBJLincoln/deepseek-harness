import { NextResponse } from 'next/server'
import type { Run } from '@/lib/contract'
import { readFixtureJson } from '@/lib/fixtures.server'

/** The fixture routes read files at request time, so nothing is prerendered. */
export const dynamic = 'force-dynamic'

/**
 * `GET /api/fixtures/runs` — the replay mirror of the feed's `GET /runs`.
 * @returns Every run in the committed fixture.
 */
export function GET(): NextResponse {
  return NextResponse.json(readFixtureJson<Run[]>('runs.json'))
}
