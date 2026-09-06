/**
 * The blind judge's own decisions: the workspace copy and its digest check, the
 * lineage-free creation request, the three messages the judge reads, and the
 * verdict read back from its answer.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { CallId, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CheckCaseId, CheckId, hashWorkspaceTree, StandardId } from '@deepseek-ai/dsh-verification'
import type { CheckResult, VerificationCertificate } from '@deepseek-ai/dsh-verification/types'
import JudgeService, {
  certificateLine,
  checkLine,
  DEFAULT_JUDGE_PRESET,
  DEFAULT_JUDGE_SYSTEM_PROMPT,
  evidenceText,
  JudgeError,
  judgeAnswer,
  readVerdict,
  SILENT_JUDGE_RATIONALE,
  WORKSPACES_DIR,
} from '@deepseek-ai/dsh-judge'
import type { Config, JudgeRequest } from '@deepseek-ai/dsh-judge'
import { GoalId } from '@deepseek-ai/dsh-goal'

const AUDITED = SessionId('environment-audited')

/** A live agent whose turn appends the claimed messages and one scripted answer. */
class FakeAgent {
  readonly session: Session
  readonly ctx: Context
  private readonly pending: UserMessage[] = []

  constructor(readonly id: SessionId, ctx: Context, private readonly answer: string | undefined) {
    this.session = Session.create(id)
    this.ctx = ctx
  }

  inject(message: UserMessage): void {
    this.pending.push(message)
  }

  followup(message: UserMessage): void {
    this.pending.push(message)
  }

  /** One step: the claimed batch in claim order, then the model's reply. */
  async whenIdle(): Promise<void> {
    for (const message of this.pending.splice(0)) {
      this.session.append('user/message', message, { surfaceOp: 'append' })
    }
    if (this.answer === undefined) return
    this.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: this.answer }],
        source: { provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
  }
}

class StubAgents extends Service {
  static current: StubAgents
  readonly created: CreateAgentOptions[] = []
  answer: string | undefined = 'verdict: upheld\nthe checks all passed.'
  disposed = 0
  agent: FakeAgent | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
    StubAgents.current = this
  }

  async create(options: CreateAgentOptions): Promise<{ agent: Agent; dispose: () => Promise<void> }> {
    this.created.push(options)
    const agent = new FakeAgent(options.sessionId, this.ctx, this.answer)
    this.agent = agent
    await options.setup?.(this.ctx)
    return {
      agent: agent as unknown as Agent,
      dispose: async () => { this.disposed += 1 },
    }
  }
}

class StubSessions extends Service {
  static current: StubSessions
  flushed = 0

  constructor(ctx: Context) {
    super(ctx, 'sessions')
    StubSessions.current = this
  }

  async flush(): Promise<boolean> {
    this.flushed += 1
    return true
  }
}

class StubAgentPresets extends Service {
  static current: StubAgentPresets
  readonly mounted: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'agentPresets')
    StubAgentPresets.current = this
  }

  async mount(_agentCtx: Context, id?: string): Promise<{ id: string }> {
    this.mounted.push(id ?? '')
    return { id: id ?? '' }
  }
}

/** A composed judge over stub services, with a fresh workspace root per test. */
async function setup(config: Partial<Config> = {}): Promise<{ ctx: Context; root: string }> {
  const ctx = new Context()
  await ctx.plugin(StubAgents)
  await ctx.plugin(StubSessions)
  await ctx.plugin(StubAgentPresets)
  const root = await mkdtemp(join(tmpdir(), 'judge-root-'))
  await ctx.plugin(JudgeService, { workspaceRoot: root, ...config })
  return { ctx, root }
}

/** A workspace holding one file, plus the digest a run would have recorded for it. */
async function auditedWorkspace(): Promise<{ workspace: string; treeHash: string }> {
  const workspace = await mkdtemp(join(tmpdir(), 'judge-audited-'))
  await writeFile(join(workspace, 'MARKER'), 'done\n')
  return { workspace, treeHash: await hashWorkspaceTree(workspace) }
}

const PASSING: CheckResult[] = [{ checkId: CheckId('marker-file'), status: 'pass', evidence: 'exit 0' }]

const CERTIFICATE: VerificationCertificate = {
  standard: { id: StandardId('standard-1'), revision: 1 },
  goalId: GoalId('goal-1'),
  isolation: 'none',
  executor: 'runner',
  results: PASSING,
  recordedAt: 0,
}

function request(overrides: Partial<JudgeRequest> & Pick<JudgeRequest, 'workspace' | 'treeHash'>): JudgeRequest {
  return {
    auditedSessionId: AUDITED,
    attempt: 1,
    taskPrompt: 'Create a file named MARKER.',
    results: PASSING,
    ...overrides,
  }
}

describe('the evidence a judge is handed', () => {
  it('names each check, its verdict, and its case tally', () => {
    expect(checkLine(PASSING[0] as CheckResult, 1)).toBe('1. marker-file: pass')
    expect(checkLine({
      checkId: CheckId('reversed-output'),
      status: 'fail',
      evidence: 'stdout: oops',
      cases: {
        passed: 2,
        total: 5,
        weightPassed: 8,
        weightTotal: 15,
        failed: [{ id: CheckCaseId('c1'), weight: 3, channels: ['stdout'], exitClass: 'zero' }],
      },
    }, 2)).toBe('2. reversed-output: fail (cases 2 of 5 passed, weight 8 of 15)')
  })

  it('states the certificate the attempt earned, or that it earned none', () => {
    expect(certificateLine(undefined)).toBe('certificate: none')
    expect(certificateLine(CERTIFICATE))
      .toBe('certificate: issued at "none" isolation over checks run by an automated validator, covering 1 check(s)')
    expect(certificateLine({ ...CERTIFICATE, executor: 'agent-reported' }))
      .toBe('certificate: issued at "none" isolation over checks run by the implementer\'s own report, covering 1 check(s)')
  })

  it('carries no check instruction and no captured output', () => {
    const text = evidenceText({ attempt: 2, results: PASSING, certificate: CERTIFICATE })
    expect(text).toBe([
      '<audited_attempt attempt="2">',
      'checks:',
      '1. marker-file: pass',
      'certificate: issued at "none" isolation over checks run by an automated validator, covering 1 check(s)',
      '</audited_attempt>',
    ].join('\n'))
    expect(text).not.toContain('exit 0')
  })
})

describe('reading a verdict back from the judge', () => {
  it('takes the verdict line and keeps everything after it as the reason', () => {
    expect(readVerdict('verdict: overturned\nthe certificate covers a run nothing executed.', 2000))
      .toEqual({ verdict: 'overturned', rationale: 'the certificate covers a run nothing executed.' })
  })

  it('reads the line whatever its case and surrounding blank lines', () => {
    expect(readVerdict('\n  VERDICT:   upheld  \n\nevery check passed.\n', 2000))
      .toEqual({ verdict: 'upheld', rationale: 'every check passed.' })
  })

  it('records the answer itself when it names no verdict', () => {
    expect(readVerdict('I would need the check scripts.', 2000))
      .toEqual({ verdict: 'inconclusive', rationale: 'I would need the check scripts.' })
  })

  it('records that the judge answered nothing when it produced no text', () => {
    expect(readVerdict('   ', 2000)).toEqual({ verdict: 'inconclusive', rationale: SILENT_JUDGE_RATIONALE })
    expect(readVerdict('verdict: upheld', 2000)).toEqual({ verdict: 'upheld', rationale: SILENT_JUDGE_RATIONALE })
  })

  it('bounds a long reason head and tail', () => {
    const rationale = readVerdict(`verdict: upheld\n${'x'.repeat(50)}y${'z'.repeat(50)}`, 20).rationale
    expect(rationale).toHaveLength(20)
    expect(rationale).toBe(`${'x'.repeat(9)}\n…\n${'z'.repeat(8)}`)
  })

  it('answers nothing for a session whose turn produced no assistant message', () => {
    expect(judgeAnswer(Session.create(SessionId('empty')))).toBe('')
  })

  it('joins the text blocks of the last assistant message and drops every other block', () => {
    const session = Session.create(SessionId('mixed'))
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [
          { type: 'tool-call', id: CallId('call-1'), name: 'read', arguments: '{}' },
          { type: 'text', text: 'verdict: upheld' },
        ],
        source: { provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
    expect(judgeAnswer(session)).toBe('verdict: upheld')
  })
})

describe('the lineage-free judge session', () => {
  it('copies the audited tree, creates a parentless unseeded session, and records both events', async () => {
    const { ctx, root } = await setup()
    const { workspace, treeHash } = await auditedWorkspace()
    const audit = await ctx.judge.audit(request({ workspace, treeHash }))

    expect(audit).toMatchObject({ auditedSessionId: AUDITED, attempt: 1, verdict: 'upheld', treeHash })
    expect(audit.rationale).toBe('the checks all passed.')
    expect(audit.judgeWorkspace).toBe(join(root, WORKSPACES_DIR, audit.judgeSessionId))
    expect(await readFile(join(audit.judgeWorkspace, 'MARKER'), 'utf8')).toBe('done\n')

    const created = StubAgents.current.created[0]
    expect(created?.sessionId).toBe(audit.judgeSessionId)
    expect(created?.meta).toEqual({ cwd: audit.judgeWorkspace })
    expect(created?.meta?.parentSession).toBeUndefined()
    expect(created?.seed).toBeUndefined()
    expect(created?.agentOptions).toBeUndefined()
    expect(StubAgentPresets.current.mounted).toEqual([DEFAULT_JUDGE_PRESET])

    const session = StubAgents.current.agent?.session
    const events = session?.events ?? []
    expect(events.find(event => event.type === 'judge/session')?.data).toEqual({
      judgeSessionId: audit.judgeSessionId,
      auditedSessionId: AUDITED,
      attempt: 1,
      treeHash,
    })
    expect(events.find(event => event.type === 'judge/verdict')?.data).toEqual({
      auditedSessionId: AUDITED,
      attempt: 1,
      verdict: 'upheld',
      rationale: 'the checks all passed.',
    })
    expect(StubSessions.current.flushed).toBe(1)
    expect(StubAgents.current.disposed).toBe(1)
  })

  it('reads exactly the instruction, the task, and the evidence, in that order', async () => {
    const { ctx } = await setup()
    const { workspace, treeHash } = await auditedWorkspace()
    await ctx.judge.audit(request({ workspace, treeHash, certificate: CERTIFICATE }))

    const messages = StubAgents.current.agent?.session.deriveMessages() ?? []
    expect(messages.slice(0, 3).map(message => message.content.map(block => (block.type === 'text' ? block.text : '')).join('')))
      .toEqual([
        DEFAULT_JUDGE_SYSTEM_PROMPT,
        'Create a file named MARKER.',
        evidenceText({ attempt: 1, results: PASSING, certificate: CERTIFICATE }),
      ])
    expect(messages.map(message => message.role)).toEqual(['user', 'user', 'user', 'assistant'])
    expect(messages[0]?.source).toEqual({ kind: 'plugin', plugin: 'judge' })
  })

  it('carries the model route and cancellation the caller chose into the creation request', async () => {
    const { ctx } = await setup()
    const { workspace, treeHash } = await auditedWorkspace()
    const signal = new AbortController().signal
    await ctx.judge.audit(request({ workspace, treeHash, model: { provider: 'p', model: 'm' }, signal }))

    const created = StubAgents.current.created[0]
    expect(created?.agentOptions).toEqual({ provider: 'p', model: 'm' })
    expect(created?.signal).toBe(signal)
  })

  it('records an inconclusive verdict when the judge answers nothing', async () => {
    const { ctx } = await setup()
    StubAgents.current.answer = undefined
    const { workspace, treeHash } = await auditedWorkspace()
    const audit = await ctx.judge.audit(request({ workspace, treeHash }))
    expect(audit).toMatchObject({ verdict: 'inconclusive', rationale: SILENT_JUDGE_RATIONALE })
  })

  it('refuses a copy that does not reproduce the attempt digest, before any session exists', async () => {
    const { ctx } = await setup()
    const { workspace } = await auditedWorkspace()
    await expect(ctx.judge.audit(request({ workspace, treeHash: 'deadbeef' })))
      .rejects.toThrow(new JudgeError(
        `judge: the workspace copy for attempt 1 of session "${AUDITED}" hashes to`
        + ` "${await hashWorkspaceTree(workspace)}", not the recorded "deadbeef"`,
        'JUDGE_TREE_HASH_MISMATCH',
      ))
    expect(StubAgents.current.created).toEqual([])
  })
})

describe('the judge workspace root', () => {
  it('defaults under the harness home and takes a configured preset and bound', async () => {
    const ctx = new Context()
    await ctx.plugin(StubAgents)
    await ctx.plugin(StubSessions)
    await ctx.plugin(StubAgentPresets)
    await ctx.plugin(JudgeService, { preset: 'auditor', rationaleMaxChars: 8, systemPrompt: 'decide.' })
    expect(isAbsolute(ctx.judge.workspaceRoot)).toBe(true)
    expect(basename(ctx.judge.workspaceRoot)).toBe('judge')
    expect(ctx.judge.preset).toBe('auditor')
    expect(ctx.judge.rationaleMaxChars).toBe(8)
    expect(ctx.judge.systemPrompt).toBe('decide.')
  })

  it('refuses a workspace root that is not absolute', async () => {
    const ctx = new Context()
    await ctx.plugin(StubAgents)
    await ctx.plugin(StubSessions)
    await ctx.plugin(StubAgentPresets)
    await expect(ctx.plugin(JudgeService, { workspaceRoot: 'judge-workspaces' }))
      .rejects.toThrow('judge: workspaceRoot "judge-workspaces" must be an absolute or "~"-prefixed directory')
  })
})
