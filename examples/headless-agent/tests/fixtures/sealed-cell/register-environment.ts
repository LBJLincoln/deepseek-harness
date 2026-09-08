/**
 * Test-only producer: one keyless task with a caseless check over the workspace
 * and a cased check whose every case feeds the candidate through all three input
 * channels. Under a barrier the runner sources a cased check from its reserved
 * script with the case's argv as positional parameters; a script that dropped
 * them fails every case here, which is the regression the cased check covers.
 */

import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { caseChannelDigest, CheckCaseId, checkCasesRef, CheckId } from '@deepseek-ai/dsh-verification'
import type { CheckCase } from '@deepseek-ai/dsh-verification'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /** A keyless task whose checks run shell commands over the workspace; no kind-specific detail. */
    'sealed-cell-smoke': Record<string, never>
  }
}

export const name = 'register-environment'
export const inject = ['environments']

/** SHA-256 of one expected stream after the comparator's `crlf` normalizer. */
const expect = (text: string): string => caseChannelDigest(Buffer.from(text, 'utf8'), ['crlf'])

/**
 * One case of `channels.sh`, which echoes its arguments, its stdin, and the
 * staged `input.txt` on three labelled lines. Every case stages its own file so
 * the cases agree whatever order they run in, and every case compares stdout, so
 * a candidate reached through fewer than three channels matches none of them.
 */
function echoes(id: string, weight: number, argv: readonly string[], stdin: string, file: string): CheckCase {
  return {
    id: CheckCaseId(id),
    weight,
    input: { argv, stdin, files: { 'input.txt': file } },
    expected: { exitCode: 0, stdoutSha256: expect(`argv=${argv.join(' ')}\nstdin=${stdin}\nfile=${file}\n`) },
    comparator: { channels: ['exit', 'stdout'], normalizers: ['crlf'] },
  }
}

const cases: readonly CheckCase[] = [
  echoes('two-words', 1, ['alpha', 'beta'], 'first', 'one'),
  echoes('one-word', 2, ['gamma'], 'second', 'two'),
  echoes('no-word', 3, [], 'third', 'three'),
]

const definition: EnvironmentDefinition<'sealed-cell-smoke'> = {
  id: EnvironmentId('smoke:sealed-marker'),
  kind: 'sealed-cell-smoke',
  name: 'smoke:sealed-marker',
  description: 'The workspace holds MARKER and a channels.sh that echoes its arguments, its stdin, and input.txt.',
  task: {
    prompt: 'Create a file named MARKER in the workspace, and a channels.sh so that `sh channels.sh WORD...` prints `argv=WORD...`, then `stdin=` followed by its standard input, then `file=` followed by the content of input.txt, one line each.',
  },
  checks: [
    { id: CheckId('marker-file'), outcome: 'the workspace holds MARKER', run: 'test -f MARKER' },
    {
      id: CheckId('echo-channels'),
      outcome: 'channels.sh echoes its arguments, its stdin, and input.txt on three lines',
      run: 'sh channels.sh',
      cases: checkCasesRef(cases),
      caseBodies: cases,
    },
  ],
  heldOut: false,
  owner: 'headless-agent sealed-cell fixture',
  provenance: 'curated',
  detail: {},
}

/**
 * Register the environment under the producer's own fiber.
 * @param ctx - the plugin context carrying the environment registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.environments.register(definition))
}
