/**
 * The `verification` projection unit: mounting CompletionStandardService
 * beside the registry serves the whole current standard on the history tail
 * page; before the first authorship the value is null; a composition without
 * the verification service has no `verification` key; unmounting drops it
 * (HMR safety). Malformed verification-shaped events are ignored fail-soft
 * (same-reference return) — strict replay validation belongs to the write
 * side, never the projection drive.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { GoalId } from '@deepseek-ai/dsh-goal'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CompletionStandardService, {
  applyVerificationProjection,
  CheckId,
} from '@deepseek-ai/dsh-verification'
import type { StandardRef, VerificationProjection } from '@deepseek-ai/dsh-verification'

interface Bench {
  ctx: Context
  session: Session
  agent: Agent
  tailValues(): Record<string, unknown>
}

/** Register a minimal registry-compatible live agent over a store session. */
function liveAgent(ctx: Context, session: Session): Agent {
  const status: AgentStatus = 'idle'
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx,
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject(input: UserMessage) {
      inbox.append('next-step', input)
    },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  ctx.agents.register(agent)
  return agent
}

async function harness(withVerification: boolean) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = withVerification ? await ctx.plugin(CompletionStandardService) : undefined
  const session = ctx.sessions.create()
  const agent = liveAgent(ctx, session)
  const bench: Bench = {
    ctx,
    session,
    agent,
    tailValues: () => ctx.sessionProjections.snapshot(session).values,
  }
  return { ...bench, fiber }
}

/** One paginable message so the tail is non-degenerate. */
function seedMessage(session: Session): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

const goal = GoalId('goal-projection')

describe('verification projection unit', () => {
  it('serves null before authorship and omits the key without the service', async () => {
    const withService = await harness(true)
    seedMessage(withService.session)
    expect(withService.tailValues()).toMatchObject({ verification: null })

    const without = await harness(false)
    seedMessage(without.session)
    expect(Object.keys(without.tailValues())).not.toContain('verification')
  })

  it('tracks authorship, certification, invalidation, and directives last-wins', async () => {
    const bench = await harness(true)
    seedMessage(bench.session)
    const view = bench.ctx.completionStandards.author(bench.agent, {
      goalId: goal,
      checks: [{ id: CheckId('build-passes'), outcome: 'build exits zero', run: 'pnpm build' }],
    })
    const ref: StandardRef = { id: view.id, revision: view.revision }
    expect(bench.tailValues()['verification']).toMatchObject({
      standard: { id: view.id, revision: 1, goalId: goal },
      directivesIssued: 0,
      runsRecorded: 0,
    })

    bench.ctx.completionStandards.issueDirective(bench.agent, ref, { rootCause: 'stub', detail: 'placeholder output' })
    expect(bench.tailValues()['verification']).toMatchObject({ directivesIssued: 1 })

    bench.ctx.completionStandards.recordRun(bench.agent, ref, 'process', [
      { checkId: CheckId('build-passes'), status: 'pass', evidence: 'exit 0' },
    ], { executor: 'runner', treeHash: 'c0ffee' })
    expect(bench.tailValues()['verification']).toMatchObject({
      certificate: { standard: { id: view.id, revision: 1 }, isolation: 'process' },
      directivesIssued: 1,
      runsRecorded: 1,
    })

    bench.ctx.completionStandards.extend(bench.agent, ref, [
      { id: CheckId('tests-pass'), outcome: 'tests exit zero', run: 'pnpm test' },
    ])
    const extended = bench.tailValues()['verification'] as VerificationProjection
    expect(extended.standard.revision).toBe(2)
    expect(extended.certificate).toBeUndefined()
    expect(extended.directivesIssued).toBe(1)
    expect(extended.runsRecorded).toBe(1)

    bench.ctx.completionStandards.relax(bench.agent, { id: view.id, revision: 2 }, CheckId('tests-pass'), 'unstable host')
    const relaxed = bench.tailValues()['verification'] as VerificationProjection
    expect(relaxed.standard.revision).toBe(3)
    expect(relaxed.standard.relaxed.map(item => item.check.id)).toEqual(['tests-pass'])
    expect(relaxed.runsRecorded).toBe(1)
  })

  it('ignores malformed and mismatched verification-shaped events fail-soft', () => {
    const mismatched = (type: string) => ({ seq: 9, type, data: { kind: 'other' } }) as never
    expect(applyVerificationProjection(null, mismatched('verification/standard'))).toBeNull()
    expect(applyVerificationProjection(null, mismatched('verification/relaxation'))).toBeNull()
    expect(applyVerificationProjection(null, mismatched('verification/run'))).toBeNull()
    expect(applyVerificationProjection(null, mismatched('verification/certificate'))).toBeNull()
    expect(applyVerificationProjection(null, mismatched('verification/directive'))).toBeNull()
    const malformed = {
      seq: 9,
      type: 'verification/standard',
      data: { kind: 'verification/standard', version: 2 },
    } as never
    expect(applyVerificationProjection(null, malformed)).toBeNull()
    expect(applyVerificationProjection(null, { seq: 9, type: 'turn/start', data: { turn: 1 } } as never)).toBeNull()
  })

  it('accepts a relaxation as the first observed standard state', () => {
    const relaxation = {
      seq: 0,
      type: 'verification/relaxation',
      data: {
        kind: 'verification/relaxation',
        version: 1,
        checkId: 'b',
        standard: {
          id: 'standard-x',
          revision: 2,
          goalId: 'goal-x',
          checks: [],
          relaxed: [{ check: { id: 'b', outcome: 'outcome b', run: 'run b' }, evidence: 'unstable host' }],
        },
        createdAt: 1,
        updatedAt: 2,
      },
    } as never
    const projected = applyVerificationProjection(null, relaxation)
    expect(projected).toMatchObject({ directivesIssued: 0, runsRecorded: 0, createdAt: 1, updatedAt: 2 })
  })

  it('keeps pre-authorship runs, certificates, and directives inert', () => {
    const certificate = {
      kind: 'verification/certificate',
      version: 1,
      certificate: {
        standard: { id: 'standard-x', revision: 1 },
        goalId: 'goal-x',
        isolation: 'none',
        results: [{ checkId: 'a', status: 'pass', evidence: 'ok' }],
        recordedAt: 1,
      },
    }
    const directive = {
      kind: 'verification/directive',
      version: 1,
      standard: { id: 'standard-x', revision: 1 },
      rootCause: 'x',
      detail: 'y',
      issuedAt: 1,
    }
    const run = {
      kind: 'verification/run',
      version: 1,
      standard: { id: 'standard-x', revision: 1 },
      attempt: 1,
      isolation: 'none',
      executor: 'runner',
      results: [{ checkId: 'a', status: 'pass', evidence: 'ok' }],
      recordedAt: 1,
    }
    const certEvent = { seq: 0, type: 'verification/certificate', data: certificate } as never
    const directiveEvent = { seq: 1, type: 'verification/directive', data: directive } as never
    const runEvent = { seq: 2, type: 'verification/run', data: run } as never
    expect(applyVerificationProjection(null, certEvent)).toBeNull()
    expect(applyVerificationProjection(null, directiveEvent)).toBeNull()
    expect(applyVerificationProjection(null, runEvent)).toBeNull()
  })

  it('drops the key when the service fiber is disposed', async () => {
    const bench = await harness(true)
    seedMessage(bench.session)
    expect(bench.tailValues()).toMatchObject({ verification: null })
    await bench.fiber?.dispose()
    expect(Object.keys(bench.tailValues())).not.toContain('verification')
  })
})
