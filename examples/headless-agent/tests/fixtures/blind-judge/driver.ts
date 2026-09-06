#!/usr/bin/env node
/**
 * Test driver: boot the blind-judge composition, run the registered environment
 * to one uncertified attempt, then audit that attempt through `ctx.judge`.
 *
 * It streams the JUDGE session's canonical events as JSONL — and only that
 * session's, so the transcript a snapshot pins is the record the judge actually
 * read — and ends with one `result` record carrying the judge session's
 * lineage, its derived history, the tools it could see, and the durable verdict
 * read back from the persisted log.
 */

import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type {} from '@deepseek-ai/dsh-environment-runner'
import type {} from '@deepseek-ai/dsh-judge'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import { JUDGE_PROVIDER } from './judge-mock-llm.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('blind-judge driver requires a config path')

// The shipped roster lives beside the installed app; the smoke runs in a
// temporary cwd, so the composition reads the absolute path from here.
process.env.DSH_BLIND_JUDGE_PRESETS ??= fileURLToPath(
  new URL('../../../../../apps/cli/config/agent-presets/', import.meta.url),
)

const ENVIRONMENT = EnvironmentId('smoke:blind-judge')

/** The text blocks of one derived message, joined. */
function messageText(content: readonly { type: string; text?: string }[]): string {
  return content.flatMap(block => (block.type === 'text' && block.text !== undefined ? [block.text] : [])).join('')
}

/** Every persisted session log under the run's store, parsed line by line. */
async function persistedLogs(root: string): Promise<Record<string, unknown>[][]> {
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.jsonl'))
  return Promise.all(files.map(async file => (await readFile(join(root, file), 'utf8'))
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as Record<string, unknown>)))
}

const ctx = await boot('blind-judge-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates its agent only over the settled application.
  await ctx.get('loader')?.await()
  const runner = ctx.get('environmentRuns')
  const judge = ctx.get('judge')
  const environments = ctx.get('environments')
  const tools = ctx.get('tools')
  if (runner === undefined || judge === undefined || environments === undefined || tools === undefined) {
    throw new Error('blind-judge driver requires the runner, the judge, the environment registry, and the tool registry')
  }
  const definition = environments.get(ENVIRONMENT)
  if (definition === undefined) throw new Error('blind-judge driver requires the registered environment')

  const streams = new Map<string, SessionEvent[]>()
  const stopStreaming = ctx.on('session/event', (session: Session, event: SessionEvent) => {
    const events = streams.get(session.id) ?? []
    events.push(event)
    streams.set(session.id, events)
  }, { global: true })
  // Captured while each agent is live: a disposed agent's scope is unwound, so
  // the composed tool view is only readable here.
  const composed = new Map<string, { session: Session; tools: string[] }>()
  const stopComposing = ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    composed.set(agent.id, { session: agent.session, tools: tools.schemas(agent).map(schema => schema.name).sort() })
  })

  const workspace = join(process.cwd(), 'workspace')
  await mkdir(workspace)
  const report = await runner.run({ environment: ENVIRONMENT, workspace })
  const attempt = report.attempts.at(-1)
  if (attempt === undefined) throw new Error('blind-judge driver requires one recorded attempt')

  const audit = await judge.audit({
    auditedSessionId: report.sessionId,
    attempt: attempt.attempt,
    treeHash: attempt.treeHash,
    workspace,
    taskPrompt: definition.task.prompt,
    results: attempt.results,
    ...report.certificate === undefined ? {} : { certificate: report.certificate },
    model: { provider: JUDGE_PROVIDER, model: JUDGE_PROVIDER },
  })
  stopStreaming()
  stopComposing()

  for (const event of streams.get(audit.judgeSessionId) ?? []) {
    process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId: audit.judgeSessionId, event })}\n`)
  }

  const judged = composed.get(audit.judgeSessionId)
  if (judged === undefined) throw new Error('blind-judge driver never observed the judge agent')
  const logs = await persistedLogs(join(process.cwd(), '.sessions'))
  const judgeLog = logs.find(records => (records[0] as { id?: string } | undefined)?.id === audit.judgeSessionId) ?? []
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    sessionId: audit.judgeSessionId,
    auditedSessionId: report.sessionId,
    attempt: audit.attempt,
    verdict: audit.verdict,
    rationale: audit.rationale,
    treeHash: audit.treeHash,
    implementerCertified: report.certified,
    implementerResults: attempt.results.map(result => ({ checkId: result.checkId, status: result.status })),
    judgeHeader: {
      hasParent: judged.session.header.parentSession !== undefined,
      seedLength: judged.session.header.seedLength ?? 0,
      agentPreset: judged.session.header.agentPreset ?? null,
    },
    judgeTools: judged.tools,
    judgeHistory: judged.session.deriveMessages().map(message => ({
      role: message.role,
      text: messageText(message.content),
    })),
    durableEvents: judgeLog
      .filter(record => typeof record.type === 'string' && record.type.startsWith('judge/'))
      .map(record => ({ type: record.type, data: record.data })),
    sessionCount: streams.size,
    // The two durable records name the audited session on purpose; nothing the
    // judge READ may, which is the property this reports.
    auditedSessionInHistory: judged.session.deriveMessages()
      .some(message => messageText(message.content).includes(report.sessionId)),
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
