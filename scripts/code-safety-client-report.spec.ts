/**
 * The client-facing code-safety assessment, run under plain Node the way the tool itself runs: the committed
 * NodeGoat assessment is the rendering of its record, a record without a matching assessment is refused, and the
 * rendering labels a training target and a seeded copy with the readings that bound each.
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const tool = fileURLToPath(new URL('../data/code-safety/tools/client-report.mjs', import.meta.url))
const root = fileURLToPath(new URL('..', import.meta.url))
const run = (...args: string[]): string => execFileSync(process.execPath, [tool, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

describe('code-safety client report', () => {
  it('keeps the committed assessment identical to the rendering of the latest NodeGoat record', () => {
    expect(run('--check').trim()).toMatch(/^client-report: data\/code-safety\/reports\/\S+ matches data\/code-safety\/\S+nodegoat\S*$/)
  })

  it('refuses a record whose committed assessment does not match its rendering', () => {
    expect(() => run('data/code-safety/2026-09-28-dsh-self-review', '--check')).toThrow(/differ from the rendering/)
  })

  it('labels the training target, the matching rule and the in-sample readings', () => {
    const markdown = run('--print')
    expect(markdown).toContain('**Training target, not a client system.**')
    expect(markdown).toContain('within three lines')
    expect(markdown).toContain('in-sample:')
    expect(markdown).not.toContain('Seeded copy')
  })

  it('labels a seeded copy and states its recall with the Wilson interval', () => {
    const markdown = run('data/code-safety/2026-09-28-dsh-self-review', '--print')
    expect(markdown).toContain('**Seeded copy.**')
    expect(markdown).toContain('Seeded recall 6 of 8, 95% interval [0.409, 0.929]')
    expect(markdown).not.toContain('Training target')
  })
})
