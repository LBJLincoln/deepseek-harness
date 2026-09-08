/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * Each builder expresses the policy's denied read roots in its own dialect: an
 * empty tmpfs mounted over each root under bwrap, a grant list carved around
 * them under Landlock (whose rulesets are allow-lists with no deny form), and a
 * trailing deny clause under Seatbelt (whose later forms outrank earlier ones).
 * Each also expresses the policy's granted read root in that dialect, which is
 * what {@link partitionDenied} orders the denied roots for.
 *
 * @module @deepseek-ai/dsh-sandbox-local/profiles
 */

import { readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-landlock-run'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

/**
 * The policy's denied roots split by what the granted read root outranks, in the
 * order every dialect applies them.
 */
export interface DeniedPartition {
  /** Denied roots the granted root lies strictly beneath; the grant is restored after them. */
  readonly aboveGrant: readonly string[]
  /** Every other denied root, applied after the grant so it outranks the grant in turn. */
  readonly rest: readonly string[]
  /** The granted root to restore between the two, absent when no denied root is above it. */
  readonly grant?: string
}

/**
 * Order one policy's denied roots around its granted root. A dialect applies
 * `aboveGrant`, restores `grant`, then applies `rest`, so the last expression
 * wins in each dialect's own ordering rule: the workspace survives an ancestor's
 * denial, and a denied root that IS the workspace or lies inside it survives the
 * grant.
 * @param policy - the file-effect policy carrying both halves.
 * @returns the two groups and the grant to restore between them.
 */
export function partitionDenied(policy: SandboxPolicy): DeniedPartition {
  const granted = policy.grantedReadRoot
  const aboveGrant: string[] = []
  const rest: string[] = []
  for (const denied of policy.deniedReadRoots) {
    // Strict ancestry: a denial of the workspace itself grants nothing back.
    const above = granted !== undefined && denied !== granted && contains(denied, granted)
    ;(above ? aboveGrant : rest).push(denied)
  }
  return { aboveGrant, rest, ...aboveGrant.length === 0 || granted === undefined ? {} : { grant: granted } }
}

/**
 * Build the bwrap profile arguments for one file-effect policy. Denied roots
 * come last: bwrap applies filesystem operations in argv order, so an empty
 * tmpfs mounted after the read-only root bind (and after any workspace bind
 * containing it) is what the confined process sees at that path. A granted root
 * beneath one of those tmpfs mounts is bound back from the host between the two
 * denied groups, so the tmpfs over a denied root inside it still governs.
 * @param policy - file-effect policy to express as bwrap mounts.
 * @returns profile arguments before the trailing separator and command argv.
 */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent']
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    args.push('--bind', policy.workspaceRoot, policy.workspaceRoot)
  }
  const { aboveGrant, rest, grant } = partitionDenied(policy)
  for (const denied of aboveGrant) args.push('--tmpfs', denied)
  if (grant !== undefined) {
    // The workspace is writable only where the mode already promises it; every
    // other granted root comes back read-only.
    const bind = policy.mode === 'workspace-write' && grant === policy.workspaceRoot ? '--bind' : '--ro-bind'
    args.push(bind, grant, grant)
  }
  for (const denied of rest) args.push('--tmpfs', denied)
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
 * A denied root that IS `root` removes the grant entirely. A denied root ABOVE
 * `root` binds nothing here and leaves it whole: whichever wider grant contains
 * that ancestor carved it out already, and granting `root` back is how an
 * allow-list expresses that the workspace outranks its ancestor's denial.
 * @param root - the directory the policy grants.
 * @param denied - every denied directory, absolute and canonical.
 * @param readDirectory - directory listing, injected for tests.
 * @returns the roots to grant in place of `root`, deepest level last.
 */
export function carveGrant(root: string, denied: readonly string[], readDirectory: ReadDirectory): string[] {
  const binding = denied.filter(path => !(path !== root && contains(path, root)))
  const inside = binding.filter(path => contains(root, path))
  if (inside.length === 0) return [root]
  if (inside.some(path => path === root)) return []
  // Each level between the granted root and a denied descendant contributes the
  // siblings that neither lead to nor lie inside a denied root; the level's own
  // leading entry is walked instead of granted.
  const grants = new Set<string>()
  const walked = new Set<string>()
  for (const path of inside) {
    for (const parent of ancestorsWithin(root, path)) {
      if (walked.has(parent)) continue
      walked.add(parent)
      for (const entry of readDirectory(parent)) {
        const child = join(parent, entry)
        // A child that leads to a denied root is walked at the next level; one
        // that lies inside a denied root is left out, so walking past a denied
        // level towards a deeper denied root cannot grant its siblings back.
        if (binding.some(deniedRoot => contains(child, deniedRoot) || contains(deniedRoot, child))) continue
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
 * inside a granted one. The granted read root is added as its own read grant
 * whenever a denied root is above it — the carve-out of `/` excluded it with the
 * rest of that ancestor's subtree — and is itself carved, so a denied root
 * inside it stays outside every rule.
 * @param policy - file-effect policy to express as Landlock allow-list grants.
 * @param readDirectory - directory listing the carve-out walks, injected for tests.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
export function landlockProfileArgs(policy: SandboxPolicy, readDirectory: ReadDirectory = listDirectory): string[] {
  const denied = policy.deniedReadRoots
  const grant = partitionDenied(policy).grant
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', policy.workspaceRoot)
  }
  return landlockGrantArgs({
    readOnly: [
      ...carveGrant('/', denied, readDirectory),
      ...grant === undefined ? [] : carveGrant(grant, denied, readDirectory),
    ],
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
 * (`@deepseek-ai/dsh-fs-sandbox`) can never drift apart. The read denials are the
 * profile's last forms: SBPL evaluates forms in order and the last match wins, so
 * a deny placed after `(allow default)` and after the write grants governs even
 * a denied directory inside the workspace. The granted read root is allowed back
 * between the denials of the roots above it and every other denial, which leaves
 * it readable while a denied directory inside it stays denied.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProfileArgs(policy: SandboxPolicy): string[] {
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  const roots = writableRoots(policy)
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  }
  const { aboveGrant, rest, grant } = partitionDenied(policy)
  for (const denied of aboveGrant) forms.push(`(deny file-read* (subpath ${sbplString(denied)}))`)
  if (grant !== undefined) forms.push(`(allow file-read* (subpath ${sbplString(grant)}))`)
  for (const denied of rest) forms.push(`(deny file-read* (subpath ${sbplString(denied)}))`)
  return ['-p', forms.join(' ')]
}
