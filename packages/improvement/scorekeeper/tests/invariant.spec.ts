/**
 * The package companion's owned relations: a facts record states what its own
 * log says. Seeded sessions exercise the startup scan; live appends exercise
 * the pre-publication check, and the direct calls prove each relation rejects a
 * record the log contradicts.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionFactsState } from '@deepseek-ai/dsh-scorekeeper'
import { factsDisagreements } from '@deepseek-ai/dsh-scorekeeper/invariant'
import * as ScorekeeperInvariantCompanion from '@deepseek-ai/dsh-scorekeeper/invariant'
import { append, cellLog, certificate, goalChange, runRecord, standard, stamp } from './log.ts'

/** Mount the store plus the companion, optionally over an already-seeded session. */
async function setup(seed?: readonly SessionEvent[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  if (seed !== undefined) ctx.sessions.create(SessionId('scorekeeper-seeded'), { seed })
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ScorekeeperInvariantCompanion)
  return ctx
}

describe('factsDisagreements', () => {
  const events = cellLog({ stamp: stamp(), certified: true, runs: 1 })
  const facts = foldSessionFactsState(events).facts

  it('accepts a record its own log reproduces', () => {
    expect(factsDisagreements(facts, events)).toEqual([])
  })

  it('rejects a run count the log contradicts', () => {
    const doctored = { ...facts, outcome: { ...facts.outcome, runsRecorded: 4 } }
    expect(factsDisagreements(doctored, events))
      .toEqual(['records runsRecorded 4 while the log holds 1 verification/run events'])
  })

  it('rejects a certified flag the reward fold contradicts', () => {
    const doctored = { ...facts, outcome: { ...facts.outcome, certified: false } }
    expect(factsDisagreements(doctored, events))
      .toEqual(['records certified false while the reward fold decided 1'])
  })

  it('rejects a weighted pass rate the last recorded run contradicts, in either direction', () => {
    const measured = cellLog({ stamp: stamp(), certified: false, runs: 2, weightPassed: 4 })
    const cased = foldSessionFactsState(measured).facts
    expect(factsDisagreements(cased, measured)).toEqual([])
    const overstated = { ...cased, outcome: { ...cased.outcome, parity: { weightPassed: 6, weightTotal: 6 } } }
    expect(factsDisagreements(overstated, measured))
      .toEqual(['records parity 6/6 while the last recorded run carries 4/6'])
    const { parity: _dropped, ...outcome } = cased.outcome
    expect(factsDisagreements({ ...cased, outcome }, measured))
      .toEqual(['records parity none while the last recorded run carries 4/6'])
  })

  it('accepts a stamped session with no certificate and an unstamped one', () => {
    const measured = cellLog({ stamp: stamp(), certified: false, runs: 1 })
    expect(factsDisagreements(foldSessionFactsState(measured).facts, measured)).toEqual([])
    const bare = cellLog({ certified: true, runs: 1 })
    expect(factsDisagreements(foldSessionFactsState(bare).facts, bare)).toEqual([])
  })
})

describe('session facts invariants', () => {
  it('accepts a seeded certified session whose facts the log reproduces', async () => {
    await expect(setup(cellLog({ stamp: stamp(), certified: true, runs: 1 }))).resolves.toBeDefined()
  })

  it('rejects a certificate earned under an isolation its run stamp did not declare', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('scorekeeper-isolation'))
    append(session, 'environment/run', stamp({ isolation: 'host' }))
    append(session, 'goal/change', goalChange('create', 'active', 1))
    append(session, 'verification/standard', standard())
    append(session, 'verification/run', runRecord(1, 'pass'))
    expect(() => {
      append(session, 'verification/certificate', certificate())
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-scorekeeper',
    }))
    expect(session.seq).toBe(4)
  })

  it('leaves a malformed verification stream to the companion that owns it', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('scorekeeper-malformed'))
    expect(() => {
      append(session, 'verification/run', runRecord(1, 'pass'))
    }).not.toThrow()
    expect(session.seq).toBe(1)
  })

  it('leaves every event that decides no checked relation alone', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('scorekeeper-other'))
    expect(() => {
      session.append('turn/start', { turn: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).not.toThrow()
    expect(session.seq).toBe(2)
  })
})
