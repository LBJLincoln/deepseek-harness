/**
 * Keyless adapter that plays every department of the code-safety program and
 * its integration: read the reporting contract, write the department's findings
 * and report section, commit them, and — in the integration session — merge them
 * into `findings.json` and `SAFETY-REPORT.md`.
 *
 * Every scripted finding states its file and line and nothing else about the
 * target's text: the `snippet` is read out of the target tree at stream time,
 * from the same bytes the committed examiner will compare it against. That is
 * what keeps this fixture honest — the scripted route cannot pass the examiner
 * by carrying a copy of the target, and a sample target edited without its
 * findings being updated fails the run rather than passing it.
 *
 * The `platform` department deliberately stops before committing on its first
 * attempt: the program refuses to measure a worktree carrying work no commit
 * carries, and the turn that follows its `<uncommitted_work>` directive commits.
 *
 * The markers and the department keys below are pinned by the e2e and by the
 * driver's spec, so keep them and the goal objectives together.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** The turn text the program delivers when a worktree carries uncommitted work. */
const UNCOMMITTED_MARKER = '<uncommitted_work>'

/** The turn text the program delivers when a standard did not pass. */
const CHECKS_FAILED_MARKER = '<checks_failed>'

/** The reporting contract every session reads before it writes anything. */
const CONTRACT = 'REPORTING.md'

/** The answer that ends a session's turn. */
const DONE = 'TURN COMPLETE'

/** The department that leaves its first attempt uncommitted. */
const UNCOMMITTED_DEPARTMENT = 'platform'

/** One scripted finding, before the target's own text fills its `snippet`. */
interface Scripted {
  readonly id: string
  readonly cwe: string
  readonly owasp: string
  readonly severity: string
  readonly confidence: string
  readonly title: string
  readonly file: string
  readonly line: number
  readonly endLine?: number
  readonly evidence: string
  readonly impact: string
  readonly fix: string
  readonly references: readonly string[]
}

/** What each department reports against `sample-target/`, keyed by its goal key. */
const SCRIPTED: Record<string, readonly Scripted[]> = {
  secrets: [
    {
      id: 'secrets-session-secret',
      cwe: 'CWE-798',
      owasp: 'A07:2021 Identification and Authentication Failures',
      severity: 'high',
      confidence: 'confirmed',
      title: 'Session signing secret is a literal in committed configuration',
      file: 'src/config.js',
      line: 8,
      evidence: 'The literal is read by server.js and passed to express-session as its signing secret.',
      impact: 'Anyone with read access to the repository can sign a session cookie for any user.',
      fix: 'Read the secret from the environment, rotate the committed value, and fail to start without one.',
      references: ['https://cwe.mitre.org/data/definitions/798.html'],
    },
    {
      id: 'secrets-api-token',
      cwe: 'CWE-798',
      owasp: 'A07:2021 Identification and Authentication Failures',
      severity: 'critical',
      confidence: 'confirmed',
      title: 'Live API token committed in configuration',
      file: 'src/config.js',
      line: 9,
      evidence: 'The value carries a live-key prefix and is exported from the module every request path imports.',
      impact: 'The token authenticates to the upstream service as this application, for anyone who reads the repository.',
      fix: 'Revoke the token, move it to the environment, and add a secret scan to the commit path.',
      references: ['https://cwe.mitre.org/data/definitions/798.html'],
    },
    {
      id: 'secrets-database-password',
      cwe: 'CWE-798',
      owasp: 'A07:2021 Identification and Authentication Failures',
      severity: 'high',
      confidence: 'confirmed',
      title: 'Database password embedded in a committed connection string',
      file: 'src/config.js',
      line: 7,
      evidence: 'The authority of the connection string carries the account and its password.',
      impact: 'Anyone who can reach the database host authenticates as its root account.',
      fix: 'Take the credentials from the environment and rotate the committed password.',
      references: ['https://cwe.mitre.org/data/definitions/798.html'],
    },
  ],
  injection: [
    {
      id: 'injection-sql-concatenation',
      cwe: 'CWE-89',
      owasp: 'A03:2021 Injection',
      severity: 'critical',
      confidence: 'confirmed',
      title: 'Account lookup builds SQL by concatenating its argument',
      file: 'src/db.js',
      line: 7,
      evidence: 'accountId reaches the query text unescaped; the caller passes it through from the request.',
      impact: 'A crafted identifier reads or changes any row the database account can reach.',
      fix: 'Pass the identifier as a bound parameter instead of concatenating it.',
      references: ['https://cwe.mitre.org/data/definitions/89.html'],
    },
    {
      id: 'injection-mongo-where',
      cwe: 'CWE-943',
      owasp: 'A03:2021 Injection',
      severity: 'critical',
      confidence: 'confirmed',
      title: 'Memo search interpolates its term into a MongoDB $where expression',
      file: 'src/db.js',
      line: 11,
      evidence: '$where evaluates JavaScript on the database server, and term is interpolated into that source.',
      impact: 'A crafted term runs arbitrary JavaScript in the database process.',
      fix: 'Match with a $regex built from an escaped term, or filter in the application.',
      references: ['https://cwe.mitre.org/data/definitions/943.html'],
    },
    {
      id: 'injection-eval-request-body',
      cwe: 'CWE-95',
      owasp: 'A03:2021 Injection',
      severity: 'critical',
      confidence: 'confirmed',
      title: 'Contribution arithmetic evaluates request fields as code',
      file: 'src/calc.js',
      line: 5,
      endLine: 6,
      evidence: 'Both fields come from the request body and are passed to eval without parsing.',
      impact: 'A request body runs as server-side code in the application process.',
      fix: 'Parse the values as numbers and reject anything else.',
      references: ['https://cwe.mitre.org/data/definitions/95.html'],
    },
  ],
  access: [
    {
      id: 'access-admin-users-unauthenticated',
      cwe: 'CWE-306',
      owasp: 'A01:2021 Broken Access Control',
      severity: 'high',
      confidence: 'confirmed',
      title: 'Administrative user listing is registered with no authentication middleware',
      file: 'src/admin.js',
      line: 9,
      evidence: 'The route is registered directly on the app; the middleware chain in server.js adds CORS and a session and no authentication.',
      impact: 'Any caller lists every user of the application.',
      fix: 'Require an authenticated session and an administrative role in front of the route.',
      references: ['https://cwe.mitre.org/data/definitions/306.html'],
    },
    {
      id: 'access-self-promotion',
      cwe: 'CWE-269',
      owasp: 'A01:2021 Broken Access Control',
      severity: 'critical',
      confidence: 'confirmed',
      title: 'Role change takes its subject from the request body and checks nothing',
      file: 'src/admin.js',
      line: 24,
      evidence: 'userId comes from the request body and the handler grants the admin role with no check on the caller.',
      impact: 'Any caller promotes any account, including their own, to administrator.',
      fix: 'Require an administrative session and verify the caller may change that account.',
      references: ['https://cwe.mitre.org/data/definitions/269.html'],
    },
  ],
  data: [
    {
      id: 'data-md5-password',
      cwe: 'CWE-916',
      owasp: 'A02:2021 Cryptographic Failures',
      severity: 'high',
      confidence: 'confirmed',
      title: 'Passwords are stored as unsalted MD5',
      file: 'src/log.js',
      line: 8,
      evidence: 'The digest is MD5 over the password alone, with no salt and no work factor.',
      impact: 'A stolen password table is reversed at commodity rates.',
      fix: 'Store a per-password salted hash from a memory-hard function such as argon2 or scrypt.',
      references: ['https://cwe.mitre.org/data/definitions/916.html'],
    },
    {
      id: 'data-pii-in-logs',
      cwe: 'CWE-532',
      owasp: 'A09:2021 Security Logging and Monitoring Failures',
      severity: 'high',
      confidence: 'confirmed',
      title: 'Login audit writes the account password, card number and national identifier to the log',
      file: 'src/log.js',
      line: 12,
      evidence: 'The template interpolates the password, card number and national identifier of the user record into a console line.',
      impact: 'Everyone with log access holds credentials and payment data in cleartext.',
      fix: 'Log an account identifier only, and redact the rest at the logging call.',
      references: ['https://cwe.mitre.org/data/definitions/532.html'],
    },
    {
      id: 'data-cleartext-transport',
      cwe: 'CWE-319',
      owasp: 'A02:2021 Cryptographic Failures',
      severity: 'medium',
      confidence: 'confirmed',
      title: 'Reporting payloads are shipped over cleartext HTTP',
      file: 'src/config.js',
      line: 10,
      evidence: 'The endpoint is an http:// URL, and ship() posts the payload to it.',
      impact: 'Anything the application reports is readable and alterable in transit.',
      fix: 'Use an https:// endpoint and verify its certificate.',
      references: ['https://cwe.mitre.org/data/definitions/319.html'],
    },
  ],
  dependencies: [
    {
      id: 'dependencies-marked-redos',
      cwe: 'CWE-1333',
      owasp: 'A06:2021 Vulnerable and Outdated Components',
      severity: 'high',
      confidence: 'likely',
      title: 'marked is pinned to 0.3.5, a release with published redress-of-service advisories',
      file: 'package.json',
      line: 10,
      evidence: 'The manifest pins 0.3.5 exactly; the 0.3.x line carries regular-expression denial-of-service advisories fixed in 4.x.',
      impact: 'A crafted document makes the rendering thread spin.',
      fix: 'Move to a maintained 4.x release and re-run the audit.',
      references: ['GHSA-4r62-v4vq-hr96'],
    },
    {
      id: 'dependencies-lodash-prototype-pollution',
      cwe: 'CWE-1321',
      owasp: 'A06:2021 Vulnerable and Outdated Components',
      severity: 'high',
      confidence: 'likely',
      title: 'lodash is pinned to 4.17.4, below the prototype-pollution fixes',
      file: 'package.json',
      line: 11,
      evidence: 'The manifest pins 4.17.4; the prototype-pollution advisories against merge and set are fixed in 4.17.12 and later.',
      impact: 'A crafted object reaches Object.prototype and changes behaviour across the process.',
      fix: 'Raise the floor to 4.17.21.',
      references: ['GHSA-jf85-cpcp-j695'],
    },
  ],
  platform: [
    {
      id: 'platform-wildcard-cors-with-credentials',
      cwe: 'CWE-942',
      owasp: 'A05:2021 Security Misconfiguration',
      severity: 'high',
      confidence: 'confirmed',
      title: 'CORS allows every origin and the next line allows credentials with it',
      file: 'server.js',
      line: 12,
      endLine: 13,
      evidence: 'The wildcard origin and the credentials header are set together on every response.',
      impact: 'Any site a logged-in user visits reads their authenticated responses.',
      fix: 'Allow an explicit origin list, and allow credentials only for those origins.',
      references: ['https://cwe.mitre.org/data/definitions/942.html'],
    },
    {
      id: 'platform-insecure-session-cookie',
      cwe: 'CWE-1004',
      owasp: 'A05:2021 Security Misconfiguration',
      severity: 'high',
      confidence: 'confirmed',
      title: 'Session cookie is set without httpOnly and without secure',
      file: 'server.js',
      line: 19,
      evidence: 'The session cookie options disable both flags, and no sameSite is set at all.',
      impact: 'Injected script reads the session cookie, and any cleartext request leaks it.',
      fix: 'Set httpOnly, secure and sameSite, and serve the application over TLS.',
      references: ['https://cwe.mitre.org/data/definitions/1004.html'],
    },
    {
      id: 'platform-stack-trace-to-client',
      cwe: 'CWE-209',
      owasp: 'A05:2021 Security Misconfiguration',
      severity: 'medium',
      confidence: 'confirmed',
      title: 'The error handler returns the stack trace to the client',
      file: 'server.js',
      line: 25,
      evidence: 'The handler interpolates error.stack into the response body for every unhandled error.',
      impact: 'Paths, module versions and internal call structure are disclosed to any caller who can cause an error.',
      fix: 'Log the stack and return an opaque error identifier.',
      references: ['https://cwe.mitre.org/data/definitions/209.html'],
    },
  ],
}

/** The order the integration lists severities in, most severe first. */
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']

/** Where in one session's turn the adapter is: the turn's text and the tool results it already has. */
interface Position {
  /** Text of the newest turn the session was handed, empty for a session that was handed none. */
  readonly text: string
  /** Tool results delivered since that turn, which is the step this stream serves. */
  readonly results: number
}

/**
 * Read the newest turn and the steps already taken in it.
 * @param options - the request the loop assembled.
 * @returns the turn text and the tool results that followed it.
 */
function position(options: GenerateOptions): Position {
  let results = 0
  for (let index = options.messages.length - 1; index >= 0; index -= 1) {
    const message = options.messages[index]
    if (message === undefined || message.role !== 'user') continue
    const content = message.content ?? []
    if (content.some(block => block.type === 'tool-result')) {
      results += 1
      continue
    }
    return { text: content.filter(block => block.type === 'text').map(block => block.text).join(''), results }
  }
  return { text: '', results }
}

/**
 * The department this session works, from the marker its goal objective carries.
 * @param options - the request whose history carries the goal text.
 * @returns the key, or `undefined` for the integration session and anything else.
 */
function departmentKey(options: GenerateOptions): string | undefined {
  const history = options.messages
    .flatMap(message => message.content ?? [])
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('\n')
  const key = /code-safety department: ([a-z-]+)/.exec(history)?.[1]
  return key !== undefined && Object.hasOwn(SCRIPTED, key) ? key : undefined
}

/**
 * The tree under review, as the driver pointed this run at it.
 * @returns the absolute target root.
 * @throws when the route is composed without one, which no composition does.
 */
function targetRoot(): string {
  const root = process.env.DSH_CODE_SAFETY_TARGET
  if (root === undefined) throw new Error('code-safety-llm requires DSH_CODE_SAFETY_TARGET')
  return root
}

/**
 * The target digest the report's certificate states, read from the lock the
 * base commit carries rather than recomputed, so the scripted integration
 * states what the examiner will compare against.
 * @returns the SHA-256 `target.json` locks the tree to.
 * @throws when the route is composed without a report repository, which no composition does.
 */
function lockDigest(): string {
  const repository = process.env.DSH_CODE_SAFETY_REPORT_REPO
  if (repository === undefined) throw new Error('code-safety-llm requires DSH_CODE_SAFETY_REPORT_REPO')
  const lock = JSON.parse(readFileSync(join(repository, 'target.json'), 'utf8')) as { sha256: string }
  return lock.sha256
}

/** One scripted finding once the target's own text filled its `snippet`. */
type Quoted = Scripted & { readonly snippet: string }

/**
 * One department's findings, with each `snippet` read out of the target tree.
 * @param key - the department's goal key.
 * @returns the findings as the department commits them.
 */
function findingsOf(key: string): Quoted[] {
  const root = targetRoot()
  return (SCRIPTED[key] ?? []).map((finding) => {
    const lines = readFileSync(join(root, finding.file), 'utf8').split('\n')
    return {
      ...finding,
      snippet: lines.slice(finding.line - 1, finding.endLine ?? finding.line).join('\n'),
    }
  })
}

/**
 * One department's own section of the report.
 * @param key - the department's goal key.
 * @returns the Markdown the department commits.
 */
function sectionOf(key: string): string {
  const findings = SCRIPTED[key] ?? []
  const listed = findings.map(finding => `- \`${finding.id}\` — ${finding.title} (\`${finding.file}:${String(finding.line)}\`, ${finding.cwe}, ${finding.confidence})`)
  return [
    `# ${key}`,
    '',
    `Read every file of the tree under review that this department owns, and reported ${String(findings.length)} findings.`,
    '',
    ...listed,
    '',
    '## Not reached',
    '',
    '- Nothing outside this department, and nothing this department could only reach by running the application.',
    '',
  ].join('\n')
}

/**
 * The union every department's findings merge into, deduplicated the way
 * `REPORTING.md` states.
 * @returns the union, ordered by severity and then by id.
 */
function union(): Quoted[] {
  const kept = new Map<string, Quoted>()
  for (const key of Object.keys(SCRIPTED)) {
    for (const finding of findingsOf(key)) {
      const identity = `${finding.file}:${String(finding.line)}:${finding.cwe}`
      if (!kept.has(identity)) kept.set(identity, finding)
    }
  }
  return [...kept.values()].sort((left, right) => (
    SEVERITIES.indexOf(left.severity) - SEVERITIES.indexOf(right.severity) || left.id.localeCompare(right.id)
  ))
}

/**
 * The report the integration commits: the sections `REPORTING.md` states, the
 * counts `findings.json` holds, and the certificate the examiner reads.
 * @param findings - the union the same attempt writes to `findings.json`.
 * @param lockDigest - the target digest `target.json` carries.
 * @returns the Markdown the integration commits.
 */
function safetyReport(findings: readonly Quoted[], lockDigest: string): string {
  const counts = SEVERITIES.map(severity => `- ${severity}: ${String(findings.filter(finding => finding.severity === severity).length)}`)
  const grouped = SEVERITIES.flatMap((severity) => {
    const listed = findings.filter(finding => finding.severity === severity)
    if (listed.length === 0) return []
    return [
      `### ${severity}`,
      '',
      ...listed.map(finding => `- \`${finding.id}\` — ${finding.title} (\`${finding.file}:${String(finding.line)}\`, ${finding.cwe}, ${finding.confidence}) — ${finding.impact} ${finding.fix}`),
      '',
    ]
  })
  return [
    '# Rapport de sûreté du code — code-safety report',
    '',
    '## Résumé exécutif',
    '',
    "Six départements ont relu l'arbre sous revue, chacun sur sa propre branche, et chaque constat cité a été vérifié mécaniquement à la ligne qu'il cite.",
    '',
    "La revue est conduite par un modèle de langage, étayée par un analyseur statique et par l'examinateur committé ; elle ne porte que sur les fichiers effectivement lus.",
    '',
    ...counts,
    '',
    '## Executive summary',
    '',
    'Six departments read the tree under review, each on its own branch, and every listed finding was mechanically verified to exist at the line it cites.',
    '',
    'The review is driven by a language model, grounded by a static scanner and by the committed examiner, and covers only the files that were actually read.',
    '',
    ...counts,
    '',
    '## Scope and method',
    '',
    'The tree under review is the one `target.json` locks, and it was read only: the examiner re-hashes every locked file on every run.',
    '',
    'The six departments were secrets, injection, access, data, dependencies and platform. Each read the files its subject covers, and each committed its findings and its own section under `report/`.',
    '',
    'This run was driven by the fixture\'s scripted route rather than by a model, so what it demonstrates is the workflow and the examiner, not what a model finds.',
    '',
    '## Findings',
    '',
    ...grouped,
    '## What was not covered',
    '',
    '- Nothing was executed: no route was called, no payload was sent, and no finding here is a demonstrated exploit.',
    '- Files no department opened are not covered, and neither is any defect outside the six subjects.',
    '- No finding was dropped by the examiner in this run.',
    '',
    '## Certificate',
    '',
    `Verified findings: ${String(findings.length)}`,
    `Target tree: ${lockDigest}`,
    '',
    'This review does not certify the absence of vulnerabilities; it certifies only that each listed finding was mechanically verified to exist at the cited line, over the files listed in "Scope and method".',
    '',
  ].join('\n')
}

/**
 * The commit one session makes once its files are written.
 * @param subject - what the commit message states was delivered.
 * @returns the arguments of the `bash` call that commits them.
 */
function commitCall(subject: string): object {
  return {
    command: `git add -A && git commit -qm 'deliver ${subject}'`,
    description: 'Commit what this session delivers.',
  }
}

class CodeSafetyAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { text, results } = position(options)
    const key = departmentKey(options)
    if (key === undefined) {
      yield * this.integrate(text, results)
      return
    }
    if (text.includes(UNCOMMITTED_MARKER)) {
      if (results === 0) {
        yield * call('commit-after-directive', 'bash', commitCall(`the ${key} department findings`))
        return
      }
      yield * reply(DONE)
      return
    }
    if (results === 0) {
      yield * call('read-contract', 'read', { file_path: CONTRACT })
      return
    }
    if (results === 1) {
      yield * call(`write-findings-${key}`, 'write', {
        file_path: `findings/${key}.json`,
        content: `${JSON.stringify(findingsOf(key), null, 2)}\n`,
      })
      return
    }
    if (results === 2) {
      yield * call(`write-section-${key}`, 'write', { file_path: `report/${key}.md`, content: sectionOf(key) })
      return
    }
    if (results === 3 && key !== UNCOMMITTED_DEPARTMENT) {
      yield * call('commit', 'bash', commitCall(`the ${key} department findings`))
      return
    }
    yield * reply(DONE)
  }

  /**
   * The integration session's turns: it is handed no objective, so its first
   * turn is the examiner's own refusal of a worktree that carries no report.
   * @param text - the newest turn's text.
   * @param results - tool results delivered since that turn.
   * @yields the block sequence of one step.
   */
  private async * integrate(text: string, results: number): AsyncIterable<StreamChunk> {
    if (!text.includes(CHECKS_FAILED_MARKER) && !text.includes(UNCOMMITTED_MARKER)) {
      yield * reply('NO CODE-SAFETY DEPARTMENT IN THIS SESSION')
      return
    }
    if (results === 0) {
      yield * call('read-contract', 'read', { file_path: CONTRACT })
      return
    }
    if (results === 1) {
      yield * call('read-lock', 'read', { file_path: 'target.json' })
      return
    }
    const merged = union()
    if (results === 2) {
      yield * call('write-union', 'write', { file_path: 'findings.json', content: `${JSON.stringify(merged, null, 2)}\n` })
      return
    }
    if (results === 3) {
      yield * call('write-report', 'write', { file_path: 'SAFETY-REPORT.md', content: safetyReport(merged, lockDigest()) })
      return
    }
    if (results === 4) {
      yield * call('commit-report', 'bash', commitCall('the merged code-safety report'))
      return
    }
    yield * reply(DONE)
  }
}

/**
 * One tool call as the canonical block sequence of a step that stops on tool calls.
 * @param id - the call's id, which the e2e and the transcript read.
 * @param name - the tool to call.
 * @param args - the call's arguments.
 * @yields the block sequence of one tool-calling step.
 */
function * call(id: string, name: string, args: object): Generator<StreamChunk> {
  const serialized = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id: CallId(id), name, argumentsDelta: serialized }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(id), name, arguments: serialized } }
  yield { type: 'usage', usage: { inputTokens: 23, outputTokens: 7 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

/**
 * One text answer as the canonical block sequence of a stopped step.
 * @param text - what the step answers.
 * @yields the block sequence of one stopped step.
 */
function * reply(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 19, outputTokens: 3 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

export const name = 'code-safety-llm'

export const inject = ['llm']

/**
 * Register the keyless `cli-mock` adapter this composition's sessions run on.
 * @param ctx - the plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['cli-mock'], new CodeSafetyAdapter())
}
