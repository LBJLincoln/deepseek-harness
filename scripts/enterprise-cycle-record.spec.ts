import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildCycleRecord,
  cycleRecordProblems,
  CYCLES_DIR,
  cycleStartedAt,
  parseCycleRecordArguments,
  parseStepLines,
  readCycleRecords,
  writeCycleRecord,
  type CycleRecord,
  type CycleRecordInput,
} from './enterprise-cycle-record.ts'
import { LEDGER_PATH, type FunctionLine, type TicketLine } from './enterprise-ledger.ts'

const repoRoot = resolve(import.meta.dirname, '..')
const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)
const COMMIT_C = 'c'.repeat(40)

const TICKET: TicketLine = {
  type: 'ticket',
  at: '2026-09-28T22:40:00.000Z',
  shift: '221500-ab12',
  ticket: 'T-0042',
  seat: 'harness-core-session-steward',
  division: 'harness-core',
  checks: [{ id: 'typecheck', ok: true }],
  review: { verdict: 'approve' },
  integration: { outcome: 'merged' },
  shipped: { commit: COMMIT_C },
  tokens: 1000,
  seconds: 300,
}

const GATE: FunctionLine = {
  type: 'function',
  at: '2026-09-28T22:50:00.000Z',
  shift: 'cycle-20260928T221301Z',
  seat: 'verification-verify-md-links',
  division: 'verification',
  function: 'verify-md-links',
  target: { commit: COMMIT_B },
  outcome: 'pass',
  evidence: { path: 'data/enterprise/functions/cycle-20260928T221301Z/verification-verify-md-links.log' },
  seconds: 12,
}

function rows(...lines: readonly object[]): string {
  return lines.map(line => `${JSON.stringify(line)}\n`).join('')
}

function input(overrides: Partial<CycleRecordInput>): CycleRecordInput {
  return {
    cycle: 'cycle-20260928T221301Z',
    endedAt: '2026-09-28T23:01:00Z',
    commits: { start: COMMIT_A, pulled: COMMIT_B, end: COMMIT_C },
    steps: [
      { name: 'pull', exit: 0, at: '2026-09-28T22:13:02.000Z' },
      { name: 'functions', exit: 0, at: '2026-09-28T22:59:00.000Z' },
    ],
    ledgerBefore: rows(GATE),
    ledgerAfter: rows(GATE),
    previous: null,
    ...overrides,
  }
}

const tempDirs: string[] = []
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('parseStepLines', () => {
  it('reads one step per line, in order, with the time normalised', () => {
    expect(parseStepLines('pull 0 2026-09-28T22:13:02Z\n\nshift 3 2026-09-28T22:40:00Z\n')).toEqual([
      { name: 'pull', exit: 0, at: '2026-09-28T22:13:02.000Z' },
      { name: 'shift', exit: 3, at: '2026-09-28T22:40:00.000Z' },
    ])
  })

  it('refuses a line that is not a step rather than guessing', () => {
    expect(() => parseStepLines('pull 0 2026-09-28T22:13:02Z\npull-after-shift x 2026-09-28T22:41:00Z\n')).toThrow(/step line 2/)
    expect(() => parseStepLines('pull 256 2026-09-28T22:13:02Z')).toThrow(/step line 1/)
    expect(() => parseStepLines('pull 0 yesterday')).toThrow(/step line 1/)
  })
})

describe('buildCycleRecord', () => {
  it('counts only the ledger rows the cycle added, by ticket status and function outcome', () => {
    const halted: TicketLine = { ...TICKET, ticket: 'T-0043', shipped: null, review: { verdict: 'none' } }
    const failed: FunctionLine = { ...GATE, seat: 'verification-verify-export-jsdoc', function: 'verify-export-jsdoc', outcome: 'fail' }
    const record = buildCycleRecord(input({
      ledgerBefore: rows(GATE),
      ledgerAfter: `${rows(TICKET, GATE, halted, { ...TICKET, shift: '231000-cd34', ticket: 'T-0044' }, failed)}{"torn": \n`,
    }))
    expect(record.tickets).toEqual({ shipped: 2, rejected: 0, halted: 1 })
    expect(record.functions).toEqual({ pass: 0, fail: 1, error: 0 })
    expect(record.shifts).toEqual(['221500-ab12', '231000-cd34'])
    expect(record.unreadable).toBe(1)
  })

  it('states the cycle id\'s moment, the commits, every step and no failure for a clean cycle', () => {
    const record = buildCycleRecord(input({}))
    expect(record).toMatchObject({
      cycle: 'cycle-20260928T221301Z',
      startedAt: '2026-09-28T22:13:01.000Z',
      endedAt: '2026-09-28T23:01:00.000Z',
      commits: { start: COMMIT_A, pulled: COMMIT_B, end: COMMIT_C },
      firstFailure: null,
      previous: null,
    })
    expect(record.steps.map(step => step.name)).toEqual(['pull', 'functions'])
  })

  it('names the first step that exited non-zero, not the last', () => {
    const record = buildCycleRecord(input({
      steps: [
        { name: 'pull', exit: 0, at: '2026-09-28T22:13:02.000Z' },
        { name: 'intake', exit: 3, at: '2026-09-28T22:14:00.000Z' },
        { name: 'functions', exit: 1, at: '2026-09-28T22:59:00.000Z' },
      ],
    }))
    expect(record.firstFailure).toEqual({ step: 'intake', exit: 3 })
  })

  it('refuses to build a record that would not validate', () => {
    expect(() => buildCycleRecord(input({ cycle: 'cycle-latest' }))).toThrow(/"cycle" is not a cycle id/)
    expect(() => buildCycleRecord(input({ commits: { start: 'HEAD', pulled: COMMIT_B, end: COMMIT_C } }))).toThrow(/"commits"/)
    expect(() => buildCycleRecord(input({ steps: [] }))).toThrow(/"steps"/)
  })
})

describe('cycleRecordProblems', () => {
  const valid = buildCycleRecord(input({}))

  it('accepts a built record', () => {
    expect(cycleRecordProblems(valid)).toEqual([])
    expect(cycleStartedAt('cycle-20260928T221301Z')).toBe('2026-09-28T22:13:01.000Z')
  })

  it('names every field a hand-edited record gets wrong', () => {
    const edited = { ...valid, startedAt: '2026-09-28T22:00:00.000Z', firstFailure: { step: 'pull', exit: 1 }, tickets: { shipped: -1 }, previous: { cycle: 'yesterday' } }
    expect(cycleRecordProblems(edited)).toEqual([
      '"startedAt" is not the moment the cycle id stamps',
      '"tickets" does not count shipped, rejected and halted',
      '"firstFailure" is not the first step that exited non-zero',
      '"previous" is neither null nor { cycle, recordOnRemote }',
    ])
    expect(cycleRecordProblems([])).toEqual(['not a JSON object'])
  })
})

describe('readCycleRecords', () => {
  it('reads the valid records in cycle order and reports every other file with the reason', () => {
    const root = tempDir('cycle-records-')
    mkdirSync(join(root, CYCLES_DIR), { recursive: true })
    const later = buildCycleRecord(input({ cycle: 'cycle-20260929T001301Z', endedAt: '2026-09-29T01:00:00Z' }))
    const earlier = buildCycleRecord(input({}))
    writeFileSync(join(root, CYCLES_DIR, `${later.cycle}.json`), JSON.stringify(later))
    writeFileSync(join(root, CYCLES_DIR, `${earlier.cycle}.json`), JSON.stringify(earlier))
    writeFileSync(join(root, CYCLES_DIR, 'cycle-20260929T021301Z.json'), JSON.stringify(earlier))
    writeFileSync(join(root, CYCLES_DIR, 'cycle-20260929T041301Z.json'), '{"cycle": ')
    const read = readCycleRecords(root)
    expect(read.records.map(record => record.cycle)).toEqual([earlier.cycle, later.cycle])
    expect(read.unreadable).toEqual([
      { path: `${CYCLES_DIR}/cycle-20260929T021301Z.json`, reason: 'the file is not named after its "cycle"' },
      { path: `${CYCLES_DIR}/cycle-20260929T041301Z.json`, reason: 'not JSON' },
    ])
    expect(readCycleRecords(tempDir('cycle-records-empty-'))).toEqual({ records: [], unreadable: [] })
  })
})

describe('parseCycleRecordArguments', () => {
  it('reads the flags the cycle passes, past the -- pnpm forwards', () => {
    expect(parseCycleRecordArguments(['--', '--cycle', 'cycle-20260928T221301Z', '--steps', '/tmp/s', '--start', COMMIT_A, '--pulled', COMMIT_B, '--remote', 'none']))
      .toEqual({ cycle: 'cycle-20260928T221301Z', steps: '/tmp/s', start: COMMIT_A, pulled: COMMIT_B, remote: 'none' })
  })

  it('refuses an unknown, valueless or missing flag', () => {
    expect(() => parseCycleRecordArguments(['--cycles', 'x'])).toThrow(/unknown flag --cycles/)
    expect(() => parseCycleRecordArguments(['--cycle', '--steps', 'x'])).toThrow(/--cycle needs a value/)
    expect(() => parseCycleRecordArguments(['--cycle', 'x'])).toThrow(/missing --steps, --start, --pulled, --remote/)
  })
})

/** Run git in `cwd` with no hooks, signing or push negotiation from the host's configuration. */
function git(cwd: string, ...args: string[]): string {
  const config = ['core.hooksPath=/dev/null', 'commit.gpgsign=false', 'push.negotiate=false', 'user.name=t', 'user.email=t@example.com']
  return execFileSync('git', [...config.flatMap(entry => ['-c', entry]), ...args], { cwd, encoding: 'utf8' }).trim()
}

/** A clone of a fresh bare origin whose branch `cycle-test` holds the ledger and whatever `files` names. */
function checkout(files: Readonly<Record<string, string>>): { origin: string; work: string } {
  const base = tempDir('cycle-git-')
  const origin = join(base, 'origin.git')
  const work = join(base, 'work')
  execFileSync('git', ['init', '-q', '--bare', origin])
  mkdirSync(work)
  git(work, 'init', '-q', '-b', 'cycle-test')
  for (const [path, content] of Object.entries({ [LEDGER_PATH]: rows(GATE), ...files })) {
    mkdirSync(join(work, path, '..'), { recursive: true })
    writeFileSync(join(work, path), content)
  }
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'base')
  git(work, 'remote', 'add', 'origin', origin)
  git(work, 'push', '-q', 'origin', 'HEAD:cycle-test')
  git(work, 'fetch', '-q', 'origin')
  return { origin, work }
}

describe('writeCycleRecord', () => {
  const previousFile = `${CYCLES_DIR}/cycle-20260928T201148Z.json`
  const previousRecord = `${JSON.stringify(buildCycleRecord(input({ cycle: 'cycle-20260928T201148Z' })), null, 2)}\n`

  function write(work: string, remote: string): CycleRecord {
    const steps = join(work, '..', 'steps')
    writeFileSync(steps, 'pull 0 2026-09-28T22:13:02Z\nfunctions 1 2026-09-28T22:59:00Z\n')
    const head = git(work, 'rev-parse', 'HEAD')
    appendRows(work, rows(TICKET))
    const { file, record } = writeCycleRecord(work, { cycle: 'cycle-20260928T221301Z', steps, start: head, pulled: head, remote }, new Date('2026-09-28T23:01:00Z'))
    expect(JSON.parse(readFileSync(join(work, file), 'utf8'))).toEqual(record)
    return record
  }

  function appendRows(work: string, content: string): void {
    writeFileSync(join(work, LEDGER_PATH), readFileSync(join(work, LEDGER_PATH), 'utf8') + content)
  }

  it('names the commits, counts the lines added since the pull, and finds the previous record on the remote', () => {
    const { work } = checkout({ [previousFile]: previousRecord })
    const record = write(work, git(work, 'rev-parse', 'refs/remotes/origin/cycle-test'))
    expect(record.commits.end).toBe(git(work, 'rev-parse', 'HEAD'))
    expect(record.tickets.shipped).toBe(1)
    expect(record.firstFailure).toEqual({ step: 'functions', exit: 1 })
    expect(record.previous).toEqual({ cycle: 'cycle-20260928T201148Z', recordOnRemote: true })
  })

  it('says the previous record is not on the remote when only the checkout holds it, and unknown without a remote ref', () => {
    const { work } = checkout({})
    const remote = git(work, 'rev-parse', 'refs/remotes/origin/cycle-test')
    mkdirSync(join(work, CYCLES_DIR), { recursive: true })
    writeFileSync(join(work, previousFile), previousRecord)
    git(work, 'add', '-A')
    git(work, 'commit', '-q', '-m', 'an unpushed record')
    expect(write(work, remote).previous).toEqual({ cycle: 'cycle-20260928T201148Z', recordOnRemote: false })
    rmSync(join(work, CYCLES_DIR, 'cycle-20260928T221301Z.json'))
    expect(write(work, 'none').previous).toEqual({ cycle: 'cycle-20260928T201148Z', recordOnRemote: null })
  })

  it('never overwrites a record', () => {
    const { work } = checkout({ [`${CYCLES_DIR}/cycle-20260928T221301Z.json`]: previousRecord })
    const head = git(work, 'rev-parse', 'HEAD')
    expect(() => writeCycleRecord(work, { cycle: 'cycle-20260928T221301Z', steps: '/nonexistent', start: head, pulled: head, remote: 'none' }, new Date()))
      .toThrow(/already exists/)
  })
})

/** Whether util-linux `flock`, which the cycle script takes its lock with, is on this host. */
const hasFlock = process.platform === 'linux' && spawnSync('flock', ['--version']).status === 0

/**
 * A stand-in for pnpm: the intake and roster do nothing, the shift commits and
 * pushes one ticket line, the functions append one function line, the roster
 * exits with `ROSTER_EXIT`, and the cycle record runs the real script.
 */
const FAKE_PNPM = `#!/bin/sh
script=$3
shift 3
[ "$1" = "--" ] && shift
case "$script" in
  enterprise:cycle-record) exec "$TSX" scripts/enterprise-cycle-record.ts "$@" ;;
  enterprise)
    printf '%s\\n' "$TICKET_LINE" >> data/enterprise/ledger.jsonl
    git -c user.name=t -c user.email=t@example.com commit -q -am shift && git push -q origin "HEAD:$ENTERPRISE_BRANCH" ;;
  enterprise:functions) printf '%s\\n' "$FUNCTION_LINE" >> data/enterprise/ledger.jsonl ;;
  roster) exit "$ROSTER_EXIT" ;;
esac
exit 0
`

describe.skipIf(!hasFlock)('enterprise-cycle.sh', () => {
  it('commits a record of every step in its final commit, and the next cycle finds it on the remote', { timeout: 60_000 }, async () => {
    const { origin, work } = checkout({
      'package.json': '{ "type": "module" }\n',
      'apps/command-deck/public/fixtures/.keep': '',
      'scripts/enterprise-cycle.sh': readFileSync(join(repoRoot, 'scripts/enterprise-cycle.sh'), 'utf8'),
    })
    for (const file of ['enterprise-cycle-record.ts', 'enterprise-ledger.ts']) copyFileSync(join(repoRoot, 'scripts', file), join(work, 'scripts', file))
    git(work, 'config', 'core.hooksPath', '/dev/null')
    git(work, 'config', 'commit.gpgsign', 'false')
    git(work, 'config', 'push.negotiate', 'false')
    git(work, 'add', '-A')
    git(work, 'commit', '-q', '-m', 'the record scripts')
    git(work, 'push', '-q', 'origin', 'HEAD:cycle-test')
    const bin = tempDir('cycle-bin-')
    writeFileSync(join(bin, 'pnpm'), FAKE_PNPM)
    chmodSync(join(bin, 'pnpm'), 0o755)
    const { ENTERPRISE_COMMIT_TRAILERS: _trailers, ...parent } = process.env
    const env = {
      ...parent,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      TMPDIR: tempDir('cycle-tmp-'),
      TSX: join(repoRoot, 'node_modules/.bin/tsx'),
      ENTERPRISE_BRANCH: 'cycle-test',
      TICKET_LINE: JSON.stringify(TICKET),
      FUNCTION_LINE: JSON.stringify(GATE),
    }
    const cycle = (rosterExit: number): number | null =>
      spawnSync('bash', ['scripts/enterprise-cycle.sh'], { cwd: work, env: { ...env, ROSTER_EXIT: String(rosterExit) }, encoding: 'utf8' }).status
    const recordsOnOrigin = (): string[] => git(origin, 'ls-tree', '--name-only', 'cycle-test', `${CYCLES_DIR}/`).split('\n').filter(Boolean)

    expect(cycle(1)).toBe(1)
    const [first] = recordsOnOrigin()
    expect(first).toBeDefined()
    const record = JSON.parse(git(origin, 'show', `cycle-test:${first}`)) as CycleRecord
    expect(record.steps.map(step => step.name)).toEqual(['pull', 'intake', 'intake-push', 'shift', 'pull-after-shift', 'functions', 'roster', 'publish'])
    expect(record.firstFailure).toEqual({ step: 'roster', exit: 1 })
    expect(record).toMatchObject({ shifts: [TICKET.shift], tickets: { shipped: 1 }, functions: { pass: 1 }, previous: null })
    expect(git(origin, 'rev-parse', 'cycle-test^')).toBe(record.commits.end)
    expect(git(origin, 'log', '-1', '--format=%s', 'cycle-test')).toBe(`chore(enterprise): ${record.cycle} functions, roster and deck`)
    expect(existsSync(join(env.TMPDIR, `enterprise-${record.cycle}.steps`))).toBe(false)

    await new Promise(resolveWait => setTimeout(resolveWait, 1100))
    expect(cycle(0)).toBe(0)
    const second = recordsOnOrigin().at(-1) ?? ''
    const next = JSON.parse(git(origin, 'show', `cycle-test:${second}`)) as CycleRecord
    expect(next.firstFailure).toBeNull()
    expect(next.previous).toEqual({ cycle: record.cycle, recordOnRemote: true })
  })
})
