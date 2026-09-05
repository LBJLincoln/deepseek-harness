import { describe, expect, it } from 'vitest'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalPhase } from '@deepseek-ai/dsh-goal/types'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { CheckId } from '@deepseek-ai/dsh-verification'
import { TRAJECTORY_FORMAT, foldTrajectory } from '@deepseek-ai/dsh-trajectories'

type Raw = Record<string, unknown>

/** Append-only event builder over a contiguous seq counter. */
class Log {
  readonly events: SessionEvent[] = []
  private time = 1_000

  /** Push one event; `extra` carries the surface intent of message events. */
  push(type: string, data: unknown, extra: Raw = {}): SessionEvent {
    const event = { type, seq: this.events.length, time: this.time += 1, data, ...extra } as unknown as SessionEvent
    this.events.push(event)
    return event
  }

  user(text: string): SessionEvent {
    return this.push('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  }

  assistant(turn: number, step: number, content: ContentBlock[], usage?: Raw): SessionEvent {
    const message = createAssistantMessage({ content, source: { provider: 'cli-mock', model: 'cli-mock' } })
    return this.push('assistant/message', { turn, step, message, ...usage === undefined ? {} : { usage } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  }

  toolResult(turn: number, step: number, callId: string, text: string, isError?: true): SessionEvent {
    const content: ContentBlock[] = [{ type: 'text', text }]
    const message = createToolResultMessage({ callId: CallId(callId), content, isError: isError ?? false })
    return this.push('tool/result', { turn, step, message }, { surfaceOp: 'append' })
  }
}

const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId('session-1'), createdAt: 500, cwd: '/work' }

function goalChange(operation: string, phase: GoalPhase, revision: number): Raw {
  return {
    kind: 'goal/change',
    version: 1,
    operation,
    goal: { id: GoalId('goal-1'), revision, objective: 'Prove the export', phase, maxGoalRounds: 7 },
    roundsStarted: 0,
    createdAt: 10,
    updatedAt: 10 + revision,
  }
}

const checks = [
  { id: CheckId('round-trip'), outcome: 'the round trip prints', run: 'printf X' },
  { id: CheckId('answer'), outcome: 'the answer quotes it', run: 'inspect' },
]

function standard(): Raw {
  return {
    kind: 'verification/standard',
    version: 1,
    operation: 'author',
    standard: { id: 'standard-1', revision: 1, goalId: 'goal-1', checks, relaxed: [] },
    createdAt: 11,
    updatedAt: 11,
  }
}

function certificate(): Raw {
  return {
    kind: 'verification/certificate',
    version: 1,
    certificate: {
      standard: { id: 'standard-1', revision: 1 },
      goalId: 'goal-1',
      isolation: 'process',
      results: checks.map(check => ({ checkId: check.id, status: 'pass', evidence: `ok ${check.id}` })),
      recordedAt: 30,
    },
  }
}

function runRecord(attempt: number, status: 'pass' | 'fail'): Raw {
  return {
    kind: 'verification/run',
    version: 1,
    standard: { id: 'standard-1', revision: 1 },
    attempt,
    isolation: 'process',
    executor: 'runner',
    results: checks.map(check => ({ checkId: check.id, status, evidence: `${status} ${check.id}` })),
    recordedAt: 20 + attempt,
  }
}

function requestHeader(): Raw {
  return {
    header: {
      config: { provider: 'cli-mock', model: 'cli-mock' },
      system: 'You are an AI agent.',
      tools: [{ name: 'bash', description: 'run a command', parameters: { type: 'object', properties: {} } }],
    },
    reason: 'initial',
  }
}

/** A certified session: one tool step, a directive, a certificate, then the admitted completion. */
function certifiedLog(): Log {
  const log = new Log()
  log.push('turn/start', { turn: 1 })
  log.push('step/start', { turn: 1, step: 1 })
  log.push('request/header', requestHeader())
  log.user('prove the certificate-gated completion')
  log.push('goal/change', goalChange('create', 'active', 1))
  log.push('verification/standard', standard())
  log.assistant(1, 1, [
    { type: 'reasoning', text: 'Run the command first.' },
    { type: 'text', text: 'Running.' },
    { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{"command":"printf X"}' },
  ], { inputTokens: 10, outputTokens: 5 })
  log.push('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"printf X"}' })
  log.toolResult(1, 1, 'call-1', 'X')
  log.push('step/end', { turn: 1, step: 1 })
  log.push('step/start', { turn: 1, step: 2 })
  log.push('verification/run', runRecord(1, 'fail'))
  log.push('verification/directive', {
    kind: 'verification/directive', version: 1, standard: { id: 'standard-1', revision: 1 }, rootCause: 'uncertified', detail: 'no certificate yet', issuedAt: 20,
  })
  log.push('verification/run', runRecord(2, 'pass'))
  log.push('verification/certificate', certificate())
  log.push('goal/change', goalChange('complete', 'complete', 2))
  log.push('tool/call', { turn: 1, step: 2, callId: 'call-2', name: 'bash', arguments: '{"command":"true"}' })
  log.assistant(1, 2, [{ type: 'text', text: 'Done: X' }], { inputTokens: 20, outputTokens: 3 })
  log.push('step/end', { turn: 1, step: 2 })
  log.push('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return log
}

describe('foldTrajectory', () => {
  it('projects surface messages with source seqs, steps with usage, a certificate reward, and provenance', () => {
    const log = certifiedLog()
    const trajectory = foldTrajectory(header, log.events)
    expect(trajectory.format).toBe(TRAJECTORY_FORMAT)
    expect(trajectory.id).toBe('session-1')
    expect(trajectory.source).toEqual({ sessionId: 'session-1', createdAt: 500, cwd: '/work' })
    expect(trajectory.config).toEqual({ provider: 'cli-mock', model: 'cli-mock' })
    expect(trajectory.system).toBe('You are an AI agent.')
    expect(trajectory.tools?.map(tool => tool.name)).toEqual(['bash'])
    expect(trajectory.messages.map(message => [message.role, message.seq, message.turn, message.step])).toEqual([
      ['user', 3, 1, 1],
      ['assistant', 6, 1, 1],
      ['tool', 8, 1, 1],
      ['assistant', 17, 1, 2],
    ])
    expect(trajectory.messages[1]).toMatchObject({
      sourceKind: 'model',
      toolCalls: [{ id: 'call-1', name: 'bash', arguments: '{"command":"printf X"}' }],
    })
    expect(trajectory.messages[1]?.content.map(block => block.type)).toEqual(['reasoning', 'text', 'tool-call'])
    expect(trajectory.messages[2]).toMatchObject({ sourceKind: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: 'X' }] })
    expect(trajectory.messages[2]).not.toHaveProperty('isError')
    expect(trajectory.messages[3]).not.toHaveProperty('toolCalls')
    expect(trajectory.steps).toEqual([
      { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 5 } },
      { turn: 1, step: 2, usage: { inputTokens: 20, outputTokens: 3 } },
    ])
    expect(trajectory.reward).toMatchObject({
      outcome: 1,
      basis: 'certificate',
      goal: { id: 'goal-1', objective: 'Prove the export', phase: 'complete' },
      directives: 1,
      relaxations: 0,
      attempts: 2,
    })
    expect(trajectory.reward.certificate?.results.map(result => result.checkId)).toEqual(['round-trip', 'answer'])
    expect(trajectory.provenance).toEqual({
      components: ['model-provider:cli-mock', 'tool:bash'],
      toolNames: ['bash'],
      isolation: 'process',
    })
  })

  it('exports exactly the derived history a session prepared from the same seed reports', () => {
    const log = certifiedLog()
    const derived = Session.create(SessionId('session-1'), log.events).deriveMessages()
    const trajectory = foldTrajectory(header, log.events)
    // A derived tool message wraps its blocks in one tool-result block; the record unwraps it onto the `tool` role.
    const expected = derived.map((message) => {
      const [block] = message.content
      return block?.type === 'tool-result' ? block.content : message.content
    })
    expect(trajectory.messages.map(message => message.content)).toEqual(expected)
    expect(trajectory.messages.map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
  })

  it('scores a measured goal without a covering certificate as zero', () => {
    const log = new Log()
    log.push('turn/start', { turn: 1 })
    log.push('step/start', { turn: 1, step: 1 })
    log.push('request/header', requestHeader())
    log.user('try')
    log.push('goal/change', goalChange('create', 'active', 1))
    log.push('verification/standard', standard())
    log.push('verification/run', runRecord(1, 'fail'))
    log.push('verification/relaxation', {
      kind: 'verification/relaxation',
      version: 1,
      checkId: 'answer',
      standard: { id: 'standard-1', revision: 2, goalId: 'goal-1', checks: [checks[0]], relaxed: [{ check: checks[1], evidence: 'unstable' }] },
      createdAt: 11,
      updatedAt: 12,
    })
    log.assistant(1, 1, [{ type: 'text', text: 'stuck' }])
    log.push('step/end', { turn: 1, step: 1 })
    log.push('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const trajectory = foldTrajectory(header, log.events)
    expect(trajectory.reward).toEqual({
      outcome: 0,
      basis: 'certificate',
      goal: { id: 'goal-1', objective: 'Prove the export', phase: 'active' },
      directives: 0,
      relaxations: 1,
      attempts: 1,
    })
    expect(trajectory.provenance).toEqual({ components: ['model-provider:cli-mock'], toolNames: [] })
    expect(trajectory.steps).toEqual([{ turn: 1, step: 1 }])
  })

  it('marks an unmeasured completion and a goal-less log as undecided', () => {
    const completed = new Log()
    completed.push('goal/change', goalChange('create', 'active', 1))
    completed.push('goal/change', goalChange('complete', 'complete', 2))
    expect(foldTrajectory(header, completed.events).reward).toEqual({
      outcome: null,
      basis: 'uncertified-completion',
      goal: { id: 'goal-1', objective: 'Prove the export', phase: 'complete' },
      directives: 0,
      relaxations: 0,
      attempts: 0,
    })

    const cleared = new Log()
    cleared.push('goal/change', goalChange('create', 'active', 1))
    cleared.push('goal/change', { kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'goal-1', revision: 1 }, clearedAt: 12 })
    cleared.push('goal/change', { kind: 'unrelated/record' })
    expect(foldTrajectory(header, cleared.events).reward).toMatchObject({ outcome: null, basis: 'none', goal: { phase: 'active' } })

    const empty = foldTrajectory({ version: SESSION_FORMAT_VERSION, id: SessionId('bare'), createdAt: 1 }, [])
    expect(empty).toEqual({
      format: TRAJECTORY_FORMAT,
      id: 'bare',
      source: { sessionId: 'bare', createdAt: 1 },
      messages: [],
      steps: [],
      reward: { outcome: null, basis: 'none', directives: 0, relaxations: 0, attempts: 0 },
      provenance: { components: [], toolNames: [] },
    })
  })

  it('follows compaction replacements, skips empty assistant steps, and records the preset, lineage, errors, and unstarted-step usage', () => {
    const log = new Log()
    log.push('agent-preset/selected', { agentPreset: 5 })
    log.push('agent-preset/selected', { agentPreset: 'reviewer' })
    log.push('turn/start', { turn: 1 })
    log.push('step/start', { turn: 1, step: 1 })
    log.push('request/header', { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }, reason: 'initial' })
    const first = log.user('first')
    const second = log.user('second')
    log.push('user/message', createUserMessage({ content: [{ type: 'text', text: 'summary of first and second' }], source: { kind: 'plugin', plugin: 'compaction' } }), {
      surfaceOp: { op: 'replace', start: first.seq, end: second.seq },
      sourceEventSeqs: [first.seq, second.seq],
    })
    log.assistant(1, 1, [], { inputTokens: 1, outputTokens: 0 })
    log.assistant(9, 9, [{ type: 'text', text: 'late usage' }], { inputTokens: 2, outputTokens: 2 })
    log.push('tool/call', { turn: 1, step: 1, callId: 'call-a', name: 'fs_read', arguments: '{}' })
    log.push('tool/call', { turn: 1, step: 1, callId: 'call-b', name: 'fs_read', arguments: '{}' })
    log.toolResult(1, 1, 'call-a', 'missing', true)
    log.push('step/end', { turn: 1, step: 1 })
    log.push('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const parented: SessionHeader = { ...header, id: SessionId('child'), parentSession: SessionId('parent') }
    const trajectory = foldTrajectory(parented, log.events)
    expect(trajectory.source).toEqual({ sessionId: 'child', createdAt: 500, cwd: '/work', parentSession: 'parent', agentPreset: 'reviewer' })
    expect(trajectory).not.toHaveProperty('system')
    expect(trajectory).not.toHaveProperty('tools')
    expect(trajectory.messages.map(message => [message.role, message.sourceKind])).toEqual([
      ['user', 'plugin'],
      ['assistant', 'model'],
      ['tool', 'tool'],
    ])
    expect(trajectory.messages[0]?.content).toEqual([{ type: 'text', text: 'summary of first and second' }])
    expect(trajectory.messages[2]).toMatchObject({ toolCallId: 'call-a', isError: true })
    expect(trajectory.steps).toEqual([{ turn: 1, step: 1, usage: { inputTokens: 1, outputTokens: 0 } }])
    expect(trajectory.provenance.components).toEqual(['composition:reviewer', 'model-provider:deepseek-official', 'tool:fs_read'])
    expect(trajectory.provenance.toolNames).toEqual(['fs_read'])
  })

  it('carries the environment stamp, names the environment among the components, and fails on a malformed stamp', () => {
    const hex = 'c'.repeat(64)
    const stamp = {
      kind: 'environment/run', version: 1, environmentId: 'smoke:marker', environmentKind: 'smoke', heldOut: false,
      promptSha256: hex, checksSha256: hex, fixtureSha256: hex, contentSha256: hex, repetition: 1, group: 'batch-1',
      model: { provider: 'cli-mock', model: 'cli-mock' }, isolation: 'process',
    }
    const log = new Log()
    log.push('environment/run', stamp)
    log.push('environment/run', { kind: 'unrelated/record' })
    log.push('request/header', requestHeader())
    log.push('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{}' })
    const trajectory = foldTrajectory(header, log.events)
    expect(trajectory.environment).toEqual(stamp)
    expect(trajectory.provenance.components).toEqual(['environment:smoke:marker', 'model-provider:cli-mock', 'tool:bash'])

    const malformed = new Log()
    malformed.push('environment/run', { ...stamp, heldOut: 'yes' })
    expect(() => foldTrajectory(header, malformed.events)).toThrow('environment/run heldOut must be a boolean')
  })

  it('leaves the position empty for messages outside any step', () => {
    const log = new Log()
    log.user('before any step')
    log.assistant(1, 1, [{ type: 'text', text: 'also before any step' }])
    const { messages } = foldTrajectory(header, log.events)
    expect(messages[0]).toEqual({ role: 'user', seq: 0, content: [{ type: 'text', text: 'before any step' }], sourceKind: 'user' })
    expect(messages[1]).toEqual({ role: 'assistant', seq: 1, content: [{ type: 'text', text: 'also before any step' }], sourceKind: 'model' })
  })
})
