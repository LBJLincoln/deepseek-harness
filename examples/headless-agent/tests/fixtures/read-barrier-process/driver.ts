#!/usr/bin/env node
/**
 * Test driver: boot the read-barrier-process composition and run the registered
 * environment, which claims `isolation: process`. It reports one `result` record
 * carrying what the confined shell reached, the enforcement census the barrier
 * recorded, and either the run's certificate or the refusal that stopped it —
 * the two outcomes this host can produce, decided by whether a sandbox backend
 * here can express a denied read root.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ReadBarrierEnforcementEntry } from '@deepseek-ai/dsh-read-barrier'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('read-barrier-process driver requires a config path')

/** Read one workspace file, answering the empty string when the run never created it. */
async function readIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // Absent is the expected outcome for the leak file: the confined `cat`
    // wrote nothing, so its redirect left an empty file or none at all.
    return ''
  }
}

const ctx = await boot('read-barrier-process-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates its agent only over the settled application.
  await ctx.get('loader')?.await()
  const runner = ctx.get('environmentRuns')
  const barrier = ctx.get('readBarrier')
  if (runner === undefined || barrier === undefined) {
    throw new Error('read-barrier-process driver requires the runner and the barrier')
  }
  const workspace = join(process.cwd(), 'workspace')
  await mkdir(workspace)

  const toolOutputs: string[] = []
  let scope: { enforcement: readonly ReadBarrierEnforcementEntry[] } | undefined
  const stopStreaming = ctx.on('session/event', (_session, event: SessionEvent) => {
    if (event.type === 'read-barrier/scope') scope = event.data
    if (event.type !== 'tool/result') return
    const blocks = event.data.message.content
    for (const block of blocks) {
      for (const part of block.content) {
        if (part.type === 'text') toolOutputs.push(part.text)
      }
    }
  }, { global: true })

  let certified = false
  let isolation: string | undefined
  let refusal: { code: string; message: string } | undefined
  try {
    const report = await runner.run({ environment: EnvironmentId('smoke:confined-marker'), workspace })
    certified = report.certified
    isolation = report.certificate?.isolation
  } catch (error: unknown) {
    // The claim failing is the OTHER admissible outcome: a host whose backends
    // cannot express the denial must refuse the claim, not the barrier.
    if (!(error instanceof HarnessError)) throw error
    refusal = { code: error.code, message: error.message }
  }
  stopStreaming()

  process.stdout.write(`${JSON.stringify({
    type: 'result',
    root: barrier.root,
    certified,
    ...isolation === undefined ? {} : { isolation },
    ...refusal === undefined ? {} : { refusal },
    enforcement: scope?.enforcement ?? [],
    toolOutputs,
    leaked: await readIfPresent(join(workspace, 'leaked.txt')),
    marker: existsSync(join(workspace, 'MARKER')),
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
