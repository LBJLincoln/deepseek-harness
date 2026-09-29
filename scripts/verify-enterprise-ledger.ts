/**
 * The enterprise ledger's append-only gate.
 *
 * `pnpm run verify-enterprise-ledger -- --base <rev> [--head <rev>]` walks
 * every commit in `base..head` whose `data/enterprise/ledger.jsonl` differs
 * from one of its parents and checks four rules:
 *
 * - **Append-only.** A commit with one parent keeps the parent's lines as a
 *   prefix of its own: nothing inserted before the end, deleted or changed.
 * - **Merges keep both sides.** A merge commit keeps each parent's lines as a
 *   subsequence of its own, the way the `merge=union` driver joins them.
 * - **Added lines parse.** Every line a commit adds reads under the ledger
 *   schema (`parseLedgerLine` in `scripts/enterprise-ledger.ts`).
 * - **References are on the branch.** Every commit an added line names
 *   (`commitReferences`) is a full object id that exists and is an ancestor of
 *   the commit that added the line, so a line cannot cite work the branch
 *   does not carry, such as a clone's commit that a rebase replaced before
 *   the push.
 *
 * `base` must itself be an ancestor of `head`; a range that does not satisfy
 * this is a rewritten branch and fails. Without `--base`, the base is
 * `DSH_LEDGER_BASE_REF`; when that is empty too the gate checks only that
 * every line of the head's ledger parses, and says so. Branch CI passes the
 * push's `github.event.before`.
 *
 * @module verify-enterprise-ledger
 */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { commitReferences, LEDGER_PATH, parseLedgerLine } from './enterprise-ledger.ts'

/** What one violation broke. */
export type LedgerViolationKind =
  | 'base-not-ancestor'
  | 'not-append'
  | 'merge-dropped'
  | 'unparsed'
  | 'reference-malformed'
  | 'reference-missing'
  | 'reference-not-ancestor'

/** One broken rule, at the commit that broke it. */
export interface LedgerViolation {
  kind: LedgerViolationKind
  /** The commit that broke the rule; the head for `base-not-ancestor`. */
  commit: string
  /** One-based line number in that commit's ledger, when one line is at fault. */
  line?: number
  detail: string
}

/** What one run of the gate found. */
export interface LedgerVerification {
  base: string
  head: string
  /** Commits in the range whose ledger differs from a parent's. */
  commits: string[]
  /** Lines those commits added. */
  added: number
  violations: LedgerViolation[]
}

/** The git reads the gate needs, so a spec can point it at any repository. */
export interface LedgerGit {
  /** @returns the full id of `rev`'s commit, or `undefined` when it names none. */
  commit(rev: string): string | undefined
  /** @returns whether `ancestor` is `descendant` or one of its ancestors. */
  isAncestor(ancestor: string, descendant: string): boolean
  /** @returns every commit in `base..head` with its parents, parents first. */
  range(base: string, head: string): { commit: string; parents: string[] }[]
  /** @returns the ledger's text at each commit, `undefined` where the file is absent. */
  ledgerAt(commits: readonly string[], path: string): Map<string, string | undefined>
}

const FULL_ID = /^[0-9a-f]{40}$/

/**
 * Split a ledger's text into its lines; the final newline ends the last line.
 * @param text - the file's text; `undefined` for an absent file.
 * @returns the lines, without their newlines.
 */
export function ledgerRows(text: string | undefined): string[] {
  if (text === undefined || text === '') return []
  const rows = text.split('\n')
  if (rows.at(-1) === '') rows.pop()
  return rows
}

/**
 * Greedily match `parent` as a subsequence of `child`.
 * @param parent - the lines that must all appear, in order.
 * @param child - the lines to find them in.
 * @returns the child index of every parent line, or `undefined` when one is missing.
 */
export function subsequenceIndexes(parent: readonly string[], child: readonly string[]): number[] | undefined {
  const indexes: number[] = []
  let at = 0
  for (const row of parent) {
    while (at < child.length && child[at] !== row) at += 1
    if (at === child.length) return undefined
    indexes.push(at)
    at += 1
  }
  return indexes
}

/**
 * The child lines that also occur in the parent, each parent line matched once, in any order.
 * @param parent - the parent's lines.
 * @param child - the child's lines.
 * @returns the child indexes of the matched lines.
 */
function sharedIndexes(parent: readonly string[], child: readonly string[]): number[] {
  const counts = new Map<string, number>()
  for (const row of parent) counts.set(row, (counts.get(row) ?? 0) + 1)
  const indexes: number[] = []
  child.forEach((row, index) => {
    const count = counts.get(row) ?? 0
    if (count === 0) return
    counts.set(row, count - 1)
    indexes.push(index)
  })
  return indexes
}

/**
 * Describe how `child` fails to extend `parent` by appending.
 * @param parent - the parent's lines.
 * @param child - the child's lines.
 * @returns `undefined` when `parent` is a prefix of `child`, else the first differing line and what happened there.
 */
export function appendFailure(parent: readonly string[], child: readonly string[]): { line: number; detail: string } | undefined {
  const first = parent.findIndex((row, index) => child[index] !== row)
  if (first === -1) return undefined
  const kept = subsequenceIndexes(parent, child) !== undefined
  const shrunk = subsequenceIndexes(child, parent) !== undefined
  const what = kept
    ? `${child.length - parent.length} line(s) inserted before the end`
    : shrunk
      ? `${parent.length - child.length} line(s) deleted`
      : 'a line changed'
  return { line: first + 1, detail: `${what}; the parent's line ${first + 1} is not kept in place` }
}

function preview(row: string): string {
  return row.length > 120 ? `${row.slice(0, 117)}...` : row
}

/**
 * Check one added line: it parses, and every commit it names is an ancestor of the commit that added it.
 * @param git - the repository.
 * @param commit - the commit that added the line.
 * @param line - its one-based number in that commit's ledger.
 * @param row - the line's text.
 * @returns the violations; empty when the line holds.
 */
function checkAddedLine(git: LedgerGit, commit: string, line: number, row: string): LedgerViolation[] {
  let decoded: unknown
  try {
    decoded = JSON.parse(row)
  } catch {
    // Only JSON.parse is in the try: a row that is not JSON is the violation reported here.
    return [{ kind: 'unparsed', commit, line, detail: `not JSON: ${preview(row)}` }]
  }
  const parsed = parseLedgerLine(decoded)
  if (typeof parsed === 'string') return [{ kind: 'unparsed', commit, line, detail: `${parsed}: ${preview(row)}` }]
  const violations: LedgerViolation[] = []
  for (const reference of commitReferences(parsed)) {
    const named = `${reference.field} ${reference.commit}`
    if (!FULL_ID.test(reference.commit)) {
      violations.push({ kind: 'reference-malformed', commit, line, detail: `${named} is not a full 40-hex commit id` })
    } else if (git.commit(reference.commit) === undefined) {
      violations.push({ kind: 'reference-missing', commit, line, detail: `${named} is not a commit in this repository` })
    } else if (!git.isAncestor(reference.commit, commit)) {
      violations.push({ kind: 'reference-not-ancestor', commit, line, detail: `${named} is not an ancestor of the commit that added the line` })
    }
  }
  return violations
}

/**
 * Verify the ledger's history over `base..head`.
 * @param git - the repository.
 * @param base - the last commit already trusted; its ledger is not re-checked.
 * @param head - the newest commit to check.
 * @param path - the ledger's path in the tree.
 * @returns what the range holds and every violation, oldest commit first.
 * @throws when `base` or `head` names no commit.
 */
export function verifyLedgerHistory(git: LedgerGit, base: string, head: string, path: string = LEDGER_PATH): LedgerVerification {
  const baseId = git.commit(base)
  if (baseId === undefined) throw new Error(`the base ${JSON.stringify(base)} is not a commit in this repository`)
  const headId = git.commit(head)
  if (headId === undefined) throw new Error(`the head ${JSON.stringify(head)} is not a commit in this repository`)
  const result: LedgerVerification = { base: baseId, head: headId, commits: [], added: 0, violations: [] }
  if (!git.isAncestor(baseId, headId)) {
    result.violations.push({ kind: 'base-not-ancestor', commit: headId, detail: `the base ${baseId} is not an ancestor of the head: the branch was rewritten` })
    return result
  }
  const range = git.range(baseId, headId)
  const texts = git.ledgerAt([...new Set(range.flatMap(entry => [entry.commit, ...entry.parents]))], path)
  for (const { commit, parents } of range) {
    const text = texts.get(commit)
    if (parents.every(parent => texts.get(parent) === text)) continue
    result.commits.push(commit)
    const rows = ledgerRows(text)
    const inherited = new Set<number>()
    for (const parent of parents) {
      const parentRows = ledgerRows(texts.get(parent))
      const failure = parents.length === 1 ? appendFailure(parentRows, rows) : undefined
      const kept = failure === undefined ? subsequenceIndexes(parentRows, rows) : undefined
      if (kept !== undefined) {
        for (const index of kept) inherited.add(index)
        continue
      }
      result.violations.push(failure === undefined
        ? { kind: 'merge-dropped', commit, detail: `the merge does not keep every line of its parent ${parent} in order` }
        : { kind: 'not-append', commit, line: failure.line, detail: failure.detail })
      // Lines the parent already held are reported once, as this violation, not again as added lines.
      for (const index of sharedIndexes(parentRows, rows)) inherited.add(index)
    }
    rows.forEach((row, index) => {
      if (inherited.has(index)) return
      result.added += 1
      result.violations.push(...checkAddedLine(git, commit, index + 1, row))
    })
  }
  return result
}

/**
 * Check that every line of one ledger text parses.
 * @param text - the ledger's text.
 * @returns the line number and reason of every line that does not.
 */
export function unparsedRows(text: string | undefined): { line: number; detail: string }[] {
  const failures: { line: number; detail: string }[] = []
  ledgerRows(text).forEach((row, index) => {
    let decoded: unknown
    try {
      decoded = JSON.parse(row)
    } catch {
      // Only JSON.parse is in the try: a row that is not JSON is the failure recorded here.
      failures.push({ line: index + 1, detail: `not JSON: ${preview(row)}` })
      return
    }
    const parsed = parseLedgerLine(decoded)
    if (typeof parsed === 'string') failures.push({ line: index + 1, detail: parsed })
  })
  return failures
}

/**
 * The gate's git reads over one checkout.
 * @param root - the repository's working directory.
 * @returns the reads.
 */
export function repositoryGit(root: string): LedgerGit {
  const run = (args: readonly string[], input?: string): { status: number; stdout: string } => {
    try {
      return { status: 0, stdout: execFileSync('git', args, { cwd: root, encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }) }
    } catch (error: unknown) {
      // A non-zero git exit is an answer here (no such commit, not an ancestor); the caller reads the status.
      const status = (error as { status?: unknown }).status
      if (typeof status !== 'number') throw error
      return { status, stdout: '' }
    }
  }
  return {
    commit(rev) {
      const answer = run(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])
      return answer.status === 0 ? answer.stdout.trim() : undefined
    },
    isAncestor(ancestor, descendant) {
      return run(['merge-base', '--is-ancestor', ancestor, descendant]).status === 0
    },
    range(base, head) {
      const answer = run(['rev-list', '--reverse', '--topo-order', '--parents', `${base}..${head}`])
      return answer.stdout.split('\n').filter(row => row !== '').map((row) => {
        const [commit = '', ...parents] = row.split(' ')
        return { commit, parents }
      })
    },
    ledgerAt(commits, path) {
      const texts = new Map<string, string | undefined>()
      if (commits.length === 0) return texts
      const ids = run(['cat-file', '--batch-check=%(objectname) %(objecttype)'], commits.map(commit => `${commit}:${path}\n`).join('')).stdout.split('\n')
      const blobs = new Map<string, string>()
      commits.forEach((commit, index) => {
        const [id, type] = (ids[index] ?? '').split(' ')
        if (type !== 'blob' || id === undefined) {
          texts.set(commit, undefined)
          return
        }
        let blob = blobs.get(id)
        if (blob === undefined) {
          blob = run(['cat-file', 'blob', id]).stdout
          blobs.set(id, blob)
        }
        texts.set(commit, blob)
      })
      return texts
    },
  }
}

/** The gate's command line. */
interface GateArguments {
  base: string | undefined
  head: string
}

/**
 * Read the gate's arguments.
 * @param argv - the arguments after the script path.
 * @param env - the environment, for `DSH_LEDGER_BASE_REF`.
 * @returns the base (absent when neither the flag nor the variable names one) and the head.
 * @throws on an unknown flag or a flag without its value.
 */
export function parseGateArguments(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): GateArguments {
  let base: string | undefined
  let head = 'HEAD'
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--') continue
    const value = argv[index + 1]
    if (flag !== '--base' && flag !== '--head') throw new Error(`unknown argument ${JSON.stringify(flag)}; expected --base <rev> [--head <rev>]`)
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a revision`)
    if (flag === '--base') base = value
    else head = value
    index += 1
  }
  const fromEnv = env['DSH_LEDGER_BASE_REF']
  return { base: base ?? (fromEnv === undefined || fromEnv === '' ? undefined : fromEnv), head }
}

/**
 * Run the gate and print its findings.
 * @param root - the repository's working directory.
 * @param args - the parsed arguments.
 * @returns the process exit code: 0 when every rule holds.
 */
function runGate(root: string, args: GateArguments): number {
  const git = repositoryGit(root)
  if (args.base === undefined) {
    const head = git.commit(args.head)
    if (head === undefined) throw new Error(`the head ${JSON.stringify(args.head)} is not a commit in this repository`)
    const failures = unparsedRows(git.ledgerAt([head], LEDGER_PATH).get(head))
    console.log(`verify-enterprise-ledger: no base (neither --base nor DSH_LEDGER_BASE_REF), so no history is checked; every line of ${LEDGER_PATH} at ${head.slice(0, 12)} must parse.`)
    for (const failure of failures) console.error(`  line ${failure.line}: ${failure.detail}`)
    return failures.length === 0 ? 0 : 1
  }
  let result: LedgerVerification
  try {
    result = verifyLedgerHistory(git, args.base, args.head)
  } catch (error: unknown) {
    // Only an unknown base or head throws; a push that rewrote the branch leaves its previous tip out of a fresh clone.
    console.error(`verify-enterprise-ledger: ${error instanceof Error ? error.message : String(error)}; a base missing from a full clone is a tip the branch no longer carries.`)
    return 1
  }
  const range = `${result.base.slice(0, 12)}..${result.head.slice(0, 12)}`
  if (result.violations.length === 0) {
    console.log(`verify-enterprise-ledger: ${range}: ${result.commits.length} commit(s) changed ${LEDGER_PATH}, adding ${result.added} line(s); each appended, parsed and named only commits on its ancestry.`)
    return 0
  }
  console.error(`verify-enterprise-ledger: ${range}: ${result.violations.length} violation(s) in ${result.commits.length} commit(s) changing ${LEDGER_PATH}:`)
  for (const violation of result.violations) {
    console.error(`  ${violation.commit.slice(0, 12)} ${violation.kind}${violation.line === undefined ? '' : ` line ${violation.line}`}: ${violation.detail}`)
  }
  return 1
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  process.exitCode = runGate(resolve(import.meta.dirname, '..'), parseGateArguments(process.argv.slice(2), process.env))
}
