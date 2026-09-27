#!/usr/bin/env node
/**
 * Test driver: boot the self-review-rung composition, run the registered
 * environment through the runner in a fixed `workspace/` directory over a
 * one-rung ladder whose rung asks for a self-review — the specification review
 * by default, the probe review when the second argument is `probe` — and
 * stream the run session's canonical events as JSONL so a snapshot can pin the
 * review turn the implementer sees between its work and the validation. It
 * ends with one `result` record naming the session, its outcome, and the user
 * turns the cell received.
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const [configPath, reviewArg] = process.argv.slice(2)
if (configPath === undefined) throw new Error('self-review-rung driver requires a config path')
if (reviewArg !== undefined && reviewArg !== 'probe') {
  throw new Error(`self-review-rung driver takes an optional review kind of 'probe', got ${JSON.stringify(reviewArg)}`)
}
const selfReview = reviewArg === undefined ? true : 'probe'

const ctx = await boot('self-review-rung-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates its agent only over the settled application.
  await ctx.get('loader')?.await()
  const runner = ctx.get('environmentRuns')
  if (runner === undefined) throw new Error('self-review-rung driver requires the runner')
  // The runner mints its own session; every event of it is streamed from here,
  // so the transcript covers the run from its stamp to its certificate. The
  // user turns are durable, so they are collected from the events themselves.
  const turns: string[] = []
  const stopStreaming = ctx.on('session/event', (session, event: SessionEvent) => {
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      turns.push(event.data.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join(''))
    }
    process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId: session.id, event })}\n`)
  }, { global: true })
  const workspace = join(process.cwd(), 'workspace')
  await mkdir(workspace)
  const report = await runner.run({ environment: EnvironmentId('smoke:ready-marker'), workspace, ladder: [{ selfReview }] })
  stopStreaming()
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    sessionId: report.sessionId,
    certified: report.certified,
    attempts: report.attempts.length,
    turns,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
