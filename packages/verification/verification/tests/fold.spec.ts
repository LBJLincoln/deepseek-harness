import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyVerificationEvent,
  decodeCertificateChange,
  decodeDirectiveChange,
  decodeRelaxationChange,
  decodeRunChange,
  decodeStandardChange,
  emptyVerificationFoldState,
  foldVerification,
} from '@deepseek-ai/dsh-verification'

type Raw = Record<string, unknown>

function check(id: string, rest: Raw = {}): Raw {
  return { id, outcome: `outcome ${id}`, run: `run ${id}`, ...rest }
}

function snapshot(rest: Raw = {}): Raw {
  return {
    id: 'standard-1',
    revision: 1,
    goalId: 'goal-1',
    checks: [check('a'), check('b')],
    relaxed: [],
    ...rest,
  }
}

function author(rest: Raw = {}): Raw {
  return {
    kind: 'verification/standard',
    version: 1,
    operation: 'author',
    standard: snapshot(),
    createdAt: 10,
    updatedAt: 10,
    ...rest,
  }
}

function relaxation(rest: Raw = {}): Raw {
  return {
    kind: 'verification/relaxation',
    version: 1,
    checkId: 'b',
    standard: snapshot({
      revision: 2,
      checks: [check('a')],
      relaxed: [{ check: check('b'), evidence: 'unstable bytes' }],
    }),
    createdAt: 10,
    updatedAt: 11,
    ...rest,
  }
}

function result(id: string, rest: Raw = {}): Raw {
  return { checkId: id, status: 'pass', evidence: `ok ${id}`, ...rest }
}

function run(rest: Raw = {}): Raw {
  return {
    kind: 'verification/run',
    version: 1,
    standard: { id: 'standard-1', revision: 1 },
    attempt: 1,
    isolation: 'process',
    executor: 'runner',
    results: [result('a'), result('b')],
    recordedAt: 11,
    ...rest,
  }
}

function certificate(rest: Raw = {}, inner: Raw = {}): Raw {
  return {
    kind: 'verification/certificate',
    version: 1,
    certificate: {
      standard: { id: 'standard-1', revision: 1 },
      goalId: 'goal-1',
      isolation: 'process',
      executor: 'runner',
      results: [result('a'), result('b')],
      recordedAt: 12,
      ...inner,
    },
    ...rest,
  }
}

function directive(rest: Raw = {}): Raw {
  return {
    kind: 'verification/directive',
    version: 1,
    standard: { id: 'standard-1', revision: 1 },
    rootCause: 'stub frontier',
    detail: 'raster verbs return placeholder output',
    issuedAt: 12,
    ...rest,
  }
}

function event(type: string, data: unknown, seq = 0): SessionEvent {
  return { seq, type, data } as unknown as SessionEvent
}

/** Fold the events and return the terminal error message, if any. */
function rejection(events: readonly SessionEvent[]): string | undefined {
  const state = emptyVerificationFoldState()
  try {
    for (const item of events) applyVerificationEvent(state, item)
    return undefined
  } catch (error) {
    return (error as Error).message
  }
}

describe('verification decoders', () => {
  it('returns undefined for unrelated values', () => {
    expect(decodeStandardChange(null)).toBeUndefined()
    expect(decodeStandardChange({ kind: 'other' })).toBeUndefined()
    expect(decodeRelaxationChange([])).toBeUndefined()
    expect(decodeRelaxationChange({ kind: 'other' })).toBeUndefined()
    expect(decodeCertificateChange(7)).toBeUndefined()
    expect(decodeCertificateChange({ kind: 'other' })).toBeUndefined()
    expect(decodeDirectiveChange('x')).toBeUndefined()
    expect(decodeDirectiveChange({ kind: 'other' })).toBeUndefined()
    expect(decodeRunChange(false)).toBeUndefined()
    expect(decodeRunChange({ kind: 'other' })).toBeUndefined()
  })

  it('round-trips a run with and without a tree hash', () => {
    expect(decodeRunChange(run())).toEqual({
      kind: 'verification/run',
      version: 1,
      standard: { id: 'standard-1', revision: 1 },
      attempt: 1,
      isolation: 'process',
      executor: 'runner',
      verdict: 'passed',
      results: [
        { checkId: 'a', status: 'pass', evidence: 'ok a' },
        { checkId: 'b', status: 'pass', evidence: 'ok b' },
      ],
      recordedAt: 11,
    })
    expect(decodeRunChange(run({
      executor: 'agent-reported',
      results: [result('a'), result('b', { status: 'fail', evidence: 'red' })],
      treeHash: '0f1e2d',
    }))).toMatchObject({
      executor: 'agent-reported',
      treeHash: '0f1e2d',
      verdict: 'failed',
      results: [{ checkId: 'a', status: 'pass' }, { checkId: 'b', status: 'fail', evidence: 'red' }],
    })
  })

  it('keeps a recorded verdict the results cannot state', () => {
    expect(decodeRunChange(run({
      verdict: 'tampered',
      results: [result('a', { status: 'fail', evidence: 'not executed' }), result('b', { status: 'fail', evidence: 'not executed' })],
    }))).toMatchObject({ verdict: 'tampered' })
    expect(decodeRunChange(run({ verdict: 'passed', treeHash: 'beef' }))).toMatchObject({ verdict: 'passed', treeHash: 'beef' })
  })

  it.each<[string, () => unknown, string]>([
    ['unsupported version', () => decodeStandardChange(author({ version: 2 })), 'unsupported verification change version 2'],
    ['standard change keys', () => decodeStandardChange(author({ extra: 1 })), 'standard change must have exactly'],
    ['invalid operation', () => decodeStandardChange(author({ operation: 'weaken' })), 'operation is invalid'],
    ['snapshot not a record', () => decodeStandardChange(author({ standard: 3 })), 'standard must be a record'],
    ['snapshot keys', () => decodeStandardChange(author({ standard: snapshot({ extra: 1 }) })), 'standard must have exactly'],
    ['snapshot id', () => decodeStandardChange(author({ standard: snapshot({ id: '' }) })), 'standard.id must be a non-empty string'],
    ['snapshot goal id', () => decodeStandardChange(author({ standard: snapshot({ goalId: '' }) })), 'standard.goalId must be a non-empty string'],
    ['snapshot checks array', () => decodeStandardChange(author({ standard: snapshot({ checks: 'x' }) })), 'standard.checks must be an array'],
    ['snapshot relaxed array', () => decodeStandardChange(author({ standard: snapshot({ relaxed: 'x' }) })), 'standard.relaxed must be an array'],
    ['snapshot revision', () => decodeStandardChange(author({ standard: snapshot({ revision: 0 }) })), 'standard.revision must be a positive safe integer'],
    ['duplicate check id', () => decodeStandardChange(author({ standard: snapshot({ checks: [check('a'), check('a')] }) })), 'repeats id "a"'],
    ['relaxed id collision', () => decodeStandardChange(author({ standard: snapshot({ relaxed: [{ check: check('a'), evidence: 'x' }] }) })), 'relaxed repeats id "a"'],
    ['check not a record', () => decodeStandardChange(author({ standard: snapshot({ checks: [1] }) })), 'checks[0] must be a record'],
    ['check keys', () => decodeStandardChange(author({ standard: snapshot({ checks: [check('a', { extra: 1 })] }) })), 'checks[0] must have exactly'],
    ['check id case', () => decodeStandardChange(author({ standard: snapshot({ checks: [check('Bad')] }) })), 'checks[0].id must be lower-kebab-case'],
    ['check id type', () => decodeStandardChange(author({ standard: snapshot({ checks: [check('a', { id: 7 })] }) })), 'checks[0].id must be lower-kebab-case'],
    ['relaxation check id type', () => decodeRelaxationChange(relaxation({ checkId: 7 })), 'relaxation checkId must be lower-kebab-case'],
    ['certificate result id type', () => decodeCertificateChange(certificate({}, { results: [result('a', { checkId: 7 })] })), 'results[0].checkId must be lower-kebab-case'],
    ['check outcome', () => decodeStandardChange(author({ standard: snapshot({ checks: [check('a', { outcome: ' padded ' })] }) })), 'checks[0].outcome must be non-empty and normalized'],
    ['check run', () => decodeStandardChange(author({ standard: snapshot({ checks: [check('a', { run: '' })] }) })), 'checks[0].run must be non-empty and normalized'],
    ['relaxed entry record', () => decodeStandardChange(author({ standard: snapshot({ relaxed: [1] }) })), 'relaxed[0] must be a record'],
    ['relaxed entry keys', () => decodeStandardChange(author({ standard: snapshot({ relaxed: [{ check: check('z') }] }) })), 'relaxed[0] must have exactly'],
    ['relaxed evidence', () => decodeStandardChange(author({ standard: snapshot({ relaxed: [{ check: check('z'), evidence: ' ' }] }) })), 'relaxed[0].evidence must be non-empty and normalized'],
    ['created at integer', () => decodeStandardChange(author({ createdAt: -1 })), 'createdAt must be a non-negative safe integer'],
    ['timestamp order', () => decodeStandardChange(author({ createdAt: 20, updatedAt: 10 })), 'updatedAt cannot precede createdAt'],
    ['relaxation keys', () => decodeRelaxationChange(relaxation({ extra: 1 })), 'relaxation must have exactly'],
    ['relaxation check id case', () => decodeRelaxationChange(relaxation({ checkId: 'Bad' })), 'relaxation checkId must be lower-kebab-case'],
    ['relaxation list mismatch', () => decodeRelaxationChange(relaxation({ checkId: 'a' })), 'must end the snapshot relaxed list with its check'],
    ['relaxation empty list', () => decodeRelaxationChange(relaxation({ standard: snapshot({ revision: 2 }) })), 'must end the snapshot relaxed list with its check'],
    ['certificate keys', () => decodeCertificateChange(certificate({ extra: 1 })), 'certificate must have exactly'],
    ['certificate record', () => decodeCertificateChange({ kind: 'verification/certificate', version: 1, certificate: 3 }), 'certificate must be a record'],
    ['certificate inner keys', () => decodeCertificateChange(certificate({}, { extra: 1 })), 'certificate must have exactly'],
    ['certificate goal id', () => decodeCertificateChange(certificate({}, { goalId: '' })), 'certificate.goalId must be a non-empty string'],
    ['certificate isolation', () => decodeCertificateChange(certificate({}, { isolation: 'vm' })), 'certificate.isolation is invalid'],
    ['certificate executor', () => decodeCertificateChange(certificate({}, { executor: 'human' })), 'certificate.executor is invalid'],
    ['certificate results array', () => decodeCertificateChange(certificate({}, { results: 'x' })), 'certificate.results must be a non-empty array'],
    ['certificate results empty', () => decodeCertificateChange(certificate({}, { results: [] })), 'certificate.results must be a non-empty array'],
    ['certificate result record', () => decodeCertificateChange(certificate({}, { results: [1] })), 'results[0] must be a record'],
    ['certificate result keys', () => decodeCertificateChange(certificate({}, { results: [result('a', { extra: 1 })] })), 'results[0] must have exactly'],
    ['certificate result id case', () => decodeCertificateChange(certificate({}, { results: [result('Bad')] })), 'results[0].checkId must be lower-kebab-case'],
    ['certificate result status', () => decodeCertificateChange(certificate({}, { results: [result('a', { status: 'fail' })] })), 'results[0].status must be "pass" inside a certificate'],
    ['certificate result evidence', () => decodeCertificateChange(certificate({}, { results: [result('a', { evidence: '' })] })), 'results[0].evidence must be non-empty and normalized'],
    ['certificate recorded at', () => decodeCertificateChange(certificate({}, { recordedAt: -1 })), 'certificate.recordedAt must be a non-negative safe integer'],
    ['certificate ref record', () => decodeCertificateChange(certificate({}, { standard: 1 })), 'certificate.standard must be a record'],
    ['certificate ref keys', () => decodeCertificateChange(certificate({}, { standard: { id: 'standard-1' } })), 'certificate.standard must have exactly'],
    ['certificate ref id', () => decodeCertificateChange(certificate({}, { standard: { id: '', revision: 1 } })), 'certificate.standard.id must be a non-empty string'],
    ['certificate ref revision', () => decodeCertificateChange(certificate({}, { standard: { id: 'standard-1', revision: 0 } })), 'certificate.standard.revision must be a positive safe integer'],
    ['run version', () => decodeRunChange(run({ version: 3 })), 'unsupported verification change version 3'],
    ['run keys', () => decodeRunChange(run({ extra: 1 })), 'run must have exactly'],
    ['run keys with a tree hash', () => decodeRunChange(run({ treeHash: 'ab', extra: 1 })), 'run must have exactly'],
    ['run isolation type', () => decodeRunChange(run({ isolation: 7 })), 'run.isolation is invalid'],
    ['run isolation value', () => decodeRunChange(run({ isolation: 'vm' })), 'run.isolation is invalid'],
    ['run executor type', () => decodeRunChange(run({ executor: 7 })), 'run.executor is invalid'],
    ['run executor value', () => decodeRunChange(run({ executor: 'human' })), 'run.executor is invalid'],
    ['run results array', () => decodeRunChange(run({ results: 'x' })), 'run.results must be a non-empty array'],
    ['run results empty', () => decodeRunChange(run({ results: [] })), 'run.results must be a non-empty array'],
    ['run result status', () => decodeRunChange(run({ results: [result('a', { status: 'skip' })] })), 'run.results[0].status must be "pass" or "fail"'],
    ['run result evidence', () => decodeRunChange(run({ results: [result('a', { evidence: ' ' })] })), 'run.results[0].evidence must be non-empty and normalized'],
    ['run ref', () => decodeRunChange(run({ standard: { id: 'standard-1' } })), 'run.standard must have exactly'],
    ['run attempt', () => decodeRunChange(run({ attempt: 0 })), 'run.attempt must be a positive safe integer'],
    ['run recorded at', () => decodeRunChange(run({ recordedAt: -1 })), 'run.recordedAt must be a non-negative safe integer'],
    ['run verdict type', () => decodeRunChange(run({ verdict: 7 })), 'run.verdict is invalid'],
    ['run verdict value', () => decodeRunChange(run({ verdict: 'pass' })), 'run.verdict is invalid'],
    ['run tree hash type', () => decodeRunChange(run({ treeHash: 7 })), 'run.treeHash must be a lowercase hex digest'],
    ['run tree hash characters', () => decodeRunChange(run({ treeHash: 'BEEF' })), 'run.treeHash must be a lowercase hex digest'],
    ['directive keys', () => decodeDirectiveChange(directive({ extra: 1 })), 'directive must have exactly'],
    ['directive root cause', () => decodeDirectiveChange(directive({ rootCause: ' ' })), 'directive.rootCause must be non-empty and normalized'],
    ['directive detail', () => decodeDirectiveChange(directive({ detail: '' })), 'directive.detail must be non-empty and normalized'],
    ['directive issued at', () => decodeDirectiveChange(directive({ issuedAt: 1.5 })), 'issuedAt must be a non-negative safe integer'],
  ])('rejects %s', (_name, decode, message) => {
    expect(decode).toThrow(message)
  })
})

describe('verification fold transitions', () => {
  it('accepts the canonical author, directive, relax, extend, certificate sequence', () => {
    const relaxed = relaxation()
    const extended = author({
      operation: 'extend',
      standard: snapshot({
        revision: 3,
        checks: [check('a'), check('c')],
        relaxed: [{ check: check('b'), evidence: 'unstable bytes' }],
      }),
      createdAt: 10,
      updatedAt: 12,
    })
    const finalCertificate = certificate({}, {
      standard: { id: 'standard-1', revision: 3 },
      results: [result('a'), result('c')],
      recordedAt: 13,
    })
    const finalRun = run({
      standard: { id: 'standard-1', revision: 3 },
      attempt: 2,
      results: [result('a'), result('c')],
      recordedAt: 13,
    })
    const folded = foldVerification([
      event('verification/standard', author()),
      event('verification/directive', directive(), 1),
      event('verification/run', run({ results: [result('a'), result('b', { status: 'fail' })] }), 2),
      event('verification/relaxation', relaxed, 3),
      event('verification/standard', extended, 4),
      event('verification/run', finalRun, 5),
      event('verification/certificate', finalCertificate, 6),
      event('turn/start', { turn: 1 }, 7),
    ])
    expect(folded.standard?.revision).toBe(3)
    expect(folded.certificate?.standard).toEqual({ id: 'standard-1', revision: 3 })
    expect(folded.directivesIssued).toBe(1)
    expect(folded.runsRecorded).toBe(2)
    expect(folded.lastRun).toMatchObject({ attempt: 2, standard: { id: 'standard-1', revision: 3 } })
    expect(folded.createdAt).toBe(10)
    expect(folded.updatedAt).toBe(12)
    expect(folded.lastRef).toEqual({ id: 'standard-1', revision: 3 })
  })

  it('starts empty and ignores unrelated events', () => {
    expect(foldVerification([event('turn/start', { turn: 1 })])).toEqual({ directivesIssued: 0, runsRecorded: 0 })
  })

  it('restarts attempt numbering for a standard authored after a superseded one', () => {
    const second = author({
      standard: snapshot({ id: 'standard-2', goalId: 'goal-2', checks: [check('a')] }),
      createdAt: 20,
      updatedAt: 20,
    })
    const folded = foldVerification([
      event('verification/standard', author()),
      event('verification/run', run(), 1),
      event('verification/standard', second, 2),
      event('verification/run', run({
        standard: { id: 'standard-2', revision: 1 },
        results: [result('a')],
        recordedAt: 21,
      }), 3),
    ])
    expect(folded.runsRecorded).toBe(2)
    expect(folded.lastRun).toMatchObject({ attempt: 1, standard: { id: 'standard-2', revision: 1 } })
  })

  it('clears the certificate on extend and on relaxation', () => {
    const base = [event('verification/standard', author()), event('verification/certificate', certificate(), 1)]
    const afterRelax = foldVerification([...base, event('verification/relaxation', relaxation(), 2)])
    expect(afterRelax.certificate).toBeUndefined()
    const afterExtend = foldVerification([...base, event('verification/standard', author({
      operation: 'extend',
      standard: snapshot({ revision: 2, checks: [check('a'), check('b'), check('c')] }),
      createdAt: 10,
      updatedAt: 11,
    }), 2)])
    expect(afterExtend.certificate).toBeUndefined()
  })

  const authored = () => [event('verification/standard', author())]

  it.each<[string, SessionEvent[], string]>([
    ['author at a later revision', [event('verification/standard', author({ standard: snapshot({ revision: 2 }) }))], 'fresh revision-one standard'],
    ['author with relaxations', [event('verification/standard', author({ standard: snapshot({ relaxed: [{ check: check('z'), evidence: 'x' }] }) }))], 'fresh revision-one standard'],
    ['author without checks', [event('verification/standard', author({ standard: snapshot({ checks: [] }) }))], 'fresh revision-one standard'],
    ['author reusing an id', [
      ...authored(),
      event('verification/standard', author({ standard: snapshot({ goalId: 'goal-2' }) }), 1),
    ], 'fresh revision-one standard'],
    ['author for the same goal', [
      ...authored(),
      event('verification/standard', author({ standard: snapshot({ id: 'standard-2' }) }), 1),
    ], 'fresh revision-one standard'],
    ['extend without a standard', [event('verification/standard', author({ operation: 'extend' }))], 'extend requires a current standard'],
    ['extend with a different id', [
      ...authored(),
      event('verification/standard', author({ operation: 'extend', standard: snapshot({ id: 'standard-2', revision: 2, checks: [check('a'), check('b'), check('c')] }), updatedAt: 11 }), 1),
    ], 'must advance the current standard by one revision'],
    ['extend altering creation time', [
      ...authored(),
      event('verification/standard', author({ operation: 'extend', standard: snapshot({ revision: 2, checks: [check('a'), check('b'), check('c')] }), createdAt: 9, updatedAt: 11 }), 1),
    ], 'does not preserve the current timestamps'],
    ['extend regressing update time', [
      ...authored(),
      event('verification/standard', author({ operation: 'extend', standard: snapshot({ revision: 2, checks: [check('a'), check('b'), check('c')] }), createdAt: 10, updatedAt: 9 }), 1),
    ], 'updatedAt cannot precede createdAt'],
    ['extend for another goal', [
      ...authored(),
      event('verification/standard', author({ operation: 'extend', standard: snapshot({ goalId: 'goal-2', revision: 2, checks: [check('a'), check('b'), check('c')] }), updatedAt: 11 }), 1),
    ], 'must advance the current standard by one revision'],
    ['extend with a stalled update time', [
      event('verification/standard', author({ updatedAt: 12 })),
      event('verification/standard', author({ operation: 'extend', standard: snapshot({ revision: 2, checks: [check('a'), check('b'), check('c')] }), createdAt: 10, updatedAt: 11 }), 1),
    ], 'does not preserve the current timestamps'],
    ['extend without additions', [
      ...authored(),
      event('verification/standard', author({ operation: 'extend', standard: snapshot({ revision: 2 }), updatedAt: 11 }), 1),
    ], 'must add at least one check'],
    ['extend rewriting a check', [
      ...authored(),
      event('verification/standard', author({ operation: 'extend', standard: snapshot({ revision: 2, checks: [check('a', { run: 'changed' }), check('b'), check('c')] }), updatedAt: 11 }), 1),
    ], 'must preserve the existing check "a"'],
    ['extend changing relaxations', [
      ...authored(),
      event('verification/standard', author({ operation: 'extend', standard: snapshot({ revision: 2, checks: [check('a'), check('b'), check('c')], relaxed: [{ check: check('z'), evidence: 'x' }] }), updatedAt: 11 }), 1),
    ], 'cannot change relaxations'],
    ['extend rewriting a relaxation', [
      ...authored(),
      event('verification/relaxation', relaxation(), 1),
      event('verification/standard', author({ operation: 'extend', standard: snapshot({ revision: 3, checks: [check('a'), check('d')], relaxed: [{ check: check('b'), evidence: 'rewritten' }] }), updatedAt: 12 }), 2),
    ], 'must preserve the existing relaxation of "b"'],
    ['relaxation without a standard', [event('verification/relaxation', relaxation())], 'relaxation requires a current standard'],
    ['relaxation skipping a revision', [
      ...authored(),
      event('verification/relaxation', relaxation({ standard: snapshot({ revision: 3, checks: [check('a')], relaxed: [{ check: check('b'), evidence: 'x' }] }) }), 1),
    ], 'must advance the current standard by one revision'],
    ['relaxation of an unknown check', [
      ...authored(),
      event('verification/relaxation', relaxation({ checkId: 'z', standard: snapshot({ revision: 2, checks: [check('a'), check('b')], relaxed: [{ check: check('z'), evidence: 'x' }] }) }), 1),
    ], 'names unknown check "z"'],
    ['relaxation removing extra checks', [
      ...authored(),
      event('verification/relaxation', relaxation({ standard: snapshot({ revision: 2, checks: [], relaxed: [{ check: check('b'), evidence: 'x' }] }) }), 1),
    ], 'must remove exactly its named check'],
    ['relaxation rewriting a survivor', [
      ...authored(),
      event('verification/relaxation', relaxation({ standard: snapshot({ revision: 2, checks: [check('x')], relaxed: [{ check: check('b'), evidence: 'x' }] }) }), 1),
    ], 'must preserve the existing check "a"'],
    ['relaxation appending two entries', [
      ...authored(),
      event('verification/relaxation', relaxation({ standard: snapshot({ revision: 2, checks: [check('a')], relaxed: [{ check: check('z'), evidence: 'x' }, { check: check('b'), evidence: 'y' }] }) }), 1),
    ], 'must append exactly one relaxed entry'],
    ['relaxation rewriting the removed check', [
      ...authored(),
      event('verification/relaxation', relaxation({ standard: snapshot({ revision: 2, checks: [check('a')], relaxed: [{ check: check('b', { run: 'changed' }), evidence: 'x' }] }) }), 1),
    ], 'must preserve the existing check "b"'],
    ['certificate without a standard', [event('verification/certificate', certificate())], 'certificate requires a current standard'],
    ['certificate for a stale revision', [
      ...authored(),
      event('verification/certificate', certificate({}, { standard: { id: 'standard-1', revision: 2 } }), 1),
    ], 'must cover the exact current standard revision'],
    ['certificate for another goal', [
      ...authored(),
      event('verification/certificate', certificate({}, { goalId: 'goal-2' }), 1),
    ], 'must cover the exact current standard revision'],
    ['certificate for another id', [
      ...authored(),
      event('verification/certificate', certificate({}, { standard: { id: 'standard-2', revision: 1 } }), 1),
    ], 'must cover the exact current standard revision'],
    ['certificate missing results', [
      ...authored(),
      event('verification/certificate', certificate({}, { results: [result('a')] }), 1),
    ], 'one result per active check'],
    ['certificate out of order', [
      ...authored(),
      event('verification/certificate', certificate({}, { results: [result('b'), result('a')] }), 1),
    ], 'result 0 must answer check "a"'],
    ['certificate recorded before the standard', [
      ...authored(),
      event('verification/certificate', certificate({}, { recordedAt: 9 }), 1),
    ], 'cannot precede the current standard update'],
    ['run without a standard', [event('verification/run', run())], 'run requires a current standard'],
    ['run for a stale revision', [
      ...authored(),
      event('verification/run', run({ standard: { id: 'standard-1', revision: 2 } }), 1),
    ], 'run must cover the exact current standard revision'],
    ['run for another id', [
      ...authored(),
      event('verification/run', run({ standard: { id: 'standard-2', revision: 1 } }), 1),
    ], 'run must cover the exact current standard revision'],
    ['run missing results', [
      ...authored(),
      event('verification/run', run({ results: [result('a')] }), 1),
    ], 'run must carry one result per active check'],
    ['run out of order', [
      ...authored(),
      event('verification/run', run({ results: [result('b'), result('a')] }), 1),
    ], 'run result 0 must answer check "a"'],
    ['run recorded before the standard', [
      ...authored(),
      event('verification/run', run({ recordedAt: 9 }), 1),
    ], 'run cannot precede the current standard update'],
    ['run claiming a verdict its results deny', [
      ...authored(),
      event('verification/run', run({ verdict: 'passed', results: [result('a'), result('b', { status: 'fail' })] }), 1),
    ], 'cannot record verdict "passed" with a failing result'],
    ['run failing on passing results', [
      ...authored(),
      event('verification/run', run({ verdict: 'failed' }), 1),
    ], 'cannot record verdict "failed" with every result passing'],
    ['run repeating an attempt number', [
      ...authored(),
      event('verification/run', run(), 1),
      event('verification/run', run(), 2),
    ], 'run must number attempt 2 for standard "standard-1"'],
    ['directive without a standard', [event('verification/directive', directive())], 'directive requires a current standard'],
    ['directive for a stale revision', [
      ...authored(),
      event('verification/directive', directive({ standard: { id: 'standard-1', revision: 2 } }), 1),
    ], 'must reference the exact current standard revision'],
    ['directive for another id', [
      ...authored(),
      event('verification/directive', directive({ standard: { id: 'standard-2', revision: 1 } }), 1),
    ], 'must reference the exact current standard revision'],
    ['directive issued before authorship', [
      ...authored(),
      event('verification/directive', directive({ issuedAt: 9 }), 1),
    ], 'cannot precede the current standard creation'],
  ])('rejects %s', (_name, events, message) => {
    expect(rejection(events)).toContain(message)
  })
})

const CASES_REF = { count: 2, weightTotal: 3, sha256: 'f'.repeat(64) }

/** A cased check `a` beside the caseless check `b`, as a standard snapshot carries them. */
function casedSnapshot(checkRest: Raw = {}, rest: Raw = {}): Raw {
  return snapshot({ checks: [check('a', { cases: CASES_REF, ...checkRest }), check('b')], ...rest })
}

function casedAuthor(checkRest: Raw = {}): SessionEvent[] {
  return [event('verification/standard', author({ standard: casedSnapshot(checkRest) }))]
}

function plainAuthor(): SessionEvent[] {
  return [event('verification/standard', author())]
}

/** A run result carrying a case tally, defaulting to a fully passing one. */
function casedResult(rest: Raw = {}): Raw {
  return result('a', { cases: { passed: 2, total: 2, weightPassed: 3, weightTotal: 3, failed: [], ...rest } })
}

const FAILED_CASE = { id: 'sample-0', weight: 1, channels: ['stdout'], exitClass: 'nonzero' }

/** A run result whose tally reports one failing case, with the status that tally requires. */
function failingCasedResult(): Raw {
  return result('a', {
    status: 'fail',
    cases: { passed: 1, total: 2, weightPassed: 1, weightTotal: 3, failed: [FAILED_CASE] },
  })
}

describe('verification case decoders', () => {
  it('round-trips a cased check, a case tally, a parity, and a directive cluster', () => {
    const decoded = decodeStandardChange(author({ standard: casedSnapshot({ treeScope: 'out' }) }))
    expect(decoded?.standard.checks[0]).toEqual({
      id: 'a',
      outcome: 'outcome a',
      run: 'run a',
      cases: CASES_REF,
      treeScope: 'out',
    })
    const decodedRun = decodeRunChange(run({
      results: [failingCasedResult(), result('b')],
      parity: { weightPassed: 1, weightTotal: 3 },
    }))
    expect(decodedRun?.results[0]).toMatchObject({
      status: 'fail',
      cases: { passed: 1, total: 2, weightPassed: 1, weightTotal: 3, failed: [FAILED_CASE] },
    })
    expect(decodedRun?.parity).toEqual({ weightPassed: 1, weightTotal: 3 })
    expect(decodeDirectiveChange(directive({ clusters: [{ checkId: 'a', channels: ['stderr', 'stdout'], count: 2, weight: 3 }] }))?.clusters)
      .toEqual([{ checkId: 'a', channels: ['stdout', 'stderr'], count: 2, weight: 3 }])
  })

  it.each<[string, unknown, string]>([
    ['a cases reference that is not a record', author({ standard: casedSnapshot({ cases: 'nope' }) }), 'standard.checks[0].cases must be a record'],
    ['a cases reference with extra fields', author({ standard: casedSnapshot({ cases: { ...CASES_REF, extra: 1 } }) }), 'must have exactly count,sha256,weightTotal fields'],
    ['a cases count of zero', author({ standard: casedSnapshot({ cases: { ...CASES_REF, count: 0 } }) }), 'cases.count must be a positive safe integer'],
    ['a cases weightTotal of zero', author({ standard: casedSnapshot({ cases: { ...CASES_REF, weightTotal: 0 } }) }), 'cases.weightTotal must be a positive safe integer'],
    ['a cases digest that is not hex', author({ standard: casedSnapshot({ cases: { ...CASES_REF, sha256: 'ZZ' } }) }), 'cases.sha256 must be a lowercase hex digest'],
    ['a treeScope without cases', author({ standard: snapshot({ checks: [check('a', { treeScope: 'out' }), check('b')] }) }), 'treeScope requires cases'],
  ])('rejects %s', (_name, payload, message) => {
    expect(() => decodeStandardChange(payload)).toThrow(message)
  })

  it.each<[string, unknown, string]>([
    ['a tally that is not a record', run({ results: [result('a', { cases: 3 }), result('b')] }), 'results[0].cases must be a record'],
    ['a tally with extra fields', run({ results: [casedResult({ extra: 1 }), result('b')] }), 'must have exactly failed,passed,total,weightPassed,weightTotal fields'],
    ['a tally whose failed list is not an array', run({ results: [casedResult({ failed: 'none' }), result('b')] }), 'cases.failed must be an array'],
    ['more passing cases than total', run({ results: [casedResult({ passed: 3 }), result('b')] }), 'cases.passed cannot exceed total'],
    ['more passing weight than total', run({ results: [casedResult({ weightPassed: 4 }), result('b')] }), 'cases.weightPassed cannot exceed weightTotal'],
    ['more failed cases than failures', run({ results: [casedResult({ failed: [FAILED_CASE] }), result('b')] }), 'cases.failed lists more cases than failed'],
    ['a status that does not follow its cases', run({ results: [casedResult({ passed: 1, weightPassed: 1, failed: [FAILED_CASE] }), result('b')], parity: { weightPassed: 1, weightTotal: 3 } }), 'results[0].status must follow its cases'],
    ['a failed case that is not a record', run({ results: [casedResult({ passed: 1, weightPassed: 1, failed: [7] }), result('b')] }), 'failed[0] must be a record'],
    ['a failed case id that is not kebab-case', run({ results: [casedResult({ passed: 1, weightPassed: 1, failed: [{ ...FAILED_CASE, id: 'Sample' }] }), result('b')] }), 'failed[0].id must be lower-kebab-case'],
    ['a failed case weight of zero', run({ results: [casedResult({ passed: 1, weightPassed: 1, failed: [{ ...FAILED_CASE, weight: 0 }] }), result('b')] }), 'failed[0].weight must be a positive safe integer'],
    ['an unknown exit class', run({ results: [casedResult({ passed: 1, weightPassed: 1, failed: [{ ...FAILED_CASE, exitClass: 'crashed' }] }), result('b')] }), 'failed[0].exitClass is invalid'],
    ['an empty channel list', run({ results: [casedResult({ passed: 1, weightPassed: 1, failed: [{ ...FAILED_CASE, channels: [] }] }), result('b')] }), 'failed[0].channels must be a non-empty array'],
    ['an unknown channel', run({ results: [casedResult({ passed: 1, weightPassed: 1, failed: [{ ...FAILED_CASE, channels: ['fd3'] }] }), result('b')] }), 'names unknown channel "fd3"'],
    ['a repeated channel', run({ results: [casedResult({ passed: 1, weightPassed: 1, failed: [{ ...FAILED_CASE, channels: ['stdout', 'stdout'] }] }), result('b')] }), 'repeats channel "stdout"'],
    ['a parity that is not a record', run({ results: [casedResult(), result('b')], parity: 'high' }), 'run.parity must be a record'],
    ['a parity with extra fields', run({ results: [casedResult(), result('b')], parity: { weightPassed: 1, weightTotal: 3, extra: 0 } }), 'must have exactly weightPassed,weightTotal fields'],
    ['a parity weightTotal of zero', run({ results: [casedResult(), result('b')], parity: { weightPassed: 0, weightTotal: 0 } }), 'run.parity.weightTotal must be a positive safe integer'],
    ['a parity passing more weight than it holds', run({ results: [casedResult(), result('b')], parity: { weightPassed: 9, weightTotal: 3 } }), 'run.parity.weightPassed cannot exceed weightTotal'],
  ])('rejects %s', (_name, payload, message) => {
    expect(() => decodeRunChange(payload)).toThrow(message)
  })

  it.each<[string, unknown, string]>([
    ['an empty cluster list', directive({ clusters: [] }), 'directive.clusters must be a non-empty array'],
    ['a cluster list that is not an array', directive({ clusters: 'none' }), 'directive.clusters must be a non-empty array'],
    ['a cluster that is not a record', directive({ clusters: [5] }), 'clusters[0] must be a record'],
    ['a cluster with extra fields', directive({ clusters: [{ checkId: 'a', channels: ['stdout'], count: 1, weight: 1, extra: 0 }] }), 'must have exactly channels,checkId,count,weight fields'],
    ['a cluster check id that is not kebab-case', directive({ clusters: [{ checkId: 'A', channels: ['stdout'], count: 1, weight: 1 }] }), 'clusters[0].checkId must be lower-kebab-case'],
    ['a cluster count of zero', directive({ clusters: [{ checkId: 'a', channels: ['stdout'], count: 0, weight: 1 }] }), 'clusters[0].count must be a positive safe integer'],
    ['a cluster weight of zero', directive({ clusters: [{ checkId: 'a', channels: ['stdout'], count: 1, weight: 0 }] }), 'clusters[0].weight must be a positive safe integer'],
  ])('rejects %s', (_name, payload, message) => {
    expect(() => decodeDirectiveChange(payload)).toThrow(message)
  })
})

describe('verification case relations', () => {
  it.each<[string, readonly SessionEvent[], string]>([
    ['a tally for a check that references no cases', [
      ...plainAuthor(),
      event('verification/run', run({ results: [casedResult(), result('b')], parity: { weightPassed: 3, weightTotal: 3 } }), 1),
    ], 'reports cases for check "a", which references none'],
    ['a tally whose count disagrees with the reference', [
      ...casedAuthor(),
      event('verification/run', run({ results: [casedResult({ total: 5, passed: 5 }), result('b')], parity: { weightPassed: 3, weightTotal: 3 } }), 1),
    ], 'case tally of check "a" disagrees with its cases reference'],
    ['a tally whose weight disagrees with the reference', [
      ...casedAuthor(),
      event('verification/run', run({ results: [casedResult({ weightTotal: 9, weightPassed: 9 }), result('b')], parity: { weightPassed: 9, weightTotal: 9 } }), 1),
    ], 'case tally of check "a" disagrees with its cases reference'],
    ['a cased run without parity', [
      ...casedAuthor(),
      event('verification/run', run({ results: [casedResult(), result('b')] }), 1),
    ], 'run with a cased result must record parity'],
    ['a caseless run carrying parity', [
      ...plainAuthor(),
      event('verification/run', run({ parity: { weightPassed: 1, weightTotal: 2 } }), 1),
    ], 'run records parity without a cased result'],
    ['a parity that does not sum its results', [
      ...casedAuthor(),
      event('verification/run', run({ results: [casedResult(), result('b')], parity: { weightPassed: 1, weightTotal: 3 } }), 1),
    ], 'run parity must sum its results\' case weights'],
    ['a certificate over a run with a failing case', [
      ...casedAuthor(),
      event('verification/run', run({
        results: [failingCasedResult(), result('b')],
        parity: { weightPassed: 1, weightTotal: 3 },
      }), 1),
      event('verification/certificate', certificate({}, { results: [casedResult({ passed: 1, weightPassed: 1, failed: [FAILED_CASE] }), result('b')] }), 2),
    ], 'certificate.results[0].status must follow its cases'],
    ['a certificate carrying a failing cased result', [
      ...casedAuthor(),
      event('verification/run', run({
        results: [failingCasedResult(), result('b')],
        parity: { weightPassed: 1, weightTotal: 3 },
      }), 1),
      event('verification/certificate', certificate({}, { results: [failingCasedResult(), result('b')] }), 2),
    ], 'certificate.results[0].status must be "pass" inside a certificate'],
    ['a directive clustering a caseless check', [
      ...casedAuthor(),
      event('verification/directive', directive({ clusters: [{ checkId: 'b', channels: ['stdout'], count: 1, weight: 1 }] }), 1),
    ], 'directive clusters unknown or caseless check "b"'],
    ['a directive cluster larger than the reference', [
      ...casedAuthor(),
      event('verification/directive', directive({ clusters: [{ checkId: 'a', channels: ['stdout'], count: 9, weight: 1 }] }), 1),
    ], 'directive cluster of check "a" exceeds its cases reference'],
    ['a directive cluster heavier than the reference', [
      ...casedAuthor(),
      event('verification/directive', directive({ clusters: [{ checkId: 'a', channels: ['stdout'], count: 1, weight: 9 }] }), 1),
    ], 'directive cluster of check "a" exceeds its cases reference'],
    ['an extension that rewrites a case reference', [
      ...casedAuthor(),
      event('verification/standard', author({
        operation: 'extend',
        standard: casedSnapshot({ cases: { ...CASES_REF, count: 3 } }, { revision: 2, checks: [check('a', { cases: { ...CASES_REF, count: 3 } }), check('b'), check('c')] }),
        updatedAt: 11,
      }), 1),
    ], 'must preserve the existing check "a"'],
    ['an extension that adds a tree scope to an existing check', [
      ...casedAuthor(),
      event('verification/standard', author({
        operation: 'extend',
        standard: snapshot({ revision: 2, checks: [check('a', { cases: CASES_REF, treeScope: 'out' }), check('b'), check('c')] }),
        updatedAt: 11,
      }), 1),
    ], 'must preserve the existing check "a"'],
  ])('rejects %s', (_name, events, message) => {
    expect(rejection(events)).toContain(message)
  })

  it('accepts a run whose cases pass and the certificate that follows it', () => {
    expect(rejection([
      ...casedAuthor(),
      event('verification/run', run({ results: [casedResult(), result('b')], parity: { weightPassed: 3, weightTotal: 3 } }), 1),
      event('verification/certificate', certificate({}, { results: [casedResult(), result('b')] }), 2),
    ])).toBeUndefined()
  })
})
