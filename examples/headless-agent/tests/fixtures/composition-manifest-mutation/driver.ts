#!/usr/bin/env node
/**
 * Test driver: boot the mutation composition, load one project skill, edit that
 * skill body in place, invalidate the catalog the way a watcher would, and run a
 * second turn that loads nothing — so the persisted log shows one skill address
 * replaced by the generation the edit produced.
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { ComponentId } from '@deepseek-ai/dsh-components'
import type {} from '@deepseek-ai/dsh-components-skills'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'

const SKILL_COMPONENT = ComponentId('skill:manifest-demo')
const REREAD_ATTEMPTS = 200
const REREAD_INTERVAL_MS = 10

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('composition-manifest-mutation driver requires a config path')

/** Wait until the adapter has re-addressed the skill away from `previous`. */
async function awaitReaddress(ctx: Context, agent: Agent, previous: string): Promise<void> {
  for (let attempt = 0; attempt < REREAD_ATTEMPTS; attempt += 1) {
    if (ctx.components.get(SKILL_COMPONENT, { scope: agent })?.digest !== previous) return
    await delay(REREAD_INTERVAL_MS)
  }
  throw new Error('the skills adapter never re-addressed the edited skill')
}

const ctx = await boot('composition-manifest-mutation-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the driver drives the settled application.
  await ctx.get('loader')?.await()
  const created = await ctx.agents.create({
    sessionId: SessionId('composition-manifest-mutation'),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'mutation-mock', model: 'mutation-mock' },
  })
  try {
    await runFixtureTurn(ctx, { task: 'load the skill' })
    const first = ctx.components.get(SKILL_COMPONENT, { scope: created.agent })?.digest
    if (first === undefined) throw new Error('the first turn recorded no skill component')

    // One byte of the body, edited where the skill actually lives.
    await writeFile(
      join(process.cwd(), '.dsh/skills/manifest-demo/SKILL.md'),
      '---\nname: manifest-demo\ndescription: The skill this composition addresses\n---\n\nSecond body.\n',
    )
    // A watcher would invalidate here; this composition keeps the watcher off,
    // so the driver publishes the same notification through a registration it
    // immediately drops.
    ctx.skills.register({ name: 'catalog-poke', description: 'Force one catalog invalidation.', source: 'runtime', content: '' })()
    await awaitReaddress(ctx, created.agent, first)

    await runFixtureTurn(ctx, { task: 'just answer' })
    process.stdout.write(`${JSON.stringify({ type: 'result', sessionId: created.agent.session.id })}\n`)
  } finally {
    await created.dispose()
  }
} finally {
  await ctx.fiber.dispose()
}
