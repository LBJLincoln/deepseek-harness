/**
 * The forms an acceptance command of the enterprise ticket queue may take.
 *
 * A ticket's acceptance commands are written by a model at intake and run with
 * `bash -c` as checks: in the department's worktree, over the program's
 * merged head, and in the engine's recertification in the clone's own
 * checkout, which is where the shift pushes from. A command is accepted only
 * when it parses as commands joined by `&&`, `||` and `|`, each optionally
 * negated with a leading `!`, whose every command is one of these forms:
 *
 * - `pnpm run <script> …` for a root script the queue names;
 * - `pnpm exec vitest run …` and `pnpm exec tsc …`;
 * - `grep …` and `test …`;
 * - `git diff …` without `--output`, `--ext-diff` or `--textconv`;
 * - for a queue that allows it, `node <file> …` and `sh <file> …` over a
 *   repository file.
 *
 * Every word is literal: no expansion (`$`, backquote, `~`, globbing, brace
 * expansion), no redirection, no subshell, no `;` or `&`, no comment, no line
 * break; and none names a path outside the checkout (an absolute path or a
 * `..` segment). The forms bound the command line a ticket makes the engine
 * run; the repository code a form runs — a test file, a root script — is the
 * checkout's, which a department may have changed inside its scope.
 */

/** What one queue admits as an acceptance command. */
export interface AcceptanceForms {
  /** Root scripts `pnpm run` may name exactly. */
  readonly rootScripts: readonly string[]
  /** Name prefixes of further root scripts `pnpm run` may name. */
  readonly rootScriptPrefixes: readonly string[]
  /** Whether `node <file>` and `sh <file>` may run a repository file. */
  readonly repositoryFiles: boolean
}

/**
 * This repository's forms: its gates by name — the typecheck, the
 * documentation gates, the linter, the snapshot replay and every `verify-*`
 * check — and no direct run of a repository file.
 */
export const HARNESS_ACCEPTANCE_FORMS: AcceptanceForms = {
  rootScripts: ['typecheck', 'doc-sync', 'lint', 'test:snapshot'],
  rootScriptPrefixes: ['verify-'],
  repositoryFiles: false,
}

/**
 * The forms of a repository without this one's root scripts: no `pnpm run`
 * script, and a repository file run directly with `node` or `sh`.
 */
export const OPEN_ACCEPTANCE_FORMS: AcceptanceForms = {
  rootScripts: [],
  rootScriptPrefixes: [],
  repositoryFiles: true,
}

/** One lexical unit of a command line: a literal word, an operator, or the negation `!`. */
type Token =
  | { readonly kind: 'word'; readonly text: string }
  | { readonly kind: 'operator'; readonly text: '&&' | '||' | '|' }
  | { readonly kind: 'bang' }

/** Characters that change what bash runs or reads when they stand outside quotes. */
const UNQUOTED_SPECIAL: ReadonlyMap<string, string> = new Map([
  [';', 'a command separator `;`'],
  ['&', 'a background `&`'],
  ['>', 'a redirection'],
  ['<', 'a redirection'],
  ['(', 'a subshell'],
  [')', 'a subshell'],
  ['`', 'command substitution'],
  ['{', 'brace expansion'],
  ['}', 'brace expansion'],
  ['*', 'a glob'],
  ['?', 'a glob'],
  ['[', 'a glob'],
  ['~', 'tilde expansion'],
  ['#', 'a comment'],
])

/** Git diff options that write a file or run a configured program. */
const GIT_DIFF_REFUSED = ['--output', '--ext-diff', '--textconv']

/** What the `$` at one index of a command line opens. */
function expansion(run: string, index: number): string {
  return run[index + 1] === '(' ? 'command substitution `$(…)`' : 'an expansion `$`'
}

/** The result of splitting a command line: its tokens, or why it cannot be accepted. */
type Lexed = { readonly tokens: readonly Token[] } | { readonly refused: string }

/**
 * Split a command line into literal words and operators the way bash would,
 * refusing every construct that is not a literal word or one of `&&`, `||`,
 * `|` and a standalone `!`.
 */
function lex(run: string): Lexed {
  const tokens: Token[] = []
  let word: string | undefined
  const end = (): void => {
    if (word === undefined) return
    tokens.push(word === '!' && tokens.at(-1)?.kind !== 'word' ? { kind: 'bang' } : { kind: 'word', text: word })
    word = undefined
  }
  for (let index = 0; index < run.length; index += 1) {
    const char = run[index] ?? ''
    if (char === '\n' || char === '\r') return { refused: 'a line break' }
    if (char === ' ' || char === '\t') {
      end()
      continue
    }
    if (char === "'") {
      const close = run.indexOf("'", index + 1)
      if (close === -1) return { refused: 'an unterminated quote' }
      word = (word ?? '') + run.slice(index + 1, close)
      index = close
      continue
    }
    if (char === '"') {
      let text = ''
      let closed = false
      for (index += 1; index < run.length; index += 1) {
        const inner = run[index] ?? ''
        if (inner === '"') {
          closed = true
          break
        }
        if (inner === '$') return { refused: expansion(run, index) }
        if (inner === '`') return { refused: 'command substitution' }
        if (inner === '\\' && '$`"\\'.includes(run[index + 1] ?? '')) {
          index += 1
          text += run[index] ?? ''
          continue
        }
        text += inner
      }
      if (!closed) return { refused: 'an unterminated quote' }
      word = (word ?? '') + text
      continue
    }
    if (char === '\\') {
      const next = run[index + 1]
      if (next === undefined) return { refused: 'a trailing backslash' }
      word = (word ?? '') + next
      index += 1
      continue
    }
    if (char === '&' && run[index + 1] === '&') {
      end()
      tokens.push({ kind: 'operator', text: '&&' })
      index += 1
      continue
    }
    if (char === '|') {
      end()
      const double = run[index + 1] === '|'
      if (run[index + 1] === '&') return { refused: 'a pipe of both streams `|&`' }
      tokens.push({ kind: 'operator', text: double ? '||' : '|' })
      if (double) index += 1
      continue
    }
    if (char === '$') return { refused: expansion(run, index) }
    const special = UNQUOTED_SPECIAL.get(char)
    if (special !== undefined) return { refused: special }
    word = (word ?? '') + char
  }
  end()
  return { tokens }
}

/** Why one word names a path outside the checkout, or `undefined` when it does not. */
function outsideCheckout(word: string): string | undefined {
  for (const part of word.split('=')) {
    if (part.startsWith('/')) return `the absolute path ${JSON.stringify(part)}`
    if (part.split('/').includes('..')) return `the parent path ${JSON.stringify(part)}`
  }
  return undefined
}

/** Why a word is not a repository file a command may run, or `undefined` when it is one. */
function notAFile(word: string | undefined, program: string): string | undefined {
  if (word === undefined || word === '' || word.startsWith('-')) return `\`${program}\` runs only a repository file named as its first word`
  return undefined
}

/**
 * Why one command, as its literal words, is not an allowed form.
 * @returns the reason, or `undefined` for an allowed command.
 */
function commandRefusal(argv: readonly string[], forms: AcceptanceForms): string | undefined {
  const [program, first, second, third] = argv
  switch (program) {
    case 'grep':
    case 'test':
      return undefined
    case 'git':
      if (first !== 'diff') return `\`git ${first ?? ''}\` is not an allowed acceptance command; only \`git diff\` is`
      return argv.slice(2).some(word => GIT_DIFF_REFUSED.some(option => word.startsWith(option)))
        ? `\`git diff\` may not take ${GIT_DIFF_REFUSED.join(', ')}`
        : undefined
    case 'pnpm':
      if (first === 'run') {
        const named = second !== undefined
          && (forms.rootScripts.includes(second) || forms.rootScriptPrefixes.some(prefix => second.startsWith(prefix)))
        if (named) return undefined
        return `\`pnpm run ${second ?? ''}\` names no allowed root script`
      }
      if (first === 'exec' && ((second === 'vitest' && third === 'run') || second === 'tsc')) return undefined
      return `\`pnpm ${[first, second].filter(word => word !== undefined).join(' ')}\` is not an allowed form; \`pnpm exec\` runs only \`vitest run\` and \`tsc\``
    case 'node':
    case 'sh':
      if (!forms.repositoryFiles) return `\`${program}\` is not an allowed acceptance command in this queue`
      return notAFile(first, program)
    default:
      return `\`${program ?? ''}\` is not an allowed acceptance command`
  }
}

/**
 * Why one acceptance command is not among a queue's forms.
 * @param run - the command line as the ticket carries it.
 * @param forms - the queue's forms.
 * @returns the reason, or `undefined` when the command is allowed.
 */
export function acceptanceRefusal(run: string, forms: AcceptanceForms): string | undefined {
  const lexed = lex(run)
  if ('refused' in lexed) return `${lexed.refused} is not allowed`
  const commands: string[][] = [[]]
  let expectCommand = true
  for (const token of lexed.tokens) {
    if (token.kind === 'bang') {
      if (!expectCommand || (commands.at(-1)?.length ?? 0) > 0) return 'a `!` may only open a command'
      continue
    }
    if (token.kind === 'operator') {
      if ((commands.at(-1)?.length ?? 0) === 0) return `\`${token.text}\` follows no command`
      commands.push([])
      expectCommand = token.text !== '|'
      continue
    }
    const outside = outsideCheckout(token.text)
    if (outside !== undefined) return `${outside} is not allowed`
    commands.at(-1)?.push(token.text)
  }
  if ((commands.at(-1)?.length ?? 0) === 0) return 'the command line ends without a command'
  for (const argv of commands) {
    const refused = commandRefusal(argv, forms)
    if (refused !== undefined) return refused
  }
  return undefined
}

/**
 * The first acceptance command of a ticket that is not among a queue's forms.
 * @param acceptance - the ticket's acceptance commands.
 * @param forms - the queue's forms.
 * @returns `<check id>: <reason>`, or `undefined` when every command is allowed.
 */
export function ticketAcceptanceRefusal(
  acceptance: readonly { readonly id: string; readonly run: string }[],
  forms: AcceptanceForms,
): string | undefined {
  for (const check of acceptance) {
    const refused = acceptanceRefusal(check.run, forms)
    if (refused !== undefined) return `${check.id}: ${refused}`
  }
  return undefined
}
