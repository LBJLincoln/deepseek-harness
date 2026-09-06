/**
 * What the worker-thread engine does about the read barrier. An escaped script
 * recovers this process's privileges, so the engine cannot deny a read where it
 * opens paths: it refuses to start instead, and the census records that as its
 * enforcement.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import ReadBarrierService from '@deepseek-ai/dsh-read-barrier'
import type { ReadBarrierIsolationClaim } from '@deepseek-ai/dsh-read-barrier'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentCapabilities, SubagentProvider, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { WorkflowError } from '@deepseek-ai/dsh-workflow'
import WorkerThreadWorkflowEngine from '../src/index.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

/** One agent whose session the barrier can reserve. */
function parentAgent(id: string): Agent {
  const sessionId = SessionId(id)
  return { id: sessionId, session: Session.create(sessionId), options: {} } as unknown as Agent
}

/** The provider the engine routes `agent()` calls to; these scripts start no children. */
class UnusedProvider implements SubagentProvider {
  readonly name = 'spawn'
  readonly capabilities: SubagentCapabilities = {
    outputSchema: false, depthLimit: false, toolFilter: false, persona: false, harnessTools: false,
  }
  readonly inheritsParentContext = false

  start(): Promise<SubagentRun> {
    throw new Error('these workflows start no children')
  }
}

/** Mount the barrier and the engine over a fresh barrier root. */
async function compose(isolationClaim: ReadBarrierIsolationClaim) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-workflow-barrier-')))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: tmpdir() })
  await ctx.plugin(ReadBarrierService, { root, isolationClaim })
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider(new UnusedProvider())
  const engineFiber = await ctx.plugin(WorkerThreadWorkflowEngine, {})
  return { ctx, engineFiber }
}

const source = { script: 'return 1', meta: { name: 'flow', description: 'a workflow' } }
const entryOf = (ctx: Context) => ctx.readBarrier.enforcementCensus().find(entry => entry.capability === 'workflow')

describe('the workflow engine under a read barrier', () => {
  it.each(['process', 'host'] as const)('refuses an implementer run under a %s claim, before the script is parsed', async (claim) => {
    const { ctx } = await compose(claim)
    const parent = parentAgent('implementer')
    ctx.readBarrier.reserve(parent)

    // A body that would fail its own parse: the refusal must come first, so the
    // engine never reaches the work it will not do.
    expect(() => ctx.workflowEngine.start({ script: 'this is not javascript {', meta: source.meta, parent }))
      .toThrow(`"workflow" opens paths this process cannot confine and does not start in an implementer session under the "${claim}" isolation claim`)
    expect(entryOf(ctx)).toEqual({ capability: 'workflow', state: 'denied-at-executor' })
  })

  it('carries the refusal under its own machine-routable code', async () => {
    const { ctx } = await compose('process')
    const parent = parentAgent('coded')
    ctx.readBarrier.reserve(parent)
    try {
      ctx.workflowEngine.start({ ...source, parent })
      expect.unreachable('the engine must refuse')
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowError)
      expect((error as WorkflowError).code).toBe('READ_BARRIER_REFUSED')
    }
  })

  it('starts for a session the barrier denies nothing, even under a process claim', async () => {
    const { ctx } = await compose('process')
    const handle = ctx.workflowEngine.start({ ...source, parent: parentAgent('open') })
    try {
      expect(await handle.result).toMatchObject({ stopReason: 'completed' })
    } finally {
      await handle.dispose()
    }
  })

  it('runs an implementer worker under a claim of none and records that it enforces nothing', async () => {
    const { ctx } = await compose('none')
    const parent = parentAgent('unclaimed')
    ctx.readBarrier.reserve(parent)
    const handle = ctx.workflowEngine.start({ ...source, parent })
    try {
      expect(await handle.result).toMatchObject({ stopReason: 'completed' })
    } finally {
      await handle.dispose()
    }
    expect(entryOf(ctx)).toEqual({
      capability: 'workflow',
      state: 'unenforced',
      reason: 'it runs outside this process and the deployment claims "none" isolation, which asserts nothing about what an executor opens',
    })
  })

  it('claims nothing once the engine is unloaded', async () => {
    const { ctx, engineFiber } = await compose('process')
    expect(entryOf(ctx)?.state).toBe('denied-at-executor')
    await engineFiber.dispose()
    expect(entryOf(ctx)?.state).toBe('not-composed')
  })
})
