import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { checkoutRevision, heldOutIds, POLYGLOT_LANGUAGES, readAdmission } from './fixtures/polyglot-bench/polyglot.ts'

const polyglotDir = fileURLToPath(new URL('./fixtures/polyglot-bench/', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/proving-ground-bench/registry-driver.ts', import.meta.url))
const configPath = join(polyglotDir, 'overlays', 'registry-only.cordis.yml')
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const record = readAdmission(join(polyglotDir, 'admission.json'))
/** The checkout the environment names, when it is a repository at the pinned revision; the registration smoke needs the real exercises. */
const checkout = ((path: string | undefined): string | undefined => {
  if (path === undefined || path === '' || !existsSync(join(path, '.git'))) return undefined
  return checkoutRevision(path) === record.revision ? path : undefined
})(process.env.POLYGLOT_BENCH_DIR)
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Boot the registry-only composition over `benchDir`, expecting `exitCode`. */
function bootRegistry(benchDir: string, exitCode: number): ReturnType<typeof runLoaderSmoke> {
  return runLoaderSmoke({
    label: 'polyglot-bench',
    tempDirPrefix: 'polyglot-bench-',
    binScript,
    libBinScript: binScript,
    configPath,
    binArgs: [configPath],
    tsconfigPath,
    env: { POLYGLOT_BENCH_DIR: benchDir },
    expectedExitCode: exitCode,
  })
}

describe('polyglot bench registrar', () => {
  it('refuses to boot when no checkout is named', async () => {
    const { stderr } = await bootRegistry('', 1)
    expect(stderr).toContain('register-environments needs checkout')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('refuses to boot over a checkout at another revision than admission ran against', async () => {
    const other = mkdtempSync(join(tmpdir(), 'polyglot-bench-other-'))
    roots.push(other)
    for (const language of POLYGLOT_LANGUAGES) mkdirSync(join(other, language, 'exercises', 'practice'), { recursive: true })
    writeFileSync(join(other, 'README.md'), 'another revision\n')
    const git = (...args: string[]): void => {
      execFileSync('git', ['-C', other, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args])
    }
    git('init', '--quiet')
    git('add', '--all')
    git('commit', '--quiet', '--message', 'another revision')
    const { stderr } = await bootRegistry(other, 1)
    expect(stderr).toContain(`and admission ran against ${record.revision}`)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it.skipIf(checkout === undefined)('registers every admitted exercise of the pinned checkout, a fifth of each track held out', async () => {
    const { stdout, stderr } = await bootRegistry(checkout ?? '', 0)
    expect(stderr).toBe('')
    const summary = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as {
      total: number
      heldOut: number
      tiers: Record<string, number>
      languages: Record<string, number>
      withReference: number
      ids: string[]
    }
    expect(summary.ids).toEqual([...record.admitted].sort())
    expect(summary.total).toBe(record.admitted.length)
    expect(summary.withReference).toBe(record.admitted.length)
    expect(summary.heldOut).toBe(heldOutIds(record.admitted).size)
    expect(summary.tiers).toEqual({})
    for (const language of POLYGLOT_LANGUAGES) {
      expect(summary.languages[language]).toBe(record.admitted.filter(id => id.startsWith(`polyglot:${language}:`)).length)
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
