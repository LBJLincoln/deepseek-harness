/**
 * The six code-safety departments, in the order the program starts them.
 *
 * Each charter line is the department's own opening directive, as the run logs
 * it: `code-safety department: <id> — <charter>`. Nothing here describes work
 * the departments do not do.
 *
 * The colours are the palette's `departmentColor`, which the process lanes read
 * too, so a department is one colour in the pipeline and on the code city.
 */

import { departmentColor } from '@/deck/palette'

/** One department: what it is called, what it reads for, and the colour it acts in. */
export interface DepartmentCharter {
  id: string
  name: string
  /** What the department reads the target's code for. */
  charter: string
  color: string
}

/**
 * Tint for an act the roster does not attribute to one department — the program
 * lead's own reads, and any agent whose id names no department.
 */
const NEUTRAL_TOUCH = '#93a7c9'

/**
 * One department entry, coloured from the palette.
 * @param id - Department id.
 * @param name - Display name.
 * @param charter - What the department reads the target's code for.
 * @returns The entry.
 */
function department(id: string, name: string, charter: string): DepartmentCharter {
  return { id, name, charter, color: departmentColor(id) ?? NEUTRAL_TOUCH }
}

/** The six departments of a code-safety review, in start order. */
export const DEPARTMENT_CHARTERS: readonly DepartmentCharter[] = [
  department('secrets', 'Secrets', 'Hard-coded credentials and leaked configuration'),
  department('injection', 'Injection', 'Injection and traversal'),
  department('access', 'Access', 'Authentication, session handling and authorization'),
  department('data', 'Data', 'Sensitive data exposure, logging and cryptography'),
  department('dependencies', 'Dependencies', 'Vulnerable and outdated dependencies'),
  department('platform', 'Platform', 'Security misconfiguration and the web platform'),
]

const BY_ID = new Map(DEPARTMENT_CHARTERS.map(entry => [entry.id, entry]))

/**
 * The department one agent acts for.
 *
 * A code-safety seat is `code-safety-<department>-integrator`; the integration
 * session acts as `code-safety-lead`, which owns no department.
 * @param agentId - The acting agent's roster id.
 * @returns The department, or `undefined` when the id names none.
 */
function charterOfAgent(agentId: string): DepartmentCharter | undefined {
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
