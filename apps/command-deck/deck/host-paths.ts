/**
 * Absolute paths of the machine that recorded a run, replaced before the run's
 * text is published.
 *
 * The feed folds session logs whose tool results and certificates quote the
 * recording machine's own paths: the operator's home directory, the
 * repository checkout, an agent's scratchpad, the directory the reviewed
 * targets were cloned into. None of them means anything to a viewer, and each
 * names the operator's machine, so the fold and the fixture snapshot replace
 * them with a placeholder naming what the directory was. The rules run in
 * order, most specific first; a path cut short by a length cap still loses
 * its host prefix to the general rules at the end.
 */

/** One path segment: anything up to a slash, whitespace, a quote, a backtick or a JSON escape. */
const SEGMENT = String.raw`[^/\s"'\x60\\]+`

/**
 * A host path starts a path: nothing path-like stands right before it, or a
 * JSON escape (`\n`, `\r`, `\t`) does, as in a certificate folded to JSON text.
 */
const START = String.raw`(?:(?<=\\[nrt])|(?<![\w.~-]))`

/** A directory name ends where no further name character follows it. */
const END = String.raw`(?![\w.-])`

/** The rules, most specific first: the host prefix and the placeholder it becomes. */
const RULES: readonly (readonly [RegExp, string])[] = [
  // An agent's scratchpad: /tmp/claude-0/<project>/<session>/scratchpad.
  [new RegExp(String.raw`${START}/tmp/claude-0/${SEGMENT}/${SEGMENT}/scratchpad${END}`, 'g'), '<scratchpad>'],
  // Anything else under an agent's temporary tree, with its project and session directories.
  [new RegExp(String.raw`${START}/tmp/claude-0(?:/${SEGMENT}){0,2}`, 'g'), '<tmp>'],
  // A worktree of the repository, then the checkout itself.
  [new RegExp(String.raw`${START}/home/user/deepseek-harness/\.claude/worktrees/${SEGMENT}`, 'g'), '<repo>'],
  [new RegExp(String.raw`${START}/home/user/deepseek-harness${END}`, 'g'), '<repo>'],
  // The directories reviewed targets are cloned into.
  [new RegExp(String.raw`${START}/(?:home/user|root)/targets${END}`, 'g'), '<targets>'],
  // Any other path under a home directory.
  [new RegExp(String.raw`${START}/(?:home/user|root)${END}`, 'g'), '<home>'],
]

/**
 * Replace the recording machine's absolute paths in one text.
 * @param text - A folded event's detail, a review's report, or any other published string.
 * @returns The text with every host prefix replaced by its placeholder; the rest of each path is kept.
 */
export function hostlessText(text: string): string {
  let result = text
  for (const [pattern, placeholder] of RULES) result = result.replace(pattern, placeholder)
  return result
}

/**
 * Replace the recording machine's absolute paths in every string of a JSON value.
 * @param value - A payload about to be written as a fixture.
 * @returns A copy in which every string, and every object key, has passed through {@link hostlessText}.
 */
export function hostlessJson<T>(value: T): T {
  return scrub(value) as T
}

/**
 * The recursive walk behind {@link hostlessJson}.
 * @param value - Any JSON value.
 * @returns Its scrubbed copy.
 */
function scrub(value: unknown): unknown {
  if (typeof value === 'string') return hostlessText(value)
  if (Array.isArray(value)) return value.map(scrub)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [hostlessText(key), scrub(entry)]))
}
