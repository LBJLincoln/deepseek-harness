/**
 * What every out-of-process subagent provider does about the read barrier: it
 * records that it enforces by refusing to start, and refuses one start the
 * barrier will not allow. The in-process drivers make neither call — a child
 * that joins its parent's composition inherits the parent's own executors.
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
import {
  SUBAGENT_READ_BARRIER_REFUSED,
  SubagentError,
  assertOutOfProcessAllowed,
  enforceOutOfProcessRefusal,
} from '@deepseek-ai/dsh-subagent'

const roots: string[] = []

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

/** One delegating parent whose session the barrier can reserve. */
function parentAgent(id: string): Agent {
  const sessionId = SessionId(id)
  return { id: sessionId, session: Session.create(sessionId) } as unknown as Agent
}

/** Mount a barrier and register one out-of-process provider's refusal against it. */
async function compose(isolationClaim: ReadBarrierIsolationClaim) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-subagent-barrier-')))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: tmpdir() })
  await ctx.plugin(ReadBarrierService, { root, isolationClaim })
  const providerFiber = await ctx.plugin((inner: Context) => { enforceOutOfProcessRefusal(inner) })
  return { ctx, providerFiber }
}

const entryOf = (ctx: Context) => ctx.readBarrier.enforcementCensus().find(entry => entry.capability === 'subagent')

describe('an out-of-process provider under a read barrier', () => {
  it.each(['process', 'host'] as const)('refuses an implementer start under a %s claim, with its own code', async (claim) => {
    const { ctx } = await compose(claim)
    const parent = parentAgent('implementer')
    ctx.readBarrier.reserve(parent)

    expect(() => { assertOutOfProcessAllowed(ctx, parent) }).toThrow(
      `"subagent" opens paths this process cannot confine and does not start in an implementer session under the "${claim}" isolation claim`,
    )
    try {
      assertOutOfProcessAllowed(ctx, parent)
      expect.unreachable('the provider must refuse')
    } catch (error) {
      expect(error).toBeInstanceOf(SubagentError)
      expect((error as SubagentError).code).toBe(SUBAGENT_READ_BARRIER_REFUSED)
    }
    expect(entryOf(ctx)).toEqual({ capability: 'subagent', state: 'denied-at-executor' })
  })

  it('starts an implementer child under a claim of none and records that it enforces nothing', async () => {
    const { ctx } = await compose('none')
    const parent = parentAgent('unclaimed')
    ctx.readBarrier.reserve(parent)
    expect(() => { assertOutOfProcessAllowed(ctx, parent) }).not.toThrow()
    expect(entryOf(ctx)).toEqual({
      capability: 'subagent',
      state: 'unenforced',
      reason: 'it runs outside this process and the deployment claims "none" isolation, which asserts nothing about what an executor opens',
    })
  })

  it('starts a child of a session the barrier denies nothing', async () => {
    const { ctx } = await compose('process')
    expect(() => { assertOutOfProcessAllowed(ctx, parentAgent('open')) }).not.toThrow()
  })

  it('starts every child when no barrier is composed at all', () => {
    const ctx = new Context()
    expect(() => { enforceOutOfProcessRefusal(ctx) }).not.toThrow()
    expect(() => { assertOutOfProcessAllowed(ctx, parentAgent('barrierless')) }).not.toThrow()
  })

  it('claims nothing once the provider is unloaded', async () => {
    const { ctx, providerFiber } = await compose('process')
    expect(entryOf(ctx)?.state).toBe('denied-at-executor')
    await providerFiber.dispose()
    expect(entryOf(ctx)?.state).toBe('not-composed')
  })
})
