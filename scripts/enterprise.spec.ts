import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { acquireLock, DEVELOPMENT_BRANCH, driverEnvironment, LOCK_FILE, parseCommand, REAL_COMPOSITION, shiftId, sweepClones } from './enterprise.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'enterprise-cli-'))
  roots.push(root)
  return root
}

describe('the shift command line', () => {
  it('parses a shift with its defaults', () => {
    const command = parseCommand(['shift', '--next', '2', '--push'], { DSH_ENTERPRISE_SCRATCH: '/tmp/x' })
    expect(command).toMatchObject({ kind: 'shift', next: 2, tickets: undefined, implementer: 'route', push: true, branch: DEVELOPMENT_BRANCH, composition: REAL_COMPOSITION, scratch: '/tmp/x', keep: false })
    expect(parseCommand(['shift', '--tickets', 'T-0012,T-0019', '--implementer', 'subagent', '--model', 'opus']))
      .toMatchObject({ tickets: 'T-0012,T-0019', implementer: 'subagent', model: 'opus', push: false })
    expect(parseCommand(['--', 'shift', '--next', '1'])).toMatchObject({ next: 1, reviewModel: undefined })
    expect(parseCommand(['shift', '--next', '1', '--review-model', 'opus'])).toMatchObject({ model: undefined, reviewModel: 'opus' })
  })

  it('refuses a missing or doubled selection, a bad count, and an unknown implementer or subcommand', () => {
    expect(() => parseCommand(['shift'])).toThrow(/exactly one of --next/)
    expect(() => parseCommand(['shift', '--next', '1', '--tickets', 'T-0001'])).toThrow(/exactly one of --next/)
    expect(() => parseCommand(['shift', '--next', '0'])).toThrow(/positive integer/)
    expect(() => parseCommand(['shift', '--next', '1', '--implementer', 'human'])).toThrow(/route or subagent/)
    expect(() => parseCommand(['shift', '--next', '1', '--review-model', ' '])).toThrow(/--review-model takes a model id/)
    expect(() => parseCommand(['shift', '--next', '1', '--model', ''])).toThrow(/--model takes a model id/)
    expect(() => parseCommand(['run'])).toThrow(/unknown subcommand/)
    expect(() => parseCommand([])).toThrow(/usage:/)
  })

  it('hands the driver the selection, the branch, the push flag and the shift under the scratch root', () => {
    const command = parseCommand(['shift', '--tickets', 'T-0012', '--push', '--model', 'sonnet', '--review-model', 'opus', '--keep'], { DSH_ENTERPRISE_SCRATCH: '/tmp/x' })
    const env = driverEnvironment(command, '120000-abcd')
    expect(env).toMatchObject({
      DSH_ENTERPRISE_BRANCH: DEVELOPMENT_BRANCH,
      DSH_ENTERPRISE_SCRATCH: '/tmp/x/120000-abcd',
      DSH_ENTERPRISE_SHIFT: '120000-abcd',
      DSH_ENTERPRISE_TICKETS: 'T-0012',
      DSH_ENTERPRISE_PUSH: '1',
      DSH_ENTERPRISE_MODEL: 'sonnet',
      DSH_ENTERPRISE_REVIEW_MODEL: 'opus',
      DSH_ENTERPRISE_KEEP: '1',
      DSH_ENTERPRISE_IMPLEMENTER: 'route',
    })
    expect(env['DSH_ENTERPRISE_REMOTE']).toMatch(/deepseek-harness/)
    expect(env).not.toHaveProperty('DSH_ENTERPRISE_NEXT')
    expect(driverEnvironment(parseCommand(['shift', '--next', '1']), '120000-abcd')).not.toHaveProperty('DSH_ENTERPRISE_REVIEW_MODEL')
    expect(shiftId(new Date('2026-09-28T18:45:01Z'))).toMatch(/^184501-[0-9a-f]{4}$/)
  })
})

describe('the shift lock', () => {
  it('is held by one live shift, refuses a second, and is released', () => {
    const root = scratch()
    const release = acquireLock(root, 'first')
    expect(JSON.parse(readFileSync(join(root, LOCK_FILE), 'utf8'))).toMatchObject({ pid: process.pid, shift: 'first' })
    expect(() => acquireLock(root, 'second')).toThrow(/a shift is already running: first/)
    release()
    const again = acquireLock(root, 'second')
    again()
  })

  it('replaces a lock whose holder is gone', () => {
    const root = scratch()
    writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: 2 ** 22 - 1, shift: 'dead', startedAt: 'x' }))
    const release = acquireLock(root, 'next')
    expect(JSON.parse(readFileSync(join(root, LOCK_FILE), 'utf8'))).toMatchObject({ shift: 'next' })
    release()
  })
})

describe('the clone sweep', () => {
  it('removes clones a day old and keeps younger ones and the shift logs beside them', () => {
    const root = scratch()
    const old = join(root, 'old-shift')
    const young = join(root, 'young-shift')
    mkdirSync(join(old, 'repo'), { recursive: true })
    writeFileSync(join(old, 'run.log'), 'kept')
    mkdirSync(join(young, 'repo'), { recursive: true })
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    utimesSync(join(old, 'repo'), twoDaysAgo, twoDaysAgo)
    expect(sweepClones(root, new Date())).toEqual([join(old, 'repo')])
    expect(readFileSync(join(old, 'run.log'), 'utf8')).toBe('kept')
    expect(sweepClones(join(root, 'missing'), new Date())).toEqual([])
  })
})
