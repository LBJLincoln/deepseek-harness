/**
 * The package companion's owned relation: a durable `budget/breach` states a
 * measurement its own durable prefix reproduces. Seeded sessions exercise the
 * startup scan; live appends exercise the pre-publication check.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { BudgetBreach } from '@deepseek-ai/dsh-budget-policy'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as BudgetInvariantCompanion from '@deepseek-ai/dsh-budget-policy/invariant'

/** One balanced step whose assistant message reports three input tokens. */
const pricedStep: readonly SessionEvent[] = [
  { type: 'turn/start', seq: 0, time: 1_000, data: { turn: 1 } },
  { type: 'step/start', seq: 1, time: 1_000, data: { turn: 1, step: 1 } },
  {
    type: 'assistant/message',
    seq: 2,
    time: 1_500,
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'spent' }],
        source: { provider: 'cli-mock', model: 'cli-mock' },
      }),
      usage: { inputTokens: 3, outputTokens: 0 },
    },
  },
  { type: 'step/end', seq: 3, time: 1_500, data: { turn: 1, step: 1 } },
]

/** Append one breach after the priced step and return the seeded events. */
function seedWithBreach(breach: BudgetBreach): readonly SessionEvent[] {
  return [...pricedStep, { type: 'budget/breach', seq: 4, time: 2_000, data: breach }]
}

/** Mount the store plus the companion, optionally over an already-seeded session. */
async function setup(seed?: readonly SessionEvent[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  if (seed !== undefined) ctx.sessions.create(SessionId('budget-invariant-seeded'), { seed })
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(BudgetInvariantCompanion)
  return ctx
}

describe('budget breach invariants', () => {
  it('accepts a stored breach the seeded prefix reproduces', async () => {
    await expect(setup(seedWithBreach({ cap: 'maxInputTokens', measured: 3, limit: 2 }))).resolves.toBeDefined()
  })

  it('rejects a stored breach whose measurement the prefix contradicts', async () => {
    await expect(setup(seedWithBreach({ cap: 'maxInputTokens', measured: 9, limit: 2 })))
      .rejects.toThrow('budget/breach records maxInputTokens measured 9, but folding the preceding events yields 3')
  })

  it('rejects a breach that does not exceed its own limit', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('budget-invariant-not-exceeded'))
    expect(() => {
      session.append('budget/breach', { cap: 'maxTotalTokens', measured: 4, limit: 4 })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-budget-policy',
    }))
    expect(session.seq).toBe(0)
  })

  it('rejects a live breach whose measurement the durable prefix contradicts', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('budget-invariant-live'))
    session.append('turn/start', { turn: 1 })
    expect(() => {
      session.append('budget/breach', { cap: 'maxTotalTokens', measured: 12, limit: 1 })
    }).toThrow('budget/breach records maxTotalTokens measured 12, but folding the preceding events yields 0')
  })

  it('checks only the exceeded-its-limit relation for a cost breach, which the log cannot price', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('budget-invariant-cost'))
    session.append('turn/start', { turn: 1 })
    expect(() => {
      session.append('budget/breach', { cap: 'maxCostEur', measured: 2.5, limit: 1 })
    }).not.toThrow()
    expect(() => {
      session.append('budget/breach', { cap: 'maxCostEur', measured: 0.5, limit: 1 })
    }).toThrow('budget/breach records maxCostEur measured 0.5 which does not exceed its limit 1')
  })

  it('leaves every other durable event to its own owner', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('budget-invariant-other'))
    expect(() => {
      session.append('turn/start', { turn: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).not.toThrow()
    expect(session.seq).toBe(2)
  })
})
