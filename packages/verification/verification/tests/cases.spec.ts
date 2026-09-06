import { describe, expect, it } from 'vitest'
import {
  applyCaseNormalizer,
  caseBodiesSha256,
  caseChannelDigest,
  CHECK_CASE_CHANNELS,
  CHECK_CASE_NORMALIZERS,
  CheckCaseId,
  CheckId,
  checkCasesRef,
  normalizeCaseBytes,
  resolveAuthoredCases,
  VerificationError,
} from '@deepseek-ai/dsh-verification'
import type { AuthoredCheck, CheckCase, CheckCaseChannel, CheckCaseNormalizer } from '@deepseek-ai/dsh-verification'

const apply = (normalizer: CheckCaseNormalizer, text: string): string =>
  applyCaseNormalizer(Buffer.from(text, 'utf8'), normalizer).toString('utf8')

/** Each normalizer's stated effect, paired with an input its second application must not change further. */
const EFFECTS: readonly { normalizer: CheckCaseNormalizer; input: string; output: string }[] = [
  { normalizer: 'crlf', input: 'a\r\nb\r\n', output: 'a\nb\n' },
  { normalizer: 'trailing-whitespace', input: 'a  \nb\t\t\nc', output: 'a\nb\nc' },
  { normalizer: 'blank-lines', input: '\n\na\n\n\nb\n\n', output: 'a\n\nb' },
  {
    normalizer: 'iso8601-timestamps',
    input: 'built 2026-09-06T09:15:00.123Z and 2026-01-02 03:04:05+02:00',
    output: 'built <timestamp> and <timestamp>',
  },
  {
    normalizer: 'temp-paths',
    input: 'wrote /tmp/out.txt, /private/tmp/x, /var/folders/ab/cd/T/y and C:\\Users\\me\\AppData\\Local\\Temp\\z',
    output: 'wrote <temp>/out.txt, <temp>/x, <temp>/y and <temp>\\z',
  },
  { normalizer: 'json-canonical', input: '{ "b": 1, "a": [ 2, { "d": 3, "c": 4 } ] }\n', output: '{"a":[2,{"c":4,"d":3}],"b":1}' },
]

const CASE: CheckCase = {
  id: CheckCaseId('reverse-empty'),
  weight: 2,
  input: { argv: ['--reverse'], stdin: 'ab\n', files: { 'in/data.txt': 'seed' } },
  expected: { stdoutSha256: 'a'.repeat(64) },
  comparator: { channels: ['stdout'], normalizers: ['crlf'] },
}

function check(rest: Partial<AuthoredCheck> = {}, bodies: readonly CheckCase[] = [CASE]): AuthoredCheck {
  return {
    id: CheckId('reverses-lines'),
    outcome: 'the program reverses each line',
    run: 'node reverse.js',
    cases: checkCasesRef(bodies),
    caseBodies: bodies,
    ...rest,
  }
}

const rejects = (candidate: AuthoredCheck, reason: string | RegExp): void => {
  expect(() => resolveAuthoredCases(candidate)).toThrow(VerificationError)
  expect(() => resolveAuthoredCases(candidate)).toThrow(reason)
}

describe('the closed normalizer set', () => {
  it('declares every channel and normalizer in one order', () => {
    expect(CHECK_CASE_CHANNELS).toEqual(['exit', 'stdout', 'stderr', 'tree'])
    expect(CHECK_CASE_NORMALIZERS).toEqual([
      'crlf',
      'trailing-whitespace',
      'blank-lines',
      'iso8601-timestamps',
      'temp-paths',
      'json-canonical',
    ])
    expect(EFFECTS.map(effect => effect.normalizer)).toEqual([...CHECK_CASE_NORMALIZERS])
  })

  it.each(EFFECTS)('applies $normalizer once and is idempotent', ({ normalizer, input, output }) => {
    expect(apply(normalizer, input)).toBe(output)
    expect(apply(normalizer, output)).toBe(output)
  })

  it('leaves bytes that are not JSON alone under json-canonical', () => {
    expect(apply('json-canonical', 'not json {')).toBe('not json {')
  })

  it('applies a comparator chain in order and digests the result', () => {
    const chained = normalizeCaseBytes(Buffer.from('a  \r\n\r\n\r\nb\r\n', 'utf8'), [
      'crlf',
      'trailing-whitespace',
      'blank-lines',
    ]).toString('utf8')
    expect(chained).toBe('a\n\nb')
    expect(caseChannelDigest(Buffer.from('a  \r\n\r\n\r\nb\r\n', 'utf8'), ['crlf', 'trailing-whitespace', 'blank-lines']))
      .toBe(caseChannelDigest(Buffer.from('a\n\nb', 'utf8'), []))
  })
})

describe('the canonical case-body digest', () => {
  it('ignores object key order and changes with any case field', () => {
    const reordered: CheckCase = {
      comparator: { normalizers: ['crlf'], channels: ['stdout'] },
      expected: { stdoutSha256: 'a'.repeat(64) },
      input: { files: { 'in/data.txt': 'seed' }, stdin: 'ab\n', argv: ['--reverse'] },
      weight: 2,
      id: CheckCaseId('reverse-empty'),
    }
    expect(caseBodiesSha256([reordered])).toBe(caseBodiesSha256([CASE]))
    expect(caseBodiesSha256([{ ...CASE, weight: 3 }])).not.toBe(caseBodiesSha256([CASE]))
    expect(caseBodiesSha256([{ ...CASE, input: { argv: [] } }])).not.toBe(caseBodiesSha256([CASE]))
    expect(checkCasesRef([CASE, { ...CASE, id: CheckCaseId('reverse-one'), weight: 3 }]))
      .toMatchObject({ count: 2, weightTotal: 5 })
  })
})

describe('authoring validation of cases', () => {
  it('accepts a complete cased check and returns its bodies', () => {
    expect(resolveAuthoredCases(check())).toEqual([CASE])
    expect(resolveAuthoredCases({ id: CheckId('plain'), outcome: 'exits zero', run: 'true' })).toBeUndefined()
  })

  it('refuses a reference that does not describe the bodies handed in', () => {
    rejects(
      { ...check(), cases: { ...checkCasesRef([CASE]), sha256: 'b'.repeat(64) } },
      /cases reference does not describe the bodies handed in/,
    )
    rejects({ ...check(), cases: { ...checkCasesRef([CASE]), count: 2 } }, /expected count 1/)
    rejects({ ...check(), cases: { ...checkCasesRef([CASE]), weightTotal: 9 } }, /weightTotal 2/)
  })

  it('refuses a reference without bodies, bodies without a reference, and an empty body list', () => {
    const { caseBodies: _bodies, ...withoutBodies } = check()
    rejects(withoutBodies, 'references cases without handing in their bodies')
    const { cases: _ref, ...withoutReference } = check()
    rejects(withoutReference, 'carries case bodies without a cases reference')
    rejects({ ...check(), cases: checkCasesRef([]), caseBodies: [] }, 'references cases but hands in none')
  })

  it('refuses an unknown normalizer id and an unknown or repeated channel', () => {
    rejects(
      check({}, [{ ...CASE, comparator: { channels: ['stdout'], normalizers: ['unicode' as CheckCaseNormalizer] } }]),
      'names unknown normalizer "unicode"',
    )
    rejects(
      check({}, [{ ...CASE, comparator: { channels: ['stdout', 'stdout'], normalizers: [] } }]),
      'repeats channel "stdout"',
    )
    rejects(
      check({}, [{ ...CASE, comparator: { channels: ['fd3' as CheckCaseChannel], normalizers: [] } }]),
      'names unknown channel "fd3"',
    )
    rejects(check({}, [{ ...CASE, comparator: { channels: [], normalizers: [] } }]), 'compares no channel')
  })

  it('refuses a configured channel without an expected value', () => {
    rejects(
      check({}, [{ ...CASE, comparator: { channels: ['exit'], normalizers: [] } }]),
      'compares "exit" without an expected value',
    )
    rejects(
      check({ treeScope: 'out' }, [{ ...CASE, comparator: { channels: ['tree'], normalizers: [] } }]),
      'compares "tree" without an expected value',
    )
  })

  it('refuses a non-positive weight, a duplicate case id, and an id that is not lower-kebab-case', () => {
    rejects(check({}, [{ ...CASE, weight: 0 }]), 'weight of case "reverse-empty" must be a positive safe integer')
    rejects(check({}, [{ ...CASE, weight: 1.5 }]), 'weight of case "reverse-empty" must be a positive safe integer')
    rejects(check({}, [CASE, CASE]), 'repeats case id "reverse-empty"')
    rejects(check({}, [{ ...CASE, id: CheckCaseId('Reverse') }]), 'id "Reverse" must be lower-kebab-case')
  })

  it('refuses an argv word that needs shell quoting', () => {
    rejects(check({}, [{ ...CASE, input: { argv: ['two words'] } }]), 'argv word "two words" needs shell quoting')
  })

  it('refuses a staged file path the runner cannot resolve under the workspace', () => {
    const staged = (path: string): AuthoredCheck => check({}, [{ ...CASE, input: { argv: [], files: { [path]: 'x' } } }])
    rejects(staged(''), 'staged file is empty')
    rejects(staged('/etc/passwd'), 'is not workspace-relative')
    rejects(staged('C:/tmp/x'), 'is not workspace-relative')
    rejects(staged('in\\data.txt'), 'uses a backslash')
    rejects(staged('in//data.txt'), 'it holds a "" segment')
    rejects(staged('in/../data.txt'), 'it holds a ".." segment')
    rejects(staged('./data.txt'), 'it holds a "." segment')
  })

  it('requires a treeScope exactly when a case compares the work tree', () => {
    rejects(
      check({}, [{ ...CASE, expected: { treeSha256: 'c'.repeat(64) }, comparator: { channels: ['tree'], normalizers: [] } }]),
      'compares the work tree without a treeScope',
    )
    rejects(check({ treeScope: 'out' }), 'declares a treeScope no case compares')
    rejects({ id: CheckId('plain'), outcome: 'exits zero', run: 'true', treeScope: 'out' }, 'declares a treeScope without cases')
    rejects(
      check({ treeScope: '../out' }, [{
        ...CASE,
        expected: { treeSha256: 'c'.repeat(64) },
        comparator: { channels: ['tree'], normalizers: [] },
      }]),
      'treeScope "../out" is not normalized',
    )
  })
})
