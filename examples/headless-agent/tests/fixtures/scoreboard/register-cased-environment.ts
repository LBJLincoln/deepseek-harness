/** Test-only producer: one environment whose check is sampled case by case, so every run of it records a weighted pass rate. */

import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { caseChannelDigest, CheckCaseId, checkCasesRef, CheckId } from '@deepseek-ai/dsh-verification'
import type { CheckCase } from '@deepseek-ai/dsh-verification'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /** A keyless task whose check is sampled case by case; no kind-specific detail. */
    'weighted-smoke': Record<string, never>
  }
}

export const name = 'register-cased-environment'
export const inject = ['environments']

/** SHA-256 of one expected stream after the comparator's `crlf` normalizer. */
const expect = (text: string): string => caseChannelDigest(Buffer.from(text, 'utf8'), ['crlf'])

/** One case feeding the shell a word and comparing what it echoes. */
function echoes(id: string, word: string, echoed: string, weight: number): CheckCase {
  return {
    id: CheckCaseId(id),
    weight,
    input: { argv: [word] },
    expected: { exitCode: 0, stdoutSha256: expect(echoed) },
    comparator: { channels: ['exit', 'stdout'], normalizers: ['crlf'] },
  }
}

// Three weights of six pass in every workspace, and the silent sample never
// does, so each cell of this environment records the same partial parity and
// no certificate.
const cases: readonly CheckCase[] = [
  echoes('echoes-ab', 'ab', 'ab', 1),
  echoes('echoes-abc', 'abc', 'abc', 2),
  echoes('echoes-nothing', 'zw', '', 3),
]

const definition: EnvironmentDefinition<'weighted-smoke'> = {
  id: EnvironmentId('smoke:weighted-echo'),
  kind: 'weighted-smoke',
  name: 'smoke:weighted-echo',
  description: 'The workspace shell echoes each sampled word, and one sample asks it for silence instead.',
  task: { prompt: 'Prove the CLI tool round trip.' },
  checks: [{
    id: CheckId('echoes-words'),
    outcome: 'the workspace shell echoes each sampled word',
    run: 'printf',
    cases: checkCasesRef(cases),
    caseBodies: cases,
  }],
  heldOut: false,
  owner: 'headless-agent scoreboard fixture',
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
