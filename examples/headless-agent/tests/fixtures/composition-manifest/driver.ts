#!/usr/bin/env node
/**
 * Test driver: boot the composition-manifest composition, compose one session
 * from the `manifest` preset, and run three turns — two over an unchanged
 * composition and one after registering a tool into the global layer — so the
 * persisted log states exactly one manifest per composition change.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId } from '@deepseek-ai/dsh-session'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('composition-manifest driver requires a config path')

const ctx = await boot('composition-manifest-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the driver creates the agent only over the settled application.
  await ctx.get('loader')?.await()
  const created = await ctx.agents.create({
    sessionId: SessionId('composition-manifest'),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'manifest-mock', model: 'manifest-mock' },
    setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, 'manifest'),
  })
  try {
    await runFixtureTurn(ctx, { task: 'first turn' })
    await runFixtureTurn(ctx, { task: 'second turn over the same composition' })

    // A tool registered into the global layer after two turns: the tools
    // adapter follows `tools/change`, so the next step records a new manifest.
    ctx.tools.register({
      name: 'late_note',
      description: 'Record one note, registered after the session started.',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
      },
      execute: () => Promise.resolve('noted'),
    })
    await runFixtureTurn(ctx, { task: 'third turn after the tool was added' })

    process.stdout.write(`${JSON.stringify({ type: 'result', sessionId: created.agent.session.id })}\n`)
  } finally {
    await created.dispose()
  }
} finally {
  await ctx.fiber.dispose()
}
