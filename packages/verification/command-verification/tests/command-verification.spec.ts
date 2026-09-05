import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { GoalId } from '@deepseek-ai/dsh-goal'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import CompletionStandardService, { CheckId } from '@deepseek-ai/dsh-verification'
import type { StandardRef } from '@deepseek-ai/dsh-verification'
import * as commandVerification from '@deepseek-ai/dsh-command-verification'
import * as invariantCompanion from '@deepseek-ai/dsh-command-verification/invariant'

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly session: Session
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

/** Build a live idle agent accepted by the exact-identity standard service. */
function stubAgent(ctx: Context, id: string): { agent: Agent; session: Session } {
  const session = ctx.sessions.create(SessionId(id))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

/** Mount the real command registry, standard domain, and producer. */
async function harness(): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CompletionStandardService)
  const plugin = await ctx.plugin(commandVerification)
  const { agent, session } = stubAgent(ctx, `command-verification-${Math.random()}`)
  ctx.agents.register(agent)
  return { ctx, agent, session, plugin }
}

/** Execute `/verification` through the same registry boundary as a UI adapter. */
async function run(test: Harness, suffix = ''): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>['result']> {
  const execution = await test.ctx.commands.execute(
    test.agent,
    `/verification${suffix}`,
    new AbortController().signal,
  )
  if (execution === undefined) throw new Error('verification command was not registered')
  return execution.result
}

const goal = GoalId('goal-ledger')

describe('@deepseek-ai/dsh-command-verification registration', () => {
  it('registers one global command with Loader-safe exports and disposes it', async () => {
    const test = await harness()
    expect(commandVerification.name).toBe('command-verification')
    expect(commandVerification.inject).toEqual(['commands', 'completionStandards'])
    expect('default' in commandVerification).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandVerification)).toBe(commandVerification)

    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'verification',
      description: 'view the completion standard, certificate, and directives for this session',
    })

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'verification')).toBeUndefined()
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})

describe('/verification human command', () => {
  it('shows the empty ledger without writing session events and rejects arguments', async () => {
    const test = await harness()
    await expect(run(test)).resolves.toEqual({
      kind: 'success',
      text: 'No completion standard is set for this session.\nUsage: /verification',
    })
    await expect(run(test, ' extra')).resolves.toEqual({
      kind: 'error',
      text: 'The verification command takes no arguments. Usage: /verification',
    })
    const bookkeeping = new Set(['command/run', 'command/done', 'turn/start', 'turn/end'])
    expect(test.session.events.filter(event => !bookkeeping.has(event.type))).toEqual([])
  })

  it('renders the whole ledger through authorship, certification, relaxation, and directives', async () => {
    const test = await harness()
    const view = test.ctx.completionStandards.author(test.agent, {
      goalId: goal,
      checks: [
        { id: CheckId('build-passes'), outcome: 'build exits zero', run: 'pnpm build' },
        { id: CheckId('tests-pass'), outcome: 'tests exit zero', run: 'pnpm test' },
      ],
    })
    const ref: StandardRef = { id: view.id, revision: view.revision }

    const uncertified = await run(test)
    expect(uncertified.kind).toBe('success')
    expect(uncertified.text).toContain('Status: not certified')
    expect(uncertified.text).toContain('Checks (2):')
    expect(uncertified.text).toContain('- build-passes: build exits zero')
    expect(uncertified.text).not.toContain('— pass:')
    expect(uncertified.text).not.toContain('Relaxed')

    test.ctx.completionStandards.recordRun(test.agent, ref, 'none', [
      { checkId: CheckId('build-passes'), status: 'pass', evidence: 'exit 0' },
      { checkId: CheckId('tests-pass'), status: 'pass', evidence: '212 passed' },
    ], { executor: 'agent-reported' })
    const certified = await run(test)
    expect(certified.text).toContain('Status: certified (isolation: none, 2 checks passed)')
    expect(certified.text).toContain('- build-passes: build exits zero — pass: exit 0')

    test.ctx.completionStandards.relax(test.agent, ref, CheckId('tests-pass'), 'unstable on wine')
    test.ctx.completionStandards.issueDirective(test.agent, { id: view.id, revision: 2 }, {
      rootCause: 'coverage gap',
      detail: 'tests relaxed pending a stable host',
    })
    const relaxed = await run(test)
    expect(relaxed).toEqual({
      kind: 'success',
      text: [
        'Completion standard',
        'Goal: goal-ledger',
        'Revision: 2',
        'Status: not certified',
        'Checks (1):',
        '- build-passes: build exits zero',
        'Relaxed (1):',
        '- tests-pass: unstable on wine',
        'Directives issued: 1',
      ].join('\n'),
    })
  })
})
