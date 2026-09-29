/** saveSelection() warns once per instance when no settings provider can retain the selection. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentDefaultModelConfig, { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE } from '../src/index.ts'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** Replace the context logger's warn method and return the captured messages. */
function observeWarnings(ctx: Context): string[] {
  const warnings: string[] = []
  ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
  return warnings
}

describe('AgentDefaultModelConfig.saveSelection without a settings provider', () => {
  it('warns once per instance and keeps the composition entry', async () => {
    const ctx = new Context()
    const warnings = observeWarnings(ctx)
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'p', model: 'm' })

    await ctx.agentDefaultModel.saveSelection({ provider: 'a', model: 'b' })
    await ctx.agentDefaultModel.saveSelection({ provider: 'c', model: 'd' })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE)
    expect(warnings[0]).toContain('this process only')
    expect(warnings[0]).toContain('no settings provider is loaded')
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'p', model: 'm' })
    await ctx.fiber.dispose()
  })

  it('logs no warning when a settings provider retains the selection', async () => {
    const ctx = new Context()
    const warnings = observeWarnings(ctx)
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'p', model: 'm' })

    await ctx.agentDefaultModel.saveSelection({ provider: 'a', model: 'b' })
    await ctx.agentDefaultModel.saveSelection({ provider: 'c', model: 'd' })

    expect(warnings).toEqual([])
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'c', model: 'd' })
    await ctx.fiber.dispose()
  })
})
