/** Test-only producer: one environment whose single check carries five weighted cases over four channels. */

import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { caseChannelDigest, CheckCaseId, checkCasesRef, CheckId } from '@deepseek-ai/dsh-verification'
import type { CheckCase } from '@deepseek-ai/dsh-verification'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /** A keyless task whose check is sampled case by case; no kind-specific detail. */
    'instrument-smoke': Record<string, never>
  }
}

export const name = 'register-environment'
export const inject = ['environments']

/** SHA-256 of one expected stream after the comparator's `crlf` normalizer. */
const expect = (text: string): string => caseChannelDigest(Buffer.from(text, 'utf8'), ['crlf'])

/** One case comparing the candidate's stdout and exit code for one input word. */
function reverses(id: string, word: string, reversed: string, weight: number): CheckCase {
  return {
    id: CheckCaseId(id),
    weight,
    input: { argv: [word] },
    expected: { exitCode: 0, stdoutSha256: expect(`${reversed}\n`) },
    comparator: { channels: ['exit', 'stdout'], normalizers: ['crlf'] },
  }
}

const cases: readonly CheckCase[] = [
  reverses('reverse-ab', 'ab', 'ba', 1),
  reverses('reverse-abc', 'abc', 'cba', 2),
  reverses('reverse-xy', 'xy', 'yx', 3),
  reverses('reverse-zw', 'zw', 'wz', 4),
  {
    id: CheckCaseId('reverse-bad'),
    weight: 5,
    input: { argv: ['bad'] },
    expected: { exitCode: 0, stderrSha256: expect('') },
    comparator: { channels: ['exit', 'stderr'], normalizers: ['crlf'] },
  },
]

const definition: EnvironmentDefinition<'instrument-smoke'> = {
  id: EnvironmentId('smoke:reverse-words'),
  kind: 'instrument-smoke',
  name: 'smoke:reverse-words',
  description: 'solve.sh prints its argument reversed and reports nothing on stderr.',
  task: {
    prompt: 'Write solve.sh in the workspace so that `sh solve.sh WORD` prints WORD reversed on stdout, writes nothing to stderr, and exits 0.',
  },
  checks: [{
    id: CheckId('reverses-words'),
    outcome: 'solve.sh prints its argument reversed and reports nothing on stderr',
    run: 'sh solve.sh',
    cases: checkCasesRef(cases),
    caseBodies: cases,
  }],
  heldOut: false,
  owner: 'headless-agent instrument-cases fixture',
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
