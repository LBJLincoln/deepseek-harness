import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalSnapshotChangeMeta } from '@deepseek-ai/dsh-goal'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
// Type-only: resolves the read-barrier members of the session event vocabulary.
import type {} from '@deepseek-ai/dsh-read-barrier'
import type { ReadBarrierScope } from '@deepseek-ai/dsh-read-barrier/types'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { CheckCaseId, CheckId, StandardId, VERIFICATION_CHANGE_VERSION } from '@deepseek-ai/dsh-verification'
import type {
  CertificateChangeMeta,
  CheckResult,
  StandardChangeMeta,
  StandardCheck,
  VerificationRunChangeMeta,
} from '@deepseek-ai/dsh-verification'
import * as VerificationInvariantCompanion from '@deepseek-ai/dsh-verification/invariant'

const goalId = GoalId('goal-invariant')

function goalChange(operation: 'create' | 'complete', revision: number): GoalSnapshotChangeMeta {
  return {
    kind: 'goal/change',
    version: 1,
    operation,
    goal: {
      id: goalId,
      revision,
      objective: 'ship the feature',
      phase: operation === 'create' ? 'active' : 'complete',
      maxGoalRounds: 4,
    },
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: operation === 'create' ? 1 : 2,
  }
}

function authored(goal = goalId): StandardChangeMeta {
  return {
    kind: 'verification/standard',
    version: VERIFICATION_CHANGE_VERSION,
    operation: 'author',
    standard: {
      id: StandardId('standard-invariant'),
      revision: 1,
      goalId: goal,
      checks: [{ id: CheckId('build-passes'), outcome: 'build exits zero', run: 'pnpm build' }],
      relaxed: [],
    },
    createdAt: 5,
    updatedAt: 5,
  }
}

function executed(status: 'pass' | 'fail' = 'pass', attempt = 1): VerificationRunChangeMeta {
  return {
    kind: 'verification/run',
    version: VERIFICATION_CHANGE_VERSION,
    standard: { id: StandardId('standard-invariant'), revision: 1 },
    attempt,
    isolation: 'none',
    executor: 'runner',
    verdict: status === 'pass' ? 'passed' : 'failed',
    results: [{ checkId: CheckId('build-passes'), status, evidence: `exit ${status === 'pass' ? 0 : 1}` }],
    recordedAt: 6,
  }
}

const CASES_REF = { count: 2, weightTotal: 3, sha256: 'a'.repeat(64) }

/** The same standard with its one check carrying two weighted cases. */
function casedStandard(): StandardChangeMeta {
  const base = authored()
  return {
    ...base,
    standard: { ...base.standard, checks: [{ ...base.standard.checks[0] as StandardCheck, cases: CASES_REF }] },
  }
}

/** One run of the cased standard, with `weightPassed` of the check's three weight units passing. */
function casedRun(weightPassed: number, weightTotal: number): VerificationRunChangeMeta {
  const passed = weightPassed === weightTotal ? 2 : 1
  return {
    ...executed(passed === 2 ? 'pass' : 'fail'),
    results: [{
      checkId: CheckId('build-passes'),
      status: passed === 2 ? 'pass' : 'fail',
      evidence: `cases: ${passed} of 2 passed`,
      cases: {
        passed,
        total: 2,
        weightPassed,
        weightTotal: 3,
        failed: passed === 2 ? [] : [{ id: CheckCaseId('sample-1'), weight: 2, channels: ['stdout'], exitClass: 'zero' }],
      },
    }],
    parity: { weightPassed, weightTotal },
  }
}

function certified(inner: Partial<CertificateChangeMeta['certificate']> = {}): CertificateChangeMeta {
  return {
    kind: 'verification/certificate',
    version: VERIFICATION_CHANGE_VERSION,
    certificate: {
      standard: { id: StandardId('standard-invariant'), revision: 1 },
      goalId,
      isolation: 'none',
      executor: 'runner',
      results: [{ checkId: CheckId('build-passes'), status: 'pass', evidence: 'exit 0' }],
      recordedAt: 6,
      ...inner,
    },
  }
}

/** A census that proves process-level isolation, as the barrier appends it before the first request. */
function proving(overrides: Partial<ReadBarrierScope> = {}): ReadBarrierScope {
  return {
    version: 1,
    role: 'implementer',
    presetId: 'implementing',
    root: '/srv/verification',
    denied: ['/srv/verification'],
    census: [{ name: 'read', authority: [] }],
    enforcement: [{ capability: 'fs', state: 'denied-at-executor' }],
    ...overrides,
  }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(VerificationInvariantCompanion)
  return ctx
}

describe('verification stream invariants', () => {
  it('accepts a certified completion and rejects malformed verification changes', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('verification-invariant-valid'))
    expect(() => {
      session.append('verification/standard', { ...authored(), extra: true } as never)
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-verification',
    }))
    expect(session.seq).toBe(0)
    session.append('goal/change', goalChange('create', 1))
    session.append('verification/standard', authored())
    session.append('verification/run', executed())
    session.append('verification/certificate', certified())
    expect(() => {
      session.append('goal/change', goalChange('complete', 2))
    }).not.toThrow()
  })

  it('rejects completing a measured goal without a covering certificate', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('verification-invariant-uncertified'))
    session.append('goal/change', goalChange('create', 1))
    session.append('verification/standard', authored())
    expect(() => {
      session.append('goal/change', goalChange('complete', 2))
    }).toThrow(/completes goal "goal-invariant" while standard "standard-invariant" revision 1 has no covering certificate/)
    session.append('verification/run', executed())
    session.append('verification/certificate', certified())
    expect(() => {
      session.append('goal/change', goalChange('complete', 2))
    }).not.toThrow()
  })

  it('ignores completions of unmeasured goals and non-complete goal operations', async () => {
    const ctx = await setup()
    const bare = ctx.sessions.create(SessionId('verification-invariant-unmeasured'))
    bare.append('goal/change', goalChange('create', 1))
    expect(() => {
      bare.append('goal/change', goalChange('complete', 2))
    }).not.toThrow()

    const other = ctx.sessions.create(SessionId('verification-invariant-other-goal'))
    other.append('verification/standard', authored(GoalId('goal-elsewhere')))
    expect(() => {
      other.append('goal/change', goalChange('complete', 2))
    }).not.toThrow()
  })

  it('rejects a certificate that no fully passing run preceded', async () => {
    const ctx = await setup()
    const unexecuted = ctx.sessions.create(SessionId('verification-invariant-unexecuted'))
    unexecuted.append('verification/standard', authored())
    expect(() => {
      unexecuted.append('verification/certificate', certified())
    }).toThrow(/certifies standard "standard-invariant" revision 1 without a preceding fully passing verification\/run/)

    const failed = ctx.sessions.create(SessionId('verification-invariant-failed-run'))
    failed.append('verification/standard', authored())
    failed.append('verification/run', executed('fail'))
    expect(() => {
      failed.append('verification/certificate', certified())
    }).toThrow(/without a preceding fully passing verification\/run/)
    failed.append('verification/run', executed('pass', 2))
    expect(() => {
      failed.append('verification/certificate', certified())
    }).not.toThrow()
  })

  it('rejects a certificate over a tampered run whose results all passed', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('verification-invariant-tampered'))
    session.append('verification/standard', authored())
    session.append('verification/run', { ...executed(), verdict: 'tampered' })
    expect(() => {
      session.append('verification/certificate', certified())
    }).toThrow(/certifies standard "standard-invariant" revision 1 over a verification\/run whose verdict is "tampered"/)
  })

  it('rejects a run whose parity outruns its weight, a tally its reference denies, and a certificate over a failing case', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('verification-invariant-cases'))
    session.append('verification/standard', casedStandard())
    const reject = (run: VerificationRunChangeMeta, message: RegExp) => {
      expect(() => session.append('verification/run', run)).toThrow(message)
      expect(session.seq).toBe(1)
    }
    reject(
      { ...casedRun(1, 3), parity: { weightPassed: 9, weightTotal: 3 } },
      /run\.parity\.weightPassed cannot exceed weightTotal/,
    )
    const wrongTally = casedRun(3, 3)
    reject(
      {
        ...wrongTally,
        results: [{
          ...wrongTally.results[0] as CheckResult,
          cases: { passed: 5, total: 5, weightPassed: 6, weightTotal: 6, failed: [] },
        }],
        parity: { weightPassed: 6, weightTotal: 6 },
      },
      /case tally of check "build-passes" disagrees with its cases reference/,
    )
    session.append('verification/run', casedRun(1, 3))
    expect(() => {
      session.append('verification/certificate', certified({
        results: [{ checkId: CheckId('build-passes'), status: 'pass', evidence: 'cases: 1 of 2 passed' }],
      }))
    }).toThrow(/without a preceding fully passing verification\/run/)
  })

  it('rejects a certificate whose executor differs from the run it cites', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('verification-invariant-executor'))
    session.append('verification/standard', authored())
    session.append('verification/run', executed())
    expect(() => {
      session.append('verification/certificate', certified({ executor: 'agent-reported' }))
    }).toThrow(/certifies executor "agent-reported" while the run it cites recorded "runner"/)
  })

  it('rejects a certificate claiming isolation the session does not prove', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('verification-invariant-unproven'))
    session.append('verification/standard', authored())
    session.append('verification/run', executed())
    expect(() => {
      session.append('verification/certificate', certified({ isolation: 'process' }))
    }).toThrow(/certifies "process" isolation the session does not prove: no read-barrier\/scope records what this session composed/)
    expect(() => {
      session.append('verification/certificate', certified({ isolation: 'host' }))
    }).toThrow(/certifies "host" isolation the session does not prove/)
  })

  it('rejects an agent-reported certificate above "none" and accepts the census-proved one', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('verification-invariant-proved'))
    session.append('read-barrier/scope', proving())
    session.append('verification/standard', authored())
    session.append('verification/run', { ...executed(), isolation: 'process', executor: 'agent-reported' })
    expect(() => {
      session.append('verification/certificate', certified({ isolation: 'process', executor: 'agent-reported' }))
    }).toThrow(/certifies "process" isolation the session does not prove: the run was agent-reported/)

    const proved = ctx.sessions.create(SessionId('verification-invariant-runner'))
    proved.append('read-barrier/scope', proving())
    proved.append('verification/standard', authored())
    proved.append('verification/run', { ...executed(), isolation: 'process' })
    expect(() => {
      proved.append('verification/certificate', certified({ isolation: 'process' }))
    }).not.toThrow()
  })

  it('rejects a certificate whose census composed an authority-bearing tool, even at "none"', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('verification-invariant-authority'))
    session.append('read-barrier/scope', proving({ census: [{ name: 'session_search', authority: ['session-log'] }] }))
    session.append('verification/standard', authored())
    session.append('verification/run', executed())
    expect(() => {
      session.append('verification/certificate', certified())
    }).toThrow(
      /certifies "none" isolation the session does not prove: the session composed "session_search",/,
    )
  })

  it('leaves a malformed certificate to the strict fold', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('verification-invariant-malformed-certificate'))
    session.append('verification/standard', authored())
    expect(() => {
      session.append('verification/certificate', { ...certified(), extra: true } as never)
    }).toThrow(/violates the durable verification stream: verification change certificate must have exactly/)
  })

  it('leaves malformed goal changes to the goal companion', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('verification-invariant-malformed-goal'))
    session.append('verification/standard', authored())
    expect(() => {
      session.append('goal/change', { ...goalChange('complete', 2), extra: true } as never)
    }).not.toThrow()
  })

  it('reconstructs an existing durable stream before checking later events', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('verification-invariant-late-load'))
    session.append('verification/standard', authored())

    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(VerificationInvariantCompanion)
    expect(() => {
      session.append('goal/change', goalChange('complete', 2))
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-verification',
    }))
    session.append('verification/run', executed())
    session.append('verification/certificate', certified())
    expect(() => {
      session.append('goal/change', goalChange('complete', 2))
    }).not.toThrow()
  })
})
