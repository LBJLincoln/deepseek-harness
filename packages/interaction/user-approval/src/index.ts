/**
 * Service Definition for the approval capability seam, covering requests, cancellation, audit, and per-session policy. Missing
 * answerers fail closed; grants apply only to the requested action.
 * @module @deepseek-ai/dsh-user-approval
 */

import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type CallId } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'

declare module '@deepseek-ai/cordis' {
  interface Context {
    approval: ApprovalService
  }

  interface Events {
    /**
     * Ask composed answerers for one decision. Return an outcome — bare, or as
     * `{ outcome, decidedBy }` when the answerer knows which person or rule
     * decided — to claim the request, or call `next()`; failure yields the
     * fail-closed default.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @param req - the pending decision (agent, tool identity, arguments, reason, signal).
     * @mode waterfall
     */
    'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalAnswer>): Promise<ApprovalAnswer>
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * An approval question was put to the answerer chain — log-only audit
     * (like `hook/*`; NOT a surface event, carries no `surfaceOp`). `id` pairs
     * it with the `approval/decided` that always follows; `toolName` is the
     * tool the question is about, `callId` the exact tool call when the asker
     * had one, `reason` the asker's human-readable explanation (e.g. a hook's
     * permission-decision reason), `argumentsSha256` the digest of the
     * arguments the asker handed the seam, absent when it handed none.
     */
    'approval/asked': {
      id: ApprovalRequestId
      toolName: string
      callId?: CallId
      reason?: string
      argumentsSha256?: string
    }
    /**
     * The outcome of a prior `approval/asked` (same `id`) — log-only audit.
     * Exactly one per ask, appended when the outcome is known: a decision, a
     * cancellation, or the fail-closed `'unavailable'`. `decidedBy` names the
     * person or rule that reached the outcome, absent when nothing claimed it
     * (a withdrawn request, an unavailable answerer, an unattributed answer);
     * `argumentsSha256` repeats the digest of the ask, so a decision states
     * what it decided on without a reader joining two events.
     */
    'approval/decided': {
      id: ApprovalRequestId
      outcome: ApprovalOutcome
      decidedBy?: ApprovalPrincipal
      argumentsSha256?: string
    }
    /**
     * The session's approval policy was switched — log-only, durable,
     * replayable, never in the model transcript (the model learns the policy
     * from the runtime-context snapshot and live switch notices). The LAST
     * such event is the session's override ({@link effectiveApprovalPolicy}).
     * `source: 'delegation'` marks an override seeded into a child; an absent
     * source is a runtime switch.
     */
    'approval/policy': {
      policy: ApprovalPolicy
      /** Marks an override seeded into a child at delegation. */
      source?: 'delegation'
    }
  }
}

import { ApprovalRequestId } from './types.ts'
import type { ApprovalOutcome, ApprovalPrincipal } from './types.ts'

export { ApprovalRequestId } from './types.ts'
export type { ApprovalOutcome, ApprovalPrincipal } from './types.ts'

/** Every {@link ApprovalOutcome}, for runtime normalization of answerer returns. */
const OUTCOMES: readonly ApprovalOutcome[] = ['allowed-once', 'rejected', 'cancelled', 'unavailable']

/** Every {@link ApprovalPrincipal} kind, for durable-record validation. */
export const APPROVAL_PRINCIPAL_KINDS: readonly ApprovalPrincipal['kind'][] = ['human', 'policy']

/** Principal the service records for the `'never'` policy's own deterministic rejection. */
export const APPROVAL_POLICY_NEVER_PRINCIPAL: ApprovalPrincipal = { kind: 'policy', id: 'approval-policy:never' }

/**
 * One answerer's reply: the bare outcome, or the outcome together with the
 * person or rule that reached it. Answerers that cannot name a principal keep
 * returning the bare outcome.
 */
export type ApprovalAnswer =
  | ApprovalOutcome
  | { readonly outcome: ApprovalOutcome; readonly decidedBy: ApprovalPrincipal }

/** One settled question as {@link ApprovalService.request} records it. */
interface ApprovalDecision {
  readonly outcome: ApprovalOutcome
  readonly decidedBy?: ApprovalPrincipal
}

/**
 * Read one answerer's reply as a decision. The parameter is `unknown` because
 * an answerer is plugin code that can return anything the declared union
 * forbids; every value outside the closed vocabulary — including an attributed
 * answer whose outcome is not one — normalizes to the fail-closed outcome with
 * no principal, instead of leaking into callers' closed-union switches.
 * @param answer - whatever the waterfall returned.
 * @returns the closed decision the audit pair records.
 */
function normalizeAnswer(answer: unknown): ApprovalDecision {
  if (typeof answer === 'string') {
    return { outcome: OUTCOMES.includes(answer as ApprovalOutcome) ? answer as ApprovalOutcome : 'unavailable' }
  }
  if (answer === null || typeof answer !== 'object') return { outcome: 'unavailable' }
  const { outcome, decidedBy } = answer as { outcome?: unknown; decidedBy?: ApprovalPrincipal }
  if (!OUTCOMES.includes(outcome as ApprovalOutcome)) return { outcome: 'unavailable' }
  return {
    outcome: outcome as ApprovalOutcome,
    ...decidedBy === undefined ? {} : { decidedBy },
  }
}

/** Recursively order object keys so two equal argument values encode identically. */
function canonicalArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalArguments)
  if (typeof value !== 'object' || value === null) return value
  const entries = value as Record<string, unknown>
  const ordered: Record<string, unknown> = {}
  for (const key of Object.keys(entries).sort()) ordered[key] = canonicalArguments(entries[key])
  return ordered
}

/**
 * The digest an audit pair records for one decided call's arguments: the
 * lowercase SHA-256 hex over the JSON encoding of the arguments with every
 * object's keys ordered, so a reader recomputing it from the same arguments
 * gets the same digest regardless of the order the model emitted them in.
 * @param args - the losslessly JSON-serializable arguments the asker supplied.
 * @returns the 64-character lowercase hex digest.
 */
export function approvalArgumentsDigest(args: unknown): string {
  return createHash('sha256').update(JSON.stringify({ arguments: canonicalArguments(args) }), 'utf8').digest('hex')
}

/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
export type ApprovalPolicy = 'ask' | 'never'

/** Every {@link ApprovalPolicy}, for option advertisement and runtime validation of untrusted policy strings. */
export const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ['ask', 'never']

/** Model-facing statement for the deterministic `'never'` policy. */
const NEVER_SENTENCE = 'Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).'
/** Model-facing statement for an interactive policy that may still fail closed. */
const ASK_SENTENCE = 'Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.'

/**
 * The session's approval-policy override: the last `approval/policy` event in
 * the log, or undefined when the session never switched (callers apply the
 * plugin's configured default). The pure fold — resume needs no catch-up
 * machinery because replaying the log IS the state.
 * @param events - session events in log order (other event types are skipped).
 * @returns the policy of the last switch event, or undefined without one.
 */
export function effectiveApprovalPolicy(events: readonly SessionEvent[]): ApprovalPolicy | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'approval/policy') return event.data.policy
  }
  return undefined
}

/**
 * Whether the log currently sits inside an open turn (a `turn/start` not yet
 * closed by a `turn/end`) — the {@link ApprovalService.request} precondition.
 * The audit pair must be turn-enclosed: the turn is the durable log's
 * commit/replay boundary, so a bare event appended between turns is
 * indistinguishable from a crash tail and silently dropped on reload.
 */
function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = (events[index] as SessionEvent).type
    if (type === 'turn/start') return true
    if (type === 'turn/end') return false
  }
  return false
}

/**
 * Append the sole durable representation of a session policy override. Invalid
 * values throw before the log changes; consumers fold the new value on each read.
 * @param session - the session the override belongs to.
 * @param policy - the policy in effect until the next switch.
 */
export function setApprovalPolicy(session: Session, policy: ApprovalPolicy): void {
  if (!APPROVAL_POLICIES.includes(policy)) {
    throw new TypeError('approval policy must be one of "ask" or "never"')
  }
  session.append('approval/policy', { policy })
}

/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
export interface ApprovalRequest {
  /**
   * The agent on whose behalf the question is asked. Routes the question (a
   * UI answerer only answers for agents it owns) and receives the audit
   * events on its session log.
   */
  readonly agent: Agent
  /** The tool the question is about (presentation and audit). */
  readonly toolName: string
  /**
   * The exact tool call being decided, when the asker has one — lets a UI
   * attach the prompt to the tool call it already streamed.
   */
  readonly callId?: CallId
  /**
   * The losslessly JSON-serializable arguments being decided, when the asker
   * has them. The seam digests them into the audit pair so a decision states
   * what it decided on; an asker whose subject is not a set of tool arguments
   * — a sandbox escalation states its subject in `reason` — omits them.
   */
  readonly arguments?: unknown
  /** The asker's human-readable explanation of WHY it is asking. */
  readonly reason?: string
  /**
   * Aborting withdraws the question: the request settles `'cancelled'`
   * immediately and a late answer from a still-pending answerer is discarded.
   */
  readonly signal?: AbortSignal
}

/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * The deployment's default {@link ApprovalPolicy} for sessions without an
   * `approval/policy` override — `'ask'` delegates to the composed answerers
   * (fail-closed with none); `'never'` auto-rejects every ask without
   * prompting (the deterministic CI/unattended stance).
   */
  readonly policy?: ApprovalPolicy
}

/**
 * Approval service that applies session policy before answerers and logs every
 * ask/outcome pair to the requesting session. It exposes deterministic policy
 * changes to the model through the runtime-context snapshot and switch notices.
 */
export class ApprovalService extends Service {
  static Config: z<Config> = z.object({
    policy: z.union(['ask', 'never'] as const).default('ask'),
  })

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'approval')

    const effective = (agent: Agent): ApprovalPolicy => this.effectivePolicy(agent.session)

    // The complete current value travels after retained history, so switching
    // policy does not rewrite the stable system-prompt cache prefix.
    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'approval:policy',
        order: 115,
        text: (context) => {
          const agent = context.agent
          // A bare assemble() (tests, diagnostics) has no session to state.
          if (agent === undefined) return ''
          const policy = effective(agent)
          return policy === 'never' ? NEVER_SENTENCE : ASK_SENTENCE
        },
      })
    })
  }

  /**
   * Switch one live agent's policy and queue the transition for its next model
   * step. Session initialization uses {@link setApprovalPolicy} directly
   * because there is no previously visible policy to change.
   * @param agent - the live agent whose policy is changing.
   * @param policy - the new effective policy.
   */
  setPolicy(agent: Agent, policy: ApprovalPolicy): void {
    const previous = this.effectivePolicy(agent.session)
    if (previous === policy) return
    setApprovalPolicy(agent.session, policy)
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `The approval policy changed from "${previous}" to "${policy}" (changed by the user).`,
      }],
      source: { kind: 'plugin', plugin: 'user-approval' },
    }))
  }

  /**
   * Ask the composed answerers to decide one readonly same-process request.
   * The service borrows the request, agent, session, and live signal directly.
   * The request requires an open turn because the audit pair must be enclosed
   * by the durable log's commit/replay boundary; an idle ask rejects before
   * appending anything. The answerer phase always produces an outcome: an
   * aborted signal yields `'cancelled'`, a missing or throwing answerer yields
   * `'unavailable'` (fail closed), and a rogue non-vocabulary return value is
   * normalized to `'unavailable'`. A failure that prevents either audit append
   * from committing still rejects because returning an unlogged decision would
   * violate the pair. Session contains post-commit observer failures, so an
   * authoritative append cannot reject the request or suppress its matching
   * audit event.
   * @param req - the pending decision (agent, tool identity, reason, signal).
   * @returns the closed outcome; `'allowed-once'` is the only grant.
   * @throws when no turn is open or either audit event fails before the session
   *   append commit point.
   */
  async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
    const session = req.agent.session
    if (!hasOpenTurn(session.events)) {
      throw new Error(
        'approval.request() outside an open turn: the approval/asked + approval/decided audit pair '
        + 'must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). '
        + 'Ask from inside the turn that needs the decision.',
      )
    }
    const id = ApprovalRequestId(randomUUID())
    // Digested once, before any answerer runs, and repeated on the decision:
    // the pair then states one argument value that no later answerer could
    // have changed under it.
    const argumentsSha256 = req.arguments === undefined ? undefined : approvalArgumentsDigest(req.arguments)
    const digested = argumentsSha256 === undefined ? {} : { argumentsSha256 }
    session.append('approval/asked', {
      id,
      toolName: req.toolName,
      ...req.callId !== undefined ? { callId: req.callId } : {},
      ...req.reason !== undefined ? { reason: req.reason } : {},
      ...digested,
    })
    const decision = await this.decide(req, session)
    session.append('approval/decided', {
      id,
      outcome: decision.outcome,
      ...decision.decidedBy === undefined ? {} : { decidedBy: decision.decidedBy },
      ...digested,
    })
    return decision.outcome
  }

  /**
   * The session's effective policy: its own `approval/policy` fold, else the
   * configured default (the schema already defaulted an omitted policy to
   * `'ask'`; the `??` only narrows the optional-input TYPE).
   * @param session - the exact accepted session whose policy applies.
   * @returns the policy every ask for this session resolves under right now.
   */
  private effectivePolicy(session: Session): ApprovalPolicy {
    return this.overrideOf(session) ?? this.config.policy ?? 'ask'
  }

  /**
   * Read the session override without applying the configured default.
   * @param session - session whose log supplies the override.
   * @returns the last logged policy, or `undefined` without one.
   */
  overrideOf(session: Session): ApprovalPolicy | undefined {
    return effectiveApprovalPolicy(session.events)
  }

  /**
   * Dispatch the waterfall, contained and raced against the request signal.
   * @param req - the borrowed public request.
   * @param session - the request agent's session used for policy lookup.
   * @returns the normalized closed outcome and, when one claimed it, the principal.
   */
  private async decide(req: ApprovalRequest, session: Session): Promise<ApprovalDecision> {
    const signal = req.signal
    if (signal?.aborted) return { outcome: 'cancelled' }
    // The 'never' policy is decided HERE, before any dispatch: a listener
    // registered with `prepend: true` after this service mounts would sit
    // ahead of any gate LISTENER, so a listener-shaped gate cannot keep the
    // documented promise that 'never' rejects deterministically regardless
    // of registration order — only the service's own request path can. It is
    // also the one decision this service makes itself, so it attributes it.
    if (this.effectivePolicy(session) === 'never') {
      return { outcome: 'rejected', decidedBy: APPROVAL_POLICY_NEVER_PRINCIPAL }
    }
    // Enter the promise chain BEFORE dispatching: a listener that throws
    // SYNCHRONOUSLY (before its first await) must land in the same rejection
    // path as an async one — `Promise.resolve(call())` would let it escape
    // the containment into the caller.
    const answer: Promise<ApprovalDecision> = Promise.resolve().then(
      () => this.ctx.waterfall(
        scopeTarget(this, req.agent), 'approval/request', req,
        () => Promise.resolve<ApprovalAnswer>('unavailable'),
      ),
    ).then(
      // Normalize a rogue (non-vocabulary) answerer return to the fail-closed
      // outcome instead of leaking it into callers' closed-union switches.
      normalizeAnswer,
      // A throwing answerer must fail the QUESTION closed, not the caller's
      // tool call open — the seam contains its callbacks.
      () => ({ outcome: 'unavailable' } as const),
    )
    if (signal === undefined) return answer
    return await new Promise<ApprovalDecision>((resolve) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        resolve({ outcome: 'cancelled' })
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void answer.then((decision) => {
        signal.removeEventListener('abort', onAbort)
        // After an abort won the race this resolve is a settled-promise no-op:
        // the late answer is discarded by construction.
        resolve(decision)
      })
    })
  }
}

export default ApprovalService
