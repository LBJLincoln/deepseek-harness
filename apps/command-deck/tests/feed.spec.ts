import { describe, expect, it } from 'vitest'

import type { Run } from '../deck/contract.ts'
import { withoutScratchCopies } from '../deck/feed.ts'

const run = (id: string, path: string, startedAt: string, kind: Run['kind'] = 'code-safety'): Run => ({ id, kind, name: id, path, startedAt, status: 'completed' })

describe('the run list', () => {
  it('keeps a committed record and drops the scratch copy the feed lists beside it', () => {
    const scratch = run('NodeGoat-base-b', '.code-safety/NodeGoat-base-b', '2026-09-22T21:58:12.131Z')
    const record = run('2026-09-22-nodegoat-8-base-b', 'data/code-safety/2026-09-22-nodegoat-8-base-b', '2026-09-22T21:58:12.122Z')
    const running = run('NodeGoat-base-c', '.code-safety/NodeGoat-base-c', '2026-09-29T12:00:00.000Z')
    const bench = run('bench-1', '.proving-ground/runs/bench-1', '2026-09-22T21:58:12.125Z', 'fleet')
    expect(withoutScratchCopies([running, scratch, record, bench]).map(entry => entry.id)).toEqual(['NodeGoat-base-c', '2026-09-22-nodegoat-8-base-b', 'bench-1'])
  })
})
