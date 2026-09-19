/**
 * Regenerate every committed fixture under `fixtures/`.
 *
 * The output is deterministic: one seeded PRNG drives every choice, so running
 * this twice on the same inputs produces byte-identical files. The code-safety
 * findings are not invented — they are read from this repository's checked-in
 * OWASP NodeGoat ground truth and re-expressed in the feed's finding format,
 * so the demo's most load-bearing screen shows real, citable issues.
 *
 * Run: `pnpm --dir apps/command-deck fixtures`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type {
  Agent,
  AgentStatus,
  EdgeKind,
  Finding,
  Roster,
  RosterEdge,
  Run,
  RunEvent,
  SafetyDepartment,
  SafetyReview,
  Severity,
  TargetFile,
} from '../deck/contract.ts'
import { DIVISIONS } from './roster-source.ts'

const here = dirname(new URL(import.meta.url).pathname)
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '../..')
const fixtures = resolve(appRoot, 'fixtures')

/** Wall-clock anchor every generated timestamp is relative to. */
const ANCHOR = Date.UTC(2026, 8, 18, 9, 12, 0)

/**
 * Deterministic 32-bit PRNG (mulberry32).
 * @param seed - Any 32-bit integer; the same seed replays the same sequence.
 * @returns A function returning the next float in `[0, 1)`.
 */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Pick one element of a non-empty list.
 * @param next - The PRNG in use.
 * @param values - The list to choose from; must not be empty.
 * @returns The chosen element.
 */
function pick<T>(next: () => number, values: readonly T[]): T {
  const value = values[Math.floor(next() * values.length)]
  if (value === undefined) throw new Error('pick: empty list')
  return value
}

/**
 * Take a deterministic subset of a list.
 * @param next - The PRNG in use.
 * @param values - Candidate values.
 * @param count - How many to keep, clamped to the list length.
 * @returns The kept values in their original order.
 */
function sample<T>(next: () => number, values: readonly T[], count: number): T[] {
  const indices = values.map((_, index) => index)
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    const a = indices[i]
    const b = indices[j]
    if (a === undefined || b === undefined) continue
    indices[i] = b
    indices[j] = a
  }
  return indices
    .slice(0, Math.min(count, values.length))
    .sort((left, right) => left - right)
    .map(index => values[index])
    .filter((value): value is T => value !== undefined)
}

/**
 * Slugify a display name into an id segment.
 * @param name - Human-readable title.
 * @returns A lowercase hyphenated slug.
 */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** ISO timestamp `offsetMs` after the anchor. */
function at(offsetMs: number): string {
  return new Date(ANCHOR + offsetMs).toISOString()
}

const ROUTES = [
  { provider: 'deepseek', model: 'deepseek-chat' },
  { provider: 'deepseek', model: 'deepseek-reasoner' },
] as const

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

const next = rng(0x5eed1147)
const agents: Agent[] = []

for (const division of DIVISIONS) {
  const groups = division.departments ?? [{
    id: division.id,
    name: division.name,
    role: division.role,
    members: division.members ?? [],
  }]
  for (const group of groups) {
    for (const [name, roleOverride] of group.members) {
      const isDepartment = division.departments !== undefined
      const id = `${division.id}/${slug(name)}`
      const sourceDir = isDepartment ? `${division.id}/${group.id}` : division.id
      agents.push({
        id,
        name,
        role: roleOverride ?? group.role,
        division: division.id,
        ...isDepartment ? { department: group.id } : {},
        route: next() < 0.34 ? ROUTES[1] : ROUTES[0],
        preset: division.preset,
        skills: sample(next, division.skills, 2 + Math.floor(next() * 2)),
        tools: sample(next, division.tools, 3 + Math.floor(next() * 3)),
        source: `agents/${sourceDir}/${slug(name)}.agent.yml`,
        status: 'defined',
      })
    }
  }
}

if (agents.length !== 147) throw new Error(`roster must hold 147 agents, built ${agents.length}`)

/** Agents the fixture run puts to work, keyed for the status pass below. */
const activeIds = new Set<string>(
  agents.filter(agent => agent.division === 'code-safety').map(agent => agent.id),
)
for (const id of [
  'verification/check-executor',
  'verification/certificate-authority',
  'verification/read-barrier-census',
  'judging/council-chair',
  'judging/correctness-judge',
  'program/program-ledger',
  'program/integration-merger',
  'observatory/leaderboard-projector',
  'observatory/session-facts-folder',
  'curation/curator',
]) activeIds.add(id)

const certifiedIds = new Set<string>([
  'verification/certificate-authority',
  'verification/check-executor',
  'code-safety/secret-scanner',
  'code-safety/taint-tracer',
  'code-safety/route-guard-auditor',
  'code-safety/encryption-at-rest-auditor',
  'code-safety/manifest-reader',
  'code-safety/header-auditor',
  'code-safety/session-flag-auditor',
  'code-safety/template-escape-auditor',
  'code-safety/transport-auditor',
  'code-safety/object-reference-auditor',
  'program/integration-merger',
  'program/release-steward',
  'proving-ground/scorekeeper',
  'proving-ground/bench-marshal',
  'knowledge/librarian',
  'governance/signoff-registrar',
])

const failedIds = new Set<string>([
  'code-safety/container-surface-auditor',
  'proving-ground/outage-watch',
  'program/implementer-platform',
])

for (const agent of agents) {
  const status: AgentStatus = failedIds.has(agent.id)
    ? 'failed'
    : certifiedIds.has(agent.id)
      ? 'certified'
      : activeIds.has(agent.id)
        ? 'active'
        : 'defined'
  agent.status = status
}

const byDivision = new Map<string, Agent[]>()
for (const agent of agents) {
  const list = byDivision.get(agent.division) ?? []
  list.push(agent)
  byDivision.set(agent.division, list)
}

/**
 * Members of one division, failing loud when the division id is unknown.
 * @param id - Division id from the roster source.
 * @returns Every agent of that division, in roster order.
 */
function division(id: string): Agent[] {
  const list = byDivision.get(id)
  if (list === undefined || list.length === 0) throw new Error(`no agents in division ${id}`)
  return list
}

const edges: RosterEdge[] = []
const seenEdges = new Set<string>()

/**
 * Record one directed relationship, ignoring duplicates and self-edges.
 * @param from - Source agent id.
 * @param to - Target agent id.
 * @param kind - Relationship kind.
 */
function edge(from: string, to: string, kind: EdgeKind): void {
  if (from === to) return
  const key = `${from}|${to}|${kind}`
  if (seenEdges.has(key)) return
  seenEdges.add(key)
  edges.push({ from, to, kind })
}

// Every division has a lead — its first member — that delegates inside the division.
for (const source of DIVISIONS) {
  const members = division(source.id)
  const lead = members[0]
  if (lead === undefined) continue
  for (const member of members.slice(1)) {
    edge(lead.id, member.id, 'delegates')
    if (next() < 0.45) edge(member.id, lead.id, 'reports')
  }
}

// Code Safety departments answer to their own first member and to the program.
for (const departmentId of ['secrets', 'injection', 'access', 'data', 'dependencies', 'platform']) {
  const members = division('code-safety').filter(agent => agent.department === departmentId)
  const head = members[0]
  if (head === undefined) continue
  for (const member of members.slice(1)) edge(head.id, member.id, 'delegates')
  edge('program/program-ledger', head.id, 'delegates')
  edge(head.id, 'verification/check-executor', 'reports')
  edge('verification/certificate-authority', head.id, 'verifies')
}

// The program ledger stands up its department leads, who staff the implementers.
const leads = division('program').filter(agent => agent.role === 'department lead')
const implementers = division('program').filter(agent => agent.name.startsWith('Implementer'))
for (const [index, lead] of leads.entries()) {
  edge('program/program-ledger', lead.id, 'delegates')
  const implementer = implementers[index]
  if (implementer === undefined) continue
  edge(lead.id, implementer.id, 'delegates')
  edge(implementer.id, lead.id, 'reports')
  edge('program/integration-merger', implementer.id, 'merges')
  edge('verification/check-executor', implementer.id, 'verifies')
}

// Verification checks what the bench and the program produce; judging reads verification.
for (const verifier of division('verification')) {
  for (const target of sample(next, division('proving-ground'), 2)) edge(verifier.id, target.id, 'verifies')
}
for (const judge of division('judging')) {
  for (const target of sample(next, division('verification'), 2)) edge(judge.id, target.id, 'judges')
  edge(judge.id, 'program/program-ledger', 'judges')
}

// Curation, Knowledge and the Observatory read the logs the rest of the enterprise writes.
for (const curator of division('curation')) {
  for (const target of sample(next, division('proving-ground'), 2)) edge(curator.id, target.id, 'reads')
}
for (const librarian of division('knowledge')) {
  for (const target of sample(next, [...division('curation'), ...division('judging')], 2)) {
    edge(librarian.id, target.id, 'reads')
  }
}
for (const observer of division('observatory')) {
  for (const target of sample(next, [...division('proving-ground'), ...division('verification')], 2)) {
    edge(observer.id, target.id, 'reads')
  }
}

// Governance signs the transitions and reads the artefacts behind them.
for (const steward of division('governance')) {
  edge(steward.id, 'program/release-steward', 'reports')
  for (const target of sample(next, division('curation'), 1)) edge(steward.id, target.id, 'reads')
}
edge('governance/signoff-registrar', 'program/spec-freezer', 'verifies')
edge('program/release-steward', 'verification/certificate-authority', 'reads')

// Harness Core keeps the seams the other divisions run on.
for (const engineer of sample(next, division('harness-core'), 10)) {
  for (const target of sample(next, [...division('proving-ground'), ...division('program')], 2)) {
    edge(engineer.id, target.id, 'reads')
  }
}

const roster: Roster = {
  generatedAt: at(0),
  counts: {
    defined: agents.length,
    active: agents.filter(agent => agent.status === 'active').length,
  },
  divisions: DIVISIONS.map(source => ({ id: source.id, name: source.name, purpose: source.purpose })),
  agents,
  edges,
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

const SAFETY_RUN = 'run-safety-nodegoat-0918'

const runs: Run[] = [
  {
    id: SAFETY_RUN,
    kind: 'code-safety',
    name: 'Code safety — OWASP NodeGoat @ c5cb68a',
    startedAt: at(0),
    endedAt: at(34 * 60_000),
    status: 'certified',
    path: 'data/code-safety/runs/2026-09-18-nodegoat',
  },
  {
    id: 'run-program-atlas-0917',
    kind: 'program',
    name: 'Program — Atlas billing portal, four departments',
    startedAt: at(-22 * 3_600_000),
    endedAt: at(-14 * 3_600_000),
    status: 'released',
    path: 'data/programs/2026-09-17-atlas',
  },
  {
    id: 'run-fleet-shift-0916',
    kind: 'fleet',
    name: 'Fleet — shift 41, eight routes over the environment suite',
    startedAt: at(-46 * 3_600_000),
    endedAt: at(-38 * 3_600_000),
    status: 'complete',
    path: 'data/proving-ground/2026-09-16-shift-41',
  },
  {
    id: 'run-experiment-e8-0915',
    kind: 'experiment',
    name: 'Experiment E8 — paired arms, t=5, seeded bootstrap',
    startedAt: at(-70 * 3_600_000),
    endedAt: at(-64 * 3_600_000),
    status: 'inconclusive',
    path: 'data/proving-ground/2026-09-15-e8',
  },
]

// ---------------------------------------------------------------------------
// Code-safety findings, from this repository's NodeGoat ground truth
// ---------------------------------------------------------------------------

/** One entry of `data/code-safety/targets/nodegoat.ground-truth.json`. */
interface GroundTruthIssue {
  id: string
  category: string
  cwe: string
  file: string
  lines: [number, number]
  description: string
}

const groundTruthPath = resolve(repoRoot, 'data/code-safety/targets/nodegoat.ground-truth.json')
const groundTruth = JSON.parse(readFileSync(groundTruthPath, 'utf8')) as {
  target: string
  repository: string
  revision: string
  issues: GroundTruthIssue[]
}

/** How each ground-truth issue is presented: severity, owning department, and remediation. */
const PRESENTATION: Record<string, {
  severity: Severity
  department: string
  owasp: string
  title: string
  snippet: string
  impact: string
  fix: string
  confidence: number
}> = {
  'NG-A1-1': {
    severity: 'critical', department: 'injection', owasp: 'A03:2021 Injection', confidence: 0.98,
    title: 'Request fields evaluated as JavaScript',
    snippet: 'const preTax = eval(req.body.preTax);',
    impact: 'Any authenticated user reaches remote code execution in the web tier with a single form field.',
    fix: 'Parse the three contribution fields with `Number.parseInt` and reject non-finite values before persisting.',
  },
  'NG-A1-2': {
    severity: 'critical', department: 'injection', owasp: 'A03:2021 Injection', confidence: 0.95,
    title: 'NoSQL `$where` built from a query parameter',
    snippet: 'const query = { $where: `this.userId == ${userId} && this.stocks > ${threshold}` };',
    impact: 'The threshold parameter is evaluated server-side by the database, exposing every allocation row.',
    fix: 'Replace the `$where` clause with a typed comparison document and coerce `threshold` to a number.',
  },
  'NG-A1-3': {
    severity: 'medium', department: 'injection', owasp: 'A09:2021 Logging failures', confidence: 0.88,
    title: 'Unescaped user name written to the log',
    snippet: "console.log('Login for user: ' + userName);",
    impact: 'CRLF in the login form forges log lines, which defeats the audit trail an incident depends on.',
    fix: 'Log through the structured logger and pass the user name as a field rather than string concatenation.',
  },
  'NG-A2-1': {
    severity: 'critical', department: 'data', owasp: 'A02:2021 Cryptographic failures', confidence: 0.97,
    title: 'Password persisted without hashing',
    snippet: '// const hash = bcrypt.hashSync(password, salt);\nuser.password = password;',
    impact: 'A database disclosure hands over every password in clear text, including reused corporate credentials.',
    fix: 'Restore the bcrypt hash on write and the comparison on read; migrate stored rows on next successful login.',
  },
  'NG-A2-2a': {
    severity: 'medium', department: 'access', owasp: 'A07:2021 Identification failures', confidence: 0.9,
    title: 'Login distinguishes unknown user from wrong password',
    snippet: "return res.render('login', { loginError: 'Invalid username' });",
    impact: 'The two distinct messages turn the login form into a user-enumeration oracle.',
    fix: 'Return one message for both branches and keep the timing of the two paths comparable.',
  },
  'NG-A2-2b': {
    severity: 'high', department: 'access', owasp: 'A07:2021 Identification failures', confidence: 0.93,
    title: 'Password policy accepts a single character',
    snippet: 'const PASS_RE = /^.{1,20}$/;',
    impact: 'One-character passwords survive registration, so credential stuffing needs no list.',
    fix: 'Require at least twelve characters and check the candidate against a breached-password list.',
  },
  'NG-A2-3': {
    severity: 'high', department: 'access', owasp: 'A05:2021 Security misconfiguration', confidence: 0.94,
    title: 'Session cookie without `httpOnly`, `secure` or `maxAge`',
    snippet: 'app.use(session({ secret: cookieSecret }));',
    impact: 'The session cookie is readable from script and travels over plain HTTP under the default name.',
    fix: 'Set `name`, `httpOnly`, `secure`, `sameSite: "lax"` and an absolute `maxAge` on the session store.',
  },
  'NG-A3': {
    severity: 'critical', department: 'injection', owasp: 'A03:2021 Injection', confidence: 0.96,
    title: 'Template auto-escaping disabled application-wide',
    snippet: 'swig.setDefaults({ autoescape: false });',
    impact: 'Every rendered template becomes a stored cross-site scripting sink, including the profile page.',
    fix: 'Remove the override, then mark the few intentionally raw fragments at their call sites.',
  },
  'NG-A4': {
    severity: 'high', department: 'access', owasp: 'A01:2021 Broken access control', confidence: 0.95,
    title: 'Allocations page trusts a user id from the URL',
    snippet: 'const userId = req.params.userId;',
    impact: 'Changing one path segment reads another customer\'s allocations.',
    fix: 'Take the user id from the session and return 404 when the path segment disagrees.',
  },
  'NG-A5': {
    severity: 'medium', department: 'platform', owasp: 'A05:2021 Security misconfiguration', confidence: 0.92,
    title: 'Security headers disabled and `x-powered-by` left on',
    snippet: '// app.use(helmet.frameguard());\n// app.use(helmet.contentSecurityPolicy());',
    impact: 'No framing, transport or content-source protection reaches the browser, and the stack is advertised.',
    fix: 'Enable helmet with a content-security policy, HSTS and frameguard, and disable `x-powered-by`.',
  },
  'NG-A6-1': {
    severity: 'critical', department: 'data', owasp: 'A02:2021 Cryptographic failures', confidence: 0.96,
    title: 'Identity documents stored in clear text',
    snippet: '// user.ssn = encrypt(ssn);\nuser.ssn = ssn;',
    impact: 'Social security number, date of birth and bank account sit unencrypted, a direct GDPR Article 32 failure.',
    fix: 'Restore field-level encryption with a managed key and re-encrypt existing rows in a migration.',
  },
  'NG-A6-2': {
    severity: 'high', department: 'data', owasp: 'A02:2021 Cryptographic failures', confidence: 0.91,
    title: 'Application listens over plain HTTP',
    snippet: 'http.createServer(app).listen(config.port);',
    impact: 'Credentials and session cookies cross the network unprotected.',
    fix: 'Terminate TLS in front of the app and redirect port 80, or restore the HTTPS listener and its key material.',
  },
  'NG-A7': {
    severity: 'high', department: 'access', owasp: 'A01:2021 Broken access control', confidence: 0.94,
    title: 'Benefits routes miss the administrator guard',
    snippet: "app.get('/benefits', isLoggedIn, benefitsHandler.displayBenefits);",
    impact: 'Any signed-in user reads and edits the benefits of every employee.',
    fix: 'Re-attach `isAdmin` to both the GET and the POST route and cover the pair with a regression check.',
  },
  'NG-A8': {
    severity: 'high', department: 'access', owasp: 'A01:2021 Broken access control', confidence: 0.9,
    title: 'No cross-site request forgery protection on state changes',
    snippet: '// app.use(csrf());',
    impact: 'A third-party page can move funds on behalf of a signed-in user.',
    fix: 'Enable the CSRF middleware, emit the token into every form, and set `sameSite` on the session cookie.',
  },
  'NG-A9': {
    severity: 'high', department: 'dependencies', owasp: 'A06:2021 Vulnerable components', confidence: 0.89,
    title: 'Manifest pins components with published advisories',
    snippet: '"dependencies": { "express": "4.13.4", "marked": "0.3.5" }',
    impact: 'Known advisories reach production through direct dependencies nobody has bumped.',
    fix: 'Upgrade the flagged direct dependencies, regenerate the lockfile, and add an advisory check to the pipeline.',
  },
  'NG-A10': {
    severity: 'medium', department: 'access', owasp: 'A01:2021 Broken access control', confidence: 0.87,
    title: 'Redirect target taken from the query string',
    snippet: 'res.redirect(req.query.url);',
    impact: 'The application lends its domain to a phishing landing page.',
    fix: 'Accept a relative path from an allowlist and reject anything carrying a scheme or authority.',
  },
  'NG-SSRF': {
    severity: 'high', department: 'platform', owasp: 'A10:2021 Server-side request forgery', confidence: 0.92,
    title: 'Server fetches a user-supplied URL',
    snippet: 'const { url } = req.query;\nhttp.get(url, response => response.pipe(res));',
    impact: 'The request reaches the cloud metadata endpoint and any internal service the host can see.',
    fix: 'Resolve the host, refuse private and link-local ranges, and restrict the fetch to an allowlist.',
  },
  'NG-REDOS': {
    severity: 'medium', department: 'platform', owasp: 'A05:2021 Security misconfiguration', confidence: 0.85,
    title: 'Catastrophic backtracking in profile validation',
    snippet: 'const re = /(a+)+$/;',
    impact: 'One crafted profile field pins a worker thread and takes the process out of rotation.',
    fix: 'Replace the nested quantifier with a bounded pattern and cap the validated field length.',
  },
}

const findings: Finding[] = groundTruth.issues.map((issue) => {
  const presentation = PRESENTATION[issue.id]
  if (presentation === undefined) throw new Error(`no presentation for ground-truth issue ${issue.id}`)
  const line = issue.lines[0]
  return {
    id: issue.id,
    cwe: issue.cwe,
    owasp: presentation.owasp,
    severity: presentation.severity,
    confidence: presentation.confidence,
    title: presentation.title,
    file: issue.file,
    line,
    snippet: presentation.snippet,
    evidence: issue.description,
    impact: presentation.impact,
    fix: presentation.fix,
  }
})

/** Departmental findings beyond the ground truth: real review output, lower confidence. */
const ADDITIONAL: readonly (Finding & { department: string })[] = [
  {
    id: 'CS-SEC-01', department: 'secrets', cwe: 'CWE-798', owasp: 'A07:2021 Identification failures',
    severity: 'critical', confidence: 0.93, title: 'Session secret hard-coded in the committed config',
    file: 'config/env/all.js', line: 12,
    snippet: 'cookieSecret: "session_cookie_secret_key_here",',
    evidence: 'The literal is present at the reviewed revision and is shared by every deployment reading this file.',
    impact: 'Anyone with repository access can forge a session cookie for any user.',
    fix: 'Read the secret from the environment at boot and fail closed when it is absent.',
  },
  {
    id: 'CS-SEC-02', department: 'secrets', cwe: 'CWE-540', owasp: 'A05:2021 Security misconfiguration',
    severity: 'high', confidence: 0.86, title: 'Database credentials committed for the development profile',
    file: 'config/env/development.js', line: 5,
    snippet: 'db: "mongodb://nodegoat:nodegoat@localhost:27017/nodegoat",',
    evidence: 'The URI carries an inline user and password, and the same file is read when NODE_ENV is unset.',
    impact: 'A production host booted without NODE_ENV uses development credentials.',
    fix: 'Move the URI to an environment variable and refuse to boot on the development profile outside development.',
  },
  {
    id: 'CS-DEP-01', department: 'dependencies', cwe: 'CWE-1395', owasp: 'A06:2021 Vulnerable components',
    severity: 'medium', confidence: 0.81, title: 'Transitive advisory reachable through the template engine',
    file: 'package.json', line: 24,
    snippet: '"swig": "1.4.2"',
    evidence: 'The engine is unmaintained; its advisory is reachable from every rendered route.',
    impact: 'No upstream fix exists, so the advisory stays open for as long as the engine is used.',
    fix: 'Migrate rendering to a maintained engine and delete the dependency.',
  },
  {
    id: 'CS-DEP-02', department: 'dependencies', cwe: 'CWE-1104', owasp: 'A06:2021 Vulnerable components',
    severity: 'low', confidence: 0.78, title: 'Lockfile drifted from the manifest',
    file: 'package.json', line: 18,
    snippet: '"dependencies": { ... }',
    evidence: 'Three manifest ranges admit versions the committed lockfile does not pin.',
    impact: 'A clean install resolves versions nobody reviewed.',
    fix: 'Regenerate the lockfile in the same commit as any manifest change and gate it in the pipeline.',
  },
  {
    id: 'CS-PLT-01', department: 'platform', cwe: 'CWE-770', owasp: 'A04:2021 Insecure design',
    severity: 'medium', confidence: 0.84, title: 'No rate limit on the authentication routes',
    file: 'app/routes/index.js', line: 34,
    snippet: "app.post('/login', sessionHandler.handleLoginRequest);",
    evidence: 'Neither the route nor the server composes a limiter; every attempt reaches the password comparison.',
    impact: 'Credential stuffing runs at network speed against a weak password policy.',
    fix: 'Add a per-address and per-account limiter with exponential backoff in front of the login route.',
  },
  {
    id: 'CS-PLT-02', department: 'platform', cwe: 'CWE-209', owasp: 'A05:2021 Security misconfiguration',
    severity: 'low', confidence: 0.8, title: 'Stack traces rendered to the browser',
    file: 'server.js', line: 128,
    snippet: 'app.use(errorHandler({ dumpExceptions: true, showStack: true }));',
    evidence: 'The development error handler is mounted unconditionally.',
    impact: 'Internal paths and library versions reach any visitor who triggers an exception.',
    fix: 'Mount the verbose handler only under the development profile and log the trace server-side otherwise.',
  },
  {
    id: 'CS-DAT-01', department: 'data', cwe: 'CWE-532', owasp: 'A09:2021 Logging failures',
    severity: 'medium', confidence: 0.83, title: 'Profile updates logged with their payload',
    file: 'app/data/profile-dao.js', line: 71,
    snippet: 'console.log("updating profile", JSON.stringify(user));',
    evidence: 'The serialized document includes the bank account and the date of birth.',
    impact: 'Personal data lands in log storage that carries none of the database\'s access controls.',
    fix: 'Log the document id only, and route any payload logging through the redaction profile.',
  },
  {
    id: 'CS-INJ-01', department: 'injection', cwe: 'CWE-22', owasp: 'A01:2021 Broken access control',
    severity: 'high', confidence: 0.79, title: 'Download route joins a user-supplied file name',
    file: 'app/routes/memos.js', line: 27,
    snippet: 'res.sendFile(path.join(uploadDir, req.query.name));',
    evidence: 'No normalization sits between the query parameter and the join.',
    impact: 'A traversal sequence reads any file the process can open.',
    fix: 'Resolve the joined path and refuse anything outside the upload directory.',
  },
]

for (const { department: _department, ...finding } of ADDITIONAL) findings.push(finding)

/** Which department owns each finding, for the table filter and the roll-up. */
const findingDepartment = new Map<string, string>()
for (const issue of groundTruth.issues) {
  const presentation = PRESENTATION[issue.id]
  if (presentation !== undefined) findingDepartment.set(issue.id, presentation.department)
}
for (const entry of ADDITIONAL) findingDepartment.set(entry.id, entry.department)

const DEPARTMENT_NAMES: Record<string, string> = {
  secrets: 'Secrets',
  injection: 'Injection',
  access: 'Access',
  data: 'Data',
  dependencies: 'Dependencies',
  platform: 'Platform',
}

const departments: SafetyDepartment[] = Object.entries(DEPARTMENT_NAMES).map(([id, name]) => {
  const count = [...findingDepartment.values()].filter(value => value === id).length
  const certified = id !== 'platform'
  return {
    id,
    name,
    status: certified ? 'certified' : 'partial — container surface unread',
    certified,
    findings: count,
  }
})

const TARGET_FILES: readonly TargetFile[] = [
  { path: 'server.js', bytes: 6120, language: 'JavaScript' },
  { path: 'package.json', bytes: 2180, language: 'JSON' },
  { path: 'README.md', bytes: 9040, language: 'Markdown' },
  { path: 'Dockerfile', bytes: 640, language: 'Docker' },
  { path: 'app/routes/index.js', bytes: 7480, language: 'JavaScript' },
  { path: 'app/routes/session.js', bytes: 8260, language: 'JavaScript' },
  { path: 'app/routes/contributions.js', bytes: 3120, language: 'JavaScript' },
  { path: 'app/routes/allocations.js', bytes: 1980, language: 'JavaScript' },
  { path: 'app/routes/profile.js', bytes: 3640, language: 'JavaScript' },
  { path: 'app/routes/benefits.js', bytes: 1720, language: 'JavaScript' },
  { path: 'app/routes/memos.js', bytes: 1480, language: 'JavaScript' },
  { path: 'app/routes/research.js', bytes: 1260, language: 'JavaScript' },
  { path: 'app/data/user-dao.js', bytes: 5240, language: 'JavaScript' },
  { path: 'app/data/profile-dao.js', bytes: 4680, language: 'JavaScript' },
  { path: 'app/data/allocations-dao.js', bytes: 4120, language: 'JavaScript' },
  { path: 'app/data/contributions-dao.js', bytes: 2860, language: 'JavaScript' },
  { path: 'app/data/benefits-dao.js', bytes: 2240, language: 'JavaScript' },
  { path: 'app/data/memos-dao.js', bytes: 1640, language: 'JavaScript' },
  { path: 'app/assets/css/main.css', bytes: 12400, language: 'CSS' },
  { path: 'app/assets/js/app.js', bytes: 5320, language: 'JavaScript' },
  { path: 'app/views/layout.html', bytes: 3860, language: 'HTML' },
  { path: 'app/views/login.html', bytes: 2140, language: 'HTML' },
  { path: 'app/views/profile.html', bytes: 3020, language: 'HTML' },
  { path: 'app/views/dashboard.html', bytes: 2680, language: 'HTML' },
  { path: 'config/env/all.js', bytes: 1120, language: 'JavaScript' },
  { path: 'config/env/development.js', bytes: 720, language: 'JavaScript' },
  { path: 'config/env/production.js', bytes: 780, language: 'JavaScript' },
  { path: 'config/config.js', bytes: 940, language: 'JavaScript' },
  { path: 'artifacts/db-reset.js', bytes: 3340, language: 'JavaScript' },
  { path: 'artifacts/seed.js', bytes: 2460, language: 'JavaScript' },
  { path: 'test/security.js', bytes: 4180, language: 'JavaScript' },
  { path: 'test/profile.js', bytes: 2920, language: 'JavaScript' },
  { path: 'test/session.js', bytes: 3260, language: 'JavaScript' },
  { path: 'Gruntfile.js', bytes: 1840, language: 'JavaScript' },
]

const languages: Record<string, number> = {}
for (const file of TARGET_FILES) languages[file.language] = (languages[file.language] ?? 0) + 1

const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
for (const finding of findings) counts[finding.severity] += 1

const severityCount = (severity: Severity): number => counts[severity]

const report = `# Rapport de sûreté du code — OWASP NodeGoat

> Données d'exemple. Ce rapport est rejoué depuis les fixtures livrées avec le Command Deck ; il n'a pas été produit par une exécution en direct.

## Résumé (français)

Six départements de la division Code Safety ont lu ${TARGET_FILES.length} fichiers de \`${groundTruth.target}\` à la révision \`${groundTruth.revision.slice(0, 7)}\` et ont placé **${findings.length} constats** sur les lignes qui les portent : ${severityCount('critical')} critiques, ${severityCount('high')} élevés, ${severityCount('medium')} moyens et ${severityCount('low')} faibles.

Les cinq constats critiques partagent une même cause : l'application fait confiance à l'entrée de la requête avant de l'exécuter, de la rendre ou de la stocker. \`eval()\` sur trois champs de formulaire donne l'exécution de code à tout utilisateur authentifié ; la clause \`$where\` construite par interpolation expose l'ensemble des allocations ; l'échappement des gabarits est désactivé pour toute l'application ; les mots de passe et les pièces d'identité sont conservés en clair.

Le certificat couvre cinq départements sur six. Le département Platform reste **partiel** : la surface conteneur n'a pas pu être lue à cette révision, et deux constats de ce département sont marqués non vérifiés. Aucune remédiation n'a été appliquée : le périmètre de cette revue est la lecture, pas l'écriture.

### Recommandation

Traiter les ${severityCount('critical')} constats critiques avant toute mise en production, puis les ${severityCount('high')} constats élevés dans la même itération, car le stockage des mots de passe et la protection de session se corrigent ensemble.

## Summary (English)

Six departments of the Code Safety division read ${TARGET_FILES.length} files of \`${groundTruth.target}\` at revision \`${groundTruth.revision.slice(0, 7)}\` and placed **${findings.length} findings** on the lines that carry them: ${severityCount('critical')} critical, ${severityCount('high')} high, ${severityCount('medium')} medium and ${severityCount('low')} low.

The five critical findings share one cause: the application trusts request input before executing, rendering or storing it. \`eval()\` over three form fields hands remote code execution to any authenticated user; an interpolated \`$where\` clause exposes every allocation row; template escaping is disabled application-wide; passwords and identity documents are kept in clear text.

The certificate covers five departments of six. Platform remains **partial** — the container surface could not be read at this revision, and two of its findings are recorded as unverified. No remediation was applied: the scope of this review is reading, not writing.

### Departments

| Department | Findings | Certificate |
| --- | --- | --- |
${departments.map(entry => `| ${entry.name} | ${entry.findings} | ${entry.certified ? 'certified' : entry.status} |`).join('\n')}

### Severity ladder

| Severity | Count |
| --- | --- |
${(['critical', 'high', 'medium', 'low'] as const).map(severity => `| ${severity} | ${severityCount(severity)} |`).join('\n')}

### Provenance

Every ground-truth entry comes from \`data/code-safety/targets/nodegoat.ground-truth.json\`, read at revision \`${groundTruth.revision}\` of [${groundTruth.target}](${groundTruth.repository}). Findings whose id starts with \`CS-\` are departmental output beyond that ground truth and carry the lower confidence to match.
`

const safety: SafetyReview = {
  target: {
    name: groundTruth.target,
    path: '/srv/targets/nodegoat',
    files: [...TARGET_FILES],
    languages,
  },
  departments,
  findings,
  certificate: {
    verified: true,
    verifier: 'verification/certificate-authority',
    checkedAt: at(33 * 60_000),
    counts,
    unverified: ['CS-PLT-02', 'NG-A5'],
  },
  report: { markdown: report },
}

// ---------------------------------------------------------------------------
// Event streams
// ---------------------------------------------------------------------------

/** Accumulates one run's events with a monotonic sequence and clock. */
class EventLog {
  private seq = 0
  private clock = 0
  readonly events: RunEvent[] = []

  /**
   * Append one event, advancing the sequence and the run clock.
   * @param event - Everything but `ts` and `seq`, which this method assigns.
   * @param gapMs - Milliseconds since the previous event.
   */
  push(event: Omit<RunEvent, 'ts' | 'seq'>, gapMs: number): void {
    this.clock += gapMs
    this.seq += 1
    this.events.push({ ts: at(this.clock), seq: this.seq, ...event })
  }
}

const SAFETY_TOOLS = ['glob', 'grep', 'read', 'bash', 'lsp_definition'] as const

/**
 * Build the code-safety run's event stream: intake, six departments in
 * parallel, verification, judging, and integration.
 * @returns Every event of the run, in sequence order.
 */
function safetyEvents(): RunEvent[] {
  const log = new EventLog()
  const stream = rng(0x0de1a17)
  const session = (agentId: string): string => `sess-${slug(agentId).slice(0, 28)}`

  log.push({
    agentId: 'program/program-ledger',
    sessionId: session('program/program-ledger'),
    kind: 'directive',
    label: 'Code safety review opened',
    detail: `${groundTruth.target} @ ${groundTruth.revision.slice(0, 7)} — six departments, read-only`,
  }, 0)
  log.push({
    agentId: 'program/program-ledger',
    sessionId: session('program/program-ledger'),
    kind: 'step',
    label: 'Spec frozen',
    detail: 'Standard compiled before any department starts',
  }, 1_400)
  log.push({
    agentId: 'code-safety/secret-scanner',
    sessionId: session('code-safety/secret-scanner'),
    kind: 'tool',
    label: 'glob — repository inventory',
    detail: `${TARGET_FILES.length} files, ${Object.keys(languages).length} languages`,
  }, 900)

  const departmentHeads = ['secrets', 'injection', 'access', 'data', 'dependencies', 'platform']
    .map((id) => {
      const head = division('code-safety').filter(agent => agent.department === id)[0]
      if (head === undefined) throw new Error(`department ${id} has no head`)
      return { id, head }
    })

  for (const { id, head } of departmentHeads) {
    log.push({
      agentId: 'program/program-ledger',
      sessionId: session('program/program-ledger'),
      kind: 'delegation',
      label: `Department started — ${DEPARTMENT_NAMES[id] ?? id}`,
      detail: `${head.name} on its own worktree`,
    }, 700 + Math.floor(stream() * 600))
  }

  const pending = [...findings]
  const members = new Map<string, Agent[]>()
  for (const { id } of departmentHeads) {
    members.set(id, division('code-safety').filter(agent => agent.department === id))
  }

  // Every department sweeps the tree before it reports: the reads that found
  // nothing are the bulk of a review and the reason the stream reads as work.
  const sourceFiles = TARGET_FILES.filter(file => file.language !== 'Markdown')
  const sweeps = departmentHeads.map(({ id }) => ({
    id,
    queue: sample(stream, sourceFiles, 14).map(file => file.path),
  }))
  // One round is one pass over the six departments: each sweeps a file, then
  // reports whatever it has found there. Sweeping and reporting interleave so
  // the pipeline view shows all four stages at work rather than in phases.
  let guard = 0
  while ((pending.length > 0 || guard < 14) && guard < 400) {
    const round = guard
    guard += 1
    for (const sweep of sweeps) {
      const path = sweep.queue[round]
      if (path === undefined) continue
      const agent = pick(stream, members.get(sweep.id) ?? [])
      const sessionId = session(agent.id)
      log.push({
        agentId: agent.id,
        sessionId,
        kind: 'tool',
        label: `${pick(stream, SAFETY_TOOLS)} — ${path}`,
        detail: `${DEPARTMENT_NAMES[sweep.id] ?? sweep.id} sweep, round ${round + 1}`,
        file: path,
      }, 200 + Math.floor(stream() * 500))
      if (stream() < 0.45) {
        log.push({
          agentId: agent.id,
          sessionId,
          kind: 'step',
          label: `${path} clear for ${DEPARTMENT_NAMES[sweep.id] ?? sweep.id}`,
          detail: 'no sink reachable from a request-controlled value',
          file: path,
        }, 250 + Math.floor(stream() * 600))
      }
    }
    for (const { id } of departmentHeads) {
      const index = pending.findIndex(finding => findingDepartment.get(finding.id) === id)
      if (index === -1) continue
      const finding = pending.splice(index, 1)[0]
      if (finding === undefined) continue
      const roster = members.get(id) ?? []
      const agent = pick(stream, roster)
      const sessionId = session(agent.id)
      log.push({
        agentId: agent.id,
        sessionId,
        kind: 'tool',
        label: `${pick(stream, SAFETY_TOOLS)} — ${finding.file}`,
        detail: `reading for ${finding.cwe}`,
        file: finding.file,
      }, 300 + Math.floor(stream() * 900))
      log.push({
        agentId: agent.id,
        sessionId,
        kind: 'step',
        label: `Tracing ${finding.cwe} in ${finding.file}`,
        detail: finding.evidence.slice(0, 120),
        file: finding.file,
        line: finding.line,
      }, 400 + Math.floor(stream() * 1_200))
      log.push({
        agentId: agent.id,
        sessionId,
        kind: 'finding',
        label: finding.title,
        detail: `${finding.cwe} · ${finding.owasp}`,
        severity: finding.severity,
        file: finding.file,
        line: finding.line,
      }, 500 + Math.floor(stream() * 900))
      if (stream() < 0.35) {
        log.push({
          agentId: agent.id,
          sessionId,
          kind: 'step',
          label: 'Second reader agrees',
          detail: `confidence ${finding.confidence.toFixed(2)}`,
          file: finding.file,
          line: finding.line,
        }, 400 + Math.floor(stream() * 700))
      }

      // Verification re-reads each placed finding at its own line while the
      // departments keep working; an unverified finding is named, not dropped.
      const unverified = safety.certificate.unverified.includes(finding.id)
      log.push({
        agentId: 'verification/check-executor',
        sessionId: session('verification/check-executor'),
        kind: 'tool',
        label: `read — ${finding.file}:${finding.line}`,
        detail: `re-reading ${finding.id}`,
        file: finding.file,
        line: finding.line,
      }, 250 + Math.floor(stream() * 500))
      log.push({
        agentId: 'verification/check-executor',
        sessionId: session('verification/check-executor'),
        kind: unverified ? 'refusal' : 'step',
        label: unverified ? `${finding.id} not verified` : `${finding.id} confirmed at line ${finding.line}`,
        detail: unverified
          ? 'the evidence needs a runtime the review did not have'
          : `${finding.cwe} · confidence ${finding.confidence.toFixed(2)}`,
        severity: unverified ? 'info' : finding.severity,
        file: finding.file,
        line: finding.line,
      }, 300 + Math.floor(stream() * 700))

      if (stream() < 0.3) {
        log.push({
          agentId: 'judging/correctness-judge',
          sessionId: session('judging/correctness-judge'),
          kind: 'step',
          label: `Scored ${finding.id} against the rubric`,
          detail: `severity ${finding.severity} upheld`,
          file: finding.file,
          line: finding.line,
        }, 300 + Math.floor(stream() * 600))
      }

      if (pending.findIndex(item => findingDepartment.get(item.id) === id) === -1) {
        log.push({
          agentId: 'program/integration-merger',
          sessionId: session('program/integration-merger'),
          kind: 'merge',
          label: `${DEPARTMENT_NAMES[id] ?? id} report received`,
          detail: 'placed on the merged head, pending the department certificate',
        }, 400 + Math.floor(stream() * 700))
      }
    }
  }

  log.push({
    agentId: 'code-safety/container-surface-auditor',
    sessionId: session('code-safety/container-surface-auditor'),
    kind: 'refusal',
    label: 'Container surface unread',
    detail: 'No image manifest at this revision; the department reports partial rather than claiming a clean read',
    severity: 'info',
  }, 1_600)

  for (const { id, head } of departmentHeads) {
    const certified = id !== 'platform'
    log.push({
      agentId: 'verification/check-executor',
      sessionId: session('verification/check-executor'),
      kind: 'step',
      label: `Checks executed — ${DEPARTMENT_NAMES[id] ?? id}`,
      detail: certified ? 'every case passed' : 'one case unread, certificate withheld',
    }, 900 + Math.floor(stream() * 500))
    if (!certified) continue
    log.push({
      agentId: 'verification/certificate-authority',
      sessionId: session('verification/certificate-authority'),
      kind: 'certificate',
      label: `Certified — ${DEPARTMENT_NAMES[id] ?? id}`,
      detail: `${head.name}, executor recorded, isolation none`,
    }, 700 + Math.floor(stream() * 400))
  }

  log.push({
    agentId: 'verification/read-barrier-census',
    sessionId: session('verification/read-barrier-census'),
    kind: 'step',
    label: 'Read-barrier census recorded',
    detail: 'every path-opening capability denied at its executor',
  }, 1_200)
  log.push({
    agentId: 'judging/correctness-judge',
    sessionId: session('judging/correctness-judge'),
    kind: 'step',
    label: 'Rubric scored — correctness lens',
    detail: '9/10, one deduction for the unread container surface',
  }, 1_500)
  log.push({
    agentId: 'judging/council-chair',
    sessionId: session('judging/council-chair'),
    kind: 'step',
    label: 'Council verdict recorded',
    detail: 'accept with the partial department named on the certificate',
  }, 1_300)
  log.push({
    agentId: 'program/integration-merger',
    sessionId: session('program/integration-merger'),
    kind: 'merge',
    label: 'Department reports merged',
    detail: `${findings.length} findings, ${departments.filter(entry => entry.certified).length} of ${departments.length} departments certified`,
  }, 1_100)
  log.push({
    agentId: 'verification/certificate-authority',
    sessionId: session('verification/certificate-authority'),
    kind: 'certificate',
    label: 'Review certificate issued',
    detail: `critical ${counts.critical} · high ${counts.high} · medium ${counts.medium} · low ${counts.low}`,
  }, 900)
  log.push({
    agentId: 'curation/curator',
    sessionId: session('curation/curator'),
    kind: 'step',
    label: 'Report exported under its redaction profile',
    detail: 'French and English summaries, no raw transcript',
  }, 800)

  return log.events
}

/**
 * Build a generic run stream from a phase script.
 * @param seed - PRNG seed for the pacing.
 * @param script - The events to lay down, before pacing.
 * @returns Every event of the run, in sequence order.
 */
function scriptedEvents(seed: number, script: readonly Omit<RunEvent, 'ts' | 'seq'>[]): RunEvent[] {
  const log = new EventLog()
  const stream = rng(seed)
  for (const event of script) log.push(event, 600 + Math.floor(stream() * 2_400))
  return log.events
}

/**
 * The program run: four departments, verification, and a release on certificate.
 * @returns The scripted program events.
 */
function programScript(): Omit<RunEvent, 'ts' | 'seq'>[] {
  const script: Omit<RunEvent, 'ts' | 'seq'>[] = []
  const names = ['API', 'Data', 'Interface', 'Platform']
  script.push({
    agentId: 'program/program-ledger', sessionId: 'sess-program-atlas', kind: 'directive',
    label: 'Program opened — Atlas billing portal', detail: 'four department goals, one integration goal',
  })
  script.push({
    agentId: 'program/spec-freezer', sessionId: 'sess-program-atlas', kind: 'step',
    label: 'Spec frozen', detail: 'signoff recorded before the first department starts',
  })
  for (const name of names) {
    const lead = `program/department-lead-${slug(name)}`
    const implementer = `program/implementer-${slug(name)}`
    script.push({
      agentId: 'program/program-ledger', sessionId: 'sess-program-atlas', kind: 'delegation',
      label: `Department goal — ${name}`, detail: `${lead} on its own worktree`,
    })
    script.push({
      agentId: implementer, sessionId: `sess-atlas-${slug(name)}`, kind: 'tool',
      label: 'bash — pnpm run test', detail: `${name} department, attempt 1`,
    })
    script.push({
      agentId: implementer, sessionId: `sess-atlas-${slug(name)}`, kind: 'step',
      label: `${name} goal met`, detail: 'every case of every active check passed',
    })
    script.push({
      agentId: 'verification/check-executor', sessionId: 'sess-atlas-verify', kind: 'certificate',
      label: `Certified — ${name}`, detail: 'executor recorded, worktree clean',
    })
  }
  script.push({
    agentId: 'program/implementer-platform', sessionId: 'sess-atlas-platform', kind: 'refusal',
    label: 'Attempt 2 refused', detail: 'budget cap reached before the round closed', severity: 'medium',
  })
  script.push({
    agentId: 'program/integration-merger', sessionId: 'sess-atlas-integration', kind: 'merge',
    label: 'Four worktrees merged', detail: 'no conflict, head recorded on the ledger',
  })
  script.push({
    agentId: 'judging/council-chair', sessionId: 'sess-atlas-council', kind: 'step',
    label: 'Council verdict', detail: 'release accepted, one dissent recorded',
  })
  script.push({
    agentId: 'governance/signoff-registrar', sessionId: 'sess-atlas-governance', kind: 'step',
    label: 'Release signoff recorded', detail: 'principal named, artefact hash pinned',
  })
  script.push({
    agentId: 'program/release-steward', sessionId: 'sess-atlas-release', kind: 'certificate',
    label: 'Released on certificate of the merged head', detail: 'Atlas billing portal, four departments',
  })
  return script
}

/**
 * The fleet run: eight routes over the environment suite.
 * @returns The scripted fleet events.
 */
function fleetScript(): Omit<RunEvent, 'ts' | 'seq'>[] {
  const script: Omit<RunEvent, 'ts' | 'seq'>[] = []
  script.push({
    agentId: 'proving-ground/bench-marshal', sessionId: 'sess-shift-41', kind: 'directive',
    label: 'Shift 41 opened', detail: 'eight licensed routes, repetitions 5, isolation none',
  })
  for (let cell = 1; cell <= 24; cell++) {
    script.push({
      agentId: 'proving-ground/cell-runner', sessionId: `sess-shift-41-cell-${cell}`, kind: 'step',
      label: `Cell ${cell} stamped`, detail: 'fresh workspace, seed and policy version recorded',
    })
    if (cell % 6 === 0) {
      script.push({
        agentId: 'proving-ground/circuit-breaker', sessionId: 'sess-shift-41', kind: 'refusal',
        label: 'Route paused', detail: 'three consecutive provider errors inside the window', severity: 'medium',
      })
    }
    if (cell % 4 === 0) {
      script.push({
        agentId: 'verification/check-executor', sessionId: `sess-shift-41-cell-${cell}`, kind: 'certificate',
        label: `Cell ${cell} certified`, detail: 'every case passed, executor recorded',
      })
    }
  }
  script.push({
    agentId: 'proving-ground/scorekeeper', sessionId: 'sess-shift-41', kind: 'step',
    label: 'Scoreboard folded', detail: 'pass@5 per route, no blending across isolation',
  })
  script.push({
    agentId: 'observatory/leaderboard-projector', sessionId: 'sess-shift-41', kind: 'step',
    label: 'Rows published', detail: 'tamper column reads "not instrumented" on every row',
  })
  return script
}

/**
 * The experiment run: two frozen arms and a seeded bootstrap.
 * @returns The scripted experiment events.
 */
function experimentScript(): Omit<RunEvent, 'ts' | 'seq'>[] {
  const script: Omit<RunEvent, 'ts' | 'seq'>[] = []
  script.push({
    agentId: 'proving-ground/paired-experiment-driver', sessionId: 'sess-e8', kind: 'directive',
    label: 'Experiment E8 opened', detail: 'two arms frozen before the first cell, t=5',
  })
  for (let pair = 1; pair <= 10; pair++) {
    script.push({
      agentId: 'proving-ground/cell-runner', sessionId: `sess-e8-pair-${pair}`, kind: 'step',
      label: `Pair ${pair} — arm A`, detail: 'same seed, same environment, same preset',
    })
    script.push({
      agentId: 'proving-ground/cell-runner', sessionId: `sess-e8-pair-${pair}`, kind: 'step',
      label: `Pair ${pair} — arm B`, detail: 'same seed, same environment, same preset',
    })
  }
  script.push({
    agentId: 'proving-ground/scorekeeper', sessionId: 'sess-e8', kind: 'step',
    label: 'Seeded bootstrap computed', detail: 'interval crosses zero',
  })
  script.push({
    agentId: 'judging/determinism-judge', sessionId: 'sess-e8', kind: 'step',
    label: 'Verdict: inconclusive', detail: 'no ranking published, the pair stays parked',
  })
  return script
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write one JSON fixture with a trailing newline.
 * @param relative - Path under `fixtures/`.
 * @param value - The value to serialize.
 */
function writeJson(relative: string, value: unknown): void {
  const path = resolve(fixtures, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Write one JSONL event stream with a trailing newline.
 * @param relative - Path under `fixtures/`.
 * @param events - Events, already in sequence order.
 */
function writeJsonl(relative: string, events: readonly RunEvent[]): void {
  const path = resolve(fixtures, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${events.map(event => JSON.stringify(event)).join('\n')}\n`)
}

writeJson('roster.json', roster)
writeJson('runs.json', runs)
writeJson(`safety/${SAFETY_RUN}.json`, safety)

const streams: Record<string, RunEvent[]> = {
  [SAFETY_RUN]: safetyEvents(),
  'run-program-atlas-0917': scriptedEvents(0xa71a5, programScript()),
  'run-fleet-shift-0916': scriptedEvents(0xf1ee7, fleetScript()),
  'run-experiment-e8-0915': scriptedEvents(0xe8e8e, experimentScript()),
}
for (const [id, events] of Object.entries(streams)) writeJsonl(`events/${id}.jsonl`, events)

console.log(`fixtures: ${agents.length} agents, ${edges.length} edges, ${findings.length} findings`)
for (const [id, events] of Object.entries(streams)) console.log(`  events/${id}.jsonl — ${events.length} events`)
