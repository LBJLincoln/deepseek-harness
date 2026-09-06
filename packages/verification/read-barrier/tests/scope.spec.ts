/**
 * Tool authority and the composition census: the denied-authority rule, the
 * per-agent execution guard, the enforcement registry, the `read-barrier/scope`
 * record, and the host attestation's verification decision.
 */

import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolAuthority, ToolDefinition } from '@deepseek-ai/dsh-tools'
import ReadBarrierService, {
  attestationProblem,
  authorityDenialMessage,
  deniedAuthority,
  deniedReadRoots,
  ENFORCED_CAPABILITY_SERVICES,
  READ_BARRIER_ATTESTATION_VERSION,
  READ_BARRIER_SCOPE_VERSION,
  startRefusalMessage,
} from '../src/index.ts'
import type { Config } from '../src/index.ts'

const roots: string[] = []
const signal = new AbortController().signal

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
  vi.restoreAllMocks()
})

/** One tool definition, optionally declaring authority. */
function tool(name: string, authority?: readonly ToolAuthority[]): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: (): Promise<string> => Promise.resolve(`ran:${name}`),
    ...authority === undefined ? {} : { authority },
  }
}

/** An agent-like handle over a real scope context, as the barrier's listeners receive it. */
interface Harness {
  readonly ctx: Context
  readonly agent: Agent & { session: Session; ctx: Context }
}

/** Publish one more scoped agent over an existing composition, as a second session would. */
async function publish(ctx: Context, id: string): Promise<Agent & { session: Session; ctx: Context }> {
  const session = Session.create(SessionId(id))
  const key = { id: SessionId(id), session } as unknown as Agent & { session: Session }
  let scope!: Scope
  // The minting plugin's injections are what a scope holder resolves through,
  // exactly as the agent loop's inject list plays that role in production.
  await ctx.plugin(Object.assign(
    (inner: Context) => { scope = createScope(inner, key) },
    { inject: ['tools', 'systemPrompt'] },
  ))
  const agent = Object.assign(key, { ctx: scope.ctx })
  // Publication is what installs the agent's own authority guard, exactly as
  // the agent factory publishes a settled composition.
  ctx.emit('agent/created', { agent })
  return agent
}

/** Mount the registry, the barrier, and one scoped agent context over a temporary root. */
async function harness(config: Config = {}, id = 'scoped'): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: tmpdir() })
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ReadBarrierService, { root: tempRoot('dsh-read-barrier-scope-'), ...config })
  return { ctx, agent: await publish(ctx, id) }
}

/** Drive the census the way the loop does: the waterfall that precedes `request/header`. */
async function request(ctx: Context, agent: Agent): Promise<void> {
  const seed: LlmCallConfig = { provider: 'p', model: 'm' }
  await agentEvents(ctx, agent).waterfall(
    'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
  )
}

describe('the denied-authority rule', () => {
  it.each([
    ['session-log'],
    ['plugin-mount'],
    ['runtime-introspection'],
  ] as const)('denies an implementer the %s authority', (authority) => {
    expect(deniedAuthority('implementer', [authority])).toBe(authority)
  })

  it('reports the first authority a tool declares', () => {
    expect(deniedAuthority('implementer', ['plugin-mount', 'session-log'])).toBe('plugin-mount')
  })

  it('denies nothing to a tool that declares no authority', () => {
    expect(deniedAuthority('implementer', undefined)).toBeUndefined()
    expect(deniedAuthority('implementer', [])).toBeUndefined()
  })

  it.each(['validator', 'unrestricted'] as const)('denies a %s session nothing', (role) => {
    expect(deniedAuthority(role, ['session-log'])).toBeUndefined()
  })

  it('states the refusal without a recovery instruction', () => {
    expect(authorityDenialMessage('session_search', 'session-log'))
      .toBe('"session_search" carries the "session-log" authority and is not callable in an implementer session')
  })

  it('names the capability and the claim in a start refusal', () => {
    expect(startRefusalMessage('subagent', 'host'))
      .toBe('"subagent" opens paths this process cannot confine and does not start in an implementer session under the "host" isolation claim')
  })
})

describe('the per-agent execution guard', () => {
  it('denies an authority-bearing tool registered after the composition settled', async () => {
    const { ctx, agent } = await harness({}, 'guarded')
    ctx.readBarrier.reserve(agent)
    // Registered into the agent's OWN layer after `agent/created`: no mount
    // audit ever saw this tool, which is what the guard exists to cover.
    agent.ctx.tools.register(tool('session_search', ['session-log']))
    agent.ctx.tools.register(tool('read'))

    const denied = await ctx.tools.execute({ signal, callId: CallId('c1'), name: 'session_search', arguments: {}, agent })
    expect(denied.isError).toBe(true)
    expect(denied.content).toEqual([{
      type: 'text',
      text: 'Error: "session_search" carries the "session-log" authority and is not callable in an implementer session',
    }])
    // The denial is authority, not visibility: the tool is registered and the
    // session's ordinary tools still run.
    expect(ctx.tools.schemas(agent).map(schema => schema.name).sort()).toEqual(['read', 'session_search'])
    const allowed = await ctx.tools.execute({ signal, callId: CallId('c2'), name: 'read', arguments: {}, agent })
    expect(allowed.isError).toBe(false)
  })

  it('leaves a session that holds no implementer role able to call the same tool', async () => {
    const { ctx, agent } = await harness({}, 'open')
    agent.ctx.tools.register(tool('session_search', ['session-log']))
    const result = await ctx.tools.execute({ signal, callId: CallId('c1'), name: 'session_search', arguments: {}, agent })
    expect(result.isError).toBe(false)
  })

  it('denies only the implementer when two sessions share one composition and one tool', async () => {
    const { ctx, agent: implementer } = await harness({}, 'shared-implementer')
    const open = await publish(ctx, 'shared-open')
    ctx.readBarrier.reserve(implementer)
    // One global registration both sessions see: each guard is registered on
    // its own agent's context and answers for that agent alone, so a guard
    // closing over the wrong session cannot decide the other session's call.
    ctx.tools.register(tool('session_search', ['session-log']))

    const denied = await ctx.tools.execute({
      signal, callId: CallId('c1'), name: 'session_search', arguments: {}, agent: implementer,
    })
    const allowed = await ctx.tools.execute({
      signal, callId: CallId('c2'), name: 'session_search', arguments: {}, agent: open,
    })

    expect(denied.isError).toBe(true)
    expect(allowed.isError).toBe(false)
  })

  it('composes no guard when the agent context has no tool registry', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd: tmpdir() })
    await ctx.plugin(ReadBarrierService, { root: tempRoot('dsh-read-barrier-registryless-') })
    const session = Session.create(SessionId('registryless'))
    const agent = { id: SessionId('registryless'), session, ctx } as unknown as Agent
    expect(() => { ctx.emit('agent/created', { agent }) }).not.toThrow()
  })
})

describe('the enforcement census', () => {
  it('reports a registered capability as denied-at-executor for as long as the registration lives', async () => {
    const { ctx } = await harness({}, 'enforced')
    const stateOf = (capability: string) =>
      ctx.readBarrier.enforcementCensus().find(entry => entry.capability === capability)?.state
    expect(stateOf('fs')).toBe('unenforced')
    const dispose = ctx.readBarrier.enforce('fs')
    expect(stateOf('fs')).toBe('denied-at-executor')
    dispose()
    expect(stateOf('fs')).toBe('unenforced')
  })

  it('reports every capability the composition lacks as not-composed, in one fixed order', async () => {
    const { ctx } = await harness({}, 'sparse')
    expect(ctx.readBarrier.enforcementCensus()).toEqual([
      { capability: 'fs', state: 'unenforced' },
      { capability: 'shell', state: 'not-composed' },
      { capability: 'subprocess', state: 'not-composed' },
      { capability: 'terminal', state: 'not-composed' },
      { capability: 'subagent', state: 'not-composed' },
      { capability: 'workflow', state: 'not-composed' },
    ])
    expect(Object.keys(ENFORCED_CAPABILITY_SERVICES))
      .toEqual(['fs', 'shell', 'subprocess', 'terminal', 'subagent', 'workflow'])
  })

  it('carries the reason a composed capability records for enforcing nothing', async () => {
    const { ctx } = await harness({}, 'unenforceable')
    const entryOf = (capability: string) =>
      ctx.readBarrier.enforcementCensus().find(entry => entry.capability === capability)
    const dispose = ctx.readBarrier.cannotEnforce('fs', 'no backend on this host denies reads')
    expect(entryOf('fs')).toEqual({ capability: 'fs', state: 'unenforced', reason: 'no backend on this host denies reads' })
    dispose()
    expect(entryOf('fs')).toEqual({ capability: 'fs', state: 'unenforced' })
  })

  it('lets an enforcing registration outrank a reason recorded for the same capability', async () => {
    const { ctx } = await harness({}, 'both')
    ctx.readBarrier.cannotEnforce('fs', 'stale reason')
    ctx.readBarrier.enforce('fs')
    expect(ctx.readBarrier.enforcementCensus()[0]).toEqual({ capability: 'fs', state: 'denied-at-executor' })
  })
})

describe('a capability that enforces by refusing to start', () => {
  it.each(['process', 'host'] as const)('denies at the executor and refuses an implementer under a %s claim', async (isolationClaim) => {
    const { ctx, agent } = await harness({ isolationClaim }, `refusing-${isolationClaim}`)
    ctx.readBarrier.enforceByRefusal('workflow')
    ctx.readBarrier.reserve(agent)
    expect(ctx.readBarrier.enforcementCensus().find(entry => entry.capability === 'workflow'))
      .toEqual({ capability: 'workflow', state: 'denied-at-executor' })
    expect(ctx.readBarrier.startRefusal('workflow', agent.session)).toBe(
      `"workflow" opens paths this process cannot confine and does not start in an implementer session under the "${isolationClaim}" isolation claim`,
    )
  })

  it('records unenforced with its reason and starts under a claim of none', async () => {
    const { ctx, agent } = await harness({}, 'refusing-none')
    ctx.readBarrier.enforceByRefusal('subagent')
    ctx.readBarrier.reserve(agent)
    expect(ctx.readBarrier.enforcementCensus().find(entry => entry.capability === 'subagent')).toEqual({
      capability: 'subagent',
      state: 'unenforced',
      reason: 'it runs outside this process and the deployment claims "none" isolation, which asserts nothing about what an executor opens',
    })
    expect(ctx.readBarrier.startRefusal('subagent', agent.session)).toBeUndefined()
  })

  it('starts for a session the barrier denies nothing, and for an agentless call', async () => {
    const { ctx, agent } = await harness({ isolationClaim: 'process' }, 'refusing-open')
    ctx.readBarrier.enforceByRefusal('workflow')
    expect(ctx.readBarrier.startRefusal('workflow', agent.session)).toBeUndefined()
    expect(ctx.readBarrier.startRefusal('workflow', undefined)).toBeUndefined()
  })

  it('stops claiming enforcement once the registration is disposed', async () => {
    const { ctx } = await harness({ isolationClaim: 'process' }, 'refusing-disposed')
    const dispose = ctx.readBarrier.enforceByRefusal('workflow')
    expect(ctx.readBarrier.enforcementCensus().find(entry => entry.capability === 'workflow')?.state)
      .toBe('denied-at-executor')
    dispose()
    expect(ctx.readBarrier.enforcementCensus().find(entry => entry.capability === 'workflow')?.state)
      .toBe('not-composed')
  })
})

describe('the denied set a policy binds', () => {
  it('is every denied directory for an implementer and nothing for any other role', async () => {
    const { ctx, agent } = await harness({}, 'denied-roots')
    expect(deniedReadRoots(ctx.readBarrier.resolve({ session: agent.session }))).toEqual([])
    ctx.readBarrier.reserve(agent)
    expect(deniedReadRoots(ctx.readBarrier.resolve({ session: agent.session }))).toEqual([ctx.readBarrier.root])
    ctx.readBarrier.declareComposition(agent, { presetId: 'judge', role: 'validator' })
    expect(deniedReadRoots(ctx.readBarrier.resolve({ session: agent.session }))).toEqual([])
  })
})

describe('the declared composition', () => {
  it('lets a preset role outrank a reservation, and unwinds with the agent', async () => {
    const { ctx, agent } = await harness({}, 'declared')
    ctx.readBarrier.reserve(agent)
    expect(ctx.readBarrier.resolve({ session: agent.session }).role).toBe('implementer')
    ctx.readBarrier.declareComposition(agent, { presetId: 'judge', role: 'validator' })
    expect(ctx.readBarrier.resolve({ session: agent.session }).role).toBe('validator')
    ctx.emit('agent/disposed', { agent })
    expect(ctx.readBarrier.resolve({ session: agent.session }).role).toBe('unrestricted')
  })

  it('leaves the reservation to decide when the preset declares no role', async () => {
    const { ctx, agent } = await harness({}, 'undeclared')
    ctx.readBarrier.declareComposition(agent, { presetId: 'coding' })
    expect(ctx.readBarrier.resolve({ session: agent.session }).role).toBe('unrestricted')
    ctx.readBarrier.reserve(agent)
    expect(ctx.readBarrier.resolve({ session: agent.session }).role).toBe('implementer')
  })
})

describe('the scope census', () => {
  it('records the role, the preset, the denied set, every visible tool, and the enforcement, once', async () => {
    const { ctx, agent } = await harness({}, 'censused')
    ctx.readBarrier.enforce('fs')
    ctx.readBarrier.declareComposition(agent, { presetId: 'implementing', role: 'implementer' })
    ctx.tools.register(tool('read'))
    agent.ctx.tools.register(tool('cordis_inspect_self', ['runtime-introspection']))

    await request(ctx, agent)
    await request(ctx, agent)

    const scopes = agent.session.events.filter(event => event.type === 'read-barrier/scope')
    expect(scopes).toHaveLength(1)
    expect(scopes[0]?.data).toEqual({
      version: READ_BARRIER_SCOPE_VERSION,
      role: 'implementer',
      presetId: 'implementing',
      root: ctx.readBarrier.root,
      denied: [ctx.readBarrier.root],
      // Sorted by tool name: registry order follows concurrent Loader mounts,
      // so two runs of one composition would otherwise record different censuses.
      census: [
        { name: 'cordis_inspect_self', authority: ['runtime-introspection'] },
        { name: 'read', authority: [] },
      ],
      enforcement: [
        { capability: 'fs', state: 'denied-at-executor' },
        { capability: 'shell', state: 'not-composed' },
        { capability: 'subprocess', state: 'not-composed' },
        { capability: 'terminal', state: 'not-composed' },
        { capability: 'subagent', state: 'not-composed' },
        { capability: 'workflow', state: 'not-composed' },
      ],
    })
  })

  it('sorts the census by tool name whatever order the registry answers in', async () => {
    const { ctx, agent } = await harness({}, 'sorted')
    for (const registered of ['workflow', 'ralph', 'send_message', 'interrupt_agent', 'bash']) {
      ctx.tools.register(tool(registered))
    }
    await request(ctx, agent)
    const scope = agent.session.events.find(event => event.type === 'read-barrier/scope')?.data
    expect(scope?.census.map(entry => entry.name))
      .toEqual(['bash', 'interrupt_agent', 'ralph', 'send_message', 'workflow'])
  })

  it('records an empty census and no preset when the composition has neither roster nor registry', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd: tmpdir() })
    await ctx.plugin(ReadBarrierService, { root: tempRoot('dsh-read-barrier-bare-') })
    const session = Session.create(SessionId('bare'))
    const agent = { id: SessionId('bare'), session, ctx } as unknown as Agent
    await request(ctx, agent)
    expect(session.events.map(event => event.type)).toEqual(['read-barrier/scope'])
    expect(session.events[0]?.data).toMatchObject({ role: 'unrestricted', census: [] })
    expect(session.events[0]?.data).not.toHaveProperty('presetId')
  })

  it('takes a fresh census after the agent is disposed and a new one takes its id', async () => {
    const { ctx, agent } = await harness({}, 'recensused')
    await request(ctx, agent)
    ctx.emit('agent/disposed', { agent })
    await request(ctx, agent)
    expect(agent.session.events.filter(event => event.type === 'read-barrier/scope')).toHaveLength(2)
  })
})

describe('the host attestation', () => {
  it('accepts only a regular file another account owns and its owner alone can write', () => {
    const foreign = { uid: 4242, mode: 0o100_444, isFile: true, sha256: 'abc' }
    expect(attestationProblem(foreign, 1000)).toBeUndefined()
    expect(attestationProblem({ ...foreign, isFile: false }, 1000)).toBe('is not a regular file')
    expect(attestationProblem(foreign, undefined))
      .toBe('cannot be attributed to an operating-system owner on this platform')
    expect(attestationProblem({ ...foreign, uid: 1000 }, 1000))
      .toBe('is owned by this harness account (uid 1000)')
    expect(attestationProblem({ ...foreign, mode: 0o100_646 }, 1000))
      .toBe('is writable outside its owner (mode 646)')
  })

  it('records no attestation and warns when the configured file cannot be read', async () => {
    const missing = join(tempRoot('dsh-read-barrier-attest-missing-'), 'attestation.json')
    const { ctx, agent } = await harness({ hostAttestation: missing }, 'unreadable')
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await request(ctx, agent)
    expect(agent.session.events.map(event => event.type)).toEqual(['read-barrier/scope'])
    expect(warn).toHaveBeenCalledWith(
      `read-barrier: host attestation ${missing} cannot be read; no certificate may claim host isolation`,
    )
  })

  it('records no attestation and warns when the file is one this account owns', async () => {
    const path = join(tempRoot('dsh-read-barrier-attest-own-'), 'attestation.json')
    writeFileSync(path, '{"treeHash":"beef01"}\n')
    chmodSync(path, 0o444)
    const { ctx, agent } = await harness({ hostAttestation: path }, 'self-owned')
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await request(ctx, agent)
    expect(agent.session.events.map(event => event.type)).toEqual(['read-barrier/scope'])
    // POSIX reports this process as the owner; Windows reports uid 0 for every
    // file, which is this process's effective uid there too.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`read-barrier: host attestation ${path} is owned by this harness account`))
  })

  it('refuses a relative attestation path at load', async () => {
    await expect(harness({ hostAttestation: 'attestation.json' }, 'relative')).rejects.toThrow(
      'read-barrier: hostAttestation "attestation.json" must be an absolute or "~"-prefixed directory',
    )
  })

  it('pins the attestation payload version the invariant validates', () => {
    expect(READ_BARRIER_ATTESTATION_VERSION).toBe(1)
  })
})
