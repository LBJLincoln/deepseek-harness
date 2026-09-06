/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * Each builder expresses the policy's denied read roots in its own dialect: an
 * empty tmpfs mounted over each root under bwrap, a grant list carved around
 * them under Landlock (whose rulesets are allow-lists with no deny form), and a
 * trailing deny clause under Seatbelt (whose later forms outrank earlier ones).
 *
 * @module @deepseek-ai/dsh-sandbox-local/profiles
 */

import { readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-landlock-run'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

/**
 * Build the bwrap profile arguments for one file-effect policy. Denied roots
 * come last: bwrap applies filesystem operations in argv order, so an empty
 * tmpfs mounted after the read-only root bind (and after any workspace bind
 * containing it) is what the confined process sees at that path.
 * @param policy - file-effect policy to express as bwrap mounts.
 * @returns profile arguments before the trailing separator and command argv.
 */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent']
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    args.push('--bind', policy.workspaceRoot, policy.workspaceRoot)
  }
  for (const denied of policy.deniedReadRoots) args.push('--tmpfs', denied)
  return args
}

/** List one directory's entries, treating an unreadable directory as empty. */
export type ReadDirectory = (path: string) => string[]

/** The default directory listing the Landlock carve-out walks. */
function listDirectory(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    // An unreadable or missing directory contributes no siblings to grant; the
    // carve-out then grants nothing at that level, which denies rather than
    // over-grants.
    return []
  }
}

/**
 * Grant `root` minus every denied directory beneath it, as the allow-list a
 * Landlock ruleset can express. Landlock has no deny rule and no rule removal,
 * so a denied descendant is excluded by granting its siblings at each level
 * between `root` and it instead of granting `root` itself.
 *
 * A denied root that IS `root`, or an ancestor of it, removes the grant
 * entirely. A denied root outside `root` leaves it whole.
 * @param root - the directory the policy grants.
 * @param denied - every denied directory, absolute and canonical.
 * @param readDirectory - directory listing, injected for tests.
 * @returns the roots to grant in place of `root`, deepest level last.
 */
export function carveGrant(root: string, denied: readonly string[], readDirectory: ReadDirectory): string[] {
  const inside = denied.filter(path => contains(root, path))
  if (inside.length === 0) return [root]
  if (inside.some(path => path === root)) return []
  // Each level between the granted root and a denied descendant contributes the
  // siblings that do not lead to any denied root; the level's own leading entry
  // is walked instead of granted.
  const grants = new Set<string>()
  const walked = new Set<string>()
  for (const path of inside) {
    for (const parent of ancestorsWithin(root, path)) {
      if (walked.has(parent)) continue
      walked.add(parent)
      for (const entry of readDirectory(parent)) {
        const child = join(parent, entry)
        // A child that leads to (or is) a denied root is walked at the next
        // level instead of granted; everything else at this level is granted whole.
        if (denied.some(deniedRoot => contains(child, deniedRoot))) continue
        grants.add(child)
      }
    }
  }
  return [...grants].sort()
}

/** Whether `child` is `parent` or lies beneath it, decided on already-canonical absolute paths. */
function contains(parent: string, child: string): boolean {
  if (parent === child) return true
  const rest = relative(parent, child)
  // `relative` answers a `..`-prefixed path for a sibling and an ABSOLUTE path
  // across Windows drives; neither is containment.
  return rest.length > 0 && !rest.startsWith('..') && !isAbsolute(rest)
}

/** Every directory from `root` down to `path`'s parent, inclusive, outermost first. */
function ancestorsWithin(root: string, path: string): string[] {
  const chain: string[] = []
  for (let current = dirname(path); contains(root, current); current = dirname(current)) {
    chain.unshift(current)
    if (current === root) break
  }
  return chain
}

/**
 * Build the Landlock launcher grants for one file-effect policy. Every grant is
 * carved around the policy's denied roots, because a ruleset is an allow-list:
 * a later rule can only ADD access, so a denied directory must never fall
 * inside a granted one.
 * @param policy - file-effect policy to express as Landlock allow-list grants.
 * @param readDirectory - directory listing the carve-out walks, injected for tests.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
export function landlockProfileArgs(policy: SandboxPolicy, readDirectory: ReadDirectory = listDirectory): string[] {
  const denied = policy.deniedReadRoots
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', policy.workspaceRoot)
  }
  return landlockGrantArgs({
    readOnly: carveGrant('/', denied, readDirectory),
    readWrite: readWrite.flatMap(root => carveGrant(root, denied, readDirectory)),
  })
}

/** Quote one path as an SBPL string literal. */
function sbplString(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

/**
 * Build the sandbox-exec arguments and SBPL profile for one policy. The
 * writable roots come from the shared {@link writableRoots} helper (canonical,
 * deduplicated) so the Seatbelt grant and the in-process fs fence
 * (`@deepseek-ai/dsh-fs-sandbox`) can never drift apart. The read denial is the
 * profile's last form: SBPL evaluates forms in order and the last match wins, so
 * a deny placed after `(allow default)` and after the write grants governs even
 * a denied directory inside the workspace.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProfileArgs(policy: SandboxPolicy): string[] {
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  const roots = writableRoots(policy)
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  }
  for (const denied of policy.deniedReadRoots) {
    forms.push(`(deny file-read* (subpath ${sbplString(denied)}))`)
  }
  return ['-p', forms.join(' ')]
}
