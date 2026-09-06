#!/usr/bin/env node
/**
 * Test driver: boot the quarantine composition and run one turn in which the
 * agent defines and mounts a package of its own, so the persisted log carries a
 * manifest naming synthesized code beside the curated rows.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId } from '@deepseek-ai/dsh-session'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('composition-quarantine driver requires a config path')

const ctx = await boot('composition-quarantine-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the driver drives the settled application.
  await ctx.get('loader')?.await()
  const created = await ctx.agents.create({
    sessionId: SessionId('composition-quarantine'),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'quarantine-mock', model: 'quarantine-mock' },
  })
  try {
    await runFixtureTurn(ctx, { task: 'mount a package that provides quarantineProbe' })
    process.stdout.write(`${JSON.stringify({ type: 'result', sessionId: created.agent.session.id })}\n`)
  } finally {
    await created.dispose()
  }
} finally {
  await ctx.fiber.dispose()
}
