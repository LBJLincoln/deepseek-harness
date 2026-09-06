/**
 * The one resolve step from composition config to route facts: the catalog the
 * operator declares, the passthrough knobs, and every bound a misconfigured
 * composition must fail on at load.
 */

import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  Config,
  DEFAULT_DISPOSE_GRACE_MS,
  DEFAULT_QUERY_TIMEOUT_MS,
  resolveAdapterOptions,
} from '../src/config.ts'
import { BASE_CONFIG, routeConfig } from './fixture.ts'

describe('resolveAdapterOptions', () => {
  it('resolves the route, the catalog, and the timer defaults', () => {
    const resolved = resolveAdapterOptions(BASE_CONFIG)
    expect(Object.keys(resolved).sort()).toEqual([
      'displayName', 'disposeGraceMs', 'env', 'models', 'provider', 'queryTimeoutMs', 'retryPolicy',
    ])
    expect(resolved).toMatchObject({
      provider: 'claude-code',
      displayName: 'claude-code',
      models: [{ id: 'default', name: 'Installation default', contextWindow: 200_000 }],
      env: {},
      queryTimeoutMs: DEFAULT_QUERY_TIMEOUT_MS,
      disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
      retryPolicy: { mode: 'normal' },
    })
  })

  it('keeps every declared field, including the product model and passthrough knobs', () => {
    const resolved = resolveAdapterOptions(routeConfig({
      displayName: 'Claude Code',
      models: [{ id: 'fast', productModel: 'installation-fast', description: 'the quick one' }],
      env: { CLAUDE_AGENT_SDK_CLIENT_APP: 'dsh/1' },
      effort: 'max',
      thinking: { type: 'enabled', budgetTokens: 4096 },
      queryTimeoutMs: 1_000,
      disposeGraceMs: 250,
    }))

    expect(resolved).toMatchObject({
      displayName: 'Claude Code',
      models: [{ id: 'fast', productModel: 'installation-fast', description: 'the quick one' }],
      env: { CLAUDE_AGENT_SDK_CLIENT_APP: 'dsh/1' },
      effort: 'max',
      thinking: { type: 'enabled', budgetTokens: 4096 },
      queryTimeoutMs: 1_000,
      disposeGraceMs: 250,
    })
  })

  it.each([
    ['adaptive'],
    ['disabled'],
  ] as const)('passes %s thinking through unchanged', (type) => {
    expect(resolveAdapterOptions(routeConfig({ thinking: { type } })).thinking).toEqual({ type })
  })

  it.each([
    ['an unnamed route', { ...BASE_CONFIG, provider: '' }, /provider must name the route/],
    ['an empty display name', { ...BASE_CONFIG, displayName: '' }, /displayName must be non-empty/],
    ['an empty catalog', { ...BASE_CONFIG, models: [] }, /at least one model/],
    ['an unnamed model', { ...BASE_CONFIG, models: [{ id: '' }] }, /model ids must be non-empty/],
    [
      'a duplicate model',
      { ...BASE_CONFIG, models: [{ id: 'a' }, { id: 'a' }] },
      /duplicate model "a"/,
    ],
    [
      'an empty product model',
      { ...BASE_CONFIG, models: [{ id: 'a', productModel: '' }] },
      /productModel must be non-empty/,
    ],
    ['an empty model name', { ...BASE_CONFIG, models: [{ id: 'a', name: '' }] }, /has an empty name/],
    [
      'a fractional context window',
      { ...BASE_CONFIG, models: [{ id: 'a', contextWindow: 1.5 }] },
      /contextWindow must be a positive safe integer/,
    ],
    ['an unknown effort', { ...BASE_CONFIG, effort: 'turbo' }, /effort must be one of/],
    ['a zero query timeout', { ...BASE_CONFIG, queryTimeoutMs: 0 }, /queryTimeoutMs must be a positive/],
    [
      'an unschedulable dispose grace',
      { ...BASE_CONFIG, disposeGraceMs: MAX_TIMER_DELAY_MS + 1 },
      /disposeGraceMs must be a positive/,
    ],
    [
      'a thinking budget that is not a positive integer',
      { ...BASE_CONFIG, thinking: { type: 'enabled', budgetTokens: 0 } },
      /budgetTokens must be a positive safe integer/,
    ],
    [
      'an unknown thinking mode',
      { ...BASE_CONFIG, thinking: { type: 'eager' } },
      /thinking\.type must be/,
    ],
  ])('refuses %s at load', (_case, config, message) => {
    expect(() => resolveAdapterOptions(config as never)).toThrow(message)
  })
})

describe('Config schema', () => {
  it('normalizes a composition entry and requires the route and catalog', () => {
    expect(new Config({ provider: 'claude-code', models: [{ id: 'default' }] }))
      .toMatchObject({ provider: 'claude-code', models: [{ id: 'default' }], env: {} })
    expect(() => new Config({ models: [{ id: 'default' }] } as never)).toThrow()
    expect(() => new Config({ provider: 'claude-code' } as never)).toThrow()
  })

  it('validates the thinking union and the effort vocabulary', () => {
    expect(new Config({
      provider: 'claude-code',
      models: [{ id: 'default' }],
      thinking: { type: 'enabled', budgetTokens: 128 },
      effort: 'low',
    })).toMatchObject({ thinking: { type: 'enabled', budgetTokens: 128 }, effort: 'low' })
    expect(() => new Config({
      provider: 'claude-code',
      models: [{ id: 'default' }],
      effort: 'turbo',
    } as never)).toThrow()
  })
})
