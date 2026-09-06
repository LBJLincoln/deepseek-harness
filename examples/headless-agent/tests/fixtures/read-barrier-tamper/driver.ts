#!/usr/bin/env node
/**
 * Test driver: boot the read-barrier-tamper composition, run the registered
 * environment through the runner in a fixed `workspace/` directory, and stream
 * the run session's canonical events as JSONL so a snapshot can pin what the
 * implementer saw. It exports the persisted sessions to `./trajectories.jsonl`
 * and ends with one `result` record naming the session and its outcome.
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('read-barrier-tamper driver requires a config path')

const ctx = await boot('read-barrier-tamper-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates its agent only over the settled application.
  await ctx.get('loader')?.await()
  const runner = ctx.get('environmentRuns')
  const trajectories = ctx.get('trajectories')
  if (runner === undefined || trajectories === undefined) {
    throw new Error('read-barrier-tamper driver requires the runner and the trajectories service')
  }
  // The runner mints its own session; every event of it is streamed from here,
  // so the transcript covers the run from its stamp to its last follow-up. The
  // verdicts are durable, so they are collected from the run events themselves.
  const verdicts: string[] = []
  const stopStreaming = ctx.on('session/event', (session, event: SessionEvent) => {
    if (event.type === 'verification/run') verdicts.push(event.data.verdict)
    process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId: session.id, event })}\n`)
  }, { global: true })
  const workspace = join(process.cwd(), 'workspace')
  await mkdir(workspace)
  const report = await runner.run({ environment: EnvironmentId('smoke:immutable-test'), workspace })
  stopStreaming()
  const exported = await trajectories.export({ sink: jsonlFileSink('./trajectories.jsonl') })
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    sessionId: report.sessionId,
    certified: report.certified,
    verdicts,
    exported: exported.exported,
    rewarded: exported.rewarded,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
