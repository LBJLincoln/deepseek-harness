/**
 * One `ctx.llm.stream()` call makes one provider request, even when the
 * failure is one the pi-ai SDK would retry. `dsh-llm-retry` and the session
 * log own every visible attempt; an SDK-level retry would hide attempts from
 * them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

async function harness(baseURL: string): Promise<Context> {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {
    providers: { deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL } },
  })
  return ctx
}

describe('PiAiAdapter single provider attempt', () => {
  it.each([
    [500, 'SERVER', {}],
    [429, 'RATE_LIMIT', { 'retry-after': '1' }],
  ] as const)('makes one request when the provider answers %s', async (status, code, headers) => {
    // Later scripted responses succeed, so an SDK retry would change both the
    // request count and the finish.
    const server = await mockServer([
      { status, headers, body: JSON.stringify({ error: { message: 'retryable provider failure' } }) },
      { events: textEvents },
      { events: textEvents },
    ])
    const ctx = await harness(server.url)

    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })

    expect(result.finish).toMatchObject({ kind: 'error', failure: { code } })
    expect(server.requests).toHaveLength(1)
  })
})
