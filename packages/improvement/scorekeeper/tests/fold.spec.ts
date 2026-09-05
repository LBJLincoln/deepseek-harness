/**
 * The pure session-facts fold: every field of the four groups comes from a
 * named event, the outcome group is decided by the goal, verification, and
 * reward folds that own those streams, and a malformed change fails the fold
 * loudly so a caller can report the session instead of publishing a wrong row.
 */

import { describe, expect, it } from 'vitest'
import { TOOL_TIMEOUT } from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import {
  applySessionFacts,
  emptySessionFactsState,
  foldSessionFacts,
  foldSessionFactsState,
} from '@deepseek-ai/dsh-scorekeeper'
import { cellLog, certificate, directive, goalChange, header, Log, runRecord, standard, stamp } from './log.ts'

describe('foldSessionFacts', () => {
  it('folds the empty log into zeroed groups carrying only the stored header identity', () => {
    expect(foldSessionFacts(header('empty'), [])).toEqual({
      identity: { sessionId: 'empty', createdAt: 500 },
      outcome: {
        reward: null,
        rewardBasis: 'none',
        certified: false,
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
      },
      tools: { toolCalls: 0, toolCallsByName: {}, toolErrors: 0, toolTimeouts: 0, toolAborts: 0 },
    })
  })

  it('carries the run stamp, the certificate, and the turn and token counts of a certified cell', () => {
    const events = cellLog({ stamp: stamp({ group: 'batch-1', repetition: 2 }), certified: true, runs: 1 })
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
        contentSha256: 'c'.repeat(64),
        provider: 'cli-mock',
        model: 'cli-mock',
        isolation: 'none',
      },
      requestProvider: 'cli-mock',
      requestModel: 'cli-mock',
    })
    expect(facts.outcome).toEqual({
      reward: 1,
      rewardBasis: 'certificate',
      certified: true,
      certificateRevision: 1,
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
    expect(facts.identity.environment?.group).toBeUndefined()
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
