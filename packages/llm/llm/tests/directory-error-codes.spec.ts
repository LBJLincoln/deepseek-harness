import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmConfigurableProvider, StreamChunk } from '@deepseek-ai/dsh-llm'

class NoopAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('not exercised')
  }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  return ctx
}

function entry(overrides: Partial<LlmConfigurableProvider> = {}): LlmConfigurableProvider {
  return {
    provider: 'openai',
    displayName: 'OpenAI',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'openai'],
    ...overrides,
  }
}

/** Run `action`, require it to throw an `LlmError`, and return that error's code. */
function codeOf(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(LlmError)
    return (error as LlmError).code
  }
  throw new Error('expected the call to throw an LlmError')
}

function declared(ctx: Context): string[] {
  return ctx.llm.listConfigurableProviders().map(view => view.provider)
}

describe('configurable-provider directory error codes', () => {
  it('gives INVALID_DIRECTORY for an empty entry list', async () => {
    const ctx = await setup()
    expect(codeOf(() => ctx.llm.registerConfigurableProviders([]))).toBe('INVALID_DIRECTORY')
    expect(declared(ctx)).toEqual([])
  })

  it('gives INVALID_DIRECTORY for an empty settingsPath segment and registers nothing', async () => {
    const ctx = await setup()
    const code = codeOf(() => ctx.llm.registerConfigurableProviders([
      entry({ provider: 'valid-first' }),
      entry({ settingsPath: ['providers', ''] }),
    ]))
    expect(code).toBe('INVALID_DIRECTORY')
    expect(declared(ctx)).toEqual([])
  })

  it('gives DUPLICATE_DIRECTORY for a provider declared twice in one call', async () => {
    const ctx = await setup()
    expect(codeOf(() => ctx.llm.registerConfigurableProviders([entry(), entry()]))).toBe('DUPLICATE_DIRECTORY')
    expect(declared(ctx)).toEqual([])
  })

  it('gives DUPLICATE_DIRECTORY for a provider another registration declares and keeps the directory intact', async () => {
    const ctx = await setup()
    ctx.llm.registerConfigurableProviders([entry()])
    const code = codeOf(() => ctx.llm.registerConfigurableProviders([entry({ provider: 'unseen' }), entry()]))
    expect(code).toBe('DUPLICATE_DIRECTORY')
    expect(declared(ctx)).toEqual(['openai'])
  })

  it('gives DUPLICATE_DIRECTORY when replace() names a provider another registration owns and keeps the current set', async () => {
    const ctx = await setup()
    const handle = ctx.llm.registerConfigurableProviders([entry(), entry({ provider: 'second' })])
    ctx.llm.registerConfigurableProviders([entry({ provider: 'owned-elsewhere' })])

    const code = codeOf(() => { handle.replace([entry({ provider: 'third' }), entry({ provider: 'owned-elsewhere' })]) })
    expect(code).toBe('DUPLICATE_DIRECTORY')
    expect(declared(ctx).sort()).toEqual(['openai', 'owned-elsewhere', 'second'])
  })

  it('gives REGISTRATION_DISPOSED for replace() on a disposed directory handle and does not declare anything', async () => {
    const ctx = await setup()
    const handle = ctx.llm.registerConfigurableProviders([entry()])
    handle()
    expect(codeOf(() => { handle.replace([entry()]) })).toBe('REGISTRATION_DISPOSED')
    expect(declared(ctx)).toEqual([])
  })
})

describe('adapter registration error codes', () => {
  it('gives REGISTRATION_DISPOSED for replace() on a disposed adapter registration and registers no route', async () => {
    const ctx = await setup()
    const handle = ctx.llm.registerAdapter(['a'], new NoopAdapter())
    handle()
    expect(codeOf(() => { handle.replace(['a']) })).toBe('REGISTRATION_DISPOSED')
    expect(ctx.llm.listProviders()).toEqual([])
  })
})

describe('model discovery error codes', () => {
  const discover = (): Promise<never[]> => Promise.resolve([])

  it('gives INVALID_DISCOVERY for an empty namespace and registers no offer', async () => {
    const ctx = await setup()
    expect(codeOf(() => ctx.llm.registerModelDiscovery('', discover))).toBe('INVALID_DISCOVERY')
    await expect(ctx.llm.discoverModels('', { baseURL: 'https://gateway.example/v1' }))
      .rejects.toMatchObject({ code: 'NO_DISCOVERY' })
  })

  it('gives INVALID_DISCOVERY for a discovery naming neither a provider nor a baseURL', async () => {
    const ctx = await setup()
    ctx.llm.registerModelDiscovery('llm-example', discover)
    await expect(ctx.llm.discoverModels('llm-example', {})).rejects.toMatchObject({
      name: 'LlmError',
      code: 'INVALID_DISCOVERY',
    })
  })

  it('gives DUPLICATE_DISCOVERY for a second offer on one namespace and keeps the first serving', async () => {
    const ctx = await setup()
    ctx.llm.registerModelDiscovery('llm-example', () => Promise.resolve([{ id: 'first' }]))
    const code = codeOf(() => ctx.llm.registerModelDiscovery('llm-example', () => Promise.resolve([{ id: 'second' }])))
    expect(code).toBe('DUPLICATE_DISCOVERY')
    await expect(ctx.llm.discoverModels('llm-example', { baseURL: 'https://gateway.example/v1' }))
      .resolves.toEqual([{ id: 'first' }])
  })
})
