#!/usr/bin/env node
/**
 * Test driver: boot the observatory composition, run one fleet plan inside the
 * Workshop district and one outside every district, fold the public snapshot
 * back out of the persisted logs, and print it with both renderings — the
 * current page and the same fold past its staleness threshold — for the e2e's
 * assertions and the keyless snapshot.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('observatory driver requires a config path')

const ctx = await boot('observatory-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const fleet = ctx.get('fleet')
  const observatory = ctx.get('observatory')
  if (fleet === undefined || observatory === undefined) throw new Error('observatory driver requires the fleet and the observatory service')
  const plan = {
    environments: { filter: { heldOut: false } },
    models: [],
    repetitions: 1,
    workspaceRoot: process.cwd(),
  } as const
  await fleet.run({ ...plan, group: 'observatory-public', district: 'proving-ground' })
  await fleet.run({ ...plan, group: 'observatory-workshop', district: 'workshop' })
  const snapshot = await observatory.snapshot()
  const newest = snapshot.newestSessionAt ?? 0
  const current = observatory.render(snapshot, newest)
  const stale = observatory.render(snapshot, newest + 3_600_001)
  process.stdout.write(`${JSON.stringify({ type: 'result', snapshot, current, stale })}\n`)
} finally {
  await ctx.fiber.dispose()
}
