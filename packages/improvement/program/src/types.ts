/**
 * Pure types of the program ledger: the frozen spec a program is identified by,
 * the seven `program/*` events its sessions carry, and the reconciled state a
 * restarting process folds out of them, free of this package's host-side
 * imports.
 *
 * @module @deepseek-ai/dsh-program/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import type { CertificateIsolation, StandardCheck } from '@deepseek-ai/dsh-verification/types'

/** Identifies one program across every session and worktree it owns. */
export type ProgramId = Branded<'ProgramId'>

/**
 * Per-session caps one department runs under, written to its session as
 * `budget/caps`. The three fields are the caps a program can state about a
 * department: token and wall-clock spend bound every deployment, and cost binds
 * one whose routes the budget policy prices.
 */
export interface ProgramGoalBudget {
  /** Input plus output tokens the department's session may spend. */
  readonly maxTotalTokens?: number
  /** Milliseconds the department's session log may span. */
  readonly maxWallMs?: number
  /** EUR the department's priced routes may cost. */
  readonly maxCostEur?: number
}

/** One goal of a program: what one department delivers, and what certifies it. */
export interface ProgramGoalSpec {
  /** Lower-kebab-case identity, unique in the program; it names the branch and the worktree. */
  readonly key: string
  /** The objective the department's goal is created with. */
  readonly objective: string
  /** Id of a shipped preset declaring the `implementer` role, mounted into the department session. */
  readonly preset: string
  /** Isolation the department's certified run claims. */
  readonly isolation: CertificateIsolation
  /** Caps recorded on the department session before its first turn. */
  readonly budget: ProgramGoalBudget
  /** Keys of the goals this one is delivered after; a directed acyclic graph over the program's keys. */
  readonly dependsOn: readonly string[]
  /** The standard the department is certified against, compiled before any department starts. */
  readonly checks: readonly StandardCheck[]
}

/** What the merged head must satisfy before the program releases. */
export interface ProgramIntegrationSpec {
  /** The standard authored for the integration session over the merged head. */
  readonly checks: readonly StandardCheck[]
  /**
   * Shell commands the merged head must exit zero on, run in the integration
   * worktree beside the standard. Each becomes one `gate-<n>` check of the
   * integration standard, in this order, so the integration certificate covers
   * the gates as well as the checks.
   */
  readonly gates: readonly string[]
}

/**
 * The artefact a program's signatures attest. It names what was signed rather
 * than describing what the program runs, so it stays out of the program's
 * digest: the same goals signed over two artefacts are one program. Who signed
 * comes from the `signoff/recorded` events of the program session, never from
 * here.
 */
export interface ProgramSignoff {
  /** Lowercase SHA-256 hex every `signoff/recorded` of this program must carry. */
  readonly artefactSha256: string
}

/**
 * How every department of one program is staffed.
 *
 * `route` is the harness agent the program drives itself through the LLM seam,
 * one user turn per attempt. `subagent` delegates each attempt to one child run
 * of a registered `ctx.subagents` provider, which writes into the department's
 * worktree while the program keeps the checks, the certificate, the caps, and
 * the ledger.
 */
export type ProgramImplementer =
  | { readonly kind: 'route' }
  | {
    readonly kind: 'subagent'
    /** Name the provider is registered under on `ctx.subagents`. */
    readonly provider: string
    /** Display label persisted with a session-backed child, passed through to the provider. */
    readonly label?: string
  }

/** One client deliverable, frozen before its first department starts. */
export interface ProgramSpec {
  /** What the whole program delivers, stated for a reader of the ledger. */
  readonly objective: string
  /** Git revision every worktree of the program is created from. */
  readonly baseRevision: string
  /** The goals the deliverable decomposes into, at least one. */
  readonly goals: readonly ProgramGoalSpec[]
  /** What the merged head is certified against. */
  readonly integration: ProgramIntegrationSpec
  /**
   * How every department of the program is staffed. A caller may omit it;
   * `resolveProgramSpec` materializes `{ kind: 'route' }`, so a
   * {@link FrozenProgramSpec} always states one and the digest always covers it.
   */
  readonly implementer?: ProgramImplementer
  /** The artefact the program's signatures attest; required by `requireSignoff`. */
  readonly signoff?: ProgramSignoff
  /** Input plus output tokens every session of the program may sum to. */
  readonly tokenCeiling?: number
}

/**
 * One spec after `resolveProgramSpec` materialized every default it owns. This
 * is the form the digest covers, the ledger stores, and the service drives, so
 * a reconciliation reads the staffing the program ran under instead of
 * re-deriving it.
 */
export interface FrozenProgramSpec extends ProgramSpec {
  readonly implementer: ProgramImplementer
}

/**
 * Status of one goal in its program's ledger.
 *
 * `pending` has no department yet, `running` has one working, `blocked` waits
 * for an operator's resume through the goal domain, `certified` holds a
 * certificate over its own branch head, `merged` has that branch inside a
 * certified integration, `failed` ended without a certificate, and `abandoned`
 * never started because the program ended first.
 */
export type ProgramGoalStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'certified'
  | 'failed'
  | 'merged'
  | 'abandoned'

/** How one program ended. */
export type ProgramOutcome = 'released' | 'failed' | 'abandoned'

/** How the integration of one program stands. */
export type ProgramIntegrationStatus = 'running' | 'certified' | 'failed'

/** Payload of `program/start`. */
export interface ProgramStart {
  /** `program-<digest>`, which is also this session's id. */
  readonly programId: ProgramId
  /** Digest of {@link ProgramStart.spec}, the identity the program runs under. */
  readonly specSha256: string
  /** The frozen spec, verbatim. */
  readonly spec: FrozenProgramSpec
  /** Git revision every worktree is created from; the spec's own value, copied for readers of this event alone. */
  readonly baseRevision: string
  /** How every department is staffed; the spec's own value, copied for readers of this event alone. */
  readonly implementer: ProgramImplementer
  /** The artefact the program's signatures attest, absent when the deployment does not require one. */
  readonly signoff?: ProgramSignoff
}

/** Payload of `program/goal`. */
export interface ProgramGoalRecord {
  readonly programId: ProgramId
  /** The goal's key in the frozen spec. */
  readonly key: string
  readonly status: ProgramGoalStatus
  /** The department's session, from the first status that has one. */
  readonly sessionId?: SessionId
  /** Absolute path of the department's worktree, from the first status that has one. */
  readonly workspace?: string
  /** The department branch head when this status was recorded. */
  readonly revision?: string
  /** The blocking code or the failure text; absent for a status that needs no explanation. */
  readonly reason?: string
}

/** Payload of `program/integration`. */
export interface ProgramIntegrationRecord {
  readonly programId: ProgramId
  readonly status: ProgramIntegrationStatus
  /** Head of the integration worktree after every department branch merged. */
  readonly mergedRevision?: string
  /** The integration session, present once one exists. */
  readonly sessionId?: SessionId
  /** Why the integration failed; absent otherwise. */
  readonly reason?: string
}

/** Goals of one program counted by the status a reconciliation gave them. */
export interface ProgramGoalStatusCounts {
  readonly pending: number
  readonly running: number
  readonly blocked: number
  readonly certified: number
  readonly failed: number
  readonly merged: number
  readonly abandoned: number
}

/** Payload of `program/resume`. */
export interface ProgramResume {
  readonly programId: ProgramId
  /** Count per status over every goal of the spec, as this process reconciled them. */
  readonly statuses: ProgramGoalStatusCounts
}

/** Payload of `program/end`. */
export interface ProgramEnd {
  readonly programId: ProgramId
  readonly outcome: ProgramOutcome
  /** The certified merged head a released program delivered. */
  readonly mergedRevision?: string
}

/** Payload of `program/member`. */
export interface ProgramMember {
  readonly programId: ProgramId
  /** The goal key this session is the department for, or `@integration` for the integration session. */
  readonly key: string
}

/** Payload of `program/delegation`. */
export interface ProgramDelegation {
  /** The goal this department delivers; the same key its `program/member` stamp carries. */
  readonly goalKey: string
  /** The 1-based attempt this run served, counted across every process that drove the department. */
  readonly attempt: number
  /** Name the provider was started under. */
  readonly provider: string
  /** The run's parent-scoped id, which for a child published in this process is that child's session id. */
  readonly runId: SessionId
  /** Why the child's run ended, as the subagent seam reports it. */
  readonly stopReason: SubagentStopReason
  /** The structured result the provider captured, absent unless it returned one. */
  readonly structured?: unknown
  /** What the run cost, absent unless the provider published a child in this process. */
  readonly usage?: ProgramDelegationUsage
}

/** Tokens one delegated child's own session log accounts for. */
export interface ProgramDelegationUsage {
  /** Input plus output tokens, folded from the child's session by the budget policy's own rule. */
  readonly totalTokens: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opening record of one program: the identity its frozen spec digests to,
     * the spec verbatim, the revision every worktree is created from, and the
     * attested artefact when the deployment required one. Appended once, before
     * the first department exists, and the only event that tells a later
     * process a program exists to reconcile.
     */
    'program/start': ProgramStart
    /**
     * One goal of the program changed status: the key, the new status, and the
     * department session, worktree, branch head, or reason that status carries.
     * Appended after the fact it records is durable — the worktree exists, the
     * department session is flushed, the certificate is in the department's own
     * log — so the ledger never claims a state the departments cannot show.
     */
    'program/goal': ProgramGoalRecord
    /**
     * The integration of the program: `running` once the merged worktree
     * exists, then `certified` with the merged head its certificate covers, or
     * `failed` with the reason. Departments move to `merged` only after the
     * `certified` record.
     */
    'program/integration': ProgramIntegrationRecord
    /**
     * A later process picked this program up: the count per status over every
     * goal of the spec, as reconciled from the department logs and worktrees.
     * Appended after the status changes that reconciliation discovered and
     * before any department is resumed or started.
     */
    'program/resume': ProgramResume
    /**
     * Closing record of one program: how it ended and, for a released one, the
     * certified merged head it delivered. Its presence is what marks the
     * program finished, so a session with `program/start` and no `program/end`
     * is exactly what a later process reconciles.
     */
    'program/end': ProgramEnd
    /**
     * This session belongs to one program: the program and the key it works.
     * Appended once at creation, to the department or integration session
     * rather than to the program's own, so a reader folding sessions can group
     * a program's work without the ledger.
     */
    'program/member': ProgramMember
    /**
     * One attempt of a delegated department ran as one child of an external
     * coding agent and ended: the attempt it served, the provider and run it
     * used, and what that run came to. Appended to the department's own session
     * after the run settled and before its checks execute, so a restarting
     * process continues after the attempts the log records instead of running
     * one a second time. No model request of this session carries it, and
     * nothing of the child's own history reaches this log.
     */
    'program/delegation': ProgramDelegation
  }
}
