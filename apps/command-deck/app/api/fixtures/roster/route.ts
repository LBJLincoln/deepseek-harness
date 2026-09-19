import { NextResponse } from 'next/server'
import type { Roster } from '@/lib/contract'
import { readFixtureJson } from '@/lib/fixtures.server'

/** The fixture routes read files at request time, so nothing is prerendered. */
export const dynamic = 'force-dynamic'

/**
 * `GET /api/fixtures/roster` — the replay mirror of the feed's `GET /roster`.
 * @returns The committed roster fixture.
 */
export function GET(): NextResponse {
  return NextResponse.json(readFixtureJson<Roster>('roster.json'))
}
