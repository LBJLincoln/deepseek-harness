import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  BASE_COMPOSITION,
  describePlan,
  formatPlansListing,
  formatRunBanner,
  formatUtcTimestamp,
  listOverlayNames,
  listPlanNames,
  OVERLAYS_DIR,
  parseCommand,
  PLANS_DIR,
  resolveOutDir,
  resolveOverlayPath,
  resolvePlanPath,
  selectRegistrySummary,
  USAGE,
  type RegistrySummary,
} from './proving-ground.ts'

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixtureDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-proving-ground-'))
  fixtureRoots.push(root)
  return root
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value))
}

describe('listOverlayNames / resolveOverlayPath', () => {
  it('lists the real checked-in overlays, sorted, without their suffix', () => {
    expect(listOverlayNames()).toEqual([
      'attempts-1',
      'attempts-5',
      'registry-only',
      'route-only',
      'with-craft-skills',
      'with-knowledge-pack',
      'with-spawn',
    ])
  })

  it('resolves a known overlay name to its composition path', () => {
    expect(resolveOverlayPath('with-spawn')).toBe(join(OVERLAYS_DIR, 'with-spawn.cordis.yml'))
  })

  it('resolves an undefined overlay to the fixture base composition', () => {
    expect(resolveOverlayPath(undefined)).toBe(BASE_COMPOSITION)
  })

  it('refuses an unknown overlay and lists every real overlay in the message', () => {
    expect(() => resolveOverlayPath('does-not-exist')).toThrow(/unknown overlay 'does-not-exist'/)
    for (const name of listOverlayNames()) {
      expect(() => resolveOverlayPath('does-not-exist')).toThrow(new RegExp(name))
    }
  })

  it('refuses an unknown overlay against a synthetic directory, listing exactly its overlays', () => {
    const dir = fixtureDir()
    writeFileSync(join(dir, 'alpha.cordis.yml'), '')
    writeFileSync(join(dir, 'beta.cordis.yml'), '')
    expect(listOverlayNames(dir)).toEqual(['alpha', 'beta'])
    expect(() => resolveOverlayPath('gamma', dir, '/base.yml')).toThrow('expected one of alpha | beta')
    expect(resolveOverlayPath('alpha', dir, '/base.yml')).toBe(join(dir, 'alpha.cordis.yml'))
  })
})

describe('listPlanNames / resolvePlanPath', () => {
  it('lists every checked-in plan fixture', () => {
    const names = listPlanNames()
    expect(names).toHaveLength(25)
    expect(names).toContain('e3-attempts-t5')
    expect(names).toContain('held-out-sonnet-all')
    expect(names).toEqual([...names].sort())
  })

  it('finds a checked-in plan by name', () => {
    const path = resolvePlanPath('e3-attempts-t5')
    expect(path).toBe(join(PLANS_DIR, 'e3-attempts-t5.json'))
    expect(existsSync(path)).toBe(true)
  })

  it('resolves a path argument that is not a checked-in plan name', () => {
    const dir = fixtureDir()
    const adHoc = join(dir, 'ad-hoc.json')
    writeJson(adHoc, { name: 'ad-hoc' })
    expect(resolvePlanPath(adHoc)).toBe(adHoc)
    expect(resolvePlanPath('ad-hoc.json', PLANS_DIR, dir)).toBe(adHoc)
  })

  it('refuses an unknown plan and lists the checked-in plans', () => {
    expect(() => resolvePlanPath('does-not-exist')).toThrow(/unknown plan 'does-not-exist'/)
    expect(() => resolvePlanPath('does-not-exist')).toThrow(/e3-attempts-t5/)
  })

  it('refuses an unknown plan against a synthetic directory, listing exactly its plans', () => {
    const dir = fixtureDir()
    writeJson(join(dir, 'only.json'), {})
    expect(() => resolvePlanPath('missing', dir, dir)).toThrow('expected a checked-in plan (only)')
  })
})

describe('formatUtcTimestamp / resolveOutDir', () => {
  it('formats a fixed instant as a compact, filesystem-safe UTC timestamp', () => {
    expect(formatUtcTimestamp(new Date('2026-09-18T21:15:30.123Z'))).toBe('20260918T211530Z')
  })

  it('names the out directory after the plan and the timestamp, under the runs root', () => {
    const date = new Date('2026-09-18T21:15:30.000Z')
    expect(resolveOutDir('e3-attempts-t5', date, '/repo/.proving-ground/runs')).toBe(
      '/repo/.proving-ground/runs/e3-attempts-t5-20260918T211530Z',
    )
  })
})

describe('formatRunBanner', () => {
  it('renders one line carrying the time, plan, overlay, and head', () => {
    const line = formatRunBanner(new Date('2026-09-18T21:15:30.000Z'), 'e3-attempts-t5', 'with-spawn', 'abc1234')
    expect(line).toBe('=== 2026-09-18T21:15:30.000Z plan=e3-attempts-t5 overlay=with-spawn head=abc1234 ===\n')
  })
})

describe('describePlan', () => {
  it('describes an experiment-style plan with baseline/candidate arms', () => {
    const line = describePlan('e3-attempts-t5', {
      name: 'e3-attempts-t5',
      tier: 5,
      heldOut: false,
      repetitions: 2,
      seed: 2,
      baseline: { provider: 'claude-code', model: 'sonnet', ladder: [{}, {}, {}] },
      candidate: { provider: 'claude-code', model: 'sonnet', ladder: [{}] },
    })
    expect(line).toBe(
      'e3-attempts-t5: tier=5 heldOut=false repetitions=2 seed=2 '
      + 'baseline=claude-code/sonnet ladder×3 candidate=claude-code/sonnet ladder×1',
    )
  })

  it('describes a fleet-style plan with a models array, an implementer, and a district', () => {
    const line = describePlan('e5-drop-candidate-t5', {
      name: 'e5-drop-candidate-t5',
      tier: 5,
      heldOut: false,
      repetitions: 2,
      seed: 2,
      models: [{ provider: 'claude-code', model: 'haiku' }],
      ladder: [{}, { model: { provider: 'claude-code', model: 'opus' } }],
      implementer: { kind: 'subagent', provider: 'spawn', label: 'drop' },
    })
    expect(line).toBe(
      'e5-drop-candidate-t5: tier=5 heldOut=false repetitions=2 seed=2 '
      + 'models=[claude-code/haiku] implementer=subagent/spawn/drop ladder×2',
    )
  })

  it('renames the label with the plan file name only when the JSON name differs from it', () => {
    expect(describePlan('h1-fleet-harness-loop-sonnet-t2', {
      name: 'h1-harness-loop-sonnet-t2',
      heldOut: false,
      repetitions: 2,
    })).toMatch(/^h1-fleet-harness-loop-sonnet-t2 \(h1-harness-loop-sonnet-t2\): /)
    expect(describePlan('same-name', { name: 'same-name', heldOut: false, repetitions: 1 })).toMatch(/^same-name: /)
  })
})

describe('formatPlansListing', () => {
  it('includes every checked-in plan file, one line each', () => {
    const lines = formatPlansListing()
    const names = listPlanNames()
    expect(lines).toHaveLength(names.length)
    for (const name of names) {
      expect(lines.some(line => line === name || line.startsWith(`${name}:`) || line.startsWith(`${name} (`))).toBe(true)
    }
  })
})

describe('selectRegistrySummary', () => {
  const summary: RegistrySummary = {
    type: 'registry',
    total: 30,
    heldOut: 6,
    tiers: { '2': 6, '3': 9, '4': 9, '5': 10 },
    domains: { parsing: 6 },
    withReference: 10,
    cases: {},
    ids: ['code:csv-codec'],
  }

  it('returns the full summary when neither filter is given', () => {
    expect(selectRegistrySummary(summary, { tier: undefined, heldOut: false })).toBe(summary)
  })

  it('narrows to the requested tier count', () => {
    expect(selectRegistrySummary(summary, { tier: 2, heldOut: false })).toEqual({
      type: 'registry',
      total: 30,
      tier: { value: 2, count: 6 },
    })
  })

  it('reports zero for a tier the registry never populated', () => {
    expect(selectRegistrySummary(summary, { tier: 9, heldOut: false })).toEqual({
      type: 'registry',
      total: 30,
      tier: { value: 9, count: 0 },
    })
  })

  it('narrows to the held-out count', () => {
    expect(selectRegistrySummary(summary, { tier: undefined, heldOut: true })).toEqual({
      type: 'registry',
      total: 30,
      heldOut: 6,
    })
  })

  it('combines both narrowings as independent fields', () => {
    expect(selectRegistrySummary(summary, { tier: 3, heldOut: true })).toEqual({
      type: 'registry',
      total: 30,
      tier: { value: 3, count: 9 },
      heldOut: 6,
    })
  })
})

describe('parseCommand', () => {
  it('treats no arguments, --help, and -h as the help command', () => {
    expect(parseCommand([])).toEqual({ kind: 'help' })
    expect(parseCommand(['--help'])).toEqual({ kind: 'help' })
    expect(parseCommand(['-h'])).toEqual({ kind: 'help' })
  })

  it('strips the leading -- that pnpm forwards from `pnpm run bench -- <subcommand>`', () => {
    expect(parseCommand(['--'])).toEqual({ kind: 'help' })
    expect(parseCommand(['--', '--help'])).toEqual({ kind: 'help' })
    expect(parseCommand(['--', 'plans'])).toEqual({ kind: 'plans' })
    expect(parseCommand(['--', 'fleet', 'e3-attempts-t5'])).toEqual({
      kind: 'fleet',
      planArg: 'e3-attempts-t5',
      overlay: undefined,
      out: undefined,
    })
  })

  it('refuses an unknown subcommand, listing the known ones', () => {
    expect(() => parseCommand(['bogus'])).toThrow(
      'unknown subcommand \'bogus\'; expected plans | environments | fleet | experiment | fold | record | summarize | census | admit',
    )
  })

  it('parses plans with no arguments and refuses any', () => {
    expect(parseCommand(['plans'])).toEqual({ kind: 'plans' })
    expect(() => parseCommand(['plans', 'extra'])).toThrow(/'plans' takes no arguments/)
  })

  it('parses environments with its optional filters', () => {
    expect(parseCommand(['environments'])).toEqual({ kind: 'environments', tier: undefined, heldOut: false })
    expect(parseCommand(['environments', '--tier', '2'])).toEqual({ kind: 'environments', tier: 2, heldOut: false })
    expect(parseCommand(['environments', '--held-out'])).toEqual({ kind: 'environments', tier: undefined, heldOut: true })
    expect(parseCommand(['environments', '--tier', '5', '--held-out'])).toEqual({
      kind: 'environments',
      tier: 5,
      heldOut: true,
    })
  })

  it('refuses a non-integer --tier and a positional argument to environments', () => {
    expect(() => parseCommand(['environments', '--tier', 'abc'])).toThrow(/--tier must be an integer/)
    expect(() => parseCommand(['environments', 'code:csv-codec'])).toThrow(/takes no positional arguments/)
  })

  it('parses fleet and experiment with the plan, overlay, and out', () => {
    expect(parseCommand(['fleet', 'e3-attempts-t5'])).toEqual({
      kind: 'fleet',
      planArg: 'e3-attempts-t5',
      overlay: undefined,
      out: undefined,
    })
    expect(parseCommand(['experiment', 'e5-drop-candidate-t5', '--overlay', 'with-spawn', '--out', '/tmp/run'])).toEqual({
      kind: 'experiment',
      planArg: 'e5-drop-candidate-t5',
      overlay: 'with-spawn',
      out: '/tmp/run',
    })
  })

  it('refuses fleet or experiment without exactly one plan argument', () => {
    expect(() => parseCommand(['fleet'])).toThrow(/requires exactly one <plan> argument/)
    expect(() => parseCommand(['experiment', 'a', 'b'])).toThrow(/requires exactly one <plan> argument/)
  })

  it('forwards fold, record, summarize, census, and admit arguments unchanged', () => {
    expect(parseCommand(['fold', 'a.json', 'b.json', 'out.json', '0.05', '500'])).toEqual({
      kind: 'fold',
      args: ['a.json', 'b.json', 'out.json', '0.05', '500'],
    })
    expect(parseCommand(['record', '/tmp/run', 'name', '--composition', 'cordis.yml'])).toEqual({
      kind: 'record',
      args: ['/tmp/run', 'name', '--composition', 'cordis.yml'],
    })
    expect(parseCommand(['summarize', '/tmp/run', '--json'])).toEqual({
      kind: 'summarize',
      args: ['/tmp/run', '--json'],
    })
    expect(parseCommand(['census', '/tmp/run'])).toEqual({ kind: 'census', args: ['/tmp/run'] })
    expect(parseCommand(['admit'])).toEqual({ kind: 'admit', args: [] })
    expect(parseCommand(['admit', '/tmp/environments'])).toEqual({ kind: 'admit', args: ['/tmp/environments'] })
  })
})

describe('USAGE', () => {
  it('names every subcommand', () => {
    for (const subcommand of ['plans', 'environments', 'fleet', 'experiment', 'fold', 'record', 'summarize', 'census', 'admit']) {
      expect(USAGE).toContain(subcommand)
    }
  })
})
