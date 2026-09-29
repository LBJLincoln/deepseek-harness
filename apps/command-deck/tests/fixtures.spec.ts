/**
 * The published fixtures under `public/fixtures/` name no path of the machine
 * that recorded them. The replay fixtures are written by
 * `scripts/snapshot-fixtures.ts` through `deck/host-paths.ts`, and `ops.json`
 * by each enterprise cycle's operations collector, which clears its snapshot
 * the same way.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const FIXTURES = join(import.meta.dirname, '..', 'public', 'fixtures')

/** An absolute path of the recording machine: its home directory or an agent's temporary tree. */
const HOST_PATH = /(?:\/home\/user|\/tmp\/claude-0)(?![\w.-])[^\s"'`\\]*/g

/**
 * Every file under a directory.
 * @param dir - The directory.
 * @returns The files' paths.
 */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

describe('published fixtures', () => {
  it('carry no absolute path of the machine that recorded them', () => {
    const hits = filesUnder(FIXTURES)
      .flatMap(path => (readFileSync(path, 'utf8').match(HOST_PATH) ?? []).map(hit => `${relative(FIXTURES, path)}: ${hit}`))
    expect(hits).toEqual([])
  })
})
