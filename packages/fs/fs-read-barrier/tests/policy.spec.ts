/**
 * Decider tests over the real barrier service and the real local provider: what
 * the `fs/read-intent` waterfall answers for each actor, and that a read the
 * barrier allows still reaches the next policy in the chain.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsReadDenial, FsTarget } from '@deepseek-ai/dsh-fs'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import ReadBarrierService from '@deepseek-ai/dsh-read-barrier'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
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

function agentWithSession(id: string, cwd?: string): Agent & { session: Session } {
  const sessionId = SessionId(id)
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 0,
    ...cwd === undefined ? {} : { cwd },
  }
  const session = Session.create(sessionId, undefined, header)
  return { id: sessionId, session } as unknown as Agent & { session: Session }
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

describe('a cell denied everything above its workspace', () => {
  it('reads its own workspace, and nothing in the run directory around it', async () => {
    const { ctx, root } = await setup()
    const run = tempRoot('dsh-fs-read-barrier-run-')
    const workspace = join(run, 'cell-a')
    const sibling = join(run, 'cell-b')
    await mkdir(workspace, { recursive: true })
    await mkdir(sibling, { recursive: true })
    await writeFile(join(run, 'plan.json'), '{}\n')
    await writeFile(join(workspace, 'src.txt'), 'work\n')
    await writeFile(join(sibling, 'src.txt'), 'theirs\n')
    const agent = agentWithSession('cell', workspace)
    ctx.readBarrier.reserve(agent)
    ctx.readBarrier.denyFor(agent.session, run)

    const own = await ctx.fs.resolve(join(workspace, 'src.txt'))
    expect(await decide(ctx, own, { agent })).toEqual({ denial: undefined, delegated: true })
    for (const path of [join(run, 'plan.json'), join(sibling, 'src.txt'), run, join(root, 'standard.json')]) {
      const target = await ctx.fs.resolve(path)
      expect((await decide(ctx, target, { agent })).denial?.code, path).toBe('FS_READ_BARRIER_DENIED')
    }
    // One record per refusal, and none for the read that was allowed.
    expect(agent.session.events.filter(event => event.type === 'read-barrier/denied')).toHaveLength(4)
  })

  it('leaves a sibling cell reading the run directory the other cell may not', async () => {
    const { ctx } = await setup()
    const run = tempRoot('dsh-fs-read-barrier-sibling-')
    await writeFile(join(run, 'plan.json'), '{}\n')
    const sealed = agentWithSession('sealed', run)
    const other = agentWithSession('other', run)
    ctx.readBarrier.reserve(sealed)
    ctx.readBarrier.reserve(other)
    const dispose = ctx.readBarrier.denyFor(sealed.session, run)
    const target = await ctx.fs.resolve(join(run, 'plan.json'))

    expect((await decide(ctx, target, { agent: sealed })).denial?.code).toBe('FS_READ_BARRIER_DENIED')
    expect(await decide(ctx, target, { agent: other })).toEqual({ denial: undefined, delegated: true })
    dispose()
    expect(await decide(ctx, target, { agent: sealed })).toEqual({ denial: undefined, delegated: true })
  })
})

describe('the denial message', () => {
  it('carries the path and no recovery instruction', () => {
    expect(readBarrierDenialMessage('/srv/verification/runs/a/checks/build'))
      .toBe('read denied: "/srv/verification/runs/a/checks/build" is validator-owned — it is not part of this task; continue without it')
  })
})
