#!/usr/bin/env node
/**
 * Keyless driver: boot a composition holding the bench's registry, then print
 * one JSON line with the registered environments grouped by tier, domain, and
 * held-out flag, plus the case count of every cased check, for the smoke that
 * checks the bench against its task files.
 *
 *   registry-driver.ts <config>
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-environments'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('registry-driver requires <config>')

const ctx = await boot('proving-ground-bench-registry', resolveConfigPath(configPath, undefined))
try {
  await ctx.get('loader')?.await()
  const environments = ctx.get('environments')
  if (environments === undefined) throw new Error('registry-driver requires the environments service')
  const all = environments.list({})
  const count = (select: (detail: { tier: number; domain: string }, heldOut: boolean) => boolean): number =>
    all.filter(definition => select(definition.detail as { tier: number; domain: string }, definition.heldOut)).length
  const domains = [...new Set(all.map(definition => (definition.detail as { domain: string }).domain))].sort()
  const tiers = [2, 3, 4, 5]
  // Per environment, the case count of every check that carries cases, so the
  // smoke can require the hidden-case tier to be cased without reading the
  // bodies, which never leave the validator's reservation.
  const cases = Object.fromEntries(all
    .map(definition => [definition.id, definition.checks.flatMap(check => (check.cases === undefined ? [] : [check.cases.count]))] as const)
    .filter(([, counts]) => counts.length > 0))
  const summary = {
    type: 'registry',
    total: all.length,
    heldOut: count((_, heldOut) => heldOut),
    tiers: Object.fromEntries(tiers.map(tier => [tier, count(detail => detail.tier === tier)])),
    domains: Object.fromEntries(domains.map(domain => [domain, count(detail => detail.domain === domain)])),
    withReference: all.filter(definition => definition.task.reference !== undefined).length,
    cases,
    ids: all.map(definition => definition.id).sort(),
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`)
} finally {
  await ctx.fiber.dispose()
}
