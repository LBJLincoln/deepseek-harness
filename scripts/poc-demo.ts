/**
 * One command for the demonstration machine: build the command deck, start
 * the harness feed, wait until it answers, then serve the deck's production
 * build against it. Both children share this process's terminal; Ctrl-C stops
 * both, and when either exits on its own the other is stopped and this
 * process exits with the same code.
 *
 *   pnpm run poc                       # feed on 4711, deck on 3000
 *   pnpm run poc -- --deck-port 3010   # the deck on another port
 *   pnpm run poc -- --no-build         # serve the build already under apps/command-deck/.next
 *
 * The feed's URL is compiled into the deck at build time (`NEXT_PUBLIC_FEED_URL`),
 * so a feed port other than the default forces a build even with `--no-build`.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** What the command line asked for. */
export interface PocDemoArgs {
  feedPort: number
  deckPort: number
  build: boolean
}

/** The feed port the deck's default build expects. */
const DEFAULT_FEED_PORT = 4711
/** The port `next start` serves the deck on unless told otherwise. */
const DEFAULT_DECK_PORT = 3000
/** How long to wait for the feed's first `GET /roster` before giving up. */
const FEED_READY_MS = 90_000

/**
 * Parse `--feed-port <n>`, `--deck-port <n>` and `--no-build`.
 * @param argv - Arguments after the script path.
 * @returns The resolved options.
 */
export function parsePocArgs(argv: readonly string[]): PocDemoArgs {
  let feedPort = DEFAULT_FEED_PORT
  let deckPort = DEFAULT_DECK_PORT
  let build = true
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    // `pnpm run poc -- --no-build` forwards the separator itself.
    if (arg === '--') continue
    if (arg === '--feed-port' && next !== undefined) {
      feedPort = Number(next)
      i += 1
    } else if (arg === '--deck-port' && next !== undefined) {
      deckPort = Number(next)
      i += 1
    } else if (arg === '--no-build') {
      build = false
    } else {
      throw new Error(`poc-demo: unknown argument "${arg}"; expected --feed-port <n>, --deck-port <n>, --no-build`)
    }
  }
  for (const [name, port] of [['--feed-port', feedPort], ['--deck-port', deckPort]] as const) {
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error(`poc-demo: ${name} must be a port number, got "${port}"`)
  }
  // The deck only knows the feed's URL from its build, so any other port needs one.
  if (feedPort !== DEFAULT_FEED_PORT) build = true
  return { feedPort, deckPort, build }
}

/**
 * Poll the feed until `GET /roster` answers 200.
 * @param url - The feed's base URL.
 * @param deadlineMs - How long to keep polling.
 * @returns Resolves when the feed answers; rejects at the deadline.
 */
async function waitForFeed(url: string, deadlineMs: number): Promise<void> {
  const until = Date.now() + deadlineMs
  while (Date.now() < until) {
    try {
      const response = await fetch(`${url}/roster`, { signal: AbortSignal.timeout(10_000) })
      if (response.ok) return
    } catch {
      // Not listening yet, or still folding the recorded sessions: poll again.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1_000))
  }
  throw new Error(`poc-demo: the feed at ${url} did not answer within ${Math.round(deadlineMs / 1000)} s`)
}

/**
 * Run one child to completion, inheriting this terminal.
 * @param command - Executable.
 * @param args - Arguments.
 * @param env - Extra environment.
 * @returns The exit code.
 */
function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } })
    child.on('error', reject)
    child.on('exit', (code) => { resolvePromise(code ?? 1) })
  })
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const deckDir = join(root, 'apps/command-deck')
  const options = parsePocArgs(process.argv.slice(2))
  const feedUrl = `http://localhost:${options.feedPort}`
  console.log(`poc-demo: feed port ${options.feedPort}, deck port ${options.deckPort}, ${options.build ? 'building the deck first' : 'serving the existing build'}`)

  if (options.build || !existsSync(join(deckDir, '.next', 'BUILD_ID'))) {
    console.log(`poc-demo: building the deck against ${feedUrl}`)
    const code = await run('pnpm', ['--dir', deckDir, 'exec', 'next', 'build'], { NEXT_PUBLIC_FEED_URL: feedUrl })
    if (code !== 0) {
      console.error(`poc-demo: the deck build exited with ${code}`)
      process.exit(code)
    }
  }

  // Each child leads its own process group: the feed and the deck are started
  // through pnpm wrappers, and signalling the group is what reaches the server
  // process behind the wrapper. Ctrl-C therefore arrives here and is forwarded.
  const children: ChildProcess[] = []
  const stopAll = (signal: NodeJS.Signals = 'SIGTERM'): void => {
    for (const child of children) {
      if (child.exitCode !== null || child.pid === undefined) continue
      try {
        process.kill(-child.pid, signal)
      } catch {
        // The group is already gone: the child exited between the check and the signal.
      }
    }
  }
  const onChildExit = (name: string) => (code: number | null): void => {
    console.log(`poc-demo: ${name} exited with ${code ?? 'a signal'}; stopping the other`)
    stopAll()
    process.exit(code ?? 1)
  }
  process.on('SIGINT', () => { stopAll('SIGINT'); process.exit(130) })
  process.on('SIGTERM', () => { stopAll(); process.exit(143) })

  console.log(`poc-demo: starting the feed on ${feedUrl}`)
  const feed = spawn('pnpm', ['exec', 'tsx', 'scripts/harness-feed.ts', '--port', String(options.feedPort)], { cwd: root, stdio: 'inherit', detached: true })
  children.push(feed)
  feed.on('exit', onChildExit('the feed'))
  await waitForFeed(feedUrl, FEED_READY_MS)

  console.log(`poc-demo: serving the deck on http://localhost:${options.deckPort} (LIVE against ${feedUrl})`)
  const deck = spawn('pnpm', ['--dir', deckDir, 'exec', 'next', 'start', '-p', String(options.deckPort)], { stdio: 'inherit', detached: true })
  children.push(deck)
  deck.on('exit', onChildExit('the deck'))
}
