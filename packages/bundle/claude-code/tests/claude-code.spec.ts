/**
 * The shipped `claude-code` profile. The suite resolves the REAL bundle
 * packages through the launcher's own two-anchor profile machinery and
 * composes their shipped patch files with the boot's patch algorithm, so it
 * pins what `dsh --profile claude-code` actually mounts rather than a fixture.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries, loadProfile, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'

const PROFILE = 'claude-code'
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const bundleGroupRoot = fileURLToPath(new URL('../..', import.meta.url))

const temporaries: string[] = []
afterEach(() => {
  for (const dir of temporaries.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function temporary(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temporaries.push(dir)
  return dir
}

/**
 * An installation anchor whose `node_modules` links the real in-box bundle
 * packages, mirroring how the launcher resolves `dsh.profile.bundles` from the
 * dsh installation before falling back to the profile directory.
 */
function stageInstallation(): string {
  const appDir = join(temporary('dsh-claude-code-app-'), 'app')
  const scope = join(appDir, 'node_modules', '@deepseek-ai')
  mkdirSync(scope, { recursive: true })
  const dependencies: Record<string, string> = {}
  for (const [packageName, directory] of [
    ['@deepseek-ai/dsh-base', 'base'],
    ['@deepseek-ai/dsh-headless', 'headless'],
    ['@deepseek-ai/dsh-claude-code', 'claude-code'],
  ] as const) {
    dependencies[packageName] = 'workspace:^'
    symlinkSync(join(bundleGroupRoot, directory), join(scope, packageName.slice('@deepseek-ai/'.length)), 'junction')
  }
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'dsh-app', version: '0.0.0', dependencies }))
  return join(appDir, 'package.json')
}

/** Compose the shipped profile template's bundle layers into its effective row index. */
function composeProfile(): { rows: Map<string, EntryOptions>; layers: string[]; warnings: string[] } {
  const profile = loadProfile('dsh', PROFILE, stageInstallation(), temporary('dsh-claude-code-home-'))
  const warnings: string[] = []
  const rows = composeEntries(profile.layers.map(layer => layer.patches), message => warnings.push(message))
  return {
    rows: new Map(rows.flatMap(row => typeof row.id === 'string' ? [[row.id, row] as const] : [])),
    layers: profile.layers.map(layer => layer.packageName),
    warnings,
  }
}

describe('the shipped claude-code profile (real bundle layers)', () => {
  it('routes the headless one-shot mode to the operator Claude Code installation', () => {
    const { rows, layers, warnings } = composeProfile()
    expect(layers).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@deepseek-ai/dsh-claude-code'])
    // Every id this layer targets exists in the layers below it.
    expect(warnings).toEqual([])

    const route = rows.get('llm-claude-code')
    expect(route?.name).toBe('@deepseek-ai/dsh-llm-claude-code')
    expect(route?.config).toEqual({
      provider: 'claude-code',
      models: [
        { id: 'opus', name: 'Claude Code opus', productModel: 'opus', contextWindow: 200000 },
        { id: 'sonnet', name: 'Claude Code sonnet', productModel: 'sonnet', contextWindow: 200000 },
        { id: 'haiku', name: 'Claude Code haiku', productModel: 'haiku', contextWindow: 200000 },
      ],
      effort: 'medium',
      queryTimeoutMs: 300000,
    })
    // The route injects `subprocess`; the base layer mounts the provider.
    expect(rows.get('subprocess')?.name).toBe('@deepseek-ai/dsh-subprocess-local')

    // An id-targeted patch replaces the whole config: both fields are restated.
    expect(rows.get('agent-default-model')?.config).toEqual({ provider: 'claude-code', model: 'sonnet' })

    // The one-shot surface is unchanged: this layer adds a route, not a mode.
    expect(rows.get('headless-runner')?.name).toBe('@deepseek-ai/dsh-headless')
    expect(rows.get('headless-startup')?.name).toBe('@deepseek-ai/dsh-headless/startup')
    expect(rows.get('hmr')?.disabled).toBe(true)

    const persona = (rows.get('system-prompt')?.config as { persona?: string } | undefined)?.persona
    expect(persona).toContain('Claude Code {{model}}')
    expect(persona).toContain('{{cwd}}')
  })

  it('leaves the keyed adapters mounted, because neither needs a key to load', () => {
    const { rows } = composeProfile()
    for (const id of ['llm-deepseek', 'llm-pi-ai', 'web-search-deepseek']) {
      expect(rows.has(id), `row ${id}`).toBe(true)
      expect(rows.get(id)?.disabled, `row ${id}`).not.toBe(true)
    }
  })

  it('is the shipped template auto-initialized on first use, in layer order', () => {
    expect(PROFILE_TEMPLATES[PROFILE]).toEqual([
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@deepseek-ai/dsh-claude-code',
    ])
  })

  it('declares its patch list and the plugin package that list names', () => {
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-llm-claude-code')
    const patches: unknown = yaml.load(
      readFileSync(resolve(packageRoot, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(patches)) throw new TypeError('the claude-code patch must parse to a patch list')
    // The README names these three rows as the layer's whole reach.
    expect(patches.map(patch => (patch as { id?: string; insert?: { id?: string }[] }).id
      ?? (patch as { insert?: { id?: string }[] }).insert?.map(row => row.id)))
      .toEqual(['agent-default-model', 'system-prompt', ['llm-claude-code']])
  })
})
