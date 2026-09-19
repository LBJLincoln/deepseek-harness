/**
 * Generates the customer proof-of-concept's 147-agent enterprise roster from
 * sources this repository actually defines: package READMEs, `verify-*`
 * scripts, CI gate names, Agent Notes, skill directories, the Proving Ground
 * bench's real task environments, and the code-safety review knowledge packs
 * under `data/knowledge/code-safety`. Every {@link RosterAgentDefinition.source}
 * is a repository-relative path this generator checks with `existsSync`
 * before emitting it, so a renamed or removed source fails the generator
 * loudly instead of shipping a roster entry nothing backs.
 *
 * The roster is a composition of role x division x specialization. Every
 * division's agent count is a fixed quota in {@link DIVISION_QUOTAS}, summing
 * to {@link ROSTER_AGENT_COUNT}: a division whose members come from a
 * variable pool (a package group's leaves, a `verify-*.ts` directory, a
 * skill directory, a bench environment directory) takes exactly its quota
 * from that pool, sorted, via {@link takeQuota}, which throws naming the
 * division and the shortfall when the tree defines fewer sources than the
 * quota needs — the count never silently drifts with an unrelated rename or
 * removal. A division built from fixed enumerations (the CI gate union, the
 * governance standards, the code-safety department x specialization
 * cross-product) is exact by construction instead. Pool iteration order is
 * `Array#sort` on the pool's own keys, which is what makes the output
 * byte-identical for the same tree.
 *
 * `status` here is always `"defined"` and `counts.active` is always `0`: this
 * module describes what the repository defines, never what is running. Live
 * status and active counts are computed by `scripts/harness-feed.ts` from real
 * session data and are never written back into this file.
 *
 * @module enterprise-roster
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One LLM route: the provider a Service Definition registers plus the model id it accepts. */
export interface RosterRoute {
  /** Provider route key (e.g. `deepseek-official`, `claude-code`, `codex`, `openrouter`). */
  provider: string
  /** Model id sent to that provider. */
  model: string
}

/** One roster entry: a defined agent seat, grounded in one real repository source. */
export interface RosterAgentDefinition {
  /** Unique, kebab-case, stable across regenerations while its source stays put. */
  id: string
  /** Human-readable name for display. */
  name: string
  /** The agent's function (e.g. `steward`, `reviewer`, `verifier`, `judge`, `curator`). */
  role: string
  /** The division id this agent belongs to; matches one entry in {@link Roster.divisions}. */
  division: string
  /** The code-safety department this agent reviews; present only in the `code-safety` division. */
  department?: string
  /** The role x division axis this agent covers within its division (a language, a package, a gate name). */
  specialization?: string
  /** The LLM route this agent's session would run under. */
  route: RosterRoute
  /** The preset id (`coding` or `reviewing`, the two presets this repository ships as fixtures) this agent composes from. */
  preset: string
  /**
   * Skill ids this agent draws on; empty when none applies. A bare id names
   * `.agents/skills/<id>`; a `code-safety/<id>` id names the review
   * knowledge pack at `data/knowledge/code-safety/<id>/SKILL.md`.
   */
  skills: string[]
  /** Model-facing tool ids this agent's preset would register; empty when none applies. */
  tools: string[]
  /** Repository-relative path this entry derives from; always checked to exist on disk at generation time. */
  source: string
  /** Always `"defined"` in the generated file; live status is computed by `harness-feed.ts`, never written here. */
  status: 'defined'
}

/**
 * One relationship between two roster agents. `from` performs the relationship
 * named by `kind` on or toward `to`: `verifies` (a verifier checks an
 * implementer's output), `judges` (a judge rules on a verifier's check),
 * `merges` (an integrator merges a department's findings), `reads` (a curator
 * reads a dataset), `reports` (a scorekeeper reports to the observatory), and
 * `delegates` (a program hands work to its departments).
 */
export interface RosterEdge {
  /** Source agent id; must name an entry in {@link Roster.agents}. */
  from: string
  /** Target agent id; must name an entry in {@link Roster.agents}. */
  to: string
  /** The relationship type; see the interface doc for the reading of each value. */
  kind: 'delegates' | 'verifies' | 'judges' | 'merges' | 'reads' | 'reports'
}

/** One division's identity and remit. */
export interface RosterDivisionSummary {
  /** Kebab-case division id; matches {@link RosterAgentDefinition.division} on its members. */
  id: string
  /** Human-readable division name. */
  name: string
  /** One-line description of what the division is for. */
  purpose: string
}

/** The complete generated roster document persisted at `data/enterprise/roster.json`. */
export interface Roster {
  /** ISO timestamp of the moment the roster's content last changed; {@link generateRoster} keeps it while the content is unchanged. */
  generatedAt: string
  /** Aggregate counts; `active` is always 0 here because this file never observes running sessions. */
  counts: { defined: number; active: number }
  /** Every division this roster composes agents from, in a fixed presentation order. */
  divisions: RosterDivisionSummary[]
  /** The 147 defined agents. */
  agents: RosterAgentDefinition[]
  /** Relationships between agents, derived from role/division adjacency. */
  edges: RosterEdge[]
}

/** The roster's fixed size: role x division x specialization composed over this repository's real sources. */
export const ROSTER_AGENT_COUNT = 147

/**
 * Every division's fixed agent count, summing to {@link ROSTER_AGENT_COUNT}.
 * The count is a design constant, not a directory listing's length: a
 * division whose members come from a variable pool (a package group, a
 * fixture directory) takes exactly its quota from that pool via
 * {@link takeQuota}, sorted, and throws naming the shortfall rather than
 * silently reporting however many the tree happens to define today.
 */
const DIVISION_QUOTAS = {
  'code-safety': 43,
  'harness-core': 24,
  verification: 14,
  'proving-ground': 12,
  judging: 11,
  knowledge: 11,
  'program-departments': 10,
  'curation-data': 8,
  governance: 8,
  observatory: 6,
} as const satisfies Record<string, number>

const CLAUDE_CODE_MODELS = ['sonnet', 'opus', 'haiku'] as const

/**
 * Resolve one hardcoded relative source path against the repository root and
 * fail loudly if it is missing, instead of shipping a roster entry nothing on
 * disk backs.
 * @param root - repository root.
 * @param relative - repository-relative path (forward slashes) to cite.
 * @returns `relative`, unchanged, once existence is confirmed.
 */
function cite(root: string, relative: string): string {
  if (!existsSync(join(root, relative))) {
    throw new Error(`enterprise-roster: cited source "${relative}" does not exist in this tree`)
  }
  return relative
}

/**
 * Take exactly `quota` sources from `pool` (already sorted for deterministic
 * iteration), or throw a clear, named error when the tree defines fewer than
 * `quota`.
 * @param division - the division id, named in the shortfall error.
 * @param pool - the sorted candidate sources.
 * @param quota - the division's fixed agent count.
 * @returns exactly `quota` sources, in pool order.
 */
function takeQuota<T>(division: string, pool: readonly T[], quota: number): T[] {
  if (pool.length < quota) {
    throw new Error(`enterprise-roster: division "${division}" needs ${quota} sources but this tree defines only ${pool.length}`)
  }
  return pool.slice(0, quota)
}

/**
 * Pick one entry of `pool` cyclically by `index`, for an agent count larger
 * than a fixed route or specialization pool (an OpenRouter model list, the
 * three Claude Code models). Throws on an empty pool rather than returning
 * `undefined`, which `noUncheckedIndexedAccess` cannot otherwise rule out at
 * the call site.
 * @param pool - the fixed values to cycle through.
 * @param index - the agent's position in its division.
 * @returns one entry of `pool`.
 */
function pickCyclic<T>(pool: readonly T[], index: number): T {
  const item = pool[index % pool.length]
  if (item === undefined) throw new Error('enterprise-roster: pickCyclic called with an empty pool')
  return item
}

/**
 * Extract every free OpenRouter model id from the Proving Ground bench's
 * OpenRouter overlay, by regular expression over the file text rather than a
 * YAML parse: the ids this roster cites for its `openrouter` routes must
 * track whatever that overlay actually lists, never a hardcoded snapshot of
 * it. Every model on this route is a `:free` id (a plugin-entry `id:` such as
 * `llm-pi-ai` never carries that suffix), so matching on the suffix finds
 * exactly the model list regardless of the file's other `id:` keys or indentation.
 * @param root - repository root.
 * @returns every free model id in file order.
 */
function openRouterFreeModels(root: string): string[] {
  const path = 'examples/headless-agent/tests/fixtures/proving-ground-bench/overlays/with-openrouter.cordis.yml'
  const text = readFileSync(join(root, cite(root, path)), 'utf8')
  const ids = [...text.matchAll(/^\s*- id:\s*(\S+:free)\s*$/gm)]
    .map(match => match[1])
    .filter((id): id is string => id !== undefined)
  if (ids.length === 0) throw new Error(`enterprise-roster: found no ":free" model id in ${path}`)
  return ids
}

/**
 * Real leaf package directories (each with its own `README.md`) directly
 * under one package group, sorted for deterministic iteration.
 * @param root - repository root.
 * @param group - group directory name under `packages/`.
 * @returns sorted leaf directory names.
 */
function packageLeaves(root: string, group: string): string[] {
  const dir = join(root, 'packages', group)
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

/**
 * Real `verify-*.ts` gate scripts (excluding their `.spec.ts` tests), sorted
 * for deterministic iteration.
 * @param root - repository root.
 * @returns sorted script filenames under `scripts/`.
 */
function verifyScripts(root: string): string[] {
  return readdirSync(join(root, 'scripts'))
    .filter(name => name.startsWith('verify-') && name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .sort()
}

/**
 * Real bench task directories under the Proving Ground bench fixture, sorted
 * for deterministic iteration — the same environments the recorded runs
 * under `data/proving-ground` name as cells (`code:build-schedule`,
 * `code:glob-match`, …), so a bench operator seat names a task this
 * repository's own bench actually runs, not an unrelated snapshot fixture.
 * @param root - repository root.
 * @returns sorted `examples/headless-agent/tests/fixtures/proving-ground-bench/environments/<name>` paths.
 */
function provingGroundEnvironments(root: string): string[] {
  const base = 'examples/headless-agent/tests/fixtures/proving-ground-bench/environments'
  return readdirSync(join(root, base), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => `${base}/${entry.name}`)
    .sort()
}

/** Real `.agents/skills/<id>` directories, sorted for deterministic iteration. */
function skillDirectories(root: string): string[] {
  return readdirSync(join(root, '.agents/skills'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

/** Convert a kebab-case slug into a Title Case display name. */
function titleCase(slug: string): string {
  return slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/** The roster file this generator owns, relative to the repository root. */
export const ROSTER_PATH = 'data/enterprise/roster.json'

/** The `generatedAt` a roster is built under before any file exists to keep a stamp from. */
const EPOCH = '1970-01-01T00:00:00Z'

/** Options for {@link buildRoster}. */
export interface BuildRosterOptions {
  /** The `generatedAt` to stamp; {@link generateRoster} chooses the value that keeps an unchanged file byte-identical. */
  generatedAt: string
  /** Repository-relative path to this feature's Agent Note, cited as the code-safety program lead's source. */
  notePath?: string
}

/**
 * Read the roster file as last written.
 * @param file - absolute path of the roster file.
 * @returns the file's bytes and the `generatedAt` they carry, or `undefined` when no file exists.
 */
function readRosterFile(file: string): { content: string; generatedAt: string } | undefined {
  if (!existsSync(file)) return undefined
  const content = readFileSync(file, 'utf8')
  try {
    const parsed: unknown = JSON.parse(content)
    const stamp = typeof parsed === 'object' && parsed !== null && 'generatedAt' in parsed ? parsed.generatedAt : undefined
    return { content, generatedAt: typeof stamp === 'string' ? stamp : EPOCH }
  } catch {
    // A file that is not JSON cannot match any build, so it is rewritten under a fresh stamp.
    return { content, generatedAt: EPOCH }
  }
}

/**
 * Regenerate the roster file. `generatedAt` names the moment the roster's
 * content last changed: the roster is first built under the file's current
 * stamp, and when that reproduces the file byte for byte the file is left as
 * it is; otherwise the roster is rebuilt under `now()` and written.
 * @param root - repository root.
 * @param now - the stamp a changed roster receives; the wall clock unless a test injects a fixed value.
 * @param file - the roster file to read and write; {@link ROSTER_PATH} under `root` unless overridden.
 * @returns the roster the file holds afterwards and whether the file changed.
 */
export function generateRoster(
  root: string,
  now: () => string = () => new Date().toISOString(),
  file = join(root, ROSTER_PATH),
): { roster: Roster; changed: boolean } {
  const previous = readRosterFile(file)
  const rebuilt = buildRoster(root, { generatedAt: previous?.generatedAt ?? EPOCH })
  if (previous !== undefined && serializeRoster(rebuilt) === previous.content) return { roster: rebuilt, changed: false }
  const roster = buildRoster(root, { generatedAt: now() })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, serializeRoster(roster))
  return { roster, changed: true }
}

const DIVISIONS: RosterDivisionSummary[] = [
  {
    id: 'harness-core',
    name: 'Harness Core',
    purpose: 'Stewards the product API spine: session, prompt assembly, tools, agent, the agent loop, LLM routing, and subagent delegation.',
  },
  {
    id: 'proving-ground',
    name: 'Proving Ground',
    purpose: 'Operates the harness against real bench scenarios recorded under examples/headless-agent/tests.',
  },
  {
    id: 'verification',
    name: 'Verification',
    purpose: 'Runs the verify-* scripts that gate changed source before it ships.',
  },
  {
    id: 'judging',
    name: 'Judging',
    purpose: 'Decides pass or fail at each named CI gate.',
  },
  {
    id: 'curation-data',
    name: 'Curation & Data',
    purpose: 'Curates the Agent Note corpus and fixture datasets, and keeps score of usage for the observatory.',
  },
  {
    id: 'program-departments',
    name: 'Program Departments',
    purpose: 'Coordinates cross-cutting package groups as departments of one program.',
  },
  {
    id: 'code-safety',
    name: 'Code Safety',
    purpose: 'Reviews target repositories for secrets, injection, access, data, dependency, and platform risk, per language.',
  },
  {
    id: 'knowledge',
    name: 'Knowledge',
    purpose: 'Keeps the repository\'s reusable skills current and discoverable.',
  },
  {
    id: 'governance',
    name: 'Governance',
    purpose: 'Owns process standards: labels, stacking, dependencies, vendoring, licensing, and translation pairing.',
  },
  {
    id: 'observatory',
    name: 'Observatory',
    purpose: 'Watches session telemetry, token spend, and query surfaces across runs.',
  },
]

/**
 * One code-safety department: its id and display name. Its grounding source
 * and knowledge-pack skill both derive from `id` alone —
 * `data/knowledge/code-safety/<id>/SKILL.md`, the real review knowledge pack
 * for that department — so there is nothing further to hardcode per department.
 */
interface CodeSafetyDepartment {
  id: string
  name: string
}

/** One code-safety specialization: the language(s) a reviewer seat covers. */
interface CodeSafetySpecialization {
  id: string
  name: string
}

const CODE_SAFETY_DEPARTMENTS: readonly CodeSafetyDepartment[] = [
  { id: 'secrets', name: 'Secrets' },
  { id: 'injection', name: 'Injection' },
  { id: 'access', name: 'Access' },
  { id: 'data', name: 'Data' },
  { id: 'dependencies', name: 'Dependencies' },
  { id: 'platform', name: 'Platform' },
]

const CODE_SAFETY_SPECIALIZATIONS: readonly CodeSafetySpecialization[] = [
  { id: 'javascript-typescript', name: 'JavaScript/TypeScript' },
  { id: 'python', name: 'Python' },
  { id: 'java', name: 'Java' },
  { id: 'go', name: 'Go' },
  { id: 'php', name: 'PHP' },
  { id: 'mobile', name: 'Mobile (Swift/Kotlin)' },
]

/** A knowledge-pack skill id under `data/knowledge/code-safety/<id>/SKILL.md`; see {@link RosterAgentDefinition.skills}. */
function codeSafetyKnowledgeSkill(root: string, id: string): string {
  cite(root, `data/knowledge/code-safety/${id}/SKILL.md`)
  return `code-safety/${id}`
}

/**
 * The `code-safety` division ({@link DIVISION_QUOTAS}): 36 department x
 * specialization reviewers, 6 per-department integrators, and 1 program
 * lead — a fixed count by construction (6 departments x 6 specializations,
 * plus 6 plus 1), not a pool slice. Java, Go, PHP, and mobile have no
 * implementing scanner in this repository yet (only JavaScript/TypeScript
 * and Python have first-party static-analysis tooling here), so every
 * reviewer cites its department's real review knowledge pack — the
 * specialization narrows what the seat is *for*, not what already exists for
 * that language. Every reviewer's OpenRouter model cycles through the bench's
 * real free-tier model list (see {@link openRouterFreeModels}).
 * @param root - repository root.
 * @param notePath - the roster design note, cited by the program lead.
 * @param openRouterModels - the bench's real free OpenRouter model ids, cycled across reviewers.
 * @returns the division's agent definitions.
 */
function buildCodeSafety(root: string, notePath: string, openRouterModels: readonly string[]): RosterAgentDefinition[] {
  const agents: RosterAgentDefinition[] = []
  let index = 0
  for (const department of CODE_SAFETY_DEPARTMENTS) {
    const source = cite(root, `data/knowledge/code-safety/${department.id}/SKILL.md`)
    const knowledgeSkill = codeSafetyKnowledgeSkill(root, department.id)
    for (const specialization of CODE_SAFETY_SPECIALIZATIONS) {
      agents.push({
        id: `code-safety-${department.id}-${specialization.id}-reviewer`,
        name: `${department.name} × ${specialization.name} Reviewer`,
        role: 'reviewer',
        division: 'code-safety',
        department: department.id,
        specialization: specialization.id,
        route: { provider: 'openrouter', model: pickCyclic(openRouterModels, index) },
        preset: 'reviewing',
        skills: ['dsh-code-review', knowledgeSkill],
        tools: ['read', 'bash'],
        source,
        status: 'defined',
      })
      index += 1
    }
    agents.push({
      id: `code-safety-${department.id}-integrator`,
      name: `${department.name} Integrator`,
      role: 'integrator',
      division: 'code-safety',
      department: department.id,
      route: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      preset: 'reviewing',
      skills: [knowledgeSkill],
      tools: ['read', 'session_query'],
      source,
      status: 'defined',
    })
  }
  agents.push({
    id: 'code-safety-lead',
    name: 'Code Safety Program Lead',
    role: 'lead',
    division: 'code-safety',
    route: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    preset: 'coding',
    skills: [codeSafetyKnowledgeSkill(root, 'review-method'), codeSafetyKnowledgeSkill(root, 'severity-and-evidence')],
    tools: ['subagent', 'session_query'],
    source: cite(root, notePath),
    status: 'defined',
  })
  return agents
}

/**
 * The `harness-core` division ({@link DIVISION_QUOTAS}): one steward per real
 * leaf package under `packages/core`, `packages/llm`, and `packages/subagent`
 * — the session/prompt/tool/agent spine, the LLM adapter capability, and the
 * subagent delegation capability — taking exactly its quota from the sorted,
 * group-major pool.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildHarnessCore(root: string): RosterAgentDefinition[] {
  const groups = ['core', 'llm', 'subagent'] as const
  const pool = groups.flatMap(group => packageLeaves(root, group).map(leaf => ({ group, leaf })))
  return takeQuota('harness-core', pool, DIVISION_QUOTAS['harness-core']).map(({ group, leaf }) => {
    const source = cite(root, `packages/${group}/${leaf}/README.md`)
    return {
      id: `harness-core-${leaf}-steward`,
      name: `${titleCase(leaf)} Steward`,
      role: 'steward',
      division: 'harness-core',
      specialization: leaf,
      route: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      preset: 'coding',
      skills: [],
      tools: ['read'],
      source,
      status: 'defined',
    }
  })
}

/**
 * The `proving-ground` division ({@link DIVISION_QUOTAS}): one bench
 * operator per real task environment under the Proving Ground bench fixture
 * (see {@link provingGroundEnvironments}), taking exactly its quota from the
 * sorted pool.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildProvingGround(root: string): RosterAgentDefinition[] {
  const scenarios = takeQuota('proving-ground', provingGroundEnvironments(root), DIVISION_QUOTAS['proving-ground'])
  return scenarios.map((scenario, index) => {
    const name = scenario.split('/').at(-1) ?? scenario
    return {
      id: `proving-ground-${name}-bench-operator`,
      name: `${titleCase(name)} Bench Operator`,
      role: 'bench-operator',
      division: 'proving-ground',
      specialization: name,
      route: { provider: 'claude-code', model: pickCyclic(CLAUDE_CODE_MODELS, index) },
      preset: 'coding',
      skills: [],
      tools: ['subagent', 'bash'],
      source: cite(root, scenario),
      status: 'defined',
    }
  })
}

/**
 * The `verification` division ({@link DIVISION_QUOTAS}): one verifier per
 * real `verify-*.ts` gate script, taking exactly its quota from the sorted pool.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildVerification(root: string): RosterAgentDefinition[] {
  const scripts = takeQuota('verification', verifyScripts(root), DIVISION_QUOTAS.verification)
  return scripts.map((file) => {
    const slug = file.replace(/\.ts$/, '')
    return {
      id: `verification-${slug}`,
      name: `${titleCase(slug.replace(/^verify-/, ''))} Verifier`,
      role: 'verifier',
      division: 'verification',
      specialization: slug,
      route: { provider: 'codex', model: 'codex' },
      preset: 'reviewing',
      skills: ['dsh-pre-push-checks'],
      tools: ['bash', 'read'],
      source: cite(root, `scripts/${file}`),
      status: 'defined',
    }
  })
}

/**
 * The literal CI gate ids `scripts/run-gates.ts` names in its `GateMode`
 * union. Hardcoded here (rather than parsed from the TypeScript union) and
 * checked once against the file that must still define them; a renamed or
 * removed gate mode fails {@link buildJudging} loudly.
 */
const CI_GATE_IDS = [
  'ci-primary',
  'ci-linux-primary',
  'ci-static',
  'ci-lint-contracts-ready',
  'ci-coverage',
  'ci-snapshot',
  'ci-artifacts',
  'ci-consumers',
  'ci-windows-blocking',
  'ci-windows-complete',
  'ci-windows-observational',
] as const

/**
 * The `judging` division ({@link DIVISION_QUOTAS}): one judge per named CI
 * gate in `scripts/run-gates.ts`.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildJudging(root: string): RosterAgentDefinition[] {
  const source = cite(root, 'scripts/run-gates.ts')
  const gates = takeQuota('judging', CI_GATE_IDS, DIVISION_QUOTAS.judging)
  return gates.map(gate => ({
    id: `judging-${gate}`,
    name: `${titleCase(gate)} Judge`,
    role: 'judge',
    division: 'judging',
    specialization: gate,
    route: { provider: 'codex', model: 'codex' },
    preset: 'reviewing',
    skills: ['dsh-code-review'],
    tools: ['session_query'],
    source,
    status: 'defined',
  }))
}

const NOTE_KINDS = ['architecture', 'bug-fix', 'feature', 'process', 'simplification', 'testing'] as const

/**
 * The 8-agent `curation-data` division: one curator per Agent Note class
 * under `implemented/`, one fixture curator, and one scorekeeper grounded in
 * the token-usage capability that keeps score for the observatory.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildCurationData(root: string): RosterAgentDefinition[] {
  const agents: RosterAgentDefinition[] = NOTE_KINDS.map(kind => ({
    id: `curation-data-${kind}-curator`,
    name: `${titleCase(kind)} Note Curator`,
    role: 'curator',
    division: 'curation-data',
    specialization: kind,
    route: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    preset: 'reviewing',
    skills: ['dsh-archive-agent-notes'],
    tools: ['read'],
    source: cite(root, `.agents/notes/implemented/${kind}`),
    status: 'defined',
  }))
  agents.push({
    id: 'curation-data-fixture-curator',
    name: 'Fixture Dataset Curator',
    role: 'curator',
    division: 'curation-data',
    route: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    preset: 'reviewing',
    skills: [],
    tools: ['read'],
    source: cite(root, 'examples/headless-agent/tests/fixtures'),
    status: 'defined',
  })
  agents.push({
    id: 'curation-data-scorekeeper',
    name: 'Usage Scorekeeper',
    role: 'scorekeeper',
    division: 'curation-data',
    route: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    preset: 'reviewing',
    skills: [],
    tools: ['session_query'],
    source: cite(root, 'packages/llm/token-meter/README.md'),
    status: 'defined',
  })
  return agents
}

const PROGRAM_DEPARTMENT_GROUPS = [
  'jobs', 'workflow', 'goal', 'schedule', 'feedback', 'storage', 'workspace', 'host', 'client', 'boot',
] as const

/**
 * The 10-agent `program-departments` division: one coordinator per real
 * package group not already covered by `harness-core` or `code-safety`.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildProgramDepartments(root: string): RosterAgentDefinition[] {
  return PROGRAM_DEPARTMENT_GROUPS.map(group => ({
    id: `program-departments-${group}-coordinator`,
    name: `${titleCase(group)} Department Coordinator`,
    role: 'coordinator',
    division: 'program-departments',
    specialization: group,
    route: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    preset: 'coding',
    skills: [],
    tools: ['subagent'],
    source: cite(root, `packages/${group}/README.md`),
    status: 'defined',
  }))
}

/**
 * The `knowledge` division ({@link DIVISION_QUOTAS}): one skill-keeper per
 * real `.agents/skills/<id>` directory, taking exactly its quota from the
 * sorted pool.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildKnowledge(root: string): RosterAgentDefinition[] {
  const ids = takeQuota('knowledge', skillDirectories(root), DIVISION_QUOTAS.knowledge)
  return ids.map(id => ({
    id: `knowledge-${id}-skill-keeper`,
    name: `${titleCase(id)} Skill Keeper`,
    role: 'skill-keeper',
    division: 'knowledge',
    specialization: id,
    route: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    preset: 'reviewing',
    skills: [id],
    tools: ['skill'],
    source: cite(root, `.agents/skills/${id}/SKILL.md`),
    status: 'defined',
  }))
}

/** One governance standard: its id, display name, grounding source, and the skill (if any) that applies. */
interface GovernanceStandard {
  id: string
  name: string
  source: string
  skill?: string
}

const GOVERNANCE_STANDARDS: readonly GovernanceStandard[] = [
  {
    id: 'label-taxonomy',
    name: 'Label Taxonomy',
    source: '.agents/notes/implemented/process/2026-08-08-unified-github-label-taxonomy.md',
  },
  {
    id: 'stacked-prs',
    name: 'Stacked PR Policy',
    source: '.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md',
    skill: 'dsh-merging-stacked-prs',
  },
  {
    id: 'dependency-policy',
    name: 'Dependency Policy',
    source: '.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md',
    skill: 'dsh-find-simplifications',
  },
  { id: 'vendoring-policy', name: 'Vendoring Policy', source: 'vendor/README.md' },
  { id: 'license-policy', name: 'License Policy', source: 'scripts/verify-dsh-package-licenses.ts' },
  { id: 'third-party-notices', name: 'Third-Party Notices', source: 'scripts/gen-third-party-notices.ts' },
  {
    id: 'doc-budgets',
    name: 'Doc Budget Policy',
    source: 'scripts/doc-budgets.manifest.json',
    skill: 'dsh-doc-standards',
  },
  {
    id: 'translation-pairing',
    name: 'Translation Pairing Policy',
    source: 'scripts/verify-translation-pairing.ts',
    skill: 'dsh-translate-docs',
  },
]

/**
 * The 8-agent `governance` division: one standard-author per real process
 * standard this repository already documents or enforces.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildGovernance(root: string): RosterAgentDefinition[] {
  return GOVERNANCE_STANDARDS.map(standard => ({
    id: `governance-${standard.id}-standard-author`,
    name: `${standard.name} Standard Author`,
    role: 'standard-author',
    division: 'governance',
    specialization: standard.id,
    route: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    preset: 'reviewing',
    skills: standard.skill === undefined ? [] : [standard.skill],
    tools: ['read'],
    source: cite(root, standard.source),
    status: 'defined',
  }))
}

const OBSERVATORY_SOURCES: readonly { id: string; name: string; source: string }[] = [
  { id: 'session-telemetry', name: 'Session Telemetry', source: 'packages/session/session-telemetry/README.md' },
  {
    id: 'session-telemetry-otel',
    name: 'OpenTelemetry Export',
    source: 'packages/session/session-telemetry-otel/README.md',
  },
  { id: 'session-stats', name: 'Session Stats', source: 'packages/session/session-stats/README.md' },
  { id: 'session-projection', name: 'Session Projection', source: 'packages/session/session-projection/README.md' },
  { id: 'session-query', name: 'Session Query', source: 'packages/session-query/README.md' },
  {
    id: 'otel-bench-fixture',
    name: 'OpenTelemetry Bench Fixture',
    source: 'examples/headless-agent/tests/fixtures/session-telemetry-otel.cordis.yml',
  },
]

/**
 * The 6-agent `observatory` division: one observer per real telemetry, stats,
 * projection, or query source.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildObservatory(root: string): RosterAgentDefinition[] {
  return OBSERVATORY_SOURCES.map(entry => ({
    id: `observatory-${entry.id}-observer`,
    name: `${entry.name} Observer`,
    role: 'observer',
    division: 'observatory',
    specialization: entry.id,
    route: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    preset: 'reviewing',
    skills: [],
    tools: ['session_query'],
    source: cite(root, entry.source),
    status: 'defined',
  }))
}

/**
 * Derive the roster's edges from real role/division adjacency: implementer
 * (harness-core stewards, program coordinators, bench operators) to verifier,
 * verifier to judge, code-safety department reviewers to their integrator,
 * note curators to the dataset curators, the scorekeeper to every observer,
 * and the program lead to every department coordinator/integrator. See
 * {@link RosterEdge} for how `kind` reads.
 * @param agents - the complete agent list to derive adjacency from.
 * @returns the roster's edges.
 */
function buildEdges(agents: readonly RosterAgentDefinition[]): RosterEdge[] {
  const byDivision = (division: string): RosterAgentDefinition[] => agents.filter(a => a.division === division)
  const byRole = (role: string): RosterAgentDefinition[] => agents.filter(a => a.role === role)
  const edges: RosterEdge[] = []

  const implementers = [...byDivision('harness-core'), ...byDivision('program-departments'), ...byDivision('proving-ground')]
  const verifiers = byRole('verifier')
  for (const [index, implementer] of implementers.entries()) {
    const verifier = verifiers[index % verifiers.length]
    if (verifier === undefined) break
    edges.push({ from: implementer.id, to: verifier.id, kind: 'verifies' })
  }

  const judges = byRole('judge')
  for (const [index, verifier] of verifiers.entries()) {
    const judge = judges[index % judges.length]
    if (judge === undefined) break
    edges.push({ from: verifier.id, to: judge.id, kind: 'judges' })
  }

  for (const reviewer of byRole('reviewer')) {
    const integrator = byRole('integrator').find(candidate => candidate.department === reviewer.department)
    if (integrator !== undefined) edges.push({ from: reviewer.id, to: integrator.id, kind: 'merges' })
  }

  const datasetCurators = byRole('curator').filter(a => a.specialization === undefined)
  for (const curator of byRole('curator').filter(a => a.specialization !== undefined)) {
    for (const dataset of datasetCurators) edges.push({ from: curator.id, to: dataset.id, kind: 'reads' })
  }

  const scorekeeper = byRole('scorekeeper')[0]
  if (scorekeeper !== undefined) {
    for (const observer of byRole('observer')) edges.push({ from: scorekeeper.id, to: observer.id, kind: 'reports' })
  }

  const lead = byRole('lead')[0]
  if (lead !== undefined) {
    for (const target of [...byRole('coordinator'), ...byRole('integrator')]) {
      edges.push({ from: lead.id, to: target.id, kind: 'delegates' })
    }
  }

  return edges
}

/**
 * Build the complete 147-agent enterprise roster from this repository's real
 * sources. Pure and deterministic: given the same tree, produces the same
 * value (see {@link serializeRoster} for the byte-identical guarantee).
 * @param root - repository root to read sources from.
 * @param options - the stamp to carry and, optionally, the Agent Note path to cite.
 * @returns the assembled roster.
 */
export function buildRoster(root: string, options: BuildRosterOptions): Roster {
  const notePath = options.notePath ?? '.agents/notes/implemented/architecture/2026-09-19-enterprise-roster-and-harness-feed.md'
  const quotaSum = Object.values(DIVISION_QUOTAS).reduce((sum, quota) => sum + quota, 0)
  if (quotaSum !== ROSTER_AGENT_COUNT) {
    throw new Error(`enterprise-roster: division quotas sum to ${quotaSum}, expected ${ROSTER_AGENT_COUNT}`)
  }
  const openRouterModels = openRouterFreeModels(root)
  const agents: RosterAgentDefinition[] = [
    ...buildHarnessCore(root),
    ...buildProvingGround(root),
    ...buildVerification(root),
    ...buildJudging(root),
    ...buildCurationData(root),
    ...buildProgramDepartments(root),
    ...buildCodeSafety(root, notePath, openRouterModels),
    ...buildKnowledge(root),
    ...buildGovernance(root),
    ...buildObservatory(root),
  ]
  if (agents.length !== ROSTER_AGENT_COUNT) {
    throw new Error(`enterprise-roster: composed ${agents.length} agents, expected ${ROSTER_AGENT_COUNT}`)
  }
  const seen = new Set<string>()
  for (const agent of agents) {
    if (seen.has(agent.id)) throw new Error(`enterprise-roster: duplicate agent id "${agent.id}"`)
    seen.add(agent.id)
  }
  return {
    generatedAt: options.generatedAt,
    counts: { defined: ROSTER_AGENT_COUNT, active: 0 },
    divisions: DIVISIONS,
    agents,
    edges: buildEdges(agents),
  }
}

/**
 * Render a roster as the exact bytes this generator writes to disk: 2-space
 * indented JSON with one trailing newline, so re-running the generator on an
 * unchanged tree reproduces the committed file exactly.
 * @param roster - the roster to serialize.
 * @returns the file content, including its trailing newline.
 */
export function serializeRoster(roster: Roster): string {
  return `${JSON.stringify(roster, null, 2)}\n`
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const { roster, changed } = generateRoster(root)
  console.log(`enterprise-roster: ${changed ? 'wrote' : 'kept'} ${roster.agents.length} agents in ${ROSTER_PATH} (generatedAt ${roster.generatedAt})`)
}
