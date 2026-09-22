import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  admittedExercises, applyReference, exercisePrompt, HELD_OUT_SHARE, heldOutIds, POLYGLOT_LANGUAGES, POLYGLOT_TEST_COMMANDS, readAdmission,
  readExercise, splitTrack, stageExercise,
} from './fixtures/polyglot-bench/polyglot.ts'
import type { PolyglotAdmission } from './fixtures/polyglot-bench/polyglot.ts'

const fixtureDir = fileURLToPath(new URL('./fixtures/polyglot-bench/', import.meta.url))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'polyglot-bench-spec-'))
  roots.push(root)
  return root
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

function git(checkout: string, ...args: string[]): string {
  return execFileSync('git', ['-C', checkout, '-c', 'user.name=spec', '-c', 'user.email=spec@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
}

const CMAKE = 'get_filename_component(exercise ${CMAKE_CURRENT_SOURCE_DIR} NAME)\nproject(${exercise} CXX)\n'
const TWO_FER = 'python/exercises/practice/two-fer'
const HELLO = 'cpp/exercises/practice/hello-world'
/**
 * An exercise's documentation directory. The paths below name it through this
 * constant so the documentation-reference gate does not read them as
 * repository documents.
 */
const DOCS = '.docs'

/** A committed two-exercise checkout: one Python exercise, one C++ exercise, and empty Go and Rust tracks. */
function fakeCheckout(): { checkout: string; revision: string } {
  const checkout = scratch()
  write(checkout, {
    [`${TWO_FER}/.meta/config.json`]: JSON.stringify({
      files: { solution: ['two_fer.py'], test: ['two_fer_test.py'], example: ['.meta/example.py'] },
    }),
    [`${TWO_FER}/.meta/example.py`]: 'def two_fer(name="you"):\n    return f"One for {name}, one for me."\n',
    [`${TWO_FER}/${DOCS}/introduction.md`]: '# Introduction\n\nSharing is caring.\n',
    [`${TWO_FER}/${DOCS}/instructions.md`]: '# Instructions\n\nSay who gets one.\n',
    [`${TWO_FER}/${DOCS}/hints.md`]: '# Hints\n\nUse a default argument.\n',
    [`${TWO_FER}/.approaches/default/content.md`]: 'return f"One for {name}, one for me."\n',
    [`${TWO_FER}/two_fer.py`]: 'def two_fer(name="you"):\n    pass\n',
    [`${TWO_FER}/two_fer_test.py`]: 'from two_fer import two_fer\n',
    [`${HELLO}/.meta/config.json`]: JSON.stringify({
      files: { solution: ['hello_world.cpp', 'hello_world.h'], test: ['hello_world_test.cpp'], example: ['.meta/example.cpp', '.meta/example.h'] },
    }),
    [`${HELLO}/.meta/example.cpp`]: '// reference body\n',
    [`${HELLO}/.meta/example.h`]: '// reference header\n',
    [`${HELLO}/${DOCS}/instructions.md`]: '# Instructions\n\nGreet the world.\n',
    [`${HELLO}/${DOCS}/instructions.append.md`]: '# Append\n\nUse the namespace.\n',
    [`${HELLO}/CMakeLists.txt`]: CMAKE,
    [`${HELLO}/hello_world.cpp`]: '// stub body\n',
    [`${HELLO}/hello_world.h`]: '// stub header\n',
    [`${HELLO}/hello_world_test.cpp`]: '// test\n',
    [`${HELLO}/test/tests-main.cpp`]: '// main\n',
  })
  mkdirSync(join(checkout, 'go', 'exercises', 'practice'), { recursive: true })
  mkdirSync(join(checkout, 'rust', 'exercises', 'practice'), { recursive: true })
  git(checkout, 'init', '--quiet')
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '--quiet', '--message', 'exercises')
  return { checkout, revision: git(checkout, 'rev-parse', 'HEAD') }
}

function admission(revision: string, overrides: Partial<PolyglotAdmission> = {}): PolyglotAdmission {
  return {
    repository: 'https://example.invalid/polyglot-benchmark',
    revision,
    toolchains: { cpp: 'c++', go: 'go', python: 'python', rust: 'rust' },
    admitted: ['polyglot:cpp:hello-world', 'polyglot:python:two-fer'],
    refused: [],
    ...overrides,
  }
}

describe('polyglot bench exercise model', () => {
  it('reads the editable files and pairs each reference file with the one it replaces', () => {
    const { checkout } = fakeCheckout()
    const exercise = readExercise(checkout, 'cpp', 'hello-world')
    expect(exercise.id).toBe('polyglot:cpp:hello-world')
    expect(exercise.editable).toEqual(['hello_world.cpp', 'hello_world.h'])
    expect(exercise.references).toEqual([
      { from: '.meta/example.cpp', to: 'hello_world.cpp' },
      { from: '.meta/example.h', to: 'hello_world.h' },
    ])
  })

  it('refuses a reference file that shares its extension with no editable file', () => {
    const { checkout } = fakeCheckout()
    write(checkout, {
      'python/exercises/practice/two-fer/.meta/config.json': JSON.stringify({
        files: { solution: ['two_fer.py'], test: ['two_fer_test.py'], example: ['.meta/example.rb'] },
      }),
    })
    expect(() => readExercise(checkout, 'python', 'two-fer')).toThrow('reference file .meta/example.rb shares its extension with 0 editable files')
  })

  it('stages the exercise without its dot-directories, keeps .meta as the reference, and names the C++ exercise outright', () => {
    const { checkout } = fakeCheckout()
    const root = scratch()
    const python = join(root, 'python')
    expect(stageExercise(readExercise(checkout, 'python', 'two-fer'), python)).toEqual(['two_fer_test.py'])
    expect(readdirSync(python).sort()).toEqual(['.meta', 'two_fer.py', 'two_fer_test.py'])
    const cpp = join(root, 'cpp')
    expect(stageExercise(readExercise(checkout, 'cpp', 'hello-world'), cpp)).toEqual(['CMakeLists.txt', 'hello_world_test.cpp', 'test/tests-main.cpp'])
    expect(readFileSync(join(cpp, 'CMakeLists.txt'), 'utf8')).toBe('set(exercise hello-world)\nproject(${exercise} CXX)\n')
    expect(() => stageExercise(readExercise(checkout, 'cpp', 'hello-world'), cpp)).toThrow('which already exists')
  })

  it('refuses a C++ exercise whose CMakeLists.txt names its exercise some other way', () => {
    const { checkout } = fakeCheckout()
    write(checkout, { 'cpp/exercises/practice/hello-world/CMakeLists.txt': 'project(hello-world CXX)\n' })
    expect(() => stageExercise(readExercise(checkout, 'cpp', 'hello-world'), join(scratch(), 'cpp'))).toThrow('does not name its exercise by the one line')
  })

  it('applies the reference over the stubs it replaces', () => {
    const { checkout } = fakeCheckout()
    const root = scratch()
    const exercise = readExercise(checkout, 'cpp', 'hello-world')
    stageExercise(exercise, join(root, 'fixture'))
    write(root, { 'workspace/hello_world.cpp': '// stub body\n', 'workspace/hello_world.h': '// stub header\n' })
    applyReference(exercise, join(root, 'fixture'), join(root, 'workspace'))
    expect(readFileSync(join(root, 'workspace', 'hello_world.cpp'), 'utf8')).toBe('// reference body\n')
    expect(readFileSync(join(root, 'workspace', 'hello_world.h'), 'utf8')).toBe('// reference header\n')
  })

  it('prompts with the introduction, the instructions, and the appendix, then names the files and the command', () => {
    const { checkout } = fakeCheckout()
    expect(exercisePrompt(readExercise(checkout, 'python', 'two-fer'))).toBe([
      '# Introduction\n\nSharing is caring.',
      '# Instructions\n\nSay who gets one.',
      'Change only `two_fer.py`, keeping the names the tests use and nothing beyond the standard library, so that `python3 -m pytest -q` passes in the workspace root; every other file stays as it is.',
    ].join('\n\n'))
    expect(exercisePrompt(readExercise(checkout, 'cpp', 'hello-world'))).toBe([
      '# Instructions\n\nGreet the world.',
      '# Append\n\nUse the namespace.',
      `Change only \`hello_world.cpp\` and \`hello_world.h\`, keeping the names the tests use and nothing beyond the standard library, so that \`${POLYGLOT_TEST_COMMANDS.cpp}\` passes in the workspace root; every other file stays as it is.`,
    ].join('\n\n'))
  })

  it('reads the admitted exercises of a checkout the record describes', () => {
    const { checkout, revision } = fakeCheckout()
    expect(admittedExercises(checkout, admission(revision)).map(exercise => exercise.id)).toEqual(['polyglot:cpp:hello-world', 'polyglot:python:two-fer'])
    expect(admittedExercises(checkout, admission(revision, {
      admitted: ['polyglot:python:two-fer'],
      refused: [{ id: 'polyglot:cpp:hello-world', reason: 'the stub passes its own tests' }],
    })).map(exercise => exercise.id)).toEqual(['polyglot:python:two-fer'])
  })

  it('refuses a checkout at another revision, naming both', () => {
    const { checkout, revision } = fakeCheckout()
    const pinned = 'a'.repeat(40)
    expect(() => admittedExercises(checkout, admission(pinned))).toThrow(`is at ${revision}, and admission ran against ${pinned}`)
  })

  it('refuses a checkout with untracked or changed files under a registered track', () => {
    const { checkout, revision } = fakeCheckout()
    write(checkout, { 'python/exercises/practice/two-fer/__pycache__/two_fer.pyc': 'bytecode' })
    expect(() => admittedExercises(checkout, admission(revision))).toThrow('python/exercises/practice/two-fer/__pycache__/two_fer.pyc')
    rmSync(join(checkout, 'python/exercises/practice/two-fer/__pycache__'), { recursive: true })
    write(checkout, { 'cpp/exercises/practice/hello-world/hello_world.cpp': '// edited\n' })
    expect(() => admittedExercises(checkout, admission(revision))).toThrow('cpp/exercises/practice/hello-world/hello_world.cpp')
  })

  it('refuses a record that leaves an exercise unclassified or classifies one the checkout lacks', () => {
    const { checkout, revision } = fakeCheckout()
    expect(() => admittedExercises(checkout, admission(revision, { admitted: ['polyglot:python:two-fer'] })))
      .toThrow('unclassified ["polyglot:cpp:hello-world"]')
    expect(() => admittedExercises(checkout, admission(revision, { refused: [{ id: 'polyglot:go:counter', reason: 'no tests' }] })))
      .toThrow('absent ["polyglot:go:counter"]')
  })

  it('holds out the same fifth of each track whatever the order or the rest of the track', () => {
    // 24 and 23 exercises both hold out five, so removing one open exercise leaves the held-out ones where they were.
    const ids = Array.from({ length: 24 }, (_, index) => `polyglot:go:exercise-${index}`)
    const split = splitTrack(ids, 'go')
    expect(split.heldOut).toHaveLength(Math.round(ids.length * HELD_OUT_SHARE))
    expect([...split.heldOut, ...split.open].sort()).toEqual([...ids].sort())
    expect(splitTrack([...ids].reverse(), 'go')).toEqual(split)
    const fewer = splitTrack(ids.filter(id => id !== split.open[0]), 'go')
    expect(fewer.open).toEqual(split.open.slice(1))
    expect(heldOutIds([...ids, 'polyglot:rust:alone'])).toEqual(new Set(split.heldOut))
  })
})

describe('polyglot bench admission record and plans', () => {
  const record = readAdmission(join(fixtureDir, 'admission.json'))

  it('classifies each exercise once and pins a full commit of the benchmark', () => {
    expect(record.repository).toBe('https://github.com/Aider-AI/polyglot-benchmark')
    expect(record.revision).toBe('7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f')
    expect(record.admitted).toEqual([...record.admitted].sort())
    for (const language of POLYGLOT_LANGUAGES) expect(record.admitted.some(id => id.startsWith(`polyglot:${language}:`))).toBe(true)
  })

  it('refuses a record that classifies one exercise twice or pins no full commit', () => {
    const path = join(scratch(), 'admission.json')
    writeFileSync(path, JSON.stringify({ ...record, refused: [{ id: record.admitted[0], reason: 'twice' }] }))
    expect(() => readAdmission(path)).toThrow('classifies one exercise twice')
    writeFileSync(path, JSON.stringify({ ...record, revision: '7e0611e7' }))
    expect(() => readAdmission(path)).toThrow('names no full commit id as its revision')
  })

  it.each([
    ['polyglot-smoke-sonnet', 2],
    ['polyglot-core-sonnet', 10],
  ])('%s takes the first %i open exercises of every track, none held out', (plan, perTrack) => {
    const path = join(fixtureDir, 'plans', `${plan}.json`)
    expect(existsSync(path)).toBe(true)
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { name: string; environments: string[]; repetitions: number }
    expect(parsed.name).toBe(plan)
    expect(parsed.repetitions).toBe(1)
    const expected = POLYGLOT_LANGUAGES.flatMap(language => splitTrack(record.admitted, language).open.slice(0, perTrack))
    expect(parsed.environments).toEqual(expected)
  })
})
