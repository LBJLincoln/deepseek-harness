import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import ComponentRegistry from '@deepseek-ai/dsh-components'
import type { ComponentDigest } from '@deepseek-ai/dsh-components/types'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SessionStore, { Session, SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import SkillRegistry, { skillDigest, type SkillDefinition } from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as adapter from '@deepseek-ai/dsh-components-skills'
import { skillComponentId } from '@deepseek-ai/dsh-components-skills'
import * as invariantCompanion from '@deepseek-ai/dsh-components-skills/invariant'

const signal = new AbortController().signal

/** The `skill` tool under test: the load record the adapter reads is its canonical value. */
function skillTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'skill',
    description: 'Load the full instructions for an available skill.',
    parameters: { name: { type: 'string', required: true, description: 'Skill name.' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          digest: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.content }],
    },
    async execute(args, exec) {
      const skill = await ctx.skills.get(args.name, { scope: exec.agent })
      if (skill === undefined) throw new Error(`skill "${args.name}" is unknown`)
      return { name: skill.name, digest: skillDigest(skill), content: skill.content }
    },
  }))
}

async function harness(): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(SessionStore)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(ComponentRegistry)
  await ctx.plugin(Object.assign((inner: Context) => { skillTool(inner) }, { inject: ['tools', 'skills'] }))
  const fiber = await ctx.plugin(adapter)
  return { ctx, fiber }
}

function definition(name: string, content: string): SkillDefinition {
  return {
    name,
    description: `${name} description`,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'runtime',
    provider: 'runtime',
    content,
  }
}

/** Load one skill through the tool, which is what puts a generation in play. */
async function load(ctx: Context, name: string, callId: string, agent?: Agent): Promise<void> {
  const result = await ctx.tools.execute({
    signal,
    callId: CallId(callId),
    name: 'skill',
    arguments: { name },
    ...agent === undefined ? {} : { agent },
  })
  if (result.isError) throw new Error(`expected the skill load to succeed: ${result.error.message}`)
}

describe('@deepseek-ai/dsh-components-skills', () => {
  it('registers nothing until a skill body is loaded', async () => {
    const { ctx } = await harness()
    expect(adapter.name).toBe('components-skills')
    expect(adapter.inject).toEqual(['agents', 'components', 'skills', 'tools'])
    ctx.skills.register(definition('reachable-skill', 'Reachable body.'))
    expect(ctx.components.list({ kind: 'skill' })).toEqual([])

    await load(ctx, 'reachable-skill', 'c1')
    expect(ctx.components.get(skillComponentId('reachable-skill'))).toMatchObject({
      kind: 'skill',
      name: 'reachable-skill',
      layer: 'global',
      digestBasis: 'content',
      provenance: 'curated',
      owner: '@deepseek-ai/dsh-components-skills',
      invoke: { tool: 'skill', arguments: { name: 'reachable-skill' } },
      detail: { skillName: 'reachable-skill' },
    })
  })

  it('addresses the loaded generation by the digest the skill seam owns', async () => {
    const { ctx } = await harness()
    ctx.skills.register(definition('addressed-skill', 'Addressed body.'))
    await load(ctx, 'addressed-skill', 'c1')
    expect(ctx.components.get(skillComponentId('addressed-skill'))?.digest)
      .toBe(skillDigest(definition('addressed-skill', 'Addressed body.')))
  })

  it('ignores a failed load and a same-named tool whose value names no generation', async () => {
    const { ctx } = await harness()
    const failed = await ctx.tools.execute({
      signal, callId: CallId('c1'), name: 'skill', arguments: { name: 'absent-skill' },
    })
    expect(failed.isError).toBe(true)
    await ctx.plugin(Object.assign((inner: Context) => {
      inner.tools.register(defineTool({
        name: 'other_tool',
        description: 'A tool that is not the skill loader.',
        parameters: {},
        output: {
          schema: { type: 'object', additionalProperties: true, properties: {} },
          render: () => [{ type: 'text', text: 'ok' }],
        },
        execute: () => Promise.resolve({ name: 'forged-skill', digest: 'a'.repeat(64) }),
      }))
    }, { inject: ['tools'] }))
    await ctx.tools.execute({ signal, callId: CallId('c2'), name: 'other_tool', arguments: {} })
    expect(ctx.components.list({ kind: 'skill' })).toEqual([])
  })

  it('refuses a load record whose name or digest cannot address a generation', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(SessionStore)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ComponentRegistry)
    await ctx.plugin(adapter)
    await ctx.plugin(Object.assign((inner: Context) => {
      inner.tools.register(defineTool({
        name: 'skill',
        description: 'A same-named tool returning an unaddressable value.',
        parameters: { name: { type: 'string', required: true, description: 'Case name.' } },
        output: {
          schema: { type: 'object', additionalProperties: true, properties: {} },
          render: () => [{ type: 'text', text: 'ok' }],
        },
        execute: args => Promise.resolve(args.name === 'no-name'
          ? { digest: 'b'.repeat(64) }
          : { name: 'truncated-skill', digest: 'b'.repeat(16) }),
      }))
    }, { inject: ['tools'] }))
    await ctx.tools.execute({ signal, callId: CallId('c1'), name: 'skill', arguments: { name: 'no-name' } })
    await ctx.tools.execute({ signal, callId: CallId('c2'), name: 'skill', arguments: { name: 'short-digest' } })
    expect(ctx.components.list({ kind: 'skill' })).toEqual([])
  })

  it('records a user-explicit invocation from its durable message source', async () => {
    const { ctx } = await harness()
    const session = ctx.sessions.create(SessionId('invocation-session'), { meta: { cwd: '/workspace' } })
    const digest = skillDigest(definition('invoked-skill', 'Invoked body.'))
    appendUserMessage(session, createUserMessage({
      content: [{ type: 'text', text: '<skill_content name="invoked-skill"></skill_content>' }],
      source: { kind: 'skill-invocation', name: 'invoked-skill', digest, form: 'instructions' },
    }))
    expect(ctx.components.get(skillComponentId('invoked-skill'))?.digest).toBe(digest)

    // A message of another source, and a durable source carrying no address,
    // leave the inventory alone.
    appendUserMessage(session, createUserMessage({
      content: [{ type: 'text', text: 'plain prose' }],
      source: { kind: 'user' },
    }))
    appendUserMessage(session, createUserMessage({
      content: [{ type: 'text', text: 'seeded' }],
      source: { kind: 'skill-invocation', name: 'seeded-skill', form: 'instructions' } as never,
    }))
    session.append('step/start', { turn: 1, step: 1 })
    expect(ctx.components.list({ kind: 'skill' })).toHaveLength(1)
  })

  it('re-addresses a body edited in place and drops a skill the registry lost', async () => {
    const { ctx } = await harness()
    let disposeFirst = ctx.skills.register(definition('edited-skill', 'First body.'))
    ctx.skills.register(definition('kept-skill', 'Kept body.'))
    await load(ctx, 'edited-skill', 'c1')
    await load(ctx, 'kept-skill', 'c2')
    const first = ctx.components.get(skillComponentId('edited-skill'))?.digest

    disposeFirst()
    disposeFirst = ctx.skills.register(definition('edited-skill', 'Second body.'))
    await settle()
    const second = ctx.components.get(skillComponentId('edited-skill'))
    expect(second?.digest).not.toBe(first)
    expect(second?.digest).toBe(skillDigest(definition('edited-skill', 'Second body.')))
    expect(ctx.components.get(skillComponentId('kept-skill'))?.digest)
      .toBe(skillDigest(definition('kept-skill', 'Kept body.')))

    disposeFirst()
    await settle()
    expect(ctx.components.get(skillComponentId('edited-skill'))).toBeUndefined()
    expect(ctx.components.get(skillComponentId('kept-skill'))).toBeDefined()
  })

  it('contains a failing reload and keeps the generation it cannot re-address', async () => {
    const { ctx } = await harness()
    ctx.skills.register(definition('fragile-skill', 'Fragile body.'))
    await load(ctx, 'fragile-skill', 'c1')
    const digest = ctx.components.get(skillComponentId('fragile-skill'))?.digest
    const warnings: string[] = []
    ctx.logger.warn = (message: unknown) => { warnings.push(String(message)) }
    ctx.skills.get = () => Promise.reject(new Error('provider offline'))

    await ctx.plugin(Object.assign(
      (inner: Context) => { inner.skills.register(definition('other-skill', 'Other body.')) },
      { inject: ['skills'] },
    ))
    await settle()
    expect(warnings.some(entry => entry.includes('fragile-skill') && entry.includes('provider offline'))).toBe(true)
    expect(ctx.components.get(skillComponentId('fragile-skill'))?.digest).toBe(digest)
  })

  it('does not resurrect a registration after the adapter fiber is disposed', async () => {
    const { ctx, fiber } = await harness()
    ctx.skills.register(definition('late-skill', 'Late body.'))
    await load(ctx, 'late-skill', 'c1')
    expect(ctx.components.list({ kind: 'skill' })).toHaveLength(1)

    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const real = ctx.skills.get.bind(ctx.skills)
    ctx.skills.get = async (skillName: string) => {
      await gate
      return await real(skillName)
    }
    ctx.skills.register(definition('trigger-skill', 'Trigger body.'))
    await fiber.dispose()
    release()
    await settle()
    expect(ctx.components.list({ kind: 'skill' })).toEqual([])
  })

  it('files a load into the calling agent layer when the tool call carries one', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(SessionStore)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ComponentRegistry)
    await ctx.plugin(Object.assign((inner: Context) => { skillTool(inner) }, { inject: ['tools', 'skills'] }))
    const { scope, key } = await mintAgentScope(ctx, 'agent-1')
    await scope.ctx.plugin(adapter)
    scope.ctx.skills.register(definition('scoped-skill', 'Scoped body.'))
    await load(ctx, 'scoped-skill', 'c1', key)

    const scoped = ctx.components.list({ kind: 'skill', scope: key })
    expect(scoped.map(component => component.name)).toEqual(['scoped-skill'])
    expect(scoped[0]?.layer).toBe('agent')
    expect(ctx.components.list({ kind: 'skill' })).toEqual([])
    await scope.dispose()
    expect(ctx.components.list({ kind: 'skill', scope: key })).toEqual([])
  })

  it('removes every mirrored component when the adapter fiber is disposed', async () => {
    const { ctx, fiber } = await harness()
    ctx.skills.register(definition('disposed-skill', 'Disposed body.'))
    await load(ctx, 'disposed-skill', 'c1')
    expect(ctx.components.list({ kind: 'skill' })).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.components.list({ kind: 'skill' })).toEqual([])
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})

/** Append one claimed user message the way the agent loop records a step's batch. */
function appendUserMessage(session: Session, message: UserMessage): void {
  session.append('user/message', message, { surfaceOp: 'append' })
}

/** Let every queued reload of a `skills/change` replay settle. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
}

/** Mint a scope whose key doubles as a minimal Agent-like object. */
async function mintAgentScope(ctx: Context, id: string): Promise<{ scope: Scope; key: Agent }> {
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, [], { version: 0, id: sessionId, createdAt: 0, cwd: '/workspace' })
  const key = {
    id: sessionId,
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
  } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign(
    (inner: Context) => { scope = createScope(inner, key) },
    { inject: ['components', 'skills', 'tools'] },
  ))
  return { scope, key }
}

/** The digest brand only ever crosses this file as a value the seam produced. */
export type { ComponentDigest }
