/**
 * The frozen spec and the identity it computes: schemastery validation, the
 * rules a spec must satisfy before any department starts, the content digest
 * the program id is built from, and the dependency order the integration merges
 * branches in.
 *
 * Identity is content: the digest covers everything that decides what the
 * program runs, with goals sorted by key and each goal's dependencies sorted, so
 * the same deliverable frozen twice is one program while any changed check,
 * budget, or dependency is a different one. The signoff attests the spec rather
 * than describing it and is deliberately outside the digest.
 *
 * @module @deepseek-ai/dsh-program/spec
 */

import { createHash } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { CertificateIsolation, CheckId, StandardCheck } from '@deepseek-ai/dsh-verification/types'
import type { ProgramGoalSpec, ProgramId, ProgramSignoff, ProgramSpec } from './types.ts'

/** Prefix of every program id, so a session id names what it holds. */
export const PROGRAM_ID_PREFIX = 'program-'

/**
 * The key the integration session and worktree use. A goal key is
 * lower-kebab-case, so no goal can ever claim this one.
 */
export const INTEGRATION_KEY = '@integration'

/** Identities a goal key may use; it becomes one path segment and one branch component. */
export const PROGRAM_GOAL_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Check ids the program reserves for `integration.gates`. */
const RESERVED_GATE_CHECK = /^gate-[0-9]+$/

/** Branch prefixes a deployment may configure; each component is one git ref segment. */
export const PROGRAM_BRANCH_PREFIX = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/

/** Stable error codes of a refused spec, configuration, or git operation. */
export type ProgramErrorCode =
  | 'PROGRAM_INVALID_CONFIG'
  | 'PROGRAM_INVALID_SPEC'
  | 'PROGRAM_SIGNOFF_REQUIRED'
  | 'PROGRAM_UNKNOWN_PRESET'
  | 'PROGRAM_GIT_FAILED'

/** Error returned by the program boundary. */
export class ProgramError extends HarnessError {
  /**
   * @param message - human-readable reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: ProgramErrorCode) {
    super(message, code)
  }
}

/**
 * Brand a string as a program id.
 * @param id - raw program identifier.
 * @returns the same string with the compile-time brand.
 */
export function ProgramId(id: string): ProgramId {
  return id as ProgramId
}

/** Schemastery validation of one executable check, shared by goals and the integration. */
const checkSchema = z.object({
  // CheckId is branded and has no schemastery primitive; the verification
  // domain rejects an id that is not lower-kebab-case when the standard is authored.
  id: (z.string() as z<CheckId>).required(),
  outcome: z.string().required(),
  run: z.string().required(),
}) as z<StandardCheck>

/** Schemastery validation of one caller-supplied {@link ProgramSpec}. */
export const ProgramSpecSchema: z<ProgramSpec> = z.object({
  objective: z.string().required(),
  baseRevision: z.string().required(),
  goals: z.array(z.object({
    key: z.string().required(),
    objective: z.string().required(),
    preset: z.string().required(),
    isolation: (z.union(['none', 'process', 'host'] as const) as z<CertificateIsolation>).required(),
    budget: z.object({
      maxTotalTokens: z.number(),
      maxWallMs: z.number(),
      maxCostEur: z.number(),
    }).required(),
    dependsOn: z.array(z.string()).required(),
    checks: z.array(checkSchema).required(),
  })).required(),
  integration: z.object({
    checks: z.array(checkSchema).required(),
    gates: z.array(z.string()).required(),
  }).required(),
  // Prevent Schemastery from materializing an omitted signoff as `{}`, whose
  // missing fields would reject every program a deployment does not gate on one.
  signoff: z.object({
    principal: z.string().required(),
    artefactSha256: z.string().required(),
  }).default(undefined as unknown as ProgramSignoff),
  tokenCeiling: z.natural().min(1),
}) as z<ProgramSpec>

/** Reject a budget field that cannot express a ceiling. */
function requireBudget(key: string, field: string, value: number | undefined): void {
  if (value === undefined) return
  if (!Number.isFinite(value) || value < 0) {
    throw new ProgramError(`goal "${key}" budget ${field} must be a finite non-negative number, got ${String(value)}`, 'PROGRAM_INVALID_SPEC')
  }
}

/** Reject a check inventory that cannot author a standard. */
function requireChecks(owner: string, checks: readonly StandardCheck[]): void {
  const seen = new Set<string>()
  for (const check of checks) {
    if (seen.has(check.id)) {
      throw new ProgramError(`${owner} declares check "${check.id}" twice`, 'PROGRAM_INVALID_SPEC')
    }
    seen.add(check.id)
  }
}

/** Reject a dependency list that names an unknown key, itself, or one key twice. */
function requireDependencies(goal: ProgramGoalSpec, keys: ReadonlySet<string>): void {
  const seen = new Set<string>()
  for (const dependency of goal.dependsOn) {
    if (dependency === goal.key) {
      throw new ProgramError(`goal "${goal.key}" depends on itself`, 'PROGRAM_INVALID_SPEC')
    }
    if (!keys.has(dependency)) {
      throw new ProgramError(`goal "${goal.key}" depends on "${dependency}", which the program does not declare`, 'PROGRAM_INVALID_SPEC')
    }
    if (seen.has(dependency)) {
      throw new ProgramError(`goal "${goal.key}" depends on "${dependency}" twice`, 'PROGRAM_INVALID_SPEC')
    }
    seen.add(dependency)
  }
}

/**
 * Order the goals so every goal follows the goals it depends on.
 *
 * Ties break by key, so one dependency graph always merges in one order and two
 * processes integrating the same program produce the same merge sequence.
 * @param goals - the program's goals; their dependencies must be resolvable.
 * @returns the goal keys in dependency order.
 * @throws {@link ProgramError} when the dependencies contain a cycle.
 */
export function dependencyOrder(goals: readonly ProgramGoalSpec[]): string[] {
  const pending = new Map(goals.map(goal => [goal.key, new Set(goal.dependsOn)]))
  const ordered: string[] = []
  while (pending.size > 0) {
    const ready = [...pending.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([key]) => key)
      .sort((left, right) => (left < right ? -1 : 1))
    const next = ready[0]
    if (next === undefined) {
      const cycle = [...pending.keys()].sort((left, right) => (left < right ? -1 : 1))
      throw new ProgramError(`goals ${cycle.map(key => `"${key}"`).join(', ')} form a dependency cycle`, 'PROGRAM_INVALID_SPEC')
    }
    pending.delete(next)
    for (const dependencies of pending.values()) dependencies.delete(next)
    ordered.push(next)
  }
  return ordered
}

/**
 * Validate one caller-supplied spec and freeze it.
 * @param input - the spec as the caller supplied it.
 * @returns the validated spec, with every schema default materialized.
 * @throws {@link ProgramError} when a key, dependency, budget, or check
 *   inventory cannot support a program.
 */
export function resolveProgramSpec(input: ProgramSpec): ProgramSpec {
  const spec = ProgramSpecSchema(input)
  if (spec.goals.length === 0) {
    throw new ProgramError('a program declares at least one goal', 'PROGRAM_INVALID_SPEC')
  }
  const keys = new Set<string>()
  for (const goal of spec.goals) {
    if (!PROGRAM_GOAL_KEY.test(goal.key)) {
      throw new ProgramError(`goal key "${goal.key}" must be lower-kebab-case`, 'PROGRAM_INVALID_SPEC')
    }
    if (keys.has(goal.key)) {
      throw new ProgramError(`goal key "${goal.key}" is declared twice`, 'PROGRAM_INVALID_SPEC')
    }
    keys.add(goal.key)
  }
  for (const goal of spec.goals) {
    requireDependencies(goal, keys)
    requireBudget(goal.key, 'maxTotalTokens', goal.budget.maxTotalTokens)
    requireBudget(goal.key, 'maxWallMs', goal.budget.maxWallMs)
    requireBudget(goal.key, 'maxCostEur', goal.budget.maxCostEur)
    if (goal.checks.length === 0) {
      throw new ProgramError(`goal "${goal.key}" declares no check, so nothing can certify it`, 'PROGRAM_INVALID_SPEC')
    }
    requireChecks(`goal "${goal.key}"`, goal.checks)
  }
  dependencyOrder(spec.goals)
  if (spec.integration.checks.length + spec.integration.gates.length === 0) {
    throw new ProgramError('the integration declares no check and no gate, so nothing can certify the merged head', 'PROGRAM_INVALID_SPEC')
  }
  for (const check of spec.integration.checks) {
    if (RESERVED_GATE_CHECK.test(check.id)) {
      throw new ProgramError(`integration check "${check.id}" uses an id the program reserves for integration.gates`, 'PROGRAM_INVALID_SPEC')
    }
  }
  requireChecks('the integration', spec.integration.checks)
  return spec
}

/**
 * The integration standard: the declared checks followed by one check per gate.
 *
 * Folding the gates in is what makes the integration certificate cover them:
 * the verification domain records one result per active check, so a gate that
 * lives outside the standard would be a pass the certificate never states.
 * @param integration - the spec's integration section.
 * @returns the checks to author the integration standard from, in order.
 */
export function integrationChecks(integration: ProgramSpec['integration']): StandardCheck[] {
  return [
    ...integration.checks,
    ...integration.gates.map((gate, index) => ({
      id: `gate-${String(index + 1)}` as CheckId,
      outcome: `the merged head passes the gate: ${gate}`,
      run: gate,
    })),
  ]
}

/** One check as the digest reads it, free of any property order the caller used. */
function canonicalCheck(check: StandardCheck): unknown {
  return { id: check.id, outcome: check.outcome, run: check.run }
}

/**
 * Digest one frozen spec.
 *
 * Goals are sorted by key and each goal's dependencies are sorted, so the order
 * a caller listed them in never changes the identity; check and gate order is
 * kept, because it is the order a validator runs them in. `signoff` is excluded:
 * it attests the spec instead of stating what the program runs.
 * @param spec - the validated spec.
 * @returns the lowercase SHA-256 hex of its canonical form.
 */
export function programSpecDigest(spec: ProgramSpec): string {
  const goals = [...spec.goals]
    .sort((left, right) => (left.key < right.key ? -1 : 1))
    .map(goal => ({
      key: goal.key,
      objective: goal.objective,
      preset: goal.preset,
      isolation: goal.isolation,
      budget: {
        maxTotalTokens: goal.budget.maxTotalTokens ?? null,
        maxWallMs: goal.budget.maxWallMs ?? null,
        maxCostEur: goal.budget.maxCostEur ?? null,
      },
      dependsOn: [...goal.dependsOn].sort((left, right) => (left < right ? -1 : 1)),
      checks: goal.checks.map(canonicalCheck),
    }))
  const canonical = {
    objective: spec.objective,
    baseRevision: spec.baseRevision,
    tokenCeiling: spec.tokenCeiling ?? null,
    goals,
    integration: {
      checks: spec.integration.checks.map(canonicalCheck),
      gates: [...spec.integration.gates],
    },
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/**
 * The identity one digest names.
 * @param digest - the spec digest.
 * @returns `program-<digest>`, which is also the program session's id.
 */
export function programIdFor(digest: string): ProgramId {
  return ProgramId(`${PROGRAM_ID_PREFIX}${digest}`)
}
