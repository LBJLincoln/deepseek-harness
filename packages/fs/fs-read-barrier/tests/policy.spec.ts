/**
 * Decider tests over the real barrier service and the real local provider: what
 * the `fs/read-intent` waterfall answers for each actor, and that a read the
 * barrier allows still reaches the next policy in the chain.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsReadDenial, FsTarget } from '@deepseek-ai/dsh-fs'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import ReadBarrierService from '@deepseek-ai/dsh-read-barrier'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as FsReadBarrier from '../src/index.ts'
import { readBarrierDenialMessage } from '../src/index.ts'

const roots: string[] = []

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  roots.push(root)
  return root
}

async function setup() {
  const root = tempRoot('dsh-fs-read-barrier-root-')
  const workspace = tempRoot('dsh-fs-read-barrier-workspace-')
  await writeFile(join(root, 'standard.json'), '{}\n')
  await writeFile(join(workspace, 'src.txt'), 'work\n')
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  await ctx.plugin(ReadBarrierService, { root })
  await ctx.plugin(FsReadBarrier)
  return { ctx, root, workspace }
}

function agentWithSession(id: string): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session } as unknown as Agent & { session: Session }
}

/** Dispatch the waterfall exactly as a read executor does, with a recorded fallthrough. */
async function decide(ctx: Context, target: FsTarget, actor: object | undefined): Promise<{
  denial: FsReadDenial | undefined
  delegated: boolean
}> {
  let delegated = false
  const denial = await ctx.waterfall('fs/read-intent', target, actor, () => {
    delegated = true
    return undefined
  })
  return { denial, delegated }
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

describe('fs/read-intent decisions', () => {
  it('refuses a validator-owned target for an implementer session and records it', async () => {
    const { ctx, root } = await setup()
    const agent = agentWithSession('implementer')
    ctx.readBarrier.reserve(agent)
    const target = await ctx.fs.resolve(join(root, 'standard.json'))
    const { denial, delegated } = await decide(ctx, target, { agent })
    expect(denial).toEqual({
      code: 'FS_READ_BARRIER_DENIED',
      message: `read denied: "${target.displayPath}" is validator-owned — it is not part of this task; continue without it`,
    })
    expect(delegated).toBe(false)
  })

  it('delegates a workspace target for the same implementer session', async () => {
    const { ctx, workspace } = await setup()
    const agent = agentWithSession('implementer')
    ctx.readBarrier.reserve(agent)
    const target = await ctx.fs.resolve(join(workspace, 'src.txt'))
    expect(await decide(ctx, target, { agent })).toEqual({ denial: undefined, delegated: true })
  })

  it('delegates a validator-owned target for a session holding no reservation', async () => {
    const { ctx, root } = await setup()
    const target = await ctx.fs.resolve(join(root, 'standard.json'))
    expect(await decide(ctx, target, { agent: agentWithSession('validator') }))
      .toEqual({ denial: undefined, delegated: true })
  })

  it('delegates a call with no agent session', async () => {
    const { ctx, root } = await setup()
    const target = await ctx.fs.resolve(join(root, 'standard.json'))
    expect(await decide(ctx, target, undefined)).toEqual({ denial: undefined, delegated: true })
    expect(await decide(ctx, target, {})).toEqual({ denial: undefined, delegated: true })
  })

  it('stops deciding once the fiber is disposed (HMR safety)', async () => {
    const root = tempRoot('dsh-fs-read-barrier-hmr-')
    await writeFile(join(root, 'standard.json'), '{}\n')
    const ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(ReadBarrierService, { root })
    const fiber = await ctx.plugin(FsReadBarrier)
    const agent = agentWithSession('implementer')
    ctx.readBarrier.reserve(agent)
    const target = await ctx.fs.resolve(join(root, 'standard.json'))
    expect((await decide(ctx, target, { agent })).denial?.code).toBe('FS_READ_BARRIER_DENIED')
    await fiber.dispose()
    expect(await decide(ctx, target, { agent })).toEqual({ denial: undefined, delegated: true })
  })
})

describe('the denial message', () => {
  it('carries the path and no recovery instruction', () => {
    expect(readBarrierDenialMessage('/srv/verification/runs/a/checks/build'))
      .toBe('read denied: "/srv/verification/runs/a/checks/build" is validator-owned — it is not part of this task; continue without it')
  })
})
