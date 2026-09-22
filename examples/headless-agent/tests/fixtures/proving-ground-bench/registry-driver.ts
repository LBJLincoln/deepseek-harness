#!/usr/bin/env node
/**
 * Keyless driver: boot a composition holding a bench's registry, then print
 * one JSON line with the registered environments grouped by tier, domain,
 * language, and held-out flag, plus the case count of every cased check, for
 * the smokes that check a bench against its source. A grouping counts only the
 * environments whose detail carries it: the polyglot bench's carry a language
 * and no tier or domain.
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
  type Detail = { tier?: number; domain?: string; language?: string }
  const detailOf = (detail: unknown): Detail => detail as Detail
  const count = (select: (detail: Detail, heldOut: boolean) => boolean): number =>
    all.filter(definition => select(detailOf(definition.detail), definition.heldOut)).length
  // Every grouping is read from what registered, so a tier, a domain, or a
  // language a bench gains is counted without editing this driver.
  const domains = [...new Set(all.flatMap(definition => detailOf(definition.detail).domain ?? []))].sort()
  const tiers = [...new Set(all.flatMap(definition => detailOf(definition.detail).tier ?? []))].sort((left, right) => left - right)
  const languages = [...new Set(all.flatMap(definition => detailOf(definition.detail).language ?? []))].sort()
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
    languages: Object.fromEntries(languages.map(language => [language, count(detail => detail.language === language)])),
    withReference: all.filter(definition => definition.task.reference !== undefined).length,
    cases,
    ids: all.map(definition => definition.id).sort(),
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`)
} finally {
  await ctx.fiber.dispose()
}
