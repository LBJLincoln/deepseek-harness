/**
 * Generates the customer proof-of-concept's 147-agent enterprise roster from
 * sources this repository actually defines: package READMEs, `verify-*`
 * scripts, CI gate names, Agent Notes, skill directories, and recorded bench
 * fixtures. Every {@link RosterAgentDefinition.source} is a repository-relative
 * path this generator checks with `existsSync` before emitting it, so a
 * renamed or removed source fails the generator loudly instead of shipping a
 * roster entry nothing backs.
 *
 * The roster is a composition of role x division x specialization: each
 * division below builds its slice from one real, enumerable pool (a package
 * group's leaves, a directory of `verify-*.ts` scripts, the CI gate union in
 * `run-gates.ts`, an Agent Note class, a skill directory, or a recorded bench
 * scenario) so the entry count is a design constant while the cited source is
 * discovered, not hand-typed per entry. Pool iteration order is `Array#sort`
 * on the pool's own keys, which is what makes the output byte-identical for
 * the same tree.
 *
 * `status` here is always `"defined"` and `counts.active` is always `0`: this
 * module describes what the repository defines, never what is running. Live
 * status and active counts are computed by `scripts/harness-feed.ts` from real
 * session data and are never written back into this file.
 *
 * @module enterprise-roster
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
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
  /** Repository skill ids (`.agents/skills/<id>`) this agent draws on; empty when none applies. */
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
  /** ISO timestamp of the source tree's latest commit; stable for a given tree so the file stays byte-identical. */
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

const CLAUDE_CODE_MODELS = ['sonnet', 'opus', 'haiku'] as const
const OPENROUTER_FREE_MODELS = ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-2-9b-it:free'] as const

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
 * Real recorded bench scenario directories under the headless-agent example's
 * snapshot suites, sorted for deterministic iteration.
 * @param root - repository root.
 * @returns sorted `examples/headless-agent/tests/...` scenario paths.
 */
function provingGroundScenarios(root: string): string[] {
  const bases = [
    'examples/headless-agent/tests/snapshots',
    'examples/headless-agent/tests/workspace-context-resume-snapshots',
    'examples/headless-agent/tests/semantic-checkpoint-snapshots',
  ]
  const scenarios: string[] = []
  for (const base of bases) {
    const abs = join(root, base)
    if (!existsSync(abs)) continue
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory()) scenarios.push(`${base}/${entry.name}`)
    }
  }
  return scenarios.sort()
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

/**
 * The source tree's latest commit timestamp, which is what keeps
 * {@link Roster.generatedAt} stable across regenerations of the same tree. A
 * tree with no git history (e.g. an exported tarball) falls back to a fixed
 * epoch instead of the wall clock, which would break idempotency.
 * @param root - repository root.
 * @returns ISO 8601 commit timestamp, or the fixed fallback.
 */
function generatedAt(root: string): string {
  return tryGitCommitDate(root) ?? '1970-01-01T00:00:00Z'
}

/** @returns the HEAD commit's committer date, or `undefined` when git metadata is unavailable. */
function tryGitCommitDate(root: string): string | undefined {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cI'], { cwd: root, encoding: 'utf8' }).trim() || undefined
  } catch {
    // No git metadata reachable (a tarball export, or a shallow clone with no
    // commits checked out) — generatedAt falls back to a fixed timestamp.
    return undefined
  }
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

/** One code-safety department: its id, display name, and the real package that grounds it. */
interface CodeSafetyDepartment {
  id: string
  name: string
  source: string
}

/** One code-safety specialization: the language(s) a reviewer seat covers. */
interface CodeSafetySpecialization {
  id: string
  name: string
}

const CODE_SAFETY_DEPARTMENTS: readonly CodeSafetyDepartment[] = [
  { id: 'secrets', name: 'Secrets', source: 'packages/credentials/credentials/README.md' },
  { id: 'injection', name: 'Injection', source: 'packages/shell/shell/README.md' },
  { id: 'access', name: 'Access', source: 'packages/fs/fs/README.md' },
  { id: 'data', name: 'Data', source: 'packages/storage/storage/README.md' },
  { id: 'dependencies', name: 'Dependencies', source: 'scripts/verify-dsh-package-licenses.ts' },
  { id: 'platform', name: 'Platform', source: 'packages/sandbox/sandbox/README.md' },
]

const CODE_SAFETY_SPECIALIZATIONS: readonly CodeSafetySpecialization[] = [
  { id: 'javascript-typescript', name: 'JavaScript/TypeScript' },
  { id: 'python', name: 'Python' },
  { id: 'java', name: 'Java' },
  { id: 'go', name: 'Go' },
  { id: 'php', name: 'PHP' },
  { id: 'mobile', name: 'Mobile (Swift/Kotlin)' },
]

/**
 * The 43-agent `code-safety` division: 36 department x specialization
 * reviewers, 6 per-department integrators, and 1 program lead. Java, Go, PHP,
 * and mobile have no implementing scanner in this repository yet (only
 * JavaScript/TypeScript and Python have first-party static-analysis tooling
 * here), so every reviewer cites the department's real grounding package —
 * the specialization narrows what the seat is *for*, not what already exists
 * for that language.
 * @param root - repository root.
 * @param notePath - the roster design note, cited by the program lead.
 * @returns the division's agent definitions.
 */
function buildCodeSafety(root: string, notePath: string): RosterAgentDefinition[] {
  const agents: RosterAgentDefinition[] = []
  let index = 0
  for (const department of CODE_SAFETY_DEPARTMENTS) {
    const source = cite(root, department.source)
    for (const specialization of CODE_SAFETY_SPECIALIZATIONS) {
      agents.push({
        id: `code-safety-${department.id}-${specialization.id}-reviewer`,
        name: `${department.name} × ${specialization.name} Reviewer`,
        role: 'reviewer',
        division: 'code-safety',
        department: department.id,
        specialization: specialization.id,
        route: { provider: 'openrouter', model: OPENROUTER_FREE_MODELS[index % OPENROUTER_FREE_MODELS.length] },
        preset: 'reviewing',
        skills: ['dsh-code-review'],
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
      skills: [],
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
    skills: [],
    tools: ['subagent', 'session_query'],
    source: cite(root, notePath),
    status: 'defined',
  })
  return agents
}

/**
 * The 24-agent `harness-core` division: one steward per real leaf package
 * under `packages/core`, `packages/llm`, and `packages/subagent` — the
 * session/prompt/tool/agent spine, the LLM adapter capability, and the
 * subagent delegation capability.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildHarnessCore(root: string): RosterAgentDefinition[] {
  const groups = ['core', 'llm', 'subagent']
  const agents: RosterAgentDefinition[] = []
  for (const group of groups) {
    for (const leaf of packageLeaves(root, group)) {
      const source = cite(root, `packages/${group}/${leaf}/README.md`)
      agents.push({
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
      })
    }
  }
  return agents
}

/**
 * The 12-agent `proving-ground` division: one bench operator per real
 * recorded scenario under the headless-agent example's snapshot suites,
 * sliced from the sorted pool so the count stays a fixed 12 regardless of how
 * many scenarios the tree currently records.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildProvingGround(root: string): RosterAgentDefinition[] {
  const scenarios = provingGroundScenarios(root).slice(0, 12)
  return scenarios.map((scenario, index) => {
    const name = scenario.split('/').at(-1) ?? scenario
    return {
      id: `proving-ground-${name}-bench-operator`,
      name: `${titleCase(name)} Bench Operator`,
      role: 'bench-operator',
      division: 'proving-ground',
      specialization: name,
      route: { provider: 'claude-code', model: CLAUDE_CODE_MODELS[index % CLAUDE_CODE_MODELS.length] },
      preset: 'coding',
      skills: [],
      tools: ['subagent', 'bash'],
      source: cite(root, scenario),
      status: 'defined',
    }
  })
}

/**
 * The 14-agent `verification` division: one verifier per real `verify-*.ts`
 * gate script, sliced from the sorted pool to a fixed 14.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildVerification(root: string): RosterAgentDefinition[] {
  const scripts = verifyScripts(root).slice(0, 14)
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
 * The 11-agent `judging` division: one judge per named CI gate in
 * `scripts/run-gates.ts`.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildJudging(root: string): RosterAgentDefinition[] {
  const source = cite(root, 'scripts/run-gates.ts')
  return CI_GATE_IDS.map(gate => ({
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
 * The 11-agent `knowledge` division: one skill-keeper per real
 * `.agents/skills/<id>` directory.
 * @param root - repository root.
 * @returns the division's agent definitions.
 */
function buildKnowledge(root: string): RosterAgentDefinition[] {
  return skillDirectories(root).map(id => ({
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
 * @param notePath - repository-relative path to this feature's Agent Note,
 *   cited as the code-safety program lead's source.
 * @returns the assembled roster.
 */
export function buildRoster(
  root: string,
  notePath = '.agents/notes/implemented/architecture/2026-09-19-enterprise-roster-and-harness-feed.md',
): Roster {
  const agents: RosterAgentDefinition[] = [
    ...buildHarnessCore(root),
    ...buildProvingGround(root),
    ...buildVerification(root),
    ...buildJudging(root),
    ...buildCurationData(root),
    ...buildProgramDepartments(root),
    ...buildCodeSafety(root, notePath),
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
    generatedAt: generatedAt(root),
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
  const roster = buildRoster(root)
  const outDir = join(root, 'data/enterprise')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'roster.json'), serializeRoster(roster))
  console.log(`enterprise-roster: wrote ${roster.agents.length} agents to data/enterprise/roster.json`)
}
