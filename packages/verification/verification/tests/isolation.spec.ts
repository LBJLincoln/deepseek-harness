/**
 * The certificate precondition over recorded enforcement, decided over one
 * session log: what the barrier's census and attestation records, and the run's
 * own executor, let a certificate claim.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReadBarrierScope } from '@deepseek-ai/dsh-read-barrier/types'
import { isolationProblem, recordedScope } from '../src/isolation.ts'

const ROOT = '/srv/verification'

/** One `read-barrier/scope` event carrying a proving census unless overridden. */
function scopeEvent(overrides: Partial<ReadBarrierScope> = {}, seq = 0): SessionEvent {
  const data: ReadBarrierScope = {
    version: 1,
    role: 'implementer',
    presetId: 'implementing',
    root: ROOT,
    denied: [ROOT],
    census: [{ name: 'read', authority: [] }, { name: 'bash', authority: [] }],
    enforcement: [
      { capability: 'fs', state: 'denied-at-executor' },
      { capability: 'shell', state: 'denied-at-executor' },
      { capability: 'subprocess', state: 'not-composed' },
      { capability: 'terminal', state: 'not-composed' },
      { capability: 'subagent', state: 'not-composed' },
      { capability: 'workflow', state: 'not-composed' },
    ],
    ...overrides,
  }
  return { type: 'read-barrier/scope', seq, time: seq, data } as unknown as SessionEvent
}

/** One `read-barrier/attestation` event, as the barrier writes it after verifying a file. */
function attestationEvent(seq = 1): SessionEvent {
  return {
    type: 'read-barrier/attestation',
    seq,
    time: seq,
    data: { version: 1, path: '/srv/attestation.json', owner: 4242, sha256: 'abc' },
  } as unknown as SessionEvent
}

/** One `request/header` event assembling the named tool schemas. */
function headerEvent(names: readonly string[], seq = 2): SessionEvent {
  return {
    type: 'request/header',
    seq,
    time: seq,
    data: {
      header: {
        config: { provider: 'p', model: 'm' },
        tools: names.map(name => ({ name, description: name, parameters: { type: 'object', properties: {} } })),
      },
      reason: 'initial',
    },
  } as unknown as SessionEvent
}

describe('recordedScope', () => {
  it('answers the census a session recorded, newest first', () => {
    const first = scopeEvent({ presetId: 'first' }, 0)
    const second = scopeEvent({ presetId: 'second' }, 1)
    expect(recordedScope([first, second])?.presetId).toBe('second')
  })

  it('answers undefined for a session that composed no barrier', () => {
    expect(recordedScope([headerEvent(['read'], 0)])).toBeUndefined()
  })
})

describe('isolationProblem at "none"', () => {
  it('accepts a session that recorded nothing at all', () => {
    expect(isolationProblem([], 'none', 'runner')).toBeUndefined()
  })

  it('accepts an agent-reported run, which is exactly what the level admits', () => {
    expect(isolationProblem([], 'none', 'agent-reported')).toBeUndefined()
  })

  it('refuses a census that composed an authority-bearing tool, at every level', () => {
    const events = [scopeEvent({ census: [{ name: 'session_search', authority: ['session-log'] }] })]
    const problem = 'the session composed "session_search", which carries the "session-log" authority'
    expect(isolationProblem(events, 'none', 'runner')).toBe(problem)
    expect(isolationProblem(events, 'process', 'runner')).toBe(problem)
    expect(isolationProblem(events, 'host', 'runner')).toBe(problem)
  })

  it('refuses a request assembling a tool the census does not cover', () => {
    const events = [scopeEvent(), headerEvent(['read', 'session_trace'])]
    expect(isolationProblem(events, 'none', 'runner'))
      .toBe('request/header at event 2 assembled "session_trace", which the scope census does not cover')
  })

  it('accepts a request assembling only tools the census covers, and a tool-less request', () => {
    expect(isolationProblem([scopeEvent(), headerEvent(['read'])], 'none', 'runner')).toBeUndefined()
    const toolless = { type: 'request/header', seq: 2, time: 2, data: { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' } } as unknown as SessionEvent
    expect(isolationProblem([scopeEvent(), toolless], 'none', 'runner')).toBeUndefined()
  })
})

describe('isolationProblem at "process"', () => {
  it('accepts a census whose composed capabilities all deny at the executor', () => {
    expect(isolationProblem([scopeEvent()], 'process', 'runner')).toBeUndefined()
  })

  it('refuses a session with no census', () => {
    expect(isolationProblem([], 'process', 'runner'))
      .toBe('no read-barrier/scope records what this session composed')
  })

  it.each(['validator', 'unrestricted'] as const)('refuses a session that held role %s', (role) => {
    expect(isolationProblem([scopeEvent({ role })], 'process', 'runner'))
      .toBe(`the session held role "${role}", so no executor denied it a read`)
  })

  it('refuses a composed capability that denies nothing', () => {
    const events = [scopeEvent({
      enforcement: [
        { capability: 'fs', state: 'denied-at-executor' },
        { capability: 'shell', state: 'unenforced' },
      ],
    })]
    expect(isolationProblem(events, 'process', 'runner'))
      .toBe('capability "shell" is composed without read-barrier enforcement')
  })

  it('names the reason a capability recorded for enforcing nothing', () => {
    const events = [scopeEvent({
      enforcement: [
        { capability: 'fs', state: 'denied-at-executor' },
        { capability: 'shell', state: 'unenforced', reason: 'sandbox backend "windows-acl" cannot deny reads under "/srv/verification"' },
      ],
    })]
    expect(isolationProblem(events, 'process', 'runner')).toBe(
      'capability "shell" is composed without read-barrier enforcement: '
      + 'sandbox backend "windows-acl" cannot deny reads under "/srv/verification"',
    )
  })

  it('refuses an executor that runs outside this process under a claim that asks nothing of it', () => {
    const events = [scopeEvent({
      enforcement: [
        { capability: 'fs', state: 'denied-at-executor' },
        { capability: 'shell', state: 'denied-at-executor' },
        { capability: 'workflow', state: 'unenforced', reason: 'it runs outside this process' },
      ],
    })]
    expect(isolationProblem(events, 'process', 'runner'))
      .toBe('capability "workflow" is composed without read-barrier enforcement: it runs outside this process')
  })

  it('accepts a census whose out-of-process executors refuse to start', () => {
    const events = [scopeEvent({
      enforcement: [
        { capability: 'fs', state: 'denied-at-executor' },
        { capability: 'shell', state: 'denied-at-executor' },
        { capability: 'subprocess', state: 'denied-at-executor' },
        { capability: 'terminal', state: 'denied-at-executor' },
        { capability: 'subagent', state: 'denied-at-executor' },
        { capability: 'workflow', state: 'denied-at-executor' },
      ],
    })]
    expect(isolationProblem(events, 'process', 'runner')).toBeUndefined()
  })

  it('refuses a census whose composition carries a denied authority even with every capability denying', () => {
    const events = [scopeEvent({ census: [{ name: 'cordis_run', authority: ['plugin-mount'] }] })]
    expect(isolationProblem(events, 'process', 'runner'))
      .toBe('the session composed "cordis_run", which carries the "plugin-mount" authority')
  })

  it('refuses an agent-reported run before it reads the census at all', () => {
    expect(isolationProblem([scopeEvent()], 'process', 'agent-reported'))
      .toBe('the run was agent-reported, so no validator executed its checks')
  })
})

describe('isolationProblem at "host"', () => {
  it('accepts a proving census with a verified attestation', () => {
    expect(isolationProblem([scopeEvent(), attestationEvent()], 'host', 'runner')).toBeUndefined()
  })

  it('refuses everything "process" refuses', () => {
    expect(isolationProblem([attestationEvent(0)], 'host', 'runner'))
      .toBe('no read-barrier/scope records what this session composed')
    expect(isolationProblem([scopeEvent(), attestationEvent()], 'host', 'agent-reported'))
      .toBe('the run was agent-reported, so no validator executed its checks')
  })

  it('refuses a proving census with no attestation', () => {
    expect(isolationProblem([scopeEvent()], 'host', 'runner'))
      .toBe('no verified read-barrier/attestation places the standard outside this account')
  })
})

describe('an isolation level outside the ladder', () => {
  it('is unreachable and stays a loud backstop', () => {
    // Only a cast reaches this arm. A level added to `CertificateIsolation`
    // without a rule here must fail rather than certify by falling through.
    expect(() => isolationProblem([], 'shielded' as never, 'runner'))
      .toThrow('unreachable variant: "shielded"')
  })
})
