import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  BASE_COMPOSITION,
  buildLedgerLine,
  decideIteration,
  describePlan,
  formatLedgerLine,
  formatPlansListing,
  formatRunBanner,
  formatSchedule,
  formatUtcTimestamp,
  LEDGER_PATH,
  listOverlayNames,
  listPlanNames,
  listQueueNames,
  OVERLAYS_DIR,
  parseCommand,
  parseQueue,
  PLANS_DIR,
  planKind,
  QUEUES_DIR,
  readRecordedReading,
  RECORDS_ROOT,
  REPO_ROOT,
  resolveOutDir,
  resolveOverlayPath,
  resolvePlanPath,
  resolveQueuePath,
  resolveRecordName,
  scheduleQueue,
  selectRegistrySummary,
  USAGE,
  type IterationIdentity,
  type QueueEntry,
  type RegistrySummary,
  type ScheduledEntry,
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
      'mock-route',
      'registry-only',
      'route-only',
      'with-craft-skills',
      'with-deepseek',
      'with-knowledge-pack',
      'with-openai-gateway',
      'with-openrouter',
      'with-presets',
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
    expect(names).toHaveLength(34)
    expect(names).toContain('e3-attempts-t5')
    expect(names).toContain('e9-preset-craft-vs-plain-t5')
    expect(names).toContain('e7-attempts-5-t5')
    expect(names).toContain('h1-fleet-deepseek-t2')
    expect(names).toContain('h2-openrouter-free-t2')
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

describe('listQueueNames / resolveQueuePath', () => {
  it('lists the checked-in queues, sorted, without their suffix', () => {
    expect(listQueueNames()).toEqual(['nightly-tier5', 'openrouter-pairs', 'openrouter-smoke', 'presets-t5'])
  })

  it('finds a checked-in queue by name', () => {
    expect(resolveQueuePath('nightly-tier5')).toBe(join(QUEUES_DIR, 'nightly-tier5.json'))
  })

  it('resolves a path argument that is not a checked-in queue name', () => {
    const dir = fixtureDir()
    const adHoc = join(dir, 'ad-hoc.json')
    writeJson(adHoc, [])
    expect(resolveQueuePath(adHoc)).toBe(adHoc)
    expect(resolveQueuePath('ad-hoc.json', QUEUES_DIR, dir)).toBe(adHoc)
  })

  it('refuses an unknown queue and lists the checked-in ones', () => {
    expect(() => resolveQueuePath('does-not-exist')).toThrow(/unknown queue 'does-not-exist'/)
    expect(() => resolveQueuePath('does-not-exist')).toThrow(/nightly-tier5/)
  })
})

describe('parseQueue', () => {
  it('parses the checked-in queue into entries in file order', () => {
    const entries = parseQueue(readFileSync(join(QUEUES_DIR, 'nightly-tier5.json'), 'utf8'), 'nightly-tier5.json')
    expect(entries.map(entry => entry.plan)).toEqual(['e3-attempts-t5', 'e7-attempts-5-t5', 'h3-baseline-sonnet-t5'])
    expect(entries.map(entry => entry.overlay)).toEqual([null, 'attempts-5', null])
    for (const entry of entries) expect(entry.note.length).toBeGreaterThan(0)
  })

  it('refuses anything but a non-empty array of objects', () => {
    expect(() => parseQueue('{"plan":"a"}', 'q.json')).toThrow('queue q.json must be a JSON array')
    expect(() => parseQueue('[]', 'q.json')).toThrow('queue q.json holds no entry')
    expect(() => parseQueue('["e3-attempts-t5"]', 'q.json')).toThrow('queue q.json entry 1 must be an object')
    expect(() => parseQueue('[[]]', 'q.json')).toThrow('queue q.json entry 1 must be an object')
  })

  it('refuses an unknown field so a misspelled overlay cannot run the base composition', () => {
    const text = JSON.stringify([{ plan: 'p', overlays: 'with-spawn', overlay: null, note: 'n' }])
    expect(() => parseQueue(text, 'q.json')).toThrow('queue q.json entry 1 names overlays; a queue entry has exactly plan, overlay, note')
  })

  it('requires every field, with overlay explicitly null for the base composition', () => {
    expect(() => parseQueue(JSON.stringify([{ overlay: null, note: 'n' }]), 'q.json')).toThrow(/entry 1 needs a non-empty 'plan'/)
    expect(() => parseQueue(JSON.stringify([{ plan: '', overlay: null, note: 'n' }]), 'q.json')).toThrow(/entry 1 needs a non-empty 'plan'/)
    expect(() => parseQueue(JSON.stringify([{ plan: 'p', note: 'n' }]), 'q.json')).toThrow(/entry 1 needs an 'overlay' name, or null/)
    expect(() => parseQueue(JSON.stringify([{ plan: 'p', overlay: '', note: 'n' }]), 'q.json')).toThrow(/entry 1 needs an 'overlay' name, or null/)
    expect(() => parseQueue(JSON.stringify([{ plan: 'p', overlay: null }]), 'q.json')).toThrow(/entry 1 needs a non-empty 'note'/)
    expect(() => parseQueue(JSON.stringify([{ plan: 'p', overlay: null, note: '' }]), 'q.json')).toThrow(/entry 1 needs a non-empty 'note'/)
  })

  it('names the offending entry by its position', () => {
    const text = JSON.stringify([{ plan: 'a', overlay: null, note: 'n' }, { plan: 'b', overlay: null, note: 3 }])
    expect(() => parseQueue(text, 'q.json')).toThrow(/entry 2 needs a non-empty 'note'/)
  })
})

describe('planKind', () => {
  it('reads a models array as a fleet and a baseline/candidate pair as an experiment', () => {
    expect(planKind('h3', { models: [{ provider: 'claude-code', model: 'sonnet' }] })).toBe('fleet')
    expect(planKind('e3', { baseline: {}, candidate: {} })).toBe('experiment')
  })

  it('refuses a plan that declares neither or both', () => {
    expect(() => planKind('none', { repetitions: 2 })).toThrow(
      "plan 'none' declares neither a models array nor a baseline/candidate pair",
    )
    expect(() => planKind('both', { models: [], baseline: {}, candidate: {} })).toThrow(
      "plan 'both' declares both a models array and a baseline/candidate pair",
    )
  })

  it('classifies every plan the checked-in queue names', () => {
    const entries = parseQueue(readFileSync(join(QUEUES_DIR, 'nightly-tier5.json'), 'utf8'), 'nightly-tier5.json')
    const kinds = entries.map((entry) => {
      const plan = JSON.parse(readFileSync(resolvePlanPath(entry.plan), 'utf8')) as Record<string, unknown>
      return planKind(entry.plan, plan)
    })
    expect(kinds).toEqual(['experiment', 'experiment', 'fleet'])
  })
})

describe('scheduleQueue', () => {
  const entry = (plan: string, overlay: string | null): QueueEntry => ({ plan, overlay, note: `why ${plan}` })

  it('resolves the checked-in queue to real plans, overlays, and kinds', () => {
    const entries = parseQueue(readFileSync(join(QUEUES_DIR, 'nightly-tier5.json'), 'utf8'), 'nightly-tier5.json')
    const schedule = scheduleQueue(entries, { from: undefined, only: undefined })
    expect(schedule.map(item => item.index)).toEqual([1, 2, 3])
    expect(schedule.map(item => item.kind)).toEqual(['experiment', 'experiment', 'fleet'])
    expect(schedule[0]!.planPath).toBe(join(PLANS_DIR, 'e3-attempts-t5.json'))
    expect(schedule[0]!.compositionPath).toBe(BASE_COMPOSITION)
    expect(schedule[1]!.compositionPath).toBe(join(OVERLAYS_DIR, 'attempts-5.cordis.yml'))
    for (const item of schedule) expect(existsSync(item.planPath) && existsSync(item.compositionPath)).toBe(true)
  })

  it('refuses an unknown plan or overlay before anything runs, even where the selection would skip it', () => {
    const entries = [entry('e3-attempts-t5', null), entry('does-not-exist', null)]
    expect(() => scheduleQueue(entries, { from: 1, only: 'e3-attempts-t5' })).toThrow(/unknown plan 'does-not-exist'/)
    expect(() => scheduleQueue([entry('e3-attempts-t5', 'does-not-exist')], { from: undefined, only: undefined }))
      .toThrow(/unknown overlay 'does-not-exist'/)
  })

  it('resumes from a position and narrows to one plan, keeping each entry queue position', () => {
    const entries = [entry('e3-attempts-t5', null), entry('e7-attempts-5-t5', 'attempts-5'), entry('h3-baseline-sonnet-t5', null)]
    expect(scheduleQueue(entries, { from: 2, only: undefined }).map(item => [item.index, item.plan]))
      .toEqual([[2, 'e7-attempts-5-t5'], [3, 'h3-baseline-sonnet-t5']])
    expect(scheduleQueue(entries, { from: undefined, only: 'h3-baseline-sonnet-t5' }).map(item => item.index)).toEqual([3])
    expect(scheduleQueue(entries, { from: 3, only: 'h3-baseline-sonnet-t5' }).map(item => item.index)).toEqual([3])
  })

  it('refuses a selection that leaves no entry', () => {
    const entries = [entry('e3-attempts-t5', null)]
    expect(() => scheduleQueue(entries, { from: 2, only: undefined })).toThrow('no entry of this 1-entry queue matches --from 2')
    expect(() => scheduleQueue(entries, { from: undefined, only: 'e7-attempts-5-t5' }))
      .toThrow('no entry of this 1-entry queue matches --only e7-attempts-5-t5')
  })
})

describe('formatSchedule', () => {
  it('renders the header and one line per entry, in run order', () => {
    const schedule: ScheduledEntry[] = [
      { index: 2, plan: 'e7-attempts-5-t5', overlay: 'attempts-5', note: 'why', kind: 'experiment', planPath: '/p.json', compositionPath: '/c.yml' },
      { index: 3, plan: 'h3-baseline-sonnet-t5', overlay: null, note: 'baseline', kind: 'fleet', planPath: '/p2.json', compositionPath: '/c2.yml' },
    ]
    expect(formatSchedule('nightly-tier5', schedule)).toEqual([
      'queue=nightly-tier5 entries=2',
      '  2 plan=e7-attempts-5-t5 kind=experiment overlay=attempts-5 note=why',
      '  3 plan=h3-baseline-sonnet-t5 kind=fleet overlay=base note=baseline',
    ])
  })
})

describe('resolveRecordName', () => {
  const date = new Date('2026-09-19T21:15:30.000Z')

  it('names the record after the UTC date and the plan', () => {
    expect(resolveRecordName(date, 'e3-attempts-t5', [])).toBe('2026-09-19-bench-e3-attempts-t5')
  })

  it('suffixes the first free number when earlier records hold the name', () => {
    expect(resolveRecordName(date, 'e3-attempts-t5', ['2026-09-19-bench-e3-attempts-t5'])).toBe('2026-09-19-bench-e3-attempts-t5-2')
    expect(resolveRecordName(date, 'e3-attempts-t5', ['2026-09-19-bench-e3-attempts-t5', '2026-09-19-bench-e3-attempts-t5-2']))
      .toBe('2026-09-19-bench-e3-attempts-t5-3')
    expect(resolveRecordName(date, 'e3-attempts-t5', ['2026-09-19-bench-e3-attempts-t5', '2026-09-19-bench-e3-attempts-t5-3']))
      .toBe('2026-09-19-bench-e3-attempts-t5-2')
  })

  it('does not collide with an existing record of a different plan or date', () => {
    // A past loop night, whose records can no longer grow: it holds other plans
    // on that date, and this plan holds a record on another date.
    const night = new Date('2026-09-21T22:09:51.509Z')
    expect(resolveRecordName(night, 'e9-preset-craft-vs-plain-t5', readdirSync(RECORDS_ROOT))).toBe('2026-09-21-bench-e9-preset-craft-vs-plain-t5')
  })
})

describe('decideIteration', () => {
  it('adopts a promoted candidate and keeps the baseline otherwise', () => {
    expect(decideIteration('recorded', 'promote')).toBe('adopt-candidate')
    expect(decideIteration('recorded', 'reject')).toBe('keep-baseline')
    expect(decideIteration('recorded', 'inconclusive')).toBe('keep-baseline')
  })

  it('records a fleet, which carries no verdict, and decides nothing for a failed entry', () => {
    expect(decideIteration('recorded', null)).toBe('recorded')
    expect(decideIteration('failed', null)).toBe('none')
    expect(decideIteration('failed', 'promote')).toBe('none')
  })
})

describe('readRecordedReading', () => {
  it('reads a frozen pair verdict, delta, interval, statistic, and per-arm certificates from the record', () => {
    const name = '2026-09-19-bench-e7-attempts-5-t5'
    expect(readRecordedReading(join(RECORDS_ROOT, name), name)).toEqual({
      record: name,
      verdict: 'inconclusive',
      delta: 0.0625,
      interval: { lower: -0.125, upper: 0.25 },
      // The record predates results naming their statistic.
      statistic: 'paired-bootstrap/0',
      certified: [
        { arm: 'baseline', certified: 14, cells: 16 },
        { arm: 'candidate', certified: 15, cells: 16 },
      ],
      elapsedSeconds: 5616,
    })
  })

  it('reads a fleet as one arm per model of its leaderboard, with no verdict', () => {
    const name = '2026-09-19-bench-h1-openrouter-smoke-t2'
    expect(readRecordedReading(join(RECORDS_ROOT, name), name)).toEqual({
      record: name,
      verdict: null,
      delta: null,
      interval: null,
      statistic: null,
      certified: [{ arm: 'openrouter/deepseek/deepseek-v4-flash-0731:free', certified: 0, cells: 2 }],
      elapsedSeconds: 1594,
    })
  })

  it('reads the statistic a result names and refuses one the experiments service does not name', () => {
    const dir = fixtureDir()
    writeJson(join(dir, 'manifest.json'), {})
    const result = { verdict: 'inconclusive', delta: 0.125, interval: { lower: 0, upper: 0.375 } }
    writeJson(join(dir, 'result.json'), { result: { ...result, statistic: 'paired-cluster-bootstrap/1' } })
    expect(readRecordedReading(dir, 'r').statistic).toBe('paired-cluster-bootstrap/1')
    writeJson(join(dir, 'result.json'), { result: { ...result, statistic: 'paired-cluster-bootstrap/2' } })
    expect(() => readRecordedReading(dir, 'r')).toThrow('record r carries the unknown statistic "paired-cluster-bootstrap/2"')
  })

  it('refuses a record that carries no verdict and no leaderboard', () => {
    const dir = fixtureDir()
    writeJson(join(dir, 'manifest.json'), { elapsedSeconds: 1 })
    writeJson(join(dir, 'result.json'), { type: 'partial', reason: 'the container restarted' })
    expect(() => readRecordedReading(dir, 'a-partial-record'))
      .toThrow('record a-partial-record holds neither an experiment result nor a fleet leaderboard')
  })

  it('refuses an unknown verdict and a verdict without its interval', () => {
    const dir = fixtureDir()
    writeJson(join(dir, 'manifest.json'), {})
    writeJson(join(dir, 'result.json'), { result: { verdict: 'promoted', delta: 1, interval: { lower: 1, upper: 1 } } })
    expect(() => readRecordedReading(dir, 'r')).toThrow('record r carries the unknown verdict "promoted"')
    writeJson(join(dir, 'result.json'), { result: { verdict: 'promote', delta: 1 } })
    expect(() => readRecordedReading(dir, 'r')).toThrow('record r carries a verdict without a delta and an interval')
  })

  it('refuses a leaderboard row that does not name its arm and counts', () => {
    const dir = fixtureDir()
    writeJson(join(dir, 'manifest.json'), {})
    writeJson(join(dir, 'result.json'), { report: { leaderboard: [{ provider: 'claude-code', model: 'sonnet', runs: 2 }] } })
    expect(() => readRecordedReading(dir, 'r'))
      .toThrow('record r has a leaderboard row without a provider, model, runs, and certified count')
  })
})

describe('buildLedgerLine / formatLedgerLine', () => {
  const entry: ScheduledEntry = {
    index: 2,
    plan: 'e7-attempts-5-t5',
    overlay: 'attempts-5',
    note: 'why it is queued',
    kind: 'experiment',
    planPath: '/plans/e7-attempts-5-t5.json',
    compositionPath: '/overlays/attempts-5.cordis.yml',
  }
  const identity: IterationIdentity = {
    ranAt: '2026-09-19T21:15:30.000Z',
    queue: 'nightly-tier5',
    entry,
    head: 'abc1234',
  }

  it('carries the record reading, the statistic that read it, and the decision the verdict earned', () => {
    const line = buildLedgerLine(identity, {
      kind: 'recorded',
      reading: {
        record: '2026-09-19-bench-e7-attempts-5-t5-2',
        verdict: 'promote',
        delta: 0.25,
        interval: { lower: 0.125, upper: 0.375 },
        statistic: 'paired-cluster-bootstrap/1',
        certified: [{ arm: 'baseline', certified: 12, cells: 16 }, { arm: 'candidate', certified: 16, cells: 16 }],
        elapsedSeconds: 5616,
      },
    })
    expect(line).toEqual({
      ranAt: '2026-09-19T21:15:30.000Z',
      queue: 'nightly-tier5',
      index: 2,
      plan: 'e7-attempts-5-t5',
      overlay: 'attempts-5',
      kind: 'experiment',
      record: '2026-09-19-bench-e7-attempts-5-t5-2',
      head: 'abc1234',
      verdict: 'promote',
      delta: 0.25,
      interval: { lower: 0.125, upper: 0.375 },
      statistic: 'paired-cluster-bootstrap/1',
      certified: [{ arm: 'baseline', certified: 12, cells: 16 }, { arm: 'candidate', certified: 16, cells: 16 }],
      decision: 'adopt-candidate',
      elapsedSeconds: 5616,
      outcome: 'recorded',
    })
    expect('reason' in line).toBe(false)
  })

  it('decides recorded for a fleet, whose reading carries no verdict', () => {
    const fleet: ScheduledEntry = { ...entry, index: 3, plan: 'h3-baseline-sonnet-t5', overlay: null, kind: 'fleet' }
    const line = buildLedgerLine({ ...identity, entry: fleet }, {
      kind: 'recorded',
      reading: {
        record: '2026-09-19-bench-h3-baseline-sonnet-t5',
        verdict: null,
        delta: null,
        interval: null,
        statistic: null,
        certified: [{ arm: 'claude-code/sonnet', certified: 15, cells: 16 }],
        elapsedSeconds: 3000,
      },
    })
    expect(line.kind).toBe('fleet')
    expect(line.overlay).toBeNull()
    expect(line.verdict).toBeNull()
    expect(line.delta).toBeNull()
    expect(line.interval).toBeNull()
    expect(line.statistic).toBeNull()
    expect(line.decision).toBe('recorded')
  })

  it('writes a failed entry with its reason, no numbers, and no decision', () => {
    const line = buildLedgerLine(identity, { kind: 'failed', reason: 'the experiment driver exited 1' })
    expect(line).toMatchObject({
      record: null,
      verdict: null,
      delta: null,
      interval: null,
      statistic: null,
      certified: [],
      decision: 'none',
      elapsedSeconds: null,
      outcome: 'failed',
      reason: 'the experiment driver exited 1',
    })
  })

  it('keeps the record on a failure after it was written', () => {
    const line = buildLedgerLine(identity, { kind: 'failed', reason: 'summarizing exited 1', record: '2026-09-19-bench-e7-attempts-5-t5-2' })
    expect(line.record).toBe('2026-09-19-bench-e7-attempts-5-t5-2')
    expect(line.outcome).toBe('failed')
    expect(line.decision).toBe('none')
  })

  it('formats one compact JSON line that parses back', () => {
    const line = buildLedgerLine(identity, { kind: 'failed', reason: 'the experiment driver exited 1' })
    const text = formatLedgerLine(line)
    expect(text.endsWith('\n')).toBe(true)
    expect(text.trimEnd().includes('\n')).toBe(false)
    expect(JSON.parse(text)).toEqual(line)
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
      'unknown subcommand \'bogus\'; expected plans | environments | fleet | experiment | loop | fold | record | summarize | census | admit',
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

  it('parses loop with the queue and its resume and dry-run options', () => {
    expect(parseCommand(['loop', 'nightly-tier5'])).toEqual({
      kind: 'loop',
      queueArg: 'nightly-tier5',
      from: undefined,
      only: undefined,
      dryRun: false,
    })
    expect(parseCommand(['loop', 'nightly-tier5', '--dry-run', '--from', '2', '--only', 'e7-attempts-5-t5'])).toEqual({
      kind: 'loop',
      queueArg: 'nightly-tier5',
      from: 2,
      only: 'e7-attempts-5-t5',
      dryRun: true,
    })
  })

  it('refuses loop without exactly one queue argument and with a --from that is not a queue position', () => {
    expect(() => parseCommand(['loop'])).toThrow(/'loop' requires exactly one <queue> argument/)
    expect(() => parseCommand(['loop', 'a', 'b'])).toThrow(/'loop' requires exactly one <queue> argument/)
    expect(() => parseCommand(['loop', 'q', '--from', 'first'])).toThrow(/--from must be a positive integer/)
    expect(() => parseCommand(['loop', 'q', '--from', '0'])).toThrow(/--from must be a positive integer/)
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
    for (const subcommand of ['plans', 'environments', 'fleet', 'experiment', 'loop', 'fold', 'record', 'summarize', 'census', 'admit']) {
      expect(USAGE).toContain(subcommand)
    }
  })

  it('states the loop decision rule and that adopting a candidate is not an edit', () => {
    for (const decision of ['adopt-candidate', 'keep-baseline', 'recorded', 'none']) expect(USAGE).toContain(decision)
    expect(USAGE).toContain('data/proving-ground/loop/ledger.jsonl')
    expect(USAGE).toContain('adopt-candidate is a decision, not an edit')
  })
})

describe('bench loop --dry-run', () => {
  it('resolves the checked-in queue, prints the schedule, and writes nothing', () => {
    const ledgerBefore = existsSync(LEDGER_PATH)
    const result = spawnSync(
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      [join(REPO_ROOT, 'scripts/proving-ground.ts'), 'loop', 'nightly-tier5', '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    const entries = parseQueue(readFileSync(join(QUEUES_DIR, 'nightly-tier5.json'), 'utf8'), 'nightly-tier5.json')
    const lines = [...formatSchedule('nightly-tier5', scheduleQueue(entries, { from: undefined, only: undefined })), ''].join('\n')
    expect(result.stdout).toBe(`${lines}proving-ground: --dry-run, nothing ran and nothing was written\n`)
    expect(existsSync(LEDGER_PATH)).toBe(ledgerBefore)
  }, 60_000)

  it('refuses an unknown queue before running anything', () => {
    const result = spawnSync(
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      [join(REPO_ROOT, 'scripts/proving-ground.ts'), 'loop', 'does-not-exist', '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("proving-ground: unknown queue 'does-not-exist'")
    expect(result.stdout).toBe('')
  }, 60_000)
})
