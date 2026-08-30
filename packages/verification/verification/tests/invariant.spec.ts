import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalSnapshotChangeMeta } from '@deepseek-ai/dsh-goal'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { CheckId, StandardId, VERIFICATION_CHANGE_VERSION } from '@deepseek-ai/dsh-verification'
import type { CertificateChangeMeta, StandardChangeMeta } from '@deepseek-ai/dsh-verification'
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

function certified(): CertificateChangeMeta {
  return {
    kind: 'verification/certificate',
    version: VERIFICATION_CHANGE_VERSION,
    certificate: {
      standard: { id: StandardId('standard-invariant'), revision: 1 },
      goalId,
      isolation: 'process',
      results: [{ checkId: CheckId('build-passes'), status: 'pass', evidence: 'exit 0' }],
      recordedAt: 6,
    },
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
    session.append('verification/certificate', certified())
    expect(() => {
      session.append('goal/change', goalChange('complete', 2))
    }).not.toThrow()
  })
})
