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
      results: [{ checkId: 'a', status: 'pass' }, { checkId: 'b', status: 'fail', evidence: 'red' }],
    })
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
