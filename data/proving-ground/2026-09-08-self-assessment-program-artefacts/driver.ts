#!/usr/bin/env node
/**
 * Self-assessment through the program workflow: one department, on the
 * operator's Claude Code route, reads the evidence dossier committed in the
 * repository and writes `assessment.md` on its own branch; the goal is certified
 * by the mechanical verifier committed beside the evidence, the integration
 * re-runs it on the merged head, and the program ledger is printed as the
 * durable record. Adapted from the program fixture's driver.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { programIdFor, programSpecDigest, resolveProgramSpec } from '@deepseek-ai/dsh-program'
import type { ProgramSpec } from '@deepseek-ai/dsh-program'
import type {} from '@deepseek-ai/dsh-program'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-signoff'
import type { CheckId } from '@deepseek-ai/dsh-verification/types'

/** The artefact both of the program's signatures attest: the dossier's question. */
const ARTEFACT = 'a'.repeat(64)

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('self-assessment driver requires a config path')
const repository = process.env.DSH_TEST_PROGRAM_REPO
if (repository === undefined || !existsSync(`${repository}/.git`)) throw new Error('self-assessment driver requires DSH_TEST_PROGRAM_REPO to name an initialised repository')

process.env.DSH_TEST_PROGRAM_PRESETS = fileURLToPath(new URL('presets', import.meta.url))
for (const name of Object.keys(process.env)) {
  if (name.startsWith('GIT_CONFIG_')) Reflect.deleteProperty(process.env, name)
}

const VERIFY = 'node checks/verify-assessment.mjs assessment.md'

const BRIEF = [
  'Write `assessment.md` at the root of this repository: an honest assessment of whether the project described by the files under `evidence/` is viable and whether any part of it is state of the art.',
  'Read `evidence/goals-and-question.md` first; it states the four goals, the two questions, and the rules. Then read the primary records before the summaries: `evidence/proving-ground-README.md`, `evidence/census.txt`, `evidence/records-index.txt`, `evidence/commits-last-30h.txt`; then the notes.',
  'The document has exactly these level-two sections, in this order: `## Verdict`, `## Evidence`, `## What the evidence does not support`, `## What would change the verdict`.',
  '`## Verdict` opens with two lines, each on its own line and exactly in this form: `Viable: yes|no|undetermined (high|medium|low confidence)` and `State of the art: yes|no|in part|undetermined (high|medium|low confidence)`, followed by one paragraph for each that names the part of the project the verdict rests on.',
  '`## Evidence` is a list of at least eight bullets; every bullet states one fact and ends with the file it comes from as `(evidence/<file>)`; cite at least six distinct files; a measured result is reported with its numbers, its verdict, and its caveats exactly as the record states them.',
  '`## What the evidence does not support` lists at least three claims a reader might expect that the evidence does not carry, including any claim the project\'s own summaries make that the records do not.',
  '`## What would change the verdict` lists at least three measurable conditions.',
  'Between 600 and 2500 words. No placeholders. Verify with `node checks/verify-assessment.mjs assessment.md` before you stop; the validator runs the same command.',
].join(' ')

/** One goal: the assessment, certified by the committed verifier. */
function programSpec(): ProgramSpec {
  return {
    objective: 'assess whether this project is viable and state of the art, from its own evidence',
    baseRevision: 'base',
    signoff: { artefactSha256: ARTEFACT },
    goals: [
      {
        key: 'assessment',
        objective: BRIEF,
        preset: 'implementing',
        isolation: 'none',
        budget: { maxTotalTokens: 2_000_000, maxWallMs: 1_500_000 },
        dependsOn: [],
        checks: [{ id: 'assessment-verified' as CheckId, outcome: 'assessment.md exists and passes the committed verifier', run: VERIFY }],
      },
    ],
    integration: {
      checks: [{ id: 'merged-assessment-verified' as CheckId, outcome: 'the merged head carries a verified assessment', run: VERIFY }],
      gates: ['test -r assessment.md'],
    },
  }
}

interface LedgerLine { readonly sessionId: string; readonly events: { readonly type: string; readonly data: unknown }[]; readonly signoffs: string[] }
interface MemberLine { readonly sessionId: string; readonly programId: string; readonly key: string; readonly certified: boolean; readonly caps: unknown }

async function readRoot(persistence: SessionPersistence): Promise<{ ledgers: LedgerLine[]; members: MemberLine[] }> {
  const ledgers: LedgerLine[] = []
  const members: MemberLine[] = []
  for (const stored of await persistence.list()) {
    const { events } = await persistence.inspect(stored.id)
    const programEvents = events.filter((event: SessionEvent) => event.type.startsWith('program/') && event.type !== 'program/member')
    if (programEvents.length > 0) {
      ledgers.push({
        sessionId: stored.id,
        events: programEvents.map(event => ({ type: event.type, data: event.data })),
        signoffs: events.flatMap(event => (event.type === 'signoff/recorded' ? [event.data.transition] : [])),
      })
    }
    for (const event of events) {
      if (event.type !== 'program/member') continue
      members.push({
        sessionId: stored.id,
        programId: event.data.programId,
        key: event.data.key,
        certified: events.some(candidate => candidate.type === 'verification/certificate'),
        caps: events.find(candidate => candidate.type === 'budget/caps')?.data,
      })
    }
  }
  return { ledgers, members }
}

async function sign(ctx: Awaited<ReturnType<typeof boot>>, spec: ProgramSpec, cwd: string): Promise<void> {
  const sessionId = SessionId(programIdFor(programSpecDigest(resolveProgramSpec(spec))))
  const signoffs = ctx.get('signoffs')
  const agents = ctx.get('agents')
  if (signoffs === undefined || agents === undefined) throw new Error('self-assessment driver requires the signoffs and agents services')
  if ((await ctx.get('sessionPersistence')?.list() ?? []).some(stored => stored.id === sessionId)) return
  const model = ctx.get('agentDefaultModel')?.currentSelection()
  if (model === undefined) throw new Error('self-assessment driver requires the default-model service')
  const handle = await agents.create({ sessionId, meta: { cwd }, agentOptions: { provider: model.provider, model: model.model } })
  try {
    for (const transition of ['spec-freeze', 'release'] as const) {
      signoffs.record(handle.agent, {
        transition,
        principal: { kind: 'human', id: 'lab-lead', displayName: 'Lab lead' },
        artefactSha256: ARTEFACT,
        evidence: [{ kind: 'spec', ref: 'the frozen self-assessment spec' }],
      })
    }
    await ctx.sessions.flush(handle.agent.session)
  } finally {
    await handle.dispose()
  }
}

const ctx = await boot('self-assessment', resolveConfigPath(configPath, undefined))
try {
  await ctx.get('loader')?.await()
  const programs = ctx.get('programs')
  const persistence = ctx.get('sessionPersistence')
  if (programs === undefined || persistence === undefined) throw new Error('self-assessment driver requires the programs and session persistence services')
  const spec = programSpec()
  await sign(ctx, spec, repository)
  const report = await programs.start(spec)
  const observed = await readRoot(persistence)
  process.stdout.write(`${JSON.stringify({ type: 'result', report, ...observed })}\n`)
} finally {
  await ctx.fiber.dispose()
}
