/**
 * The six code-safety departments, in the order the program starts them.
 *
 * Each charter line is the department's own opening directive, as the run logs
 * it: `code-safety department: <id> — <charter>`. Nothing here describes work
 * the departments do not do.
 *
 * The colours are `divisionColor('code-safety')` rotated across the same 84°
 * hue band `deck/pipeline.ts` gives lanes that share one division, so a
 * department reads as one colour in the pipeline and on the code city. They are
 * written out rather than computed because the six departments are fixed.
 */

/** One department: what it is called, what it reads for, and the colour it acts in. */
export interface DepartmentCharter {
  id: string
  name: string
  /** What the department reads the target's code for. */
  charter: string
  color: string
}

/** The six departments of a code-safety review, in start order. */
export const DEPARTMENT_CHARTERS: readonly DepartmentCharter[] = [
  { id: 'secrets', name: 'Secrets', charter: 'Hard-coded credentials and leaked configuration', color: '#ff5ff6' },
  { id: 'injection', name: 'Injection', charter: 'Injection and traversal', color: '#ff5fc9' },
  { id: 'access', name: 'Access', charter: 'Authentication, session handling and authorization', color: '#ff5f9c' },
  { id: 'data', name: 'Data', charter: 'Sensitive data exposure, logging and cryptography', color: '#ff5f70' },
  { id: 'dependencies', name: 'Dependencies', charter: 'Vulnerable and outdated dependencies', color: '#ff7b5f' },
  { id: 'platform', name: 'Platform', charter: 'Security misconfiguration and the web platform', color: '#ffa85f' },
]

/**
 * Tint for an act the roster does not attribute to one department — the program
 * lead's own reads, and any agent whose id names no department.
 */
export const NEUTRAL_TOUCH = '#93a7c9'

const BY_ID = new Map(DEPARTMENT_CHARTERS.map(entry => [entry.id, entry]))

/**
 * The department one agent acts for.
 *
 * A code-safety seat is `code-safety-<department>-integrator`; the integration
 * session acts as `code-safety-lead`, which owns no department.
 * @param agentId - The acting agent's roster id.
 * @returns The department, or `undefined` when the id names none.
 */
export function charterOfAgent(agentId: string): DepartmentCharter | undefined {
  for (const segment of agentId.split('-')) {
    const charter = BY_ID.get(segment)
    if (charter !== undefined) return charter
  }
  return undefined
}

/**
 * The colour one agent's act is drawn in.
 * @param agentId - The acting agent's roster id.
 * @returns The department's colour, or {@link NEUTRAL_TOUCH}.
 */
export function touchColor(agentId: string): string {
  return charterOfAgent(agentId)?.color ?? NEUTRAL_TOUCH
}
