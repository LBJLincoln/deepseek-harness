/**
 * The blind judge (`ctx.judge`): the oversight Consumer that audits one
 * recorded attempt from a session holding no implementer context.
 *
 * A deployment with one model licence cannot route its judge to another
 * provider, so independence has to come from the session itself. This service
 * builds one: a fresh `SessionId` with no `parentSessionId` and no seed, a
 * workspace that is a fresh copy of the implementer's tree at the attempt's
 * `treeHash`, a `system`-trust preset declaring the read barrier's `judge`
 * role, and a derived history of exactly three messages — the judge's standing
 * instruction, the task prompt, and one evidence message naming the attempt's
 * check verdicts and its certificate or its absence. Nothing from the audited
 * session's log reaches it, so the judge cannot reconstruct the reasoning whose
 * outcome it is deciding. The
 * [read-barrier Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-read-barrier.md)
 * owns the design rationale, and the
 * [oversight seam](../../../.agents/notes/proposed/architecture/2026-08-29-verification-improvement-oversight-seams.md)
 * owns the role this Consumer plays.
 * @module @deepseek-ai/dsh-judge
 */

import { randomUUID } from 'node:crypto'
import { cp, mkdir } from 'node:fs/promises'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: resolves the `ctx.agentPresets` roster the judge session composes from.
import type {} from '@deepseek-ai/dsh-agent-presets'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { hashWorkspaceTree } from '@deepseek-ai/dsh-verification'
import type { CheckResult, RunExecutor, VerificationCertificate } from '@deepseek-ai/dsh-verification/types'
import type {
  JudgeAudit,
  JudgeRequest,
  JudgeSessionRecord,
  JudgeVerdict,
  JudgeVerdictRecord,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    judge: JudgeService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The lineage assertion of one judge session: its own id, the session and
     * attempt it audits, and the workspace digest its copy reproduced.
     * Appended to the JUDGE's log before its first turn, so a verdict without
     * one is a verdict from a session nothing established as a judge. Log-only
     * — it never enters model history.
     */
    'judge/session': JudgeSessionRecord
    /**
     * One reached verdict: the audited session and attempt, what the judge
     * decided, and the judge's own reason. Appended to the JUDGE's log after
     * its turn settles. Log-only — it never enters model history.
     */
    'judge/verdict': JudgeVerdictRecord
  }
}

/** Directory holding one workspace per judge session, under the configured root. */
export const WORKSPACES_DIR = 'workspaces'

/** Preset id a deployment ships the blind judge as. */
export const DEFAULT_JUDGE_PRESET = 'judge'

/** Every verdict a judge may reach, in the order the instruction offers them. */
export const JUDGE_VERDICTS: readonly JudgeVerdict[] = ['upheld', 'overturned', 'inconclusive']

/**
 * Messages a judge session's derived history holds before its first assistant
 * turn: the standing instruction, the task, and the evidence. A fourth would be
 * context the judge was not meant to have, so the invariant companion refuses a
 * verdict from a session that opened with any other number.
 */
export const JUDGE_OPENING_MESSAGES = 3

/** The verdict recorded when the judge's reply names none of {@link JUDGE_VERDICTS}. */
export const UNDECIDED_VERDICT: JudgeVerdict = 'inconclusive'

/** The rationale recorded when the judge's turn produced no text at all. */
export const SILENT_JUDGE_RATIONALE = 'the judge answered nothing'

/** The line a judge's answer opens with, and the pattern that reads it back. */
const VERDICT_LINE = /^[ \t]*verdict:[ \t]*(upheld|overturned|inconclusive)[ \t]*$/im

/**
 * The judge's standing instruction, delivered as the first message of the judge
 * session's derived history. It states the vocabulary and the answer format the
 * verdict is read back from, so a change here without a matching change to
 * {@link VERDICT_LINE} leaves every audit `inconclusive`.
 */
export const DEFAULT_JUDGE_SYSTEM_PROMPT = [
  'You are auditing one attempt at a task. You did not run it, and the session that did is closed to you: the next two messages are the whole record you have.',
  '',
  'The first is the task the implementer was given. The second is the evidence: which checks the attempt was measured by, whether each passed, and whether a certificate was issued. You are not shown the check instructions, the commands that ran, or anything either side wrote.',
  '',
  'Answer with this line first, then your reason on the lines after it:',
  '',
  'verdict: upheld',
  '',
  'Use `upheld` when the evidence supports the outcome the attempt recorded, `overturned` when it contradicts it, and `inconclusive` when the evidence cannot decide. Decide on what you were given; there is nothing further to ask for.',
].join('\n')

/** Stable error codes of a refused audit. */
export type JudgeErrorCode = 'JUDGE_TREE_HASH_MISMATCH'

/** Error returned by the judge boundary. */
export class JudgeError extends HarnessError {
  /**
   * @param message - human-readable reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: JudgeErrorCode) {
    super(message, code)
  }
}

/** Deployment choices of the judge, validated from `cordis.yml`. */
export interface Config {
  /**
   * Preset the judge session composes (default `judge`). It must be a
   * `system`-trust preset declaring `role: judge`; the roster and the read
   * barrier enforce that, not this field.
   */
  preset?: string
  /**
   * Directory judge workspaces are minted under, absolute or `~`-prefixed
   * (default `<harness home>/judge`). Each audit gets `<root>/workspaces/<judge
   * session id>/`, created owner-only.
   */
  workspaceRoot?: string
  /**
   * The judge's standing instruction, delivered as the first message of the
   * judge session's derived history (default {@link DEFAULT_JUDGE_SYSTEM_PROMPT}).
   * A deployment that rewrites it must keep the `verdict: <one of the three>`
   * answer line, which is what the verdict is read back from.
   */
  systemPrompt?: string
  /** Bound of the rationale recorded on the verdict (default 2000 characters). */
  rationaleMaxChars?: number
}

/** How each executor of a certified run reads in the evidence message. */
const EXECUTOR_PHRASE: Readonly<Record<RunExecutor, string>> = {
  runner: 'an automated validator',
  'agent-reported': "the implementer's own report",
}

/**
 * Expand `~`, resolve, and require an absolute directory path.
 * @param path - the configured directory.
 * @param field - the config field naming it, used in the failure.
 * @returns the expanded absolute path.
 * @throws when the expanded path is not absolute.
 */
function absoluteDirectory(path: string, field: string): string {
  const expanded = expandHomePath(path)
  if (!isAbsolute(expanded)) {
    throw new Error(`judge: ${field} ${JSON.stringify(path)} must be an absolute or "~"-prefixed directory`)
  }
  return resolvePath(expanded)
}

/** Keep the head and the tail of longer text inside the bound. */
function bound(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const marker = '\n…\n'
  const head = Math.ceil((maxChars - marker.length) / 2)
  const tail = maxChars - marker.length - head
  return `${text.slice(0, head)}${marker}${text.slice(text.length - tail)}`
}

/**
 * One check's line in the evidence: its id, its verdict, and its case tally
 * when it was measured case by case. The recorded `evidence` string is
 * deliberately absent — it holds the candidate's own bytes, which is exactly
 * what a blind judge must not read.
 * @param result - the attempt's result for one check.
 * @param position - one-based position in the attempt's check order.
 * @returns the rendered line.
 */
export function checkLine(result: CheckResult, position: number): string {
  const cases = result.cases
  const tally = cases === undefined
    ? ''
    : ` (cases ${cases.passed} of ${cases.total} passed, weight ${cases.weightPassed} of ${cases.weightTotal})`
  return `${position}. ${result.checkId}: ${result.status}${tally}`
}

/**
 * The certificate line of the evidence: what it claims, or that there is none.
 * @param certificate - the certificate the attempt earned, absent when it earned none.
 * @returns the rendered line.
 */
export function certificateLine(certificate: VerificationCertificate | undefined): string {
  if (certificate === undefined) return 'certificate: none'
  return `certificate: issued at "${certificate.isolation}" isolation over checks run by ${EXECUTOR_PHRASE[certificate.executor]}, covering ${certificate.results.length} check(s)`
}

/**
 * The complete evidence message: the attempt number, one line per check, and
 * the certificate or its absence. Nothing else from the audited run crosses
 * into the judge session.
 * @param request - the audit, supplying the attempt number, results, and certificate.
 * @returns the exact text delivered as the judge's third message.
 */
export function evidenceText(request: Pick<JudgeRequest, 'attempt' | 'results' | 'certificate'>): string {
  return [
    `<audited_attempt attempt="${request.attempt}">`,
    'checks:',
    ...request.results.map((result, index) => checkLine(result, index + 1)),
    certificateLine(request.certificate),
    '</audited_attempt>',
  ].join('\n')
}

/**
 * Read one verdict out of the judge's answer: the first `verdict:` line naming
 * a member of {@link JUDGE_VERDICTS}, with everything after that line as the
 * reason. An answer naming none of them is {@link UNDECIDED_VERDICT} carrying
 * the answer itself, because a judge that did not name a verdict decided
 * nothing and its words are the only account of why.
 * @param answer - the judge's assembled reply text.
 * @param maxChars - bound of the recorded rationale.
 * @returns the verdict and its bounded rationale.
 */
export function readVerdict(answer: string, maxChars: number): { verdict: JudgeVerdict; rationale: string } {
  const match = VERDICT_LINE.exec(answer)
  if (match === null) {
    const text = answer.trim()
    return { verdict: UNDECIDED_VERDICT, rationale: bound(text === '' ? SILENT_JUDGE_RATIONALE : text, maxChars) }
  }
  const rationale = answer.slice(match.index + match[0].length).trim()
  return {
    // The pattern's one capture group matches a member of the vocabulary.
    verdict: match[1] as JudgeVerdict,
    rationale: bound(rationale === '' ? SILENT_JUDGE_RATIONALE : rationale, maxChars),
  }
}

/**
 * The judge's assembled answer: the text blocks of the last assistant message
 * in its session, joined. An empty string means the turn produced no text.
 * @param session - the judge session.
 * @returns the answer text.
 */
export function judgeAnswer(session: Session): string {
  const last = session.events.findLast(event => event.type === 'assistant/message')
  if (last === undefined) return ''
  return last.data.message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
}

/** The blind judge (`ctx.judge`): one lineage-free judge session per audited attempt. */
export class JudgeService extends Service {
  static inject = ['agents', 'sessions', 'agentPresets']

  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    preset: z.string().default(DEFAULT_JUDGE_PRESET),
    // No schema default: the harness home is resolved in the constructor so the
    // stored root is always absolute regardless of how it was supplied.
    workspaceRoot: z.string(),
    systemPrompt: z.string().default(DEFAULT_JUDGE_SYSTEM_PROMPT),
    rationaleMaxChars: z.natural().min(1).default(2000),
  })

  /** The absolute directory judge workspaces are minted under. */
  readonly workspaceRoot: string

  /** The preset every judge session composes, as {@link Config.preset} set it. */
  readonly preset: string

  /** The judge's standing instruction, as {@link Config.systemPrompt} set it. */
  readonly systemPrompt: string

  /** Bound of a recorded rationale, as {@link Config.rationaleMaxChars} set it. */
  readonly rationaleMaxChars: number

  constructor(ctx: Context, config: Config) {
    super(ctx, 'judge')
    this.workspaceRoot = absoluteDirectory(config.workspaceRoot ?? dshHomePath('judge'), 'workspaceRoot')
    // schemastery (static Config) already filled these three; the casts record
    // that runtime fact. `workspaceRoot` has NO schema default, so its fallback
    // to the harness home is real branching, resolved absolute either way.
    this.preset = config.preset as string
    this.systemPrompt = config.systemPrompt as string
    this.rationaleMaxChars = config.rationaleMaxChars as number
  }

  /**
   * Audit one recorded attempt and record the verdict.
   *
   * The copy is made and checked BEFORE the session exists, so a judge is never
   * created over a tree that is not the one the attempt was measured on. The
   * session that follows has a fresh id, no parent, and no seed; its history is
   * the standing instruction, the task, and the evidence, in that order; and
   * its log carries the `judge/session` lineage assertion before the first turn
   * and the `judge/verdict` after it settles.
   * @param request - the audited session and attempt, its workspace and digest, the task, the results, and any certificate.
   * @returns the verdict, its rationale, and the judge session and workspace that produced them.
   * @throws {@link JudgeError} with `JUDGE_TREE_HASH_MISMATCH` when the copy does not reproduce the attempt's digest.
   */
  async audit(request: JudgeRequest): Promise<JudgeAudit> {
    const judgeSessionId = SessionId(`judge-${randomUUID()}`)
    const judgeWorkspace = join(this.workspaceRoot, WORKSPACES_DIR, judgeSessionId)
    await mkdir(judgeWorkspace, { recursive: true, mode: 0o700 })
    await cp(request.workspace, judgeWorkspace, { recursive: true })
    const treeHash = await hashWorkspaceTree(judgeWorkspace)
    if (treeHash !== request.treeHash) {
      throw new JudgeError(
        `judge: the workspace copy for attempt ${request.attempt} of session "${request.auditedSessionId}"`
        + ` hashes to "${treeHash}", not the recorded "${request.treeHash}"`,
        'JUDGE_TREE_HASH_MISMATCH',
      )
    }
    const handle = await this.ctx.agents.create({
      // No `parentSessionId` and no `seed`: the two fields that would make this
      // session a continuation of the one it audits.
      sessionId: judgeSessionId,
      meta: { cwd: judgeWorkspace },
      ...request.model === undefined ? {} : { agentOptions: request.model },
      ...request.signal === undefined ? {} : { signal: request.signal },
      setup: async (agentCtx: Context) => {
        await this.ctx.agentPresets.mount(agentCtx, this.preset)
      },
    })
    try {
      const record: JudgeSessionRecord = {
        judgeSessionId,
        auditedSessionId: request.auditedSessionId,
        attempt: request.attempt,
        treeHash,
      }
      handle.agent.session.append('judge/session', record)
      const verdict = await this.decide(handle.agent, request)
      handle.agent.session.append('judge/verdict', verdict)
      await this.ctx.sessions.flush(handle.agent.session)
      return { ...verdict, judgeSessionId, judgeWorkspace, treeHash }
    } finally {
      await handle.dispose()
    }
  }

  /**
   * Deliver the judge's three messages as one turn and read the verdict back.
   * The instruction and the task are injected, which queues them for the next
   * step without waking the driver; the evidence follows them as the waking
   * message, so one step claims all three in that order.
   */
  private async decide(agent: Agent, request: JudgeRequest): Promise<JudgeVerdictRecord> {
    agent.inject(this.message(this.systemPrompt))
    agent.inject(this.message(request.taskPrompt))
    agent.followup(this.message(evidenceText(request)))
    await agent.whenIdle()
    const { verdict, rationale } = readVerdict(judgeAnswer(agent.session), this.rationaleMaxChars)
    return { auditedSessionId: request.auditedSessionId, attempt: request.attempt, verdict, rationale }
  }

  /** One of the judge's three messages, attributed to this service rather than to a person. */
  private message(text: string): UserMessage {
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'judge' },
    })
  }
}

export default JudgeService
