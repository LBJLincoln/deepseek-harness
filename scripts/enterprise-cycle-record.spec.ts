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
import { acquirePushLock } from './enterprise-push-lock.ts'

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

  it('reads who started the cycle when the script passes it, and refuses any other starter', () => {
    const required = ['--cycle', 'cycle-20260928T221301Z', '--steps', '/tmp/s', '--start', COMMIT_A, '--pulled', COMMIT_B, '--remote', 'none']
    expect(parseCycleRecordArguments([...required, '--started-by', 'scheduler']).startedBy).toBe('scheduler')
    expect(() => parseCycleRecordArguments([...required, '--started-by', 'cron'])).toThrow(/scheduler or operator/)
    expect(cycleRecordProblems({ ...buildCycleRecord(input({ startedBy: 'operator' })), startedBy: 'cron' })).toEqual(['"startedBy" is neither "scheduler" nor "operator"'])
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
 * A stand-in for pnpm: the intake does nothing, the shift records the heavy
 * and push locks it was handed and commits and pushes one ticket line past the
 * hooks as the real shift does, the functions append one function line, the
 * roster writes the ledger's line count to `roster.json` and exits with
 * `ROSTER_EXIT`, the publish has another writer push a conflicting roster once
 * when `RIVAL_ONCE` is set, and the cycle record runs the real script.
 */
const FAKE_PNPM = `#!/bin/sh
script=$3
shift 3
[ "$1" = "--" ] && shift
case "$script" in
  enterprise:cycle-record) exec "$TSX" scripts/enterprise-cycle-record.ts "$@" ;;
  enterprise)
    printf '%s\\n' "\${ENTERPRISE_HEAVY_LOCK:-unset}" > "$TMPDIR/shift-heavy-lock"
    printf '%s %s\\n' "\${ENTERPRISE_PUSH_LOCK:-unset}" "\${ENTERPRISE_PUSH_LOCK_WAIT:-unset}" > "$TMPDIR/shift-push-lock"
    printf '%s\\n' "$TICKET_LINE" >> data/enterprise/ledger.jsonl
    git -c user.name=t -c user.email=t@example.com commit -q --no-verify -am shift && git push -q --no-verify origin "HEAD:$ENTERPRISE_BRANCH" ;;
  enterprise:functions) printf '%s\\n' "$FUNCTION_LINE" >> data/enterprise/ledger.jsonl ;;
  roster) grep -c '' data/enterprise/ledger.jsonl > data/enterprise/roster.json; exit "$ROSTER_EXIT" ;;
  enterprise:publish)
    if [ -n "\${RIVAL_ONCE:-}" ] && [ ! -e "$TMPDIR/rival-done" ]; then
      : > "$TMPDIR/rival-done"
      git clone -q --branch "$ENTERPRISE_BRANCH" "$(git config --get remote.origin.url)" "$TMPDIR/rival" &&
        printf 'rival\\n' > "$TMPDIR/rival/data/enterprise/roster.json" &&
        git -C "$TMPDIR/rival" -c user.name=r -c user.email=r@example.com commit -q --no-verify -am 'another writer regenerates the roster' &&
        git -C "$TMPDIR/rival" push -q --no-verify origin "HEAD:$ENTERPRISE_BRANCH" || exit 1
    fi ;;
esac
exit 0
`

/** One run of the cycle script: its exit code and what it printed. */
interface CycleRun {
  status: number | null
  stdout: string
}

/**
 * The environment a cycle under test runs in: the fake pnpm first on `PATH`, a
 * `TMPDIR` and a push lock of the test's own (never the machine's live push
 * lock), none of the operator's cycle settings, and the ticket line the fake
 * shift and the function line the fake functions append.
 */
function cycleEnvironment(functionLine: FunctionLine): NodeJS.ProcessEnv & { TMPDIR: string; ENTERPRISE_PUSH_LOCK: string } {
  const bin = tempDir('cycle-bin-')
  writeFileSync(join(bin, 'pnpm'), FAKE_PNPM)
  chmodSync(join(bin, 'pnpm'), 0o755)
  const {
    ENTERPRISE_COMMIT_TRAILERS: _trailers,
    ENTERPRISE_HEAVY_LOCK: _heavyLock,
    ENTERPRISE_PUSH_LOCK_WAIT: _pushWait,
    ...parent
  } = process.env
  const tmp = tempDir('cycle-tmp-')
  return {
    ...parent,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    TMPDIR: tmp,
    ENTERPRISE_PUSH_LOCK: join(tmp, 'push.lock'),
    TSX: join(repoRoot, 'node_modules/.bin/tsx'),
    ENTERPRISE_BRANCH: 'cycle-test',
    TICKET_LINE: JSON.stringify(TICKET),
    FUNCTION_LINE: JSON.stringify(functionLine),
  }
}

describe.skipIf(!hasFlock)('enterprise-cycle.sh', () => {
  it('commits a record of every step in its final commit past a refusing pre-push hook, and the next cycle finds it on the remote', { timeout: 60_000 }, async () => {
    const { origin, work } = checkout({
      'package.json': '{ "type": "module" }\n',
      'apps/command-deck/public/fixtures/.keep': '',
      'scripts/enterprise-cycle.sh': readFileSync(join(repoRoot, 'scripts/enterprise-cycle.sh'), 'utf8'),
    })
    for (const file of ['enterprise-cycle-record.ts', 'enterprise-ledger.ts']) copyFileSync(join(repoRoot, 'scripts', file), join(work, 'scripts', file))
    git(work, 'config', 'commit.gpgsign', 'false')
    git(work, 'config', 'push.negotiate', 'false')
    git(work, 'add', '-A')
    git(work, 'commit', '-q', '-m', 'the record scripts')
    git(work, 'push', '-q', 'origin', 'HEAD:cycle-test')
    // The repository's pre-push hook, which a push that runs it cannot pass;
    // every push of the cycle's own skips it.
    const hooks = tempDir('cycle-hooks-')
    writeFileSync(join(hooks, 'pre-push'), '#!/bin/sh\necho "the pre-push hook refuses" >&2\nexit 1\n')
    chmodSync(join(hooks, 'pre-push'), 0o755)
    git(work, 'config', 'core.hooksPath', hooks)
    expect(spawnSync('git', ['push', '-q', 'origin', 'HEAD:hook-probe'], { cwd: work, encoding: 'utf8' }).stderr).toContain('the pre-push hook refuses')
    const env = cycleEnvironment(GATE)
    const cycle = (rosterExit: number): number | null =>
      spawnSync('bash', ['scripts/enterprise-cycle.sh'], { cwd: work, env: { ...env, ROSTER_EXIT: String(rosterExit) }, encoding: 'utf8' }).status
    const recordsOnOrigin = (): string[] => git(origin, 'ls-tree', '--name-only', 'cycle-test', `${CYCLES_DIR}/`).split('\n').filter(Boolean)

    expect(cycle(1)).toBe(1)
    const [first] = recordsOnOrigin()
    expect(first).toBeDefined()
    const record = JSON.parse(git(origin, 'show', `cycle-test:${first}`)) as CycleRecord
    expect(record.steps.map(step => step.name)).toEqual(['pull', 'intake', 'intake-push', 'shift', 'pull-after-shift', 'functions', 'roster', 'publish'])
    expect(record.firstFailure).toEqual({ step: 'roster', exit: 1 })
    expect(record).toMatchObject({ startedBy: 'operator', shifts: [TICKET.shift], tickets: { shipped: 1 }, functions: { pass: 1 }, previous: null })
    expect(git(origin, 'rev-parse', 'cycle-test^')).toBe(record.commits.end)
    expect(git(origin, 'log', '-1', '--format=%s', 'cycle-test')).toBe(`chore(enterprise): ${record.cycle} functions, roster and deck`)
    expect(existsSync(join(env.TMPDIR, `enterprise-${record.cycle}.steps`))).toBe(false)
    expect(readFileSync(join(env.TMPDIR, 'shift-heavy-lock'), 'utf8')).toBe('/tmp/dsh-heavy.lock\n')
    expect(readFileSync(join(env.TMPDIR, 'shift-push-lock'), 'utf8')).toBe(`${env.ENTERPRISE_PUSH_LOCK} 1800\n`)

    await new Promise(resolveWait => setTimeout(resolveWait, 1100))
    expect(cycle(0)).toBe(0)
    const second = recordsOnOrigin().at(-1) ?? ''
    const next = JSON.parse(git(origin, 'show', `cycle-test:${second}`)) as CycleRecord
    expect(next.firstFailure).toBeNull()
    expect(next.previous).toEqual({ cycle: record.cycle, recordOnRemote: true })

    // While another writer holds the push lock, the cycle's final ship waits
    // for it, gives up after ENTERPRISE_PUSH_LOCK_WAIT, and pushes nothing.
    await new Promise(resolveWait => setTimeout(resolveWait, 1100))
    const held = acquirePushLock({ lock: env.ENTERPRISE_PUSH_LOCK, waitSeconds: 1, rounds: 1 })
    if (!('release' in held)) throw new Error(held.busy)
    const blocked = spawnSync('bash', ['scripts/enterprise-cycle.sh'], { cwd: work, env: { ...env, ROSTER_EXIT: '0', ENTERPRISE_PUSH_LOCK_WAIT: '1' }, encoding: 'utf8' })
    held.release()
    expect(blocked.stdout).toContain(`the push lock ${env.ENTERPRISE_PUSH_LOCK} was not taken within 1 s`)
    expect(blocked.status).toBe(1)
    expect(git(origin, 'log', '-1', '--format=%s', 'cycle-test')).toBe('shift')
  })
  /**
   * A cycle checkout over a bare remote, with the record scripts, the fake
   * pnpm and a lock of its own, as a linked worktree of the clone (the
   * dedicated checkout the cycle runs from) or as the clone itself.
   */
  function cycleHarness(linked: boolean): { origin: string; dir: string; run: (extra?: Record<string, string>) => CycleRun } {
    const { origin, work } = checkout({
      'package.json': '{ "type": "module" }\n',
      'apps/command-deck/public/fixtures/.keep': '',
      'data/enterprise/roster.json': 'seed\n',
      'scripts/enterprise-cycle.sh': readFileSync(join(repoRoot, 'scripts/enterprise-cycle.sh'), 'utf8'),
    })
    for (const file of ['enterprise-cycle-record.ts', 'enterprise-ledger.ts']) copyFileSync(join(repoRoot, 'scripts', file), join(work, 'scripts', file))
    git(work, 'add', '-A')
    git(work, 'commit', '-q', '-m', 'the record scripts')
    git(work, 'push', '-q', 'origin', 'HEAD:cycle-test')
    const settings = [['commit.gpgsign', 'false'], ['push.negotiate', 'false'], ['core.hooksPath', '/dev/null'], ['user.name', 't'], ['user.email', 't@example.com']] as const
    for (const [key, value] of settings) git(work, 'config', key, value)
    const dir = linked ? join(work, '..', 'cycle-worktree') : work
    if (linked) git(work, 'worktree', 'add', '-q', '-B', 'cycle-worktree', dir, 'HEAD')
    const env = { ...cycleEnvironment({ ...GATE, at: '2026-09-29T08:50:00.000Z' }), ROSTER_EXIT: '0' }
    const run = (extra: Record<string, string> = {}): CycleRun => {
      const result = spawnSync('bash', ['scripts/enterprise-cycle.sh'], { cwd: dir, env: { ...env, ...extra }, encoding: 'utf8' })
      return { status: result.status, stdout: result.stdout }
    }
    return { origin, dir, run }
  }

  /** Commit one change to the remote branch from a scratch clone, as another writer of the branch would. */
  function rivalCommit(origin: string, path: string, text: string): string {
    const rival = tempDir('cycle-rival-')
    git(rival, 'clone', '-q', '--branch', 'cycle-test', origin, '.')
    mkdirSync(join(rival, path, '..'), { recursive: true })
    writeFileSync(join(rival, path), text)
    git(rival, 'add', '-A')
    git(rival, 'commit', '-q', '-m', 'another writer regenerates the roster')
    git(rival, 'push', '-q', 'origin', 'HEAD:cycle-test')
    return git(rival, 'rev-parse', 'HEAD')
  }

  it('rebuilds its final commit on the remote tip when the rebase conflicts on a generated file, and pushes it', { timeout: 60_000 }, () => {
    const { origin, run } = cycleHarness(true)
    const { status, stdout } = run({ RIVAL_ONCE: '1' })
    expect(status, stdout).toBe(0)
    expect(stdout).toContain('the rebase onto the remote tip conflicted; rebuilding')
    expect(git(origin, 'log', '-1', '--format=%s', 'cycle-test')).toMatch(/^chore\(enterprise\): cycle-\d{8}T\d{6}Z rebuilds unpushed data on [0-9a-f]{10}$/)
    const rival = git(origin, 'log', '--format=%H', '--grep=another writer', 'cycle-test')
    expect(rival).toMatch(/^[0-9a-f]{40}$/)
    const ledger = git(origin, 'show', `cycle-test:${LEDGER_PATH}`).split('\n')
    expect(ledger.filter(line => line === JSON.stringify(TICKET))).toHaveLength(1)
    expect(ledger.filter(line => line.includes('2026-09-29T08:50:00.000Z'))).toHaveLength(1)
    const records = git(origin, 'ls-tree', '--name-only', 'cycle-test', `${CYCLES_DIR}/`).split('\n').filter(Boolean)
    expect(records).toHaveLength(1)
    // The roster was regenerated over the rebuilt ledger, not kept from either side.
    expect(git(origin, 'show', 'cycle-test:data/enterprise/roster.json')).toBe(String(ledger.length))
  })

  it('pushes a checkout\'s unpushed commits before the cycle, rebuilding them on the tip when their rebase conflicts', { timeout: 60_000 }, () => {
    const { origin, dir, run } = cycleHarness(true)
    const stranded = 'cycle-20260928T201148Z'
    const strandedLine = JSON.stringify({ ...GATE, at: '2026-09-28T20:30:00.000Z' })
    mkdirSync(join(dir, CYCLES_DIR), { recursive: true })
    writeFileSync(join(dir, CYCLES_DIR, `${stranded}.json`), `${JSON.stringify(buildCycleRecord(input({ cycle: stranded })), null, 2)}\n`)
    writeFileSync(join(dir, LEDGER_PATH), `${readFileSync(join(dir, LEDGER_PATH), 'utf8')}${strandedLine}\n`)
    writeFileSync(join(dir, 'data/enterprise/roster.json'), 'stranded\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'a cycle commit that never reached the remote')
    rivalCommit(origin, 'data/enterprise/roster.json', 'rival\n')

    const { status, stdout } = run()
    expect(status, stdout).toBe(0)
    expect(stdout).toContain('the checkout holds 1 unpushed commit(s); pushing them first')
    expect(stdout).toContain('rebuilding 1 unpushed commit(s)')
    expect(git(origin, 'ls-tree', '--name-only', 'cycle-test', `${CYCLES_DIR}/${stranded}.json`)).toBe(`${CYCLES_DIR}/${stranded}.json`)
    expect(git(origin, 'show', `cycle-test:${LEDGER_PATH}`).split('\n').filter(line => line === strandedLine)).toHaveLength(1)
    // The previous cycle's own push had not delivered its record by this cycle's start.
    const newest = git(origin, 'ls-tree', '--name-only', 'cycle-test', `${CYCLES_DIR}/`).split('\n').filter(Boolean).at(-1) ?? ''
    const record = JSON.parse(git(origin, 'show', `cycle-test:${newest}`)) as CycleRecord
    expect(record.steps[0]).toMatchObject({ name: 'pull', exit: 0 })
    expect(record.previous).toEqual({ cycle: stranded, recordOnRemote: false })
  })

  it('never resets a checkout that is not a dedicated worktree', { timeout: 60_000 }, () => {
    const { origin, dir, run } = cycleHarness(false)
    writeFileSync(join(dir, 'data/enterprise/roster.json'), 'stranded\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'a cycle commit that never reached the remote')
    const stranded = git(dir, 'rev-parse', 'HEAD')
    rivalCommit(origin, 'data/enterprise/roster.json', 'rival\n')

    const { status, stdout } = run()
    expect(status).not.toBe(0)
    expect(stdout).toContain('this checkout is not a dedicated worktree, so it is not reset')
    expect(spawnSync('git', ['merge-base', '--is-ancestor', stranded, 'HEAD'], { cwd: dir }).status).toBe(0)
  })
})
