/**
 * The package companion's owned relations: a durable `budget/breach` states a
 * measurement its own durable prefix reproduces, a durable `usage/priced`
 * states a price its own cited assistant message and its own recorded rates
 * reproduce, once per step, and a durable `budget/caps` only ever tightens the
 * caps the same log already carries. Seeded sessions exercise the startup scan;
 * live appends exercise the pre-publication check.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { BudgetBreach, UsagePriced } from '@deepseek-ai/dsh-budget-policy'
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

/** Append one assistant message reporting `usage` for one step of one route. */
function appendMessage(
  session: Session,
  where: { turn: number; step: number },
  usage: TokenUsage | undefined,
  source: { provider: string; model: string } = { provider: 'cli-mock', model: 'cli-mock' },
): void {
  session.append('assistant/message', {
    ...where,
    message: createAssistantMessage({ content: [{ type: 'text', text: 'spent' }], source }),
    ...usage === undefined ? {} : { usage },
  }, { surfaceOp: 'append' })
}

/**
 * The record the policy would write for the seeded `turn 1 / step 1` message:
 * three billed input tokens on `cli-mock/cli-mock` at one EUR per token.
 */
function priceOfFirstStep(overrides: Partial<UsagePriced> = {}): UsagePriced {
  return {
    turn: 1,
    step: 1,
    provider: 'cli-mock',
    model: 'cli-mock',
    inputTokens: 3,
    outputTokens: 0,
    inputEurPerMillionTokens: 1_000_000,
    outputEurPerMillionTokens: 2_000_000,
    costEur: 3,
    pricingDigest: 'a'.repeat(64),
    ...overrides,
  }
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

describe('session cap invariants', () => {
  it('accepts a stored record that tightens the caps the log already carries', async () => {
    await expect(setup([
      { type: 'budget/caps', seq: 0, time: 1_000, data: { maxTotalTokens: 100, maxWallMs: 900 } },
      { type: 'budget/caps', seq: 1, time: 1_100, data: { maxTotalTokens: 40, maxWallMs: 900 } },
    ])).resolves.toBeDefined()
  })

  it('accepts the first record of a session, whose log caps nothing yet', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('caps-first'))
    expect(() => {
      session.append('budget/caps', { maxTotalTokens: 1_000_000 })
    }).not.toThrow()
    expect(session.seq).toBe(1)
  })

  it('rejects a record that raises a cap its own log already set', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('caps-widened'))
    session.append('budget/caps', { maxTotalTokens: 40 })
    expect(() => {
      session.append('budget/caps', { maxTotalTokens: 41 })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-budget-policy',
    }))
    expect(() => {
      session.append('budget/caps', { maxTotalTokens: 41 })
    }).toThrow("budget/caps raises maxTotalTokens to 41, which this session's own log caps at 40")
    expect(session.seq).toBe(1)
  })

  it('rejects a record that drops a cap its own log already set', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('caps-dropped'))
    session.append('budget/caps', { maxTotalTokens: 40, maxWallMs: 900 })
    expect(() => {
      session.append('budget/caps', { maxTotalTokens: 40 })
    }).toThrow("budget/caps drops maxWallMs, which this session's own log caps at 900")
  })
})

describe('usage pricing invariants', () => {
  it('accepts a stored price the seeded prefix reproduces', async () => {
    await expect(setup([...pricedStep, {
      type: 'usage/priced',
      seq: 4,
      time: 2_000,
      data: priceOfFirstStep(),
    }])).resolves.toBeDefined()
  })

  it('rejects a price no preceding assistant message reports', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('priced-uncited'))
    appendMessage(session, { turn: 1, step: 1 }, { inputTokens: 3, outputTokens: 0 })
    expect(() => {
      session.append('usage/priced', priceOfFirstStep({ turn: 2 }))
    }).toThrow('usage/priced prices turn 2 step 1, which no preceding assistant/message reports')
    expect(() => {
      session.append('usage/priced', priceOfFirstStep({ step: 2 }))
    }).toThrow('usage/priced prices turn 1 step 2, which no preceding assistant/message reports')
    expect(session.seq).toBe(1)
  })

  it('rejects a price whose tokens its own assistant message does not report', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('priced-tokens'))
    appendMessage(session, { turn: 1, step: 1 }, { inputTokens: 3, outputTokens: 0 })
    appendMessage(session, { turn: 2, step: 1 }, undefined)
    expect(() => {
      session.append('usage/priced', priceOfFirstStep({ inputTokens: 4, costEur: 4 }))
    }).toThrow('usage/priced prices 4 input and 0 output tokens for turn 1 step 1, which its assistant/message does not report')
    expect(() => {
      session.append('usage/priced', priceOfFirstStep({ outputTokens: 1, costEur: 5 }))
    }).toThrow('usage/priced prices 3 input and 1 output tokens for turn 1 step 1, which its assistant/message does not report')
    expect(() => {
      session.append('usage/priced', priceOfFirstStep({ turn: 2, inputTokens: 0, costEur: 0 }))
    }).toThrow('usage/priced prices 0 input and 0 output tokens for turn 2 step 1, which its assistant/message does not report')
  })

  it('rejects a price whose route its own assistant message does not report', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('priced-route'))
    appendMessage(session, { turn: 1, step: 1 }, { inputTokens: 3, outputTokens: 0 })
    expect(() => {
      session.append('usage/priced', priceOfFirstStep({ provider: 'other' }))
    }).toThrow('usage/priced prices turn 1 step 1 on route other/cli-mock, which its assistant/message reports as cli-mock/cli-mock')
    expect(() => {
      session.append('usage/priced', priceOfFirstStep({ model: 'other' }))
    }).toThrow('usage/priced prices turn 1 step 1 on route cli-mock/other, which its assistant/message reports as cli-mock/cli-mock')
  })

  it('rejects a price its own recorded rates do not produce', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('priced-arithmetic'))
    appendMessage(session, { turn: 1, step: 1 }, { inputTokens: 3, outputTokens: 0 })
    expect(() => {
      session.append('usage/priced', priceOfFirstStep({ costEur: 4 }))
    }).toThrow('usage/priced records costEur 4 for turn 1 step 1, but its own rates price its own tokens at 3')
    expect(session.seq).toBe(1)
  })

  it('rejects a second price for a step the log already priced', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('priced-twice'))
    appendMessage(session, { turn: 1, step: 1 }, { inputTokens: 3, outputTokens: 0 })
    appendMessage(session, { turn: 1, step: 2 }, { inputTokens: 3, outputTokens: 0 })
    appendMessage(session, { turn: 2, step: 1 }, { inputTokens: 3, outputTokens: 0 })
    session.append('usage/priced', priceOfFirstStep())
    // A different step of the same turn, and the same step of a different turn,
    // are both new records rather than repeats.
    session.append('usage/priced', priceOfFirstStep({ step: 2 }))
    session.append('usage/priced', priceOfFirstStep({ turn: 2 }))
    expect(() => {
      session.append('usage/priced', priceOfFirstStep())
    }).toThrow('usage/priced prices turn 1 step 1, which seq 3 already priced')
    expect(session.seq).toBe(6)
  })
})
