/**
 * The code-safety program's department registry: what each department looks
 * for, and which ones a run includes when none are named explicitly.
 *
 * Both `driver.ts`'s spec construction and `code-safety-llm.ts`'s scripted
 * route import this module, so the department a session runs and the
 * department the keyless route recognizes can never drift apart. Neither file
 * has a side effect at import time, so this module stays safe for
 * `scripts/code-safety.ts` or a test to import for the key list alone.
 */

/** What one department looks for, and the marker its session is recognized by. */
export interface Department {
  readonly key: string
  /** One line naming the department's subject, which opens its objective. */
  readonly subject: string
  /** What the department reads the target for, stated as the goal's own instruction. */
  readonly instruction: string
}

/** The six specialist departments a run includes when none are named explicitly. */
export const SPECIALIST_DEPARTMENTS: readonly Department[] = [
  {
    key: 'secrets',
    subject: 'hard-coded credentials and leaked configuration',
    instruction: 'Look for credentials, tokens, private keys, connection strings and API keys written as literals in source or configuration, for secrets committed in `.env`, config or deployment files, and for secrets reaching logs or client-side bundles. Name the exact literal line; do not report a placeholder a reader can see is one without saying so.',
  },
  {
    key: 'injection',
    subject: 'injection and traversal',
    instruction: 'Look for SQL and NoSQL queries built by concatenation or interpolation, for `$where` and other server-side evaluation, for `eval`, `new Function` and string-bodied timers, for shell commands built from request data, for template injection, for unescaped HTML sinks, and for filesystem paths built from request data. Name the sink line, and say in `evidence` what reaches it.',
  },
  {
    key: 'access',
    subject: 'authentication, session handling and authorization',
    instruction: 'Look for routes that change or read data without an authentication or authorization check, for direct object references taken from the request, for session configuration that does not regenerate or expire, for missing CSRF protection on state-changing routes, and for privilege changes a user can request for themselves. Name the route line that is missing the check.',
  },
  {
    key: 'data',
    subject: 'sensitive data exposure, logging and cryptography',
    instruction: 'Look for personal data, credentials or tokens written to logs or error responses, for cleartext transport, for password storage that is not a memory-hard or iterated hash, for broken hashes and ciphers, and for secrets or personal data returned to the client. Name the line that discloses or weakly protects the data.',
  },
  {
    key: 'dependencies',
    subject: 'vulnerable and outdated dependencies',
    instruction: 'Read the manifest and, when a lockfile is present, run `npm audit --json` in the target and read what it reports. Report the declared version and the advisory identifier — the GHSA or CVE — for each vulnerable package. `file` and `line` are the manifest line that declares the dependency, and `snippet` is that line. When the audit cannot reach the registry, say so in your report section and fall back to the declared versions.',
  },
  {
    key: 'platform',
    subject: 'security misconfiguration and the web platform',
    instruction: 'Look for missing or weak security headers, permissive CORS, cookies without `httpOnly`, `secure` or `sameSite`, error handlers that return stack traces, missing rate limiting on authentication routes, debug or development settings left enabled, and client-side code that trusts the URL or the DOM. Name the configuration line.',
  },
]

/**
 * The generalist department: one reviewer across the whole application and
 * every defect class, run beside the six specialists rather than in their
 * place. `.agents/notes/proposed/architecture/2026-09-22-code-safety-generalist-department.md`
 * owns why: a three-tier comparison on NodeGoat found a single whole-repository
 * pass catching issues the six specialists missed, on a small application
 * where one reviewer can hold the whole tree in context.
 */
export const GENERALIST_DEPARTMENT: Department = {
  key: 'generalist',
  subject: 'the whole application, end to end, across every defect class',
  instruction: 'Read the whole application end to end — every route, every data access path, every configuration file, and the client-side code — rather than one subject at a time. Report a defect of any class: injection, broken access control, exposed secrets, weak cryptography or logging, a vulnerable dependency, a platform misconfiguration, or anything none of those name. Name the exact file and line for each one, and say in `evidence` what you traced from source to sink. A defect a specialist department would already name from its own subject is not worth a second report; spend your reading on what a single subject would not have surfaced.',
}

/** Every department this fixture can run, specialists first. */
export const ALL_DEPARTMENTS: readonly Department[] = [...SPECIALIST_DEPARTMENTS, GENERALIST_DEPARTMENT]

/** Department keys a run includes when `DSH_CODE_SAFETY_DEPARTMENTS` is unset. */
export const DEFAULT_DEPARTMENT_KEYS: readonly string[] = SPECIALIST_DEPARTMENTS.map(department => department.key)

/**
 * Resolve which departments one run includes.
 * @param requested - `DSH_CODE_SAFETY_DEPARTMENTS`'s raw value: a comma-separated
 *   list of department keys, or `undefined` for the default six specialists.
 * @returns the resolved departments, in the order named (or the default order).
 * @throws when the value names no department, repeats one, or names a key no department declares.
 */
export function resolveDepartments(requested: string | undefined): readonly Department[] {
  const keys = requested === undefined
    ? DEFAULT_DEPARTMENT_KEYS
    : requested.split(',').map(key => key.trim()).filter(key => key !== '')
  if (keys.length === 0) {
    throw new Error(`DSH_CODE_SAFETY_DEPARTMENTS names no department; expected a comma-separated list from ${ALL_DEPARTMENTS.map(department => department.key).join(', ')}`)
  }
  const seen = new Set<string>()
  return keys.map((key) => {
    if (seen.has(key)) throw new Error(`DSH_CODE_SAFETY_DEPARTMENTS names ${key} twice`)
    seen.add(key)
    const found = ALL_DEPARTMENTS.find(department => department.key === key)
    if (found === undefined) {
      throw new Error(`DSH_CODE_SAFETY_DEPARTMENTS names an unknown department "${key}"; known departments are ${ALL_DEPARTMENTS.map(department => department.key).join(', ')}`)
    }
    return found
  })
}
