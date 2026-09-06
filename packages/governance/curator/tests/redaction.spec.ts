/**
 * The redaction machinery on its own: what the shipped rules hit and what they
 * deliberately leave alone, which configured profiles a load refuses, and which
 * fields of a `dsh-trajectory/1` record the walk rewrites.
 */

import { describe, expect, it } from 'vitest'
import type { Trajectory } from '@deepseek-ai/dsh-trajectories'
import {
  applyRules,
  compileProfile,
  CuratorError,
  redactTrajectory,
  SHIPPED_REDACTION_RULES,
} from '@deepseek-ai/dsh-curator'
import type { CompiledRedactionRule } from '@deepseek-ai/dsh-curator'

/** The shipped profile every rule fixture runs against. */
const SHIPPED = compileProfile('shipped', { shipped: true })

/** One shipped rule with the text that must hit it and the text that must not. */
interface ShippedCase {
  readonly id: string
  readonly hit: string
  readonly redacted: string
  readonly miss: string
}

const SHIPPED_CASES: readonly ShippedCase[] = [
  {
    id: 'shipped:email',
    hit: 'write to nobody@example.invalid today',
    redacted: 'write to [redacted:email] today',
    miss: 'write to nobody@localhost today',
  },
  {
    id: 'shipped:bearer-token',
    hit: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
    redacted: 'Authorization: Bearer [redacted:token]',
    miss: 'send a Bearer token with the request',
  },
  {
    id: 'shipped:api-key',
    hit: 'the key sk-test-0000 is fake',
    redacted: 'the key [redacted:api-key] is fake',
    miss: 'risk-averse planning',
  },
  {
    id: 'shipped:ipv4',
    hit: 'host 203.0.113.7 answered',
    redacted: 'host [redacted:ipv4] answered',
    miss: 'host 999.1.1.1 answered',
  },
  {
    id: 'shipped:e164-phone',
    hit: 'call +12025550123 now',
    redacted: 'call [redacted:phone] now',
    miss: 'call +1234 now',
  },
]

/** Redact one string under a profile and report what each rule replaced. */
function redact(text: string, rules: readonly CompiledRedactionRule[]): { text: string; hits: Record<string, number> } {
  const hits = new Map<string, number>()
  return { text: applyRules(text, rules, hits), hits: Object.fromEntries(hits) }
}

describe('the shipped rule set', () => {
  it('ships one rule per credential format the profile advertises', () => {
    expect(SHIPPED.rules.map(rule => rule.id)).toEqual(SHIPPED_CASES.map(shippedCase => shippedCase.id))
    expect(SHIPPED_REDACTION_RULES.map(rule => rule.id)).toEqual(SHIPPED_CASES.map(shippedCase => shippedCase.id))
  })

  it.each(SHIPPED_CASES)('replaces what $id is for and leaves its near miss alone', (shippedCase) => {
    const hit = redact(shippedCase.hit, SHIPPED.rules)
    expect(hit.text).toBe(shippedCase.redacted)
    expect(hit.hits).toEqual({ [shippedCase.id]: 1 })

    const miss = redact(shippedCase.miss, SHIPPED.rules)
    expect(miss.text).toBe(shippedCase.miss)
    expect(miss.hits).toEqual({})
  })

  it('counts every occurrence of one rule in one string', () => {
    const { text, hits } = redact('a@example.invalid told b@example.invalid', SHIPPED.rules)
    expect(text).toBe('[redacted:email] told [redacted:email]')
    expect(hits).toEqual({ 'shipped:email': 2 })
  })

  it('digests the rules that run, not the name they were filed under', () => {
    expect(SHIPPED.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(compileProfile('other-name', { shipped: true }).sha256).toBe(SHIPPED.sha256)
    const extended = compileProfile('shipped', { shipped: true, rules: [{ id: 'local', pattern: 'x', replacement: 'y' }] })
    expect(extended.sha256).not.toBe(SHIPPED.sha256)
    expect(extended.rules.map(rule => rule.id).at(-1)).toBe('local')
  })
})

describe('compiling a configured profile', () => {
  it('adds the global flag and keeps the configured ones', () => {
    const profile = compileProfile('p', {
      shipped: false,
      rules: [
        { id: 'plain', pattern: 'a', replacement: 'A' },
        { id: 'insensitive', pattern: 'b', flags: 'i', replacement: 'B' },
        { id: 'already-global', pattern: 'c', flags: 'g', replacement: 'C' },
      ],
    })
    expect(profile.rules.map(rule => rule.regex.flags)).toEqual(['g', 'gi', 'g'])
    expect(redact('aa bB cc', profile.rules).text).toBe('AA BB CC')
  })

  it('writes a replacement containing $-sequences literally', () => {
    const profile = compileProfile('p', { shipped: false, rules: [{ id: 'dollar', pattern: 'secret', replacement: '[$& $1 $$]' }] })
    expect(redact('a secret here', profile.rules).text).toBe('a [$& $1 $$] here')
  })

  it('refuses a profile that would redact nothing', () => {
    expect(() => compileProfile('empty', { shipped: false }))
      .toThrow('redaction profile "empty" lists no rule and does not take the shipped set')
    expect(() => compileProfile('empty', { shipped: false, rules: [] }))
      .toThrow(expect.objectContaining<Partial<CuratorError>>({ code: 'CURATOR_INVALID_CONFIG' }))
  })

  it('refuses an empty, duplicated, sticky, or uncompilable rule', () => {
    expect(() => compileProfile('p', { shipped: false, rules: [{ id: '', pattern: 'a', replacement: 'b' }] }))
      .toThrow('redaction profile "p" has a rule with an empty id')
    expect(() => compileProfile('p', {
      shipped: false,
      rules: [{ id: 'twice', pattern: 'a', replacement: 'b' }, { id: 'twice', pattern: 'c', replacement: 'd' }],
    })).toThrow('redaction profile "p" lists rule "twice" twice')
    expect(() => compileProfile('p', { shipped: false, rules: [{ id: 'sticky', pattern: 'a', flags: 'y', replacement: 'b' }] }))
      .toThrow('redaction rule "sticky" of profile "p" sets the sticky flag')
    expect(() => compileProfile('p', { shipped: false, rules: [{ id: 'broken', pattern: '(', replacement: 'b' }] }))
      .toThrow('redaction rule "broken" of profile "p" does not compile')
    expect(() => compileProfile('p', { shipped: true, rules: [{ id: 'shipped:email', pattern: 'a', replacement: 'b' }] }))
      .toThrow('redaction profile "p" lists rule "shipped:email" twice')
  })
})

/** Every string of this record is `SECRET`-bearing, so one rule decides each field's fate. */
function record(): Trajectory {
  return {
    format: 'dsh-trajectory/1',
    id: 'SECRET-session',
    source: {
      sessionId: 'SECRET-session',
      createdAt: 100,
      cwd: '/home/SECRET/workspace',
      parentSession: 'SECRET-parent',
      agentPreset: 'SECRET-preset',
    },
    environment: {
      kind: 'environment/run',
      version: 1,
      environmentId: 'SECRET-environment',
      environmentKind: 'SECRET-kind',
      heldOut: false,
      repetition: 0,
      district: 'SECRET-district',
      promptSha256: 'a'.repeat(64),
      checksSha256: 'a'.repeat(64),
      contentSha256: 'a'.repeat(64),
      model: { provider: 'SECRET-provider', model: 'SECRET-model' },
      isolation: 'none',
    },
    config: { provider: 'SECRET-provider', model: 'SECRET-model', stop: ['SECRET-stop'] },
    system: 'SECRET system prompt',
    tools: [{
      name: 'SECRET-tool',
      description: 'SECRET description',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'SECRET parameter' } } },
    }],
    messages: [
      {
        role: 'assistant',
        seq: 1,
        turn: 1,
        step: 1,
        sourceKind: 'model',
        content: [{ type: 'tool-call', id: 'SECRET-call', name: 'SECRET-tool', arguments: '{"q":"SECRET"}' }],
        toolCalls: [{ id: 'SECRET-call', name: 'SECRET-tool', arguments: '{"q":"SECRET"}' }],
      },
      {
        role: 'tool',
        seq: 2,
        sourceKind: 'tool',
        toolCallId: 'SECRET-call',
        isError: true,
        content: [{ type: 'text', text: 'SECRET output' }],
      },
    ],
    steps: [{ turn: 1, step: 1 }],
    reward: {
      outcome: null,
      basis: 'certificate',
      goal: { id: 'SECRET-goal', objective: 'SECRET objective', phase: 'active' },
      certificate: {
        standard: { id: 'SECRET-standard', revision: 1 },
        goalId: 'SECRET-goal',
        isolation: 'none',
        executor: 'runner',
        results: [{ checkId: 'SECRET-check', status: 'pass', evidence: 'SECRET evidence' }],
        recordedAt: 2,
      },
      directives: 1,
      relaxations: 0,
      attempts: 1,
    },
    parity: { weightPassed: 1, weightTotal: 2 },
    provenance: { components: ['tool:SECRET'], toolNames: ['SECRET-tool'], isolation: 'none' },
    // The fixture states the record format by hand rather than folding a log.
  } as unknown as Trajectory
}

describe('redacting one trajectory record', () => {
  const profile = compileProfile('marker', { shipped: false, rules: [{ id: 'marker', pattern: 'SECRET', replacement: 'REDACTED' }] })
  const hits = new Map<string, number>()
  const redacted = redactTrajectory(record(), profile.rules, hits)
  const json = JSON.stringify(redacted)

  it('redacts every text field the record carries', () => {
    expect(redacted.source.cwd).toBe('/home/REDACTED/workspace')
    expect(redacted.system).toBe('REDACTED system prompt')
    expect(redacted.config?.stop).toEqual(['REDACTED-stop'])
    expect(redacted.tools?.[0]?.description).toBe('REDACTED description')
    expect(redacted.tools?.[0]?.parameters).toEqual({ type: 'object', properties: { path: { type: 'string', description: 'REDACTED parameter' } } })
    expect(redacted.messages[0]?.toolCalls?.[0]?.arguments).toBe('{"q":"REDACTED"}')
    expect(redacted.messages[0]?.content[0]).toMatchObject({ arguments: '{"q":"REDACTED"}' })
    expect(redacted.messages[1]?.content[0]).toEqual({ type: 'text', text: 'REDACTED output' })
    expect(redacted.reward.goal?.objective).toBe('REDACTED objective')
    expect(redacted.reward.certificate?.results[0]?.evidence).toBe('REDACTED evidence')
  })

  it('never redacts an identifier, a discriminant, or a registered tool name', () => {
    expect(redacted.format).toBe('dsh-trajectory/1')
    expect(redacted.id).toBe('SECRET-session')
    expect(redacted.source).toMatchObject({
      sessionId: 'SECRET-session',
      parentSession: 'SECRET-parent',
      agentPreset: 'SECRET-preset',
      createdAt: 100,
    })
    expect(redacted.environment).toEqual(record().environment)
    expect(redacted.config).toMatchObject({ provider: 'SECRET-provider', model: 'SECRET-model' })
    expect(redacted.tools?.[0]?.name).toBe('SECRET-tool')
    expect(redacted.messages[0]).toMatchObject({ role: 'assistant', sourceKind: 'model' })
    expect(redacted.messages[0]?.content[0]).toMatchObject({ type: 'tool-call', id: 'SECRET-call', name: 'SECRET-tool' })
    expect(redacted.messages[0]?.toolCalls?.[0]).toMatchObject({ id: 'SECRET-call', name: 'SECRET-tool' })
    expect(redacted.messages[1]).toMatchObject({ toolCallId: 'SECRET-call', isError: true })
    expect(redacted.reward).toMatchObject({ outcome: null, basis: 'certificate', directives: 1 })
    expect(redacted.reward.goal).toMatchObject({ id: 'SECRET-goal', phase: 'active' })
    expect(redacted.reward.certificate).toMatchObject({
      standard: { id: 'SECRET-standard', revision: 1 },
      goalId: 'SECRET-goal',
      isolation: 'none',
      executor: 'runner',
      recordedAt: 2,
    })
    expect(redacted.reward.certificate?.results[0]).toMatchObject({ checkId: 'SECRET-check', status: 'pass' })
    expect(redacted.steps).toEqual([{ turn: 1, step: 1 }])
    expect(redacted.parity).toEqual({ weightPassed: 1, weightTotal: 2 })
    expect(redacted.provenance).toEqual(record().provenance)
  })

  it('counts one hit per replaced string and leaves the source record untouched', () => {
    expect(hits.get('marker')).toBe(json.split('REDACTED').length - 1)
    expect(record().system).toBe('SECRET system prompt')
  })
})
