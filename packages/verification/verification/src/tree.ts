/**
 * The workspace-tree digest a recorded run states and an auditor reproduces.
 *
 * It lives beside the case comparators because it is the same comparison at a
 * different scale: `tree` compares one case's scope, `treeHash` on a
 * `verification/run` states the whole workspace the run measured. One home
 * keeps the executor that records a digest and the consumer that re-derives it
 * from disagreeing over path spelling, sort order, or normalization.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { normalizeCaseBytes } from './cases.ts'
import type { CheckCaseNormalizer } from './types.ts'

/**
 * SHA-256 over every regular file under a directory: relative POSIX path, then
 * bytes, in sorted path order, each field NUL-terminated. Directory entries
 * themselves are not digested, so an empty directory is invisible to the
 * comparison. Normalizers are applied to each file's bytes before they are
 * digested, in the order given.
 * @param root - absolute directory to digest.
 * @param normalizers - byte normalizers applied to every file, in order; none by default.
 * @returns the hex digest.
 */
export async function hashWorkspaceTree(
  root: string,
  normalizers: readonly CheckCaseNormalizer[] = [],
): Promise<string> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files = entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(relative(root, file).split(sep).join('/')).update('\0')
      .update(normalizeCaseBytes(await readFile(file), normalizers)).update('\0')
  }
  return hash.digest('hex')
}
