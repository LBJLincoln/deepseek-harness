/**
 * Unit + real-load-path coverage for @deepseek-ai/dsh-budget-policy. The
 * enforcement cases dispatch the real `agent/pre-step` waterfall over a
 * hand-built agent so the durable consequences — the breach event, the blocked
 * goal, and the rejected step — are observed exactly as the loop would produce
 * them.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { agentEvents, Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import GoalService, { decodeGoalChange } from '@deepseek-ai/dsh-goal'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as budgetPolicy from '@deepseek-ai/dsh-budget-policy'
import { BUDGET_EXHAUSTED, foldBudgetSpend, measuredFor } from '@deepseek-ai/dsh-budget-policy'
import type { BudgetRoutePricing, BudgetSpend } from '@deepseek-ai/dsh-budget-policy'

const PRICING: Record<string, BudgetRoutePricing> = {
  'cli-mock/cli-mock': { inputEurPerMillionTokens: 1_000_000, outputEurPerMillionTokens: 2_000_000 },
}

/** Build a registry-compatible agent around one concrete session. */
function stubAgent(session: Session): Agent {
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
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
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Append one balanced turn whose single step reports `usage` on its assistant message. */
function appendPricedStep(session: Session, turn: number, usage: TokenUsage): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: `step ${turn}` }],
      source: { provider: 'cli-mock', model: 'cli-mock' },
    }),
    usage,
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/** Mount the registry, the goal domain, and the policy over one live agent. */
async function harness(config: budgetPolicy.Config = {}, options: { goals?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  if (options.goals !== false) await ctx.plugin(GoalService)
  const session = Session.create(SessionId(`budget-${Math.random()}`))
  const agent = stubAgent(session)
  ctx.agents.register(agent)
  const fiber = await ctx.plugin(budgetPolicy, config)
  return { ctx, agent, session, fiber }
}

/** Dispatch one proposed step through the real waterfall with a plain enter default. */
function preStep(ctx: Context, agent: Agent, step = 1): Promise<PreStepDecision> {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step, signal: new AbortController().signal },
    (): Promise<PreStepDecision> => Promise.resolve({ kind: 'enter', messages: [] }),
  )
}

/** The breach events a session recorded, in log order. */
function breaches(session: Session): SessionEvent<'budget/breach'>[] {
  return session.events.filter(event => event.type === 'budget/breach')
}

describe('foldBudgetSpend', () => {
  it('reports zero spend and zero elapsed time for an empty log', () => {
    expect(foldBudgetSpend([], PRICING)).toEqual<BudgetSpend>({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      wallMs: 0,
      costEur: 0,
    })
  })

  it('bills cache reads and writes as input and prices the message route', () => {
    const session = Session.create(SessionId('fold-priced'))
    appendPricedStep(session, 1, { inputTokens: 3, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 4 })
    const spend = foldBudgetSpend(session.events, PRICING)
    expect(spend).toMatchObject({ inputTokens: 9, outputTokens: 5, totalTokens: 14 })
    // 9 input at 1 EUR/token plus 5 output at 2 EUR/token under the test table.
    expect(spend.costEur).toBeCloseTo(19, 10)
  })

  it('counts tokens but no cost for a route missing from the pricing table', () => {
    const session = Session.create(SessionId('fold-unpriced'))
    appendPricedStep(session, 1, { inputTokens: 7, outputTokens: 11 })
    const spend = foldBudgetSpend(session.events, {})
    expect(spend).toMatchObject({ inputTokens: 7, outputTokens: 11, totalTokens: 18, costEur: 0 })
  })

  it('ignores an assistant message that carried no provider accounting', () => {
    const session = Session.create(SessionId('fold-usageless'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'no accounting' }],
        source: { provider: 'cli-mock', model: 'cli-mock' },
      }),
    }, { surfaceOp: 'append' })
    expect(foldBudgetSpend(session.events, PRICING)).toMatchObject({ totalTokens: 0, costEur: 0 })
  })

  it('spans the first and last event times, including idle gaps between them', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1_000, data: { turn: 1 } },
      { type: 'turn/end', seq: 1, time: 4_500, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    expect(foldBudgetSpend(events, {}).wallMs).toBe(3_500)
  })
})

describe('measuredFor', () => {
  it('reads the value each cap is measured against', () => {
    const spend: BudgetSpend = {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      wallMs: 4,
      costEur: 5,
    }
    expect(measuredFor(spend, 'maxInputTokens')).toBe(1)
    expect(measuredFor(spend, 'maxOutputTokens')).toBe(2)
    expect(measuredFor(spend, 'maxTotalTokens')).toBe(3)
    expect(measuredFor(spend, 'maxWallMs')).toBe(4)
    expect(measuredFor(spend, 'maxCostEur')).toBe(5)
  })
})

describe('budget-policy configuration', () => {
  it('accepts an empty configuration and never reads the session log', async () => {
    const { ctx, agent, session } = await harness()
    appendPricedStep(session, 1, { inputTokens: 500, outputTokens: 500 })
    await expect(preStep(ctx, agent)).resolves.toEqual({ kind: 'enter', messages: [] })
    expect(breaches(session)).toHaveLength(0)
  })

  it('rejects a cap that cannot express a ceiling', async () => {
    await expect(harness({ maxTotalTokens: Number.NaN })).rejects.toThrow(
      'budget-policy: maxTotalTokens must be a finite non-negative number, got NaN',
    )
    await expect(harness({ maxWallMs: -1 })).rejects.toThrow(
      'budget-policy: maxWallMs must be a finite non-negative number, got -1',
    )
  })

  it('rejects a pricing rate that cannot price a route', async () => {
    await expect(harness({
      pricing: { 'cli-mock/cli-mock': { inputEurPerMillionTokens: -1, outputEurPerMillionTokens: 1 } },
    })).rejects.toThrow(
      'budget-policy: pricing["cli-mock/cli-mock"].inputEurPerMillionTokens must be a finite non-negative number, got -1',
    )
    await expect(harness({
      pricing: { 'cli-mock/cli-mock': { inputEurPerMillionTokens: 1, outputEurPerMillionTokens: Number.POSITIVE_INFINITY } },
    })).rejects.toThrow(
      'budget-policy: pricing["cli-mock/cli-mock"].outputEurPerMillionTokens must be a finite non-negative number, got Infinity',
    )
  })

  it('rejects a cost cap with no priced route', async () => {
    await expect(harness({ maxCostEur: 5 })).rejects.toThrow(
      'budget-policy: maxCostEur needs a non-empty pricing table; an unpriced route has no cost cap',
    )
  })
})

describe('budget-policy enforcement', () => {
  it('delegates while every configured cap holds', async () => {
    const { ctx, agent, session } = await harness({ maxTotalTokens: 100, maxWallMs: 10_000_000 })
    appendPricedStep(session, 1, { inputTokens: 4, outputTokens: 6 })
    await expect(preStep(ctx, agent, 2)).resolves.toEqual({ kind: 'enter', messages: [] })
    expect(breaches(session)).toHaveLength(0)
  })

  it('records the first cap in evaluation order, blocks the goal, and rejects the step', async () => {
    const { ctx, agent, session } = await harness({ maxInputTokens: 2, maxOutputTokens: 1 })
    const goal = ctx.goals.create(agent, { objective: 'spend the budget', maxGoalRounds: 5 })
    appendPricedStep(session, 1, { inputTokens: 3, outputTokens: 5 })

    await expect(preStep(ctx, agent, 2)).resolves.toEqual({ kind: 'reject' })

    const [breach] = breaches(session)
    expect(breach?.data).toEqual({ cap: 'maxInputTokens', measured: 3, limit: 2 })
    const blocked = ctx.goals.get(agent)
    expect(blocked).toMatchObject({
      id: goal.id,
      phase: 'blocked',
      activation: 'disarmed',
      blockedReason: {
        code: BUDGET_EXHAUSTED,
        message: 'Session budget maxInputTokens exceeded: 3 of 2.',
      },
    })
    // The breach explains the block, so it is durable first.
    const change = session.events.findIndex(event => event.type === 'goal/change'
      && decodeGoalChange(event.data)?.operation === 'block')
    expect(breach?.seq).toBeLessThan(change)
  })

  it('stops an unpriced-route session on tokens while its cost stays uncapped', async () => {
    const { ctx, agent, session } = await harness({ maxOutputTokens: 1, maxCostEur: 1, pricing: PRICING })
    appendPricedStep(session, 1, {
      inputTokens: 0,
      outputTokens: 4,
    })
    await expect(preStep(ctx, agent, 2)).resolves.toEqual({ kind: 'reject' })
    expect(breaches(session)[0]?.data).toEqual({ cap: 'maxOutputTokens', measured: 4, limit: 1 })
  })

  it('trips the cost cap once priced usage exceeds it', async () => {
    const { ctx, agent, session } = await harness({ maxCostEur: 10, pricing: PRICING })
    appendPricedStep(session, 1, { inputTokens: 6, outputTokens: 3 })
    await expect(preStep(ctx, agent, 2)).resolves.toEqual({ kind: 'reject' })
    expect(breaches(session)[0]?.data).toMatchObject({ cap: 'maxCostEur', limit: 10 })
    expect(breaches(session)[0]?.data.measured).toBeCloseTo(12, 10)
  })

  it('records every later blocked step so a re-prompted session stays stopped', async () => {
    const { ctx, agent, session } = await harness({ maxTotalTokens: 0 })
    ctx.goals.create(agent, { objective: 'already over budget' })
    appendPricedStep(session, 1, { inputTokens: 1, outputTokens: 0 })

    await expect(preStep(ctx, agent, 2)).resolves.toEqual({ kind: 'reject' })
    await expect(preStep(ctx, agent, 3)).resolves.toEqual({ kind: 'reject' })
    expect(breaches(session)).toHaveLength(2)
    // The goal left `active` at the first breach, so the second one records the
    // stop without a second block.
    expect(session.events.filter(event => event.type === 'goal/change'
      && decodeGoalChange(event.data)?.operation === 'block')).toHaveLength(1)
  })

  it('stops the turn without a goal domain composed', async () => {
    const { ctx, agent, session } = await harness({ maxTotalTokens: 1 }, { goals: false })
    appendPricedStep(session, 1, { inputTokens: 2, outputTokens: 0 })
    await expect(preStep(ctx, agent, 2)).resolves.toEqual({ kind: 'reject' })
    expect(breaches(session)[0]?.data).toEqual({ cap: 'maxTotalTokens', measured: 2, limit: 1 })
  })

  it('stops the turn when the session has no current goal', async () => {
    const { ctx, agent, session } = await harness({ maxTotalTokens: 1 })
    appendPricedStep(session, 1, { inputTokens: 2, outputTokens: 0 })
    await expect(preStep(ctx, agent, 2)).resolves.toEqual({ kind: 'reject' })
    expect(ctx.goals.get(agent)).toBeUndefined()
    expect(breaches(session)).toHaveLength(1)
  })
})

describe('budget-policy disposal (HMR safety)', () => {
  it('removes its pre-step listener when the plugin fiber disposes', async () => {
    const { ctx, agent, session, fiber } = await harness({ maxTotalTokens: 0 })
    appendPricedStep(session, 1, { inputTokens: 1, outputTokens: 0 })
    await expect(preStep(ctx, agent, 2)).resolves.toEqual({ kind: 'reject' })
    await fiber.dispose()
    await expect(preStep(ctx, agent, 3)).resolves.toEqual({ kind: 'enter', messages: [] })
    expect(breaches(session)).toHaveLength(1)
  })
})

describe('dsh-budget-policy real-load-path guard', () => {
  it('has no default export and keeps name/inject through unwrapExports', () => {
    expect('default' in budgetPolicy).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(budgetPolicy) as Record<string, unknown>
    expect(unwrapped).toBe(budgetPolicy)
    expect(unwrapped['name']).toBe('budget-policy')
    expect(unwrapped['inject']).toEqual(['agents'])
    expect(typeof unwrapped['apply']).toBe('function')
  })
})
