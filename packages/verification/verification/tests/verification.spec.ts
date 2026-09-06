import { afterEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import GoalService, { GoalId } from '@deepseek-ai/dsh-goal'
// Type-only: resolves the read-barrier members of the session event vocabulary.
import type {} from '@deepseek-ai/dsh-read-barrier'
import type { ReadBarrierScope } from '@deepseek-ai/dsh-read-barrier/types'
import { Session as SessionClass, SessionId } from '@deepseek-ai/dsh-session'
import CompletionStandardService, {
  CheckId,
  VerificationError,
} from '@deepseek-ai/dsh-verification'
import type { Config, RunEvidence, StandardCheck, StandardRef } from '@deepseek-ai/dsh-verification'

interface StubAgent {
  agent: Agent
  session: SessionClass
}

/** Build a registry-compatible agent around one concrete session. */
function stubAgentForSession(session: SessionClass): StubAgent {
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

async function harness(config: Config = {}) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CompletionStandardService, config)
  const stub = stubAgentForSession(SessionClass.create(SessionId(`verification-test-${Math.random()}`)))
  ctx.agents.register(stub.agent)
  return { ctx, ...stub }
}

const goal = GoalId('goal-under-test')

function check(id: string, rest: Partial<Omit<StandardCheck, 'id'>> = {}): StandardCheck {
  return {
    id: CheckId(id),
    outcome: rest.outcome ?? `outcome of ${id}`,
    run: rest.run ?? `run ${id}`,
  }
}

function passes(ids: readonly string[]) {
  return ids.map(id => ({ checkId: CheckId(id), status: 'pass' as const, evidence: `ok ${id}` }))
}

const reported: RunEvidence = { executor: 'agent-reported' }

/** A census that proves process-level isolation: implementer role, no unenforced capability, no authority. */
function proving(): ReadBarrierScope {
  return {
    version: 1,
    role: 'implementer',
    presetId: 'implementing',
    root: '/srv/verification',
    denied: ['/srv/verification'],
    census: [{ name: 'read', authority: [] }],
    enforcement: [
      { capability: 'fs', state: 'denied-at-executor' },
      { capability: 'shell', state: 'not-composed' },
    ],
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('CompletionStandardService authoring', () => {
  it('authors a revision-one standard and writes one durable event', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const { ctx, agent, session } = await harness()
    const view = ctx.completionStandards.author(agent, {
      goalId: goal,
      checks: [check('build-passes', { outcome: ' build exits zero ', run: ' pnpm build ' })],
    })
    expect(view).toMatchObject({
      revision: 1,
      goalId: goal,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      directivesIssued: 0,
    })
    expect(view.id).toMatch(/^standard-/)
    expect(view.checks[0]).toEqual({ id: 'build-passes', outcome: 'build exits zero', run: 'pnpm build' })
    expect(view.certificate).toBeUndefined()
    expect(session.events.map(event => event.type)).toEqual(['verification/standard'])
    expect(session.deriveMessages()).toEqual([])
  })

  it('rejects authoring twice for the same goal and supersedes a different goal', async () => {
    const { ctx, agent } = await harness()
    ctx.completionStandards.author(agent, { goalId: goal, checks: [check('a')] })
    expect(() => ctx.completionStandards.author(agent, { goalId: goal, checks: [check('b')] }))
      .toThrow(expect.objectContaining({ code: 'VERIFICATION_STANDARD_EXISTS' }))
    const next = ctx.completionStandards.author(agent, { goalId: GoalId('goal-two'), checks: [check('b')] })
    expect(next.revision).toBe(1)
    expect(next.goalId).toBe('goal-two')
  })

  it('validates the check inventory at the boundary', async () => {
    const { ctx, agent } = await harness()
    const author = (checks: readonly StandardCheck[]) =>
      ctx.completionStandards.author(agent, { goalId: goal, checks })
    expect(() => author([])).toThrow(expect.objectContaining({ code: 'VERIFICATION_INVALID_CHECK' }))
    expect(() => author([check('Bad_Id')])).toThrow(/lower-kebab-case/)
    expect(() => author([check('a'), check('a')])).toThrow(/already taken/)
    expect(() => author([check('a', { outcome: '   ' })])).toThrow(/outcome must be a non-empty string/)
    expect(() => author([check('a', { run: '' })])).toThrow(/run must be a non-empty string/)
  })

  it('applies the configured text and check-count bounds', async () => {
    const { ctx, agent } = await harness({ maxChecks: 2, maxTextChars: 12 })
    expect(() => ctx.completionStandards.author(agent, {
      goalId: goal,
      checks: [check('a'), check('b'), check('c')],
    })).toThrow(/cannot exceed 2 active checks/)
    expect(() => ctx.completionStandards.author(agent, {
      goalId: goal,
      checks: [check('a', { outcome: 'far too long for the cap' })],
    })).toThrow(/exceeds 12 characters/)
    const view = ctx.completionStandards.author(agent, { goalId: goal, checks: [check('a'), check('b')] })
    const ref: StandardRef = { id: view.id, revision: view.revision }
    expect(() => ctx.completionStandards.extend(agent, ref, [check('c')]))
      .toThrow(/cannot exceed 2 active checks/)
  })

  it('rejects an invalid configured bound', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await expect(ctx.plugin(CompletionStandardService, { maxChecks: 0 })).rejects.toThrow(
      /maxChecks must be a positive safe integer/,
    )
  })

  it('materializes its own defaults under direct construction', () => {
    const service = new CompletionStandardService(new Context())
    expect(service).toBeInstanceOf(CompletionStandardService)
  })

  it('keeps relaxed check ids reserved for later extensions', async () => {
    const { ctx, agent } = await harness()
    const view = ctx.completionStandards.author(agent, { goalId: goal, checks: [check('a'), check('b')] })
    ctx.completionStandards.relax(agent, { id: view.id, revision: 1 }, CheckId('b'), 'unsatisfiable on wine')
    expect(() => ctx.completionStandards.extend(agent, { id: view.id, revision: 2 }, [check('b')]))
      .toThrow(/already taken/)
    const extended = ctx.completionStandards.extend(agent, { id: view.id, revision: 2 }, [check('c')])
    expect(extended.checks.map(item => item.id)).toEqual(['a', 'c'])
    expect(extended.relaxed.map(item => item.check.id)).toEqual(['b'])
  })

  it('rejects an agent that is not the live registry instance', async () => {
    const { ctx, session } = await harness()
    const impostor = stubAgentForSession(session).agent
    expect(() => ctx.completionStandards.get(impostor))
      .toThrow(expect.objectContaining({ code: 'VERIFICATION_AGENT_NOT_LIVE' }))
  })
})

describe('CompletionStandardService lifecycle', () => {
  async function authored() {
    const built = await harness()
    const view = built.ctx.completionStandards.author(built.agent, {
      goalId: goal,
      checks: [check('build-passes'), check('tests-pass')],
    })
    return { ...built, view, ref: { id: view.id, revision: view.revision } as StandardRef }
  }

  it('returns undefined before authoring and a fresh view after', async () => {
    const { ctx, agent } = await harness()
    expect(ctx.completionStandards.get(agent)).toBeUndefined()
    expect(ctx.completionStandards.certified(agent)).toBeUndefined()
    ctx.completionStandards.author(agent, { goalId: goal, checks: [check('a')] })
    expect(ctx.completionStandards.get(agent)?.checks).toHaveLength(1)
  })

  it('extends append-only, bumps the revision, and invalidates the certificate', async () => {
    const { ctx, agent, ref } = await authored()
    const outcome = ctx.completionStandards.recordRun(agent, ref, 'none', passes(['build-passes', 'tests-pass']), reported)
    expect(outcome.certified).toBe(true)
    expect(ctx.completionStandards.certified(agent)?.standard).toEqual(ref)
    const extended = ctx.completionStandards.extend(agent, ref, [check('lint-passes')])
    expect(extended.revision).toBe(2)
    expect(extended.checks.map(item => item.id)).toEqual(['build-passes', 'tests-pass', 'lint-passes'])
    expect(extended.certificate).toBeUndefined()
    expect(ctx.completionStandards.certified(agent)).toBeUndefined()
  })

  it('rejects invalid extensions', async () => {
    const { ctx, agent, ref } = await authored()
    expect(() => ctx.completionStandards.extend(agent, ref, []))
      .toThrow(/extend requires at least one added check/)
    expect(() => ctx.completionStandards.extend(agent, ref, [check('build-passes')]))
      .toThrow(/already taken/)
    expect(() => ctx.completionStandards.extend(agent, { ...ref, revision: 9 }, [check('x')]))
      .toThrow(expect.objectContaining({ code: 'VERIFICATION_STALE_REVISION' }))
  })

  it('relaxes exactly one check with recorded evidence', async () => {
    const { ctx, agent, ref, session } = await authored()
    const relaxed = ctx.completionStandards.relax(agent, ref, CheckId('tests-pass'), ' flaky on wine only ')
    expect(relaxed.revision).toBe(2)
    expect(relaxed.checks.map(item => item.id)).toEqual(['build-passes'])
    expect(relaxed.relaxed.map(item => ({ id: item.check.id, evidence: item.evidence })))
      .toEqual([{ id: 'tests-pass', evidence: 'flaky on wine only' }])
    expect(session.events.map(event => event.type)).toEqual(['verification/standard', 'verification/relaxation'])
    expect(() => ctx.completionStandards.relax(agent, { id: ref.id, revision: 2 }, CheckId('missing'), 'why'))
      .toThrow(expect.objectContaining({ code: 'VERIFICATION_INVALID_RELAXATION' }))
    expect(() => ctx.completionStandards.relax(agent, { id: ref.id, revision: 2 }, CheckId('build-passes'), '  '))
      .toThrow(/evidence must be a non-empty string/)
  })

  it('requires a current standard before revision-fenced verbs', async () => {
    const { ctx, agent } = await harness()
    const ref: StandardRef = { id: 'standard-none' as StandardRef['id'], revision: 1 }
    expect(() => ctx.completionStandards.extend(agent, ref, [check('a')]))
      .toThrow(expect.objectContaining({ code: 'VERIFICATION_STANDARD_NOT_FOUND' }))
  })
})

describe('CompletionStandardService runs, certificates, and directives', () => {
  async function authored() {
    const built = await harness()
    const view = built.ctx.completionStandards.author(built.agent, {
      goalId: goal,
      checks: [check('build-passes'), check('tests-pass')],
    })
    return { ...built, ref: { id: view.id, revision: view.revision } as StandardRef }
  }

  it('validates the result set exactly', async () => {
    const { ctx, agent, ref } = await authored()
    const run = (results: Parameters<typeof ctx.completionStandards.recordRun>[3]) =>
      ctx.completionStandards.recordRun(agent, ref, 'none', results, reported)
    expect(() => run([...passes(['build-passes']), ...passes(['build-passes'])]))
      .toThrow(/duplicate result/)
    expect(() => run([{ checkId: CheckId('build-passes'), status: 'pass', evidence: ' ' }]))
      .toThrow(/must be a non-empty string/)
    expect(() => run(passes(['build-passes'])))
      .toThrow(/missing a result for check "tests-pass"/)
    expect(() => run(passes(['build-passes', 'tests-pass', 'other'])))
      .toThrow(/unknown check\(s\) "other"/)
  })

  it('records the failing run durably and returns the failing subset', async () => {
    const { ctx, agent, ref, session } = await authored()
    const outcome = ctx.completionStandards.recordRun(agent, ref, 'none', [
      { checkId: CheckId('tests-pass'), status: 'fail', evidence: '3 assertions failed' },
      ...passes(['build-passes']),
    ], reported)
    expect(outcome).toEqual({
      certified: false,
      failures: [{ checkId: 'tests-pass', status: 'fail', evidence: '3 assertions failed' }],
    })
    expect(session.events.map(event => event.type)).toEqual(['verification/standard', 'verification/run'])
    expect(session.events[1]?.data).toMatchObject({
      kind: 'verification/run',
      version: 1,
      standard: ref,
      attempt: 1,
      isolation: 'none',
      executor: 'agent-reported',
      results: [
        { checkId: 'build-passes', status: 'pass', evidence: 'ok build-passes' },
        { checkId: 'tests-pass', status: 'fail', evidence: '3 assertions failed' },
      ],
    })
    expect(session.events[1]?.data).not.toHaveProperty('treeHash')
    expect(ctx.completionStandards.get(agent)?.runsRecorded).toBe(1)
  })

  it('numbers attempts per standard id across revisions and restarts them for a new standard', async () => {
    const { ctx, agent, ref, session } = await authored()
    const failing = [{ checkId: CheckId('tests-pass'), status: 'fail' as const, evidence: 'red' }, ...passes(['build-passes'])]
    ctx.completionStandards.recordRun(agent, ref, 'none', failing, reported)
    ctx.completionStandards.recordRun(agent, ref, 'none', failing, reported)
    ctx.completionStandards.relax(agent, ref, CheckId('tests-pass'), 'unsatisfiable on wine')
    ctx.completionStandards.recordRun(agent, { id: ref.id, revision: 2 }, 'none', passes(['build-passes']), reported)
    const runs = session.events.filter(event => event.type === 'verification/run')
    expect(runs.map(event => (event.data as { attempt: number }).attempt)).toEqual([1, 2, 3])
    expect(ctx.completionStandards.get(agent)?.runsRecorded).toBe(3)

    const next = ctx.completionStandards.author(agent, { goalId: GoalId('goal-two'), checks: [check('a')] })
    ctx.completionStandards.recordRun(agent, { id: next.id, revision: 1 }, 'none', passes(['a']), reported)
    const attempts = session.events
      .filter(event => event.type === 'verification/run')
      .map(event => (event.data as { attempt: number }).attempt)
    expect(attempts).toEqual([1, 2, 3, 1])
    expect(ctx.completionStandards.get(agent)?.runsRecorded).toBe(4)
  })

  it('commits a certificate in check order for a fully passing run', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const { ctx, agent, ref, session } = await authored()
    vi.setSystemTime(1_600_000_000_000)
    const outcome = ctx.completionStandards.recordRun(agent, ref, 'none', [
      ...passes(['tests-pass']),
      ...passes(['build-passes']),
    ], { executor: 'runner', treeHash: 'beef01' })
    expect(outcome.certified).toBe(true)
    if (!outcome.certified) throw new Error('expected a certificate')
    expect(outcome.certificate.results.map(result => result.checkId)).toEqual(['build-passes', 'tests-pass'])
    expect(outcome.certificate.isolation).toBe('none')
    expect(outcome.certificate.recordedAt).toBe(1_700_000_000_000)
    expect(session.events.map(event => event.type))
      .toEqual(['verification/standard', 'verification/run', 'verification/certificate'])
    expect(session.events[1]?.data).toMatchObject({ executor: 'runner', treeHash: 'beef01', recordedAt: 1_700_000_000_000 })
    expect(ctx.completionStandards.get(agent)?.certificate).toEqual(outcome.certificate)
    expect(ctx.completionStandards.get(agent)?.runsRecorded).toBe(1)
  })

  it('records a tampered run and refuses its certificate however the results came out', async () => {
    const { ctx, agent, ref, session } = await authored()
    const outcome = ctx.completionStandards.recordRun(agent, ref, 'none', passes(['build-passes', 'tests-pass']), {
      executor: 'runner',
      treeHash: 'beef02',
      tampered: true,
    })
    expect(outcome).toEqual({ certified: false, failures: [] })
    expect(session.events.map(event => event.type)).toEqual(['verification/standard', 'verification/run'])
    expect(session.events[1]?.data).toMatchObject({ verdict: 'tampered', executor: 'runner', treeHash: 'beef02' })
    expect(ctx.completionStandards.certified(agent)).toBeUndefined()
  })

  it('records the verdict its results decide when nothing was tampered with', async () => {
    const { ctx, agent, ref, session } = await authored()
    ctx.completionStandards.recordRun(agent, ref, 'none', [
      { checkId: CheckId('tests-pass'), status: 'fail', evidence: 'red' },
      ...passes(['build-passes']),
    ], reported)
    ctx.completionStandards.recordRun(agent, ref, 'none', passes(['build-passes', 'tests-pass']), { ...reported, tampered: false })
    expect(session.events.filter(event => event.type === 'verification/run')
      .map(event => (event.data as { verdict: string }).verdict)).toEqual(['failed', 'passed'])
  })

  it('refuses an unproven isolation claim before anything is logged', async () => {
    const { ctx, agent, ref, session } = await authored()
    const before = session.seq
    expect(() => ctx.completionStandards.recordRun(agent, ref, 'process', passes(['build-passes', 'tests-pass']), { executor: 'runner' }))
      .toThrow(expect.objectContaining({
        code: 'VERIFICATION_ISOLATION_UNPROVEN',
        message: 'run cannot claim "process" isolation: no read-barrier/scope records what this session composed',
      }))
    expect(() => ctx.completionStandards.recordRun(agent, ref, 'host', passes(['build-passes', 'tests-pass']), { executor: 'runner' }))
      .toThrow(expect.objectContaining({ code: 'VERIFICATION_ISOLATION_UNPROVEN' }))
    // The run event carries the claim too, so the refusal precedes every append.
    expect(session.seq).toBe(before)
    expect(ctx.completionStandards.get(agent)?.runsRecorded).toBe(0)
  })

  it('refuses an agent-reported run above "none" and certifies it at "none"', async () => {
    const { ctx, agent, ref, session } = await authored()
    session.append('read-barrier/scope', proving())
    expect(() => ctx.completionStandards.recordRun(agent, ref, 'process', passes(['build-passes', 'tests-pass']), reported))
      .toThrow(expect.objectContaining({
        code: 'VERIFICATION_ISOLATION_UNPROVEN',
        message: 'run cannot claim "process" isolation: the run was agent-reported, so no validator executed its checks',
      }))
    const outcome = ctx.completionStandards.recordRun(agent, ref, 'none', passes(['build-passes', 'tests-pass']), reported)
    expect(outcome.certified).toBe(true)
    if (!outcome.certified) throw new Error('expected a certificate')
    expect(outcome.certificate.executor).toBe('agent-reported')
  })

  it('certifies "process" once the census proves every composed capability denies', async () => {
    const { ctx, agent, ref, session } = await authored()
    session.append('read-barrier/scope', proving())
    const outcome = ctx.completionStandards.recordRun(
      agent, ref, 'process', passes(['build-passes', 'tests-pass']), { executor: 'runner' },
    )
    expect(outcome.certified).toBe(true)
    if (!outcome.certified) throw new Error('expected a certificate')
    expect(outcome.certificate).toMatchObject({ isolation: 'process', executor: 'runner' })
  })

  it('records directives and counts them on the view', async () => {
    const { ctx, agent, ref, session } = await authored()
    expect(() => { ctx.completionStandards.issueDirective(agent, ref, { rootCause: ' ', detail: 'x' }) })
      .toThrow(expect.objectContaining({ code: 'VERIFICATION_INVALID_DIRECTIVE' }))
    expect(() => { ctx.completionStandards.issueDirective(agent, ref, { rootCause: 'x', detail: '' }) })
      .toThrow(expect.objectContaining({ code: 'VERIFICATION_INVALID_DIRECTIVE' }))
    ctx.completionStandards.issueDirective(agent, ref, {
      rootCause: 'stub frontier',
      detail: 'raster verbs return placeholder output',
    })
    expect(ctx.completionStandards.get(agent)?.directivesIssued).toBe(1)
    expect(session.events.at(-1)?.type).toBe('verification/directive')
  })

  it('admits completion only with a covering certificate', async () => {
    const { ctx, agent, ref } = await authored()
    expect(() => ctx.completionStandards.assertCertified(agent, GoalId('other-goal')))
      .toThrow(expect.objectContaining({ code: 'VERIFICATION_STANDARD_NOT_FOUND' }))
    expect(() => ctx.completionStandards.assertCertified(agent, goal))
      .toThrow(expect.objectContaining({ code: 'VERIFICATION_NOT_CERTIFIED' }))
    ctx.completionStandards.recordRun(agent, ref, 'none', passes(['build-passes', 'tests-pass']), reported)
    expect(ctx.completionStandards.assertCertified(agent, goal).standard).toEqual(ref)
  })

  it('throws the domain error type', async () => {
    const { ctx, agent } = await harness()
    try {
      ctx.completionStandards.assertCertified(agent, goal)
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(VerificationError)
    }
  })
})

describe('CompletionStandardService replay', () => {
  it('seeds a fresh service from the durable log and syncs external appends', async () => {
    const first = await harness()
    const view = first.ctx.completionStandards.author(first.agent, { goalId: goal, checks: [check('a')] })
    const ref: StandardRef = { id: view.id, revision: view.revision }
    first.ctx.completionStandards.recordRun(first.agent, ref, 'none', passes(['a']), reported)

    const second = new Context()
    await second.plugin(AgentRegistry)
    await second.plugin(CompletionStandardService)
    const stub = stubAgentForSession(first.session)
    second.agents.register(stub.agent)
    const replayed = second.completionStandards.get(stub.agent)
    expect(replayed?.certificate?.standard).toEqual(ref)

    first.ctx.completionStandards.extend(first.agent, ref, [check('b')])
    expect(second.completionStandards.get(stub.agent)?.revision).toBe(2)
    expect(second.completionStandards.certified(stub.agent)).toBeUndefined()
  })
})

describe('CompletionStandardService certificate-gated goal completion', () => {
  async function composed() {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(GoalService)
    const fiber = await ctx.plugin(CompletionStandardService)
    const stub = stubAgentForSession(SessionClass.create(SessionId(`verification-admission-${Math.random()}`)))
    ctx.agents.register(stub.agent)
    return { ctx, fiber, ...stub }
  }

  it('rejects completing a measured goal without a covering certificate and admits it after one', async () => {
    const { ctx, agent } = await composed()
    const created = ctx.goals.create(agent, { objective: 'ship verified work' })
    const view = ctx.completionStandards.author(agent, { goalId: created.id, checks: [check('build-passes')] })
    expect(() => ctx.goals.complete(agent, { id: created.id, revision: created.revision }))
      .toThrow(expect.objectContaining({ code: 'VERIFICATION_NOT_CERTIFIED' }))
    expect(ctx.goals.get(agent)?.phase).toBe('active')
    ctx.completionStandards.recordRun(agent, { id: view.id, revision: view.revision }, 'none', passes(['build-passes']), reported)
    const completed = ctx.goals.complete(agent, { id: created.id, revision: created.revision })
    expect(completed.phase).toBe('complete')
  })

  it('re-arms the gate when a mutation invalidates the certificate', async () => {
    const { ctx, agent } = await composed()
    const created = ctx.goals.create(agent, { objective: 'ship verified work' })
    const view = ctx.completionStandards.author(agent, { goalId: created.id, checks: [check('build-passes')] })
    ctx.completionStandards.recordRun(agent, { id: view.id, revision: 1 }, 'none', passes(['build-passes']), reported)
    ctx.completionStandards.extend(agent, { id: view.id, revision: 1 }, [check('tests-pass')])
    expect(() => ctx.goals.complete(agent, { id: created.id, revision: created.revision }))
      .toThrow(expect.objectContaining({ code: 'VERIFICATION_NOT_CERTIFIED' }))
  })

  it('never blocks unmeasured goals or goals measured by another standard', async () => {
    const { ctx, agent } = await composed()
    const first = ctx.goals.create(agent, { objective: 'unmeasured work' })
    expect(ctx.goals.complete(agent, { id: first.id, revision: first.revision }).phase).toBe('complete')
    const second = ctx.goals.create(agent, { objective: 'second work' })
    ctx.completionStandards.author(agent, { goalId: GoalId('goal-elsewhere'), checks: [check('a')] })
    expect(ctx.goals.complete(agent, { id: second.id, revision: second.revision }).phase).toBe('complete')
  })

  it('removes the guard when the service fiber is disposed', async () => {
    const { ctx, agent, fiber } = await composed()
    const created = ctx.goals.create(agent, { objective: 'ship verified work' })
    ctx.completionStandards.author(agent, { goalId: created.id, checks: [check('build-passes')] })
    await fiber.dispose()
    expect(ctx.goals.complete(agent, { id: created.id, revision: created.revision }).phase).toBe('complete')
  })
})
