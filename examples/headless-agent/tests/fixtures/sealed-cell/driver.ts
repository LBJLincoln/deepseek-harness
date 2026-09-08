#!/usr/bin/env node
/**
 * Test driver: lay out one run directory the way a fleet does — a plan, a run
 * log, and two `cell-*` workspaces side by side — then run the registered
 * environment in one of them. It reports what the confined shell reached, the
 * refusals the cell session recorded, and the count the run report carries.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { ReadBarrierDenial } from '@deepseek-ai/dsh-read-barrier'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('sealed-cell driver requires a config path')

/** Read one workspace file, answering the empty string when the run never created it. */
async function readIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // Absent is the expected outcome for a leak file: the confined `cat` wrote
    // nothing, so its redirect left an empty file or none at all.
    return ''
  }
}

const ctx = await boot('sealed-cell-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates its agent only over the settled application.
  await ctx.get('loader')?.await()
  const runner = ctx.get('environmentRuns')
  if (runner === undefined) throw new Error('sealed-cell driver requires the runner')

  const run = join(process.cwd(), 'run')
  const workspace = join(run, 'cell-under-test')
  const sibling = join(run, 'cell-sibling')
  await mkdir(workspace, { recursive: true })
  await mkdir(sibling, { recursive: true })
  await writeFile(join(run, 'plan.json'), '{"cells":["cell-under-test","cell-sibling"]}\n')
  await writeFile(join(run, 'run.log'), 'cell-sibling certified\n')
  await writeFile(join(sibling, 'src.js'), 'export const sibling = "solution"\n')
  await writeFile(join(workspace, 'own.txt'), 'own-file\n')

  const toolOutputs: string[] = []
  const denials: ReadBarrierDenial[] = []
  const stopStreaming = ctx.on('session/event', (_session, event: SessionEvent) => {
    if (event.type === 'read-barrier/denied') denials.push(event.data)
    if (event.type !== 'tool/result') return
    for (const block of event.data.message.content) {
      for (const part of block.content) {
        if (part.type === 'text') toolOutputs.push(part.text)
      }
    }
  }, { global: true })

  const report = await runner.run({ environment: EnvironmentId('smoke:sealed-marker'), workspace })
  stopStreaming()

  process.stdout.write(`${JSON.stringify({
    type: 'result',
    certified: report.certified,
    escapesDenied: report.escapesDenied,
    denials,
    toolOutputs,
    leakedPlan: await readIfPresent(join(workspace, 'leaked-plan.txt')),
    leakedSibling: await readIfPresent(join(workspace, 'leaked-sibling.txt')),
    marker: existsSync(join(workspace, 'MARKER')),
    siblingIntact: await readIfPresent(join(sibling, 'src.js')),
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
