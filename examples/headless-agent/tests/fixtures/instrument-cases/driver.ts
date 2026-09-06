#!/usr/bin/env node
/**
 * Test driver: boot the instrument-cases composition, run the registered
 * environment through the runner in a fixed `workspace/` directory, and stream
 * the run session's canonical events as JSONL so a snapshot can pin the
 * clustered directive the implementer sees. It exports the persisted sessions
 * to `./trajectories.jsonl` and ends with one `result` record naming the
 * session, its outcome, and the parity of every recorded run.
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'
import type { RunParity } from '@deepseek-ai/dsh-verification'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('instrument-cases driver requires a config path')

const ctx = await boot('instrument-cases-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates its agent only over the settled application.
  await ctx.get('loader')?.await()
  const runner = ctx.get('environmentRuns')
  const trajectories = ctx.get('trajectories')
  if (runner === undefined || trajectories === undefined) {
    throw new Error('instrument-cases driver requires the runner and the trajectories service')
  }
  // The runner mints its own session; every event of it is streamed from here,
  // so the transcript covers the run from its stamp to its last follow-up. The
  // parity of each attempt is durable, so it is collected from the run events.
  const parity: (RunParity | undefined)[] = []
  const stopStreaming = ctx.on('session/event', (session, event: SessionEvent) => {
    if (event.type === 'verification/run') parity.push(event.data.parity)
    process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId: session.id, event })}\n`)
  }, { global: true })
  const workspace = join(process.cwd(), 'workspace')
  await mkdir(workspace)
  const report = await runner.run({ environment: EnvironmentId('smoke:reverse-words'), workspace })
  stopStreaming()
  const exported = await trajectories.export({ sink: jsonlFileSink('./trajectories.jsonl') })
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    sessionId: report.sessionId,
    certified: report.certified,
    parity,
    exported: exported.exported,
    rewarded: exported.rewarded,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
