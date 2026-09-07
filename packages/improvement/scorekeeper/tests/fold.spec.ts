/**
 * The pure session-facts fold: every field of the four groups comes from a
 * named event, the outcome group is decided by the goal, verification, and
 * reward folds that own those streams, and a malformed change fails the fold
 * loudly so a caller can report the session instead of publishing a wrong row.
 */

import { describe, expect, it } from 'vitest'
import { pricingTableDigest } from '@deepseek-ai/dsh-budget-policy'
import type { BudgetRoutePricing } from '@deepseek-ai/dsh-budget-policy'
import { TOOL_TIMEOUT } from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import {
  applySessionFacts,
  emptySessionFactsState,
  foldSessionFacts,
  foldSessionFactsState,
} from '@deepseek-ai/dsh-scorekeeper'
import { cellLog, certificate, directive, goalChange, header, Log, manifest, MOCK_ROUTE, runRecord, standard, stamp } from './log.ts'
import type { Route } from './log.ts'

/** The rates one deployment priced the mock route at, and the ten-times-higher rates that replaced them. */
const OLD_RATES: BudgetRoutePricing = { inputEurPerMillionTokens: 1, outputEurPerMillionTokens: 2 }
const NEW_RATES: BudgetRoutePricing = { inputEurPerMillionTokens: 10, outputEurPerMillionTokens: 20 }

const ROUTE_KEY = `${MOCK_ROUTE.provider}/${MOCK_ROUTE.model}`
const OLD_DIGEST = pricingTableDigest({ [ROUTE_KEY]: OLD_RATES })
const NEW_DIGEST = pricingTableDigest({ [ROUTE_KEY]: NEW_RATES })

/** A route no pricing table names, so no `usage/priced` can ever state its price. */
const UNPRICED_ROUTE: Route = { provider: 'cli-mock', model: 'cli-mock-unpriced' }

/** What one twelve-in three-out step costs at the given rates. */
function costOf(rates: BudgetRoutePricing): number {
  return (12 * rates.inputEurPerMillionTokens + 3 * rates.outputEurPerMillionTokens) / 1_000_000
}

describe('foldSessionFacts', () => {
  it('folds the empty log into zeroed groups carrying only the stored header identity', () => {
    expect(foldSessionFacts(header('empty'), [])).toEqual({
      identity: { sessionId: 'empty', createdAt: 500 },
      outcome: {
        reward: null,
        rewardBasis: 'none',
        certified: false,
        tamper: 'not-instrumented',
        runsRecorded: 0,
        attempts: 0,
        directives: 0,
        relaxations: 0,
        goalRoundsStarted: 0,
      },
      efficiency: {
        turns: 0,
        steps: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        wallMs: 0,
        pricedSteps: 0,
        costEur: 0,
        pricingDigests: [],
      },
      tools: { toolCalls: 0, toolCallsByName: {}, toolErrors: 0, toolTimeouts: 0, toolAborts: 0 },
    })
  })

  it('carries the run stamp, the certificate, and the turn and token counts of a certified cell', () => {
    const events = cellLog({
      stamp: stamp({ group: 'batch-1', repetition: 2, district: 'proving-ground' }),
      certified: true,
      runs: 1,
    })
    const facts = foldSessionFacts(header('certified'), events)
    expect(facts.identity).toEqual({
      sessionId: 'certified',
      createdAt: 500,
      environment: {
        environmentId: 'smoke:round-trip',
        environmentKind: 'smoke',
        heldOut: false,
        repetition: 2,
        group: 'batch-1',
        district: 'proving-ground',
        contentSha256: 'c'.repeat(64),
        provider: 'cli-mock',
        model: 'cli-mock',
        isolation: 'none',
        // A stamp naming no implementer is a run its own model route implemented.
        implementer: 'route',
      },
      requestProvider: 'cli-mock',
      requestModel: 'cli-mock',
    })
    expect(facts.outcome).toEqual({
      reward: 1,
      rewardBasis: 'certificate',
      certified: true,
      certificateRevision: 1,
      certificateExecutor: 'runner',
      tamper: 'passed',
      runsRecorded: 1,
      attempts: 1,
      directives: 0,
      relaxations: 0,
      goalPhase: 'complete',
      goalRoundsCap: 7,
      goalRoundsStarted: 0,
    })
    expect(facts.efficiency).toMatchObject({ turns: 1, steps: 1, inputTokens: 12, outputTokens: 3 })
    // Ten events at one millisecond apart, from the stamp to the closing turn.
    expect(facts.efficiency.wallMs).toBe(events.length - 1)
  })

  it('scores a measured cell without a certificate as zero and counts every recorded run and directive', () => {
    const log = new Log()
    log.push('environment/run', stamp())
    log.push('goal/change', goalChange('create', 'active', 1))
    log.push('verification/standard', standard())
    log.push('verification/run', runRecord(1, 'fail'))
    log.push('verification/directive', directive())
    log.push('verification/run', runRecord(2, 'fail'))
    const facts = foldSessionFacts(header('measured'), log.events)
    expect(facts.outcome).toMatchObject({
      reward: 0,
      rewardBasis: 'certificate',
      certified: false,
      runsRecorded: 2,
      attempts: 2,
      directives: 1,
      goalPhase: 'active',
    })
    expect(facts.outcome.certificateRevision).toBeUndefined()
    expect(facts.outcome.certificateExecutor).toBeUndefined()
    expect(facts.identity.environment?.group).toBeUndefined()
    expect(facts.identity.environment?.district).toBeUndefined()
    expect(facts.identity.requestProvider).toBeUndefined()
  })

  it('leaves a completion no standard measured undecided and counts the admitted rounds', () => {
    const log = new Log()
    log.push('goal/change', goalChange('create', 'active', 1))
    log.goalRound(1, 1)
    log.push('goal/change', goalChange('complete', 'complete', 2, 1))
    const facts = foldSessionFacts(header('unmeasured'), log.events)
    expect(facts.outcome).toMatchObject({
      reward: null,
      rewardBasis: 'uncertified-completion',
      certified: false,
      goalRoundsStarted: 1,
      goalPhase: 'complete',
    })
  })

  it('carries the weighted pass rate of the last recorded run and none for a run that measured no cases', () => {
    const log = new Log()
    log.push('environment/run', stamp())
    log.push('goal/change', goalChange('create', 'active', 1))
    log.push('verification/standard', standard(true))
    log.push('verification/run', runRecord(1, 'fail', 'none', 1))
    log.push('verification/run', runRecord(2, 'fail', 'none', 4))
    const cased = foldSessionFacts(header('cased'), log.events).outcome
    expect(cased.parity).toEqual({ weightPassed: 4, weightTotal: 6 })
    // The certificate is the completion measure; a partial weight earns none.
    expect(cased).toMatchObject({ reward: 0, certified: false, runsRecorded: 2 })
    const caseless = foldSessionFacts(header('caseless'), cellLog({ certified: false, runs: 1 })).outcome
    expect(caseless.parity).toBeUndefined()
  })

  it('carries the verdict of the last recorded run as the tamper status', () => {
    const log = new Log()
    log.push('environment/run', stamp())
    log.push('goal/change', goalChange('create', 'active', 1))
    log.push('verification/standard', standard())
    log.push('verification/run', runRecord(1, 'fail'))
    expect(foldSessionFacts(header('failed'), log.events).outcome.tamper).toBe('failed')
    log.push('verification/run', runRecord(2, 'fail', 'none', undefined, 'tampered'))
    expect(foldSessionFacts(header('tampered'), log.events).outcome.tamper).toBe('tampered')
  })

  it('carries the composition digest of the last recorded manifest and none for a log carrying no manifest', () => {
    const log = new Log()
    log.push('composition/manifest', manifest('a'.repeat(64)))
    log.push('composition/manifest', manifest('b'.repeat(64)))
    expect(foldSessionFacts(header('composed'), log.events).identity.compositionSha256).toBe('b'.repeat(64))
    expect(foldSessionFacts(header('bare'), new Log().events).identity.compositionSha256).toBeUndefined()
  })

  it('carries the model a delegated child last reported, beside the model its cell was stamped with', () => {
    const log = new Log()
    log.push('environment/run', stamp())
    log.push('environment/delegation', { attempt: 1, provider: 'claude-code', runId: 'child-1', stopReason: 'error' })
    log.push('environment/delegation', { attempt: 2, provider: 'claude-code', runId: 'child-2', stopReason: 'completed', reportedModel: 'product-sonnet-2026-01' })
    const delegated = foldSessionFacts(header('delegated'), log.events).identity
    expect(delegated.implementerModel).toBe('product-sonnet-2026-01')
    // The requested arm stays the stamp's, so the two are read side by side.
    expect(delegated.environment?.model).toBe(MOCK_ROUTE.model)

    // An attempt that ended before its backend spoke retracts nothing.
    log.push('environment/delegation', { attempt: 3, provider: 'claude-code', runId: 'child-3', stopReason: 'aborted' })
    expect(foldSessionFacts(header('later'), log.events).identity.implementerModel).toBe('product-sonnet-2026-01')

    // A route-implemented cell records no delegation, so it states no model.
    const routed = new Log()
    routed.push('environment/run', stamp())
    expect(foldSessionFacts(header('routed'), routed.events).identity.implementerModel).toBeUndefined()
  })

  it('sums the spend of every delegated attempt where a route cell reports its own', () => {
    // An out-of-process implementer states its product's own accounting.
    const external = new Log()
    external.push('environment/run', stamp())
    external.push('environment/delegation', {
      attempt: 1,
      provider: 'claude-code',
      runId: 'child-1',
      stopReason: 'error',
      reportedUsage: { inputTokens: 31, outputTokens: 7, cacheReadTokens: 12, cacheWriteTokens: 4 },
      reportedCostUsd: 0.04,
    })
    external.push('environment/delegation', {
      attempt: 2,
      provider: 'claude-code',
      runId: 'child-2',
      stopReason: 'completed',
      reportedUsage: { inputTokens: 9, outputTokens: 2 },
      reportedCostUsd: 0.01,
    })
    const product = foldSessionFacts(header('external'), external.events).efficiency
    expect(product.delegated).toEqual({
      inputTokens: 40,
      outputTokens: 9,
      cacheReadTokens: 12,
      cacheWriteTokens: 4,
      costUsd: 0.05,
    })
    // The cell drove no turn of its own; the whole cost of the work is above.
    expect(product.inputTokens).toBe(0)

    // An in-process child is accounted from its own log instead, and prices nothing.
    const inProcess = new Log()
    inProcess.push('environment/run', stamp())
    inProcess.push('environment/delegation', {
      attempt: 1,
      provider: 'spawn',
      runId: 'child-1',
      stopReason: 'completed',
      usage: { inputTokens: 21, outputTokens: 4 },
    })
    expect(foldSessionFacts(header('local'), inProcess.events).efficiency.delegated)
      .toEqual({ inputTokens: 21, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0 })

    // A delegation accounting for nothing leaves the session stating none.
    const bare = new Log()
    bare.push('environment/run', stamp())
    bare.push('environment/delegation', { attempt: 1, provider: 'acp', runId: 'child-1', stopReason: 'aborted' })
    expect(foldSessionFacts(header('bare'), bare.events).efficiency.delegated).toBeUndefined()
  })

  it('records the cap of the last budget breach', () => {
    const log = new Log()
    log.push('budget/breach', { cap: 'maxTotalTokens', measured: 9, limit: 4 })
    log.push('budget/breach', { cap: 'maxCostEur', measured: 2, limit: 1 })
    expect(foldSessionFacts(header('breached'), log.events).outcome.budgetBreachCap).toBe('maxCostEur')
  })

  it('sums every usage bucket an assistant message reports and ignores a message without usage', () => {
    const log = new Log()
    log.assistant({ inputTokens: 5, outputTokens: 2, cacheReadTokens: 7, cacheWriteTokens: 1, reasoningTokens: 4 })
    log.assistant({ inputTokens: 3, outputTokens: 1 })
    log.assistant()
    expect(foldSessionFacts(header('usage'), log.events).efficiency).toMatchObject({
      inputTokens: 8,
      outputTokens: 3,
      cacheReadTokens: 7,
      cacheWriteTokens: 1,
      reasoningTokens: 4,
    })
  })

  it('counts tool calls by name and classifies every recorded error code', () => {
    const log = new Log()
    log.push('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' })
    log.push('tool/call', { turn: 1, step: 1, callId: 'c2', name: 'bash', arguments: '{}' })
    log.push('tool/call', { turn: 1, step: 1, callId: 'c3', name: 'read', arguments: '{}' })
    log.toolResult('c1', false)
    log.toolResult('c2', true, TOOL_TIMEOUT)
    log.toolResult('c3', true, TOOL_ABORTED)
    log.toolResult('c4', true, TOOL_ABORTED_BEFORE_DISPATCH)
    log.toolResult('c5', true)
    expect(foldSessionFacts(header('tools'), log.events).tools).toEqual({
      toolCalls: 3,
      toolCallsByName: { bash: 2, read: 1 },
      toolErrors: 4,
      toolTimeouts: 1,
      toolAborts: 2,
    })
  })

  it('rejects a verification change the strict stream refuses', () => {
    const log = new Log()
    log.push('verification/certificate', certificate())
    expect(() => foldSessionFactsState(log.events)).toThrow('verification certificate requires a current standard')
  })

  it('leaves a session whose route the deployment does not price without a cost at all', () => {
    const log = new Log()
    log.assistant({ inputTokens: 5, outputTokens: 2 })
    log.priced({ inputTokens: 5, outputTokens: 2, rates: OLD_RATES, digest: OLD_DIGEST })
    log.assistant({ inputTokens: 40, outputTokens: 10 }, 2, UNPRICED_ROUTE)
    const efficiency = foldSessionFacts(header('mixed-routes'), log.events).efficiency
    expect(efficiency.costEur).toBeUndefined()
    expect(efficiency).toMatchObject({ pricedSteps: 1, pricingDigests: [OLD_DIGEST], inputTokens: 45 })
  })

  it('sums a cost across two pricing tables and keeps both digests in first-seen order', () => {
    const log = new Log()
    log.assistant({ inputTokens: 12, outputTokens: 3 })
    log.priced({ inputTokens: 12, outputTokens: 3, rates: OLD_RATES, digest: OLD_DIGEST })
    log.assistant({ inputTokens: 12, outputTokens: 3 }, 2)
    log.priced({ step: 2, inputTokens: 12, outputTokens: 3, rates: NEW_RATES, digest: NEW_DIGEST })
    // A resumed session priced its second step after the deployment re-rated the route.
    log.assistant({ inputTokens: 12, outputTokens: 3 }, 3)
    log.priced({ step: 3, inputTokens: 12, outputTokens: 3, rates: NEW_RATES, digest: NEW_DIGEST })
    const efficiency = foldSessionFacts(header('re-rated'), log.events).efficiency
    expect(efficiency.pricingDigests).toEqual([OLD_DIGEST, NEW_DIGEST])
    expect(efficiency.pricedSteps).toBe(3)
    expect(efficiency.costEur).toBeCloseTo(costOf(OLD_RATES) + 2 * costOf(NEW_RATES), 15)
  })

  it('states the cost the log recorded however the deployment is rated when it is folded', () => {
    const events = cellLog({ certified: true, runs: 1, pricing: { rates: OLD_RATES, digest: OLD_DIGEST } })
    // The fold takes no pricing table, so re-rating the route between the two
    // folds cannot move a recorded cost even though the new rates are tenfold.
    const before = foldSessionFacts(header('rated'), events).efficiency
    const after = foldSessionFacts(header('rated'), events).efficiency
    expect(after).toEqual(before)
    expect(after.costEur).toBeCloseTo(costOf(OLD_RATES), 15)
    expect(costOf(NEW_RATES)).not.toBeCloseTo(costOf(OLD_RATES), 15)
    expect(after.pricingDigests).toEqual([OLD_DIGEST])
  })

  it('leaves every other event to the log clock alone', () => {
    const state = applySessionFacts(emptySessionFactsState(), {
      type: 'turn/end',
      seq: 0,
      time: 1_000,
      data: { turn: 1, reason: { kind: 'completed' } },
    })
    expect(state.facts.efficiency.wallMs).toBe(0)
    expect(state.outcomeEvents).toEqual([])
  })
})
