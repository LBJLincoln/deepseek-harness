/**
 * Which code-safety department owns a finding.
 *
 * The feed reports per-department totals but places no department on the
 * finding itself, so the table's department filter derives one from the CWE.
 * The table below is the deck's published rule: a CWE it does not name falls
 * to `platform`, which is the department that reads whatever the other five
 * do not claim.
 */

import type { Finding } from './contract.ts'

/** CWE identifiers each department owns. */
const OWNERSHIP: Record<string, readonly string[]> = {
  secrets: ['CWE-798', 'CWE-540', 'CWE-522', 'CWE-312'],
  injection: ['CWE-95', 'CWE-943', 'CWE-117', 'CWE-79', 'CWE-22', 'CWE-78', 'CWE-89', 'CWE-502'],
  access: ['CWE-204', 'CWE-521', 'CWE-1004', 'CWE-639', 'CWE-862', 'CWE-352', 'CWE-601', 'CWE-287'],
  data: ['CWE-256', 'CWE-311', 'CWE-319', 'CWE-532', 'CWE-359'],
  dependencies: ['CWE-1104', 'CWE-1395', 'CWE-937'],
  platform: ['CWE-16', 'CWE-918', 'CWE-1333', 'CWE-770', 'CWE-209', 'CWE-693'],
}

const BY_CWE = new Map<string, string>()
for (const [department, cwes] of Object.entries(OWNERSHIP)) {
  for (const cwe of cwes) BY_CWE.set(cwe, department)
}

/**
 * The department that owns one finding.
 * @param finding - The finding to attribute.
 * @returns The owning department id.
 */
export function departmentOf(finding: Finding): string {
  return BY_CWE.get(finding.cwe) ?? 'platform'
}
