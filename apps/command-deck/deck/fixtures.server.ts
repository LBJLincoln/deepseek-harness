/**
 * Reads the committed fixtures from disk for the deck's replay routes.
 *
 * Server-only: the fixtures stay files rather than bundled imports so the
 * event streams can be replayed with pacing, and so a reviewer can read the
 * exact bytes the demo shows.
 */

import { readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import type { RunEvent } from './contract.ts'

/** Absolute path of the fixtures directory. */
const FIXTURES = join(process.cwd(), 'fixtures')

/**
 * Read one fixture file, refusing any path that escapes the fixtures tree.
 *
 * The run and review ids reaching these routes come from a URL, so they are
 * untrusted input at a process boundary even though the deck itself only ever
 * sends ids it read from `runs.json`.
 * @param relative - Path under `fixtures/`.
 * @returns The file's contents.
 */
function readFixture(relative: string): string {
  const path = normalize(join(FIXTURES, relative))
  if (!path.startsWith(FIXTURES)) throw new Error('fixture path escapes the fixtures directory')
  return readFileSync(path, 'utf8')
}

/**
 * One fixture read as JSON.
 * @param relative - Path under `fixtures/`.
 * @returns The parsed value.
 */
export function readFixtureJson<T>(relative: string): T {
  return JSON.parse(readFixture(relative)) as T
}

/**
 * One run's recorded events.
 * @param runId - The run whose JSONL stream to read.
 * @returns Every recorded event, in sequence order.
 */
export function readRunEvents(runId: string): RunEvent[] {
  return readFixture(`events/${runId}.jsonl`)
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as RunEvent)
}
