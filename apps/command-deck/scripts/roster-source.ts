/**
 * The enterprise roster's source of record for fixture generation.
 *
 * Division sizes sum to exactly 147, the number of defined agents the deck
 * claims. Each entry is `[name, roleOverride?]`; an entry without an override
 * takes its division's or department's default role.
 */

/** One agent title, with an optional role that overrides the group default. */
type Member = readonly [name: string, role?: string]

/** A named group of agents inside a division. */
interface DepartmentSource {
  id: string
  name: string
  role: string
  members: readonly Member[]
}

/** One division of the enterprise, with either members or departments. */
export interface DivisionSource {
  id: string
  name: string
  purpose: string
  preset: string
  role: string
  skills: readonly string[]
  tools: readonly string[]
  members?: readonly Member[]
  departments?: readonly DepartmentSource[]
}

export const DIVISIONS: readonly DivisionSource[] = [
  {
    id: 'harness-core',
    name: 'Harness Core',
    purpose: 'Owns the plugin spine: loader, session log, agent loop, tools, and the capability seams every other division stands on.',
    preset: 'cordis',
    role: 'harness engineer',
    skills: ['dsh-code-review', 'dsh-pre-push-checks', 'dsh-find-simplifications'],
    tools: ['read', 'edit', 'bash', 'grep', 'todo_write', 'workflow_run'],
    members: [
      ['Loader Architect', 'plugin graph owner'],
      ['Seam Designer', 'capability seam reviewer'],
      ['Session Scribe', 'durable log owner'],
      ['Agent Loop Steward', 'loop extension owner'],
      ['Tool Smith'],
      ['Prompt Compositor'],
      ['Compaction Warden'],
      ['Route Broker'],
      ['Shell Custodian'],
      ['Filesystem Marshal'],
      ['Subprocess Reaper'],
      ['Terminal Keeper'],
      ['Workflow Weaver'],
      ['Preset Composer'],
      ['Budget Sentinel'],
      ['Hook Interpreter'],
    ],
  },
  {
    id: 'proving-ground',
    name: 'Proving Ground',
    purpose: 'Runs every licensed route against the environment suite in shifts, with repetitions, seeds, and frozen paired experiments.',
    preset: 'standard',
    role: 'bench operator',
    skills: ['bench-shift-planning', 'pass-at-k', 'route-licensing'],
    tools: ['bash', 'read', 'workflow_run', 'todo_write'],
    members: [
      ['Bench Marshal', 'shift scheduler'],
      ['Environment Miner'],
      ['Cell Runner'],
      ['Repetition Planner'],
      ['Paired Experiment Driver'],
      ['Seed Registrar'],
      ['Scorekeeper', 'scoreboard folder'],
      ['Route Licensor'],
      ['Circuit Breaker'],
      ['Workspace Reaper'],
      ['Held-out Custodian'],
      ['Calibration Analyst'],
      ['Outage Watch'],
      ['Bench Craft', 'case author'],
    ],
  },
  {
    id: 'verification',
    name: 'Verification',
    purpose: 'Executes the checks nobody self-reports, records the read-barrier census, and issues the certificate a release depends on.',
    preset: 'validator',
    role: 'verifier',
    skills: ['check-execution', 'read-barrier-census', 'isolation-audit'],
    tools: ['bash', 'read', 'grep', 'glob'],
    members: [
      ['Check Executor', 'check runner'],
      ['Certificate Authority', 'certificate issuer'],
      ['Read Barrier Census'],
      ['Isolation Auditor'],
      ['Tamper Inspector'],
      ['Executor Attestor'],
      ['Standard Compiler'],
      ['Case Folder'],
      ['Regression Gate'],
      ['Flake Triager'],
      ['Coverage Assessor'],
      ['Evidence Librarian'],
    ],
  },
  {
    id: 'judging',
    name: 'Judging',
    purpose: 'Scores contested work against a frozen rubric, one lens per judge, and records the dissent alongside the verdict.',
    preset: 'judge',
    role: 'judge',
    skills: ['rubric-scoring', 'dissent-recording'],
    tools: ['read', 'grep', 'glob'],
    members: [
      ['Council Chair', 'council convener'],
      ['Correctness Judge'],
      ['Operations Judge'],
      ['Governance Judge'],
      ['Determinism Judge'],
      ['Data Judge'],
      ['Client Judge'],
      ['Rubric Keeper', 'rubric owner'],
      ['Dissent Recorder'],
    ],
  },
  {
    id: 'curation',
    name: 'Curation and Data',
    purpose: 'Turns persisted sessions into exports that respect their recorded data-use terms, with redaction before anything leaves.',
    preset: 'standard',
    role: 'curator',
    skills: ['redaction-profiles', 'terms-matching', 'trajectory-export'],
    tools: ['read', 'bash', 'glob', 'workflow_run'],
    members: [
      ['Curator', 'export owner'],
      ['Redaction Profiler'],
      ['Terms Gatekeeper'],
      ['Trajectory Exporter'],
      ['Transcript Digester'],
      ['Duplicate Detector'],
      ['Dataset Packer'],
      ['Provenance Stamper'],
      ['Consent Auditor'],
      ['Quarantine Officer'],
      ['Corpus Statistician'],
    ],
  },
  {
    id: 'program',
    name: 'Program Departments',
    purpose: 'Splits one client deliverable into department goals on their own worktrees, then releases only on a certificate of the merged head.',
    preset: 'code',
    role: 'implementer',
    skills: ['goal-decomposition', 'worktree-hygiene', 'dsh-pre-push-checks'],
    tools: ['read', 'edit', 'write', 'bash', 'grep', 'todo_write'],
    members: [
      ['Program Ledger', 'program owner'],
      ['Spec Freezer', 'spec steward'],
      ['Department Lead — API', 'department lead'],
      ['Department Lead — Data', 'department lead'],
      ['Department Lead — Interface', 'department lead'],
      ['Department Lead — Platform', 'department lead'],
      ['Implementer — API'],
      ['Implementer — Data'],
      ['Implementer — Interface'],
      ['Implementer — Platform'],
      ['Integration Merger', 'integrator'],
      ['Release Steward', 'release owner'],
      ['Worktree Broker'],
      ['Goal Compiler'],
      ['Attempt Planner'],
      ['Certificate Reconciler'],
      ['Handoff Editor'],
      ['Client Liaison', 'client contact'],
    ],
  },
  {
    id: 'code-safety',
    name: 'Code Safety',
    purpose: 'Six departments read a target repository in parallel and place every finding on the line of code that carries it.',
    preset: 'validator',
    role: 'safety auditor',
    skills: ['taint-tracing', 'cwe-mapping', 'owasp-top-ten'],
    tools: ['read', 'grep', 'glob', 'bash', 'lsp_definition'],
    departments: [
      {
        id: 'secrets',
        name: 'Secrets',
        role: 'secrets auditor',
        members: [
          ['Secret Scanner'],
          ['Entropy Sentinel'],
          ['Credential Flow Tracer'],
          ['Key Rotation Auditor'],
          ['History Sweeper'],
          ['Vault Policy Reader'],
        ],
      },
      {
        id: 'injection',
        name: 'Injection',
        role: 'injection auditor',
        members: [
          ['Taint Tracer'],
          ['Query Composer Auditor'],
          ['Template Escape Auditor'],
          ['Command Surface Auditor'],
          ['Deserialization Auditor'],
          ['Log Forging Auditor'],
        ],
      },
      {
        id: 'access',
        name: 'Access',
        role: 'access auditor',
        members: [
          ['Route Guard Auditor'],
          ['Session Flag Auditor'],
          ['Object Reference Auditor'],
          ['Privilege Escalation Auditor'],
          ['Request Forgery Auditor'],
          ['Redirect Auditor'],
        ],
      },
      {
        id: 'data',
        name: 'Data',
        role: 'data auditor',
        members: [
          ['Encryption-at-Rest Auditor'],
          ['Transport Auditor'],
          ['Personal Data Classifier'],
          ['Retention Auditor'],
          ['Backup Exposure Auditor'],
          ['Log Redaction Auditor'],
        ],
      },
      {
        id: 'dependencies',
        name: 'Dependencies',
        role: 'dependency auditor',
        members: [
          ['Manifest Reader'],
          ['Advisory Matcher'],
          ['Transitive Resolver'],
          ['Licence Auditor'],
          ['Lockfile Drift Auditor'],
          ['Supply Chain Sentinel'],
        ],
      },
      {
        id: 'platform',
        name: 'Platform',
        role: 'platform auditor',
        members: [
          ['Header Auditor'],
          ['Config Diff Auditor'],
          ['Container Surface Auditor'],
          ['Environment Secret Auditor'],
          ['Rate Limit Auditor'],
          ['Error Surface Auditor'],
        ],
      },
    ],
  },
  {
    id: 'knowledge',
    name: 'Knowledge',
    purpose: 'Keeps the packs, skills, and postmortems that every other division reads before it starts, under keep-or-retire review.',
    preset: 'standard',
    role: 'librarian',
    skills: ['dsh-doc-standards', 'dsh-prose-standard', 'keep-or-retire'],
    tools: ['read', 'write', 'grep', 'glob', 'web_search'],
    members: [
      ['Librarian', 'pack owner'],
      ['Pack Compiler'],
      ['Skill Nominator'],
      ['Keep-or-Retire Reviewer'],
      ['Proposal Digester'],
      ['Fortnight Editor'],
      ['Cookbook Author'],
      ['Glossary Keeper'],
      ['Postmortem Analyst'],
      ['Index Builder'],
    ],
  },
  {
    id: 'governance',
    name: 'Governance',
    purpose: 'Gates the five transitions that never complete without a recorded signature, and routes incidents away from the blog.',
    preset: 'minimal',
    role: 'steward',
    skills: ['signoff-records', 'data-use-terms', 'incident-routing'],
    tools: ['read', 'write', 'grep'],
    members: [
      ['Signoff Registrar', 'signature registrar'],
      ['Principal Attestor'],
      ['Compliance Reader'],
      ['Incident Router'],
      ['Data-Use Steward'],
      ['Policy Drafter'],
      ['Audit Trail Keeper'],
      ['Counsel Liaison'],
    ],
  },
  {
    id: 'observatory',
    name: 'Observatory',
    purpose: 'Folds persisted logs into the rows the deck shows, and never blends across isolation, held-out flag, or executor.',
    preset: 'standard',
    role: 'observer',
    skills: ['scoreboard-folding', 'usage-pricing', 'anomaly-watch'],
    tools: ['read', 'glob', 'workflow_run'],
    members: [
      ['Leaderboard Projector', 'projection owner'],
      ['Row Composer'],
      ['Tamper Column'],
      ['Cost Folder'],
      ['Usage Pricer'],
      ['Dashboard Publisher'],
      ['Anomaly Watch'],
      ['Shift Reporter'],
      ['Uptime Monitor'],
      ['Session Facts Folder'],
      ['Diagnosis Classifier'],
      ['Trend Analyst'],
      ['Public Digest Editor'],
    ],
  },
]
