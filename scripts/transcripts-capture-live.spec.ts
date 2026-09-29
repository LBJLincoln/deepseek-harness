/**
 * The live transcript capture (`data/transcripts/tools/capture-live.mjs`): each
 * run appends only the whole lines that are new since the run manifests say it
 * last stopped, a file that no longer starts with the captured bytes begins a
 * new epoch without touching the old chunks, every credential shape and e-mail
 * address is masked and counted unless its digest is an accepted placeholder,
 * and the state is read from the committed manifests alone. The synthetic keys
 * and addresses here match the shapes but are invented.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const tool = fileURLToPath(new URL('../data/transcripts/tools/capture-live.mjs', import.meta.url))
const dataset = fileURLToPath(new URL('../data/transcripts/tools/transcripts-to-dataset.mjs', import.meta.url))
const FAKE_OPENROUTER = `sk-or-v1-${'0123456789abcdef'.repeat(4)}`
const FAKE_AWS = `AKIA${'Q'.repeat(16)}`
const PLACEHOLDER = `Bearer ${'placeholder'.repeat(3)}`
const PEM_BODY = 'fedcba9876543210FEDCBA98'.repeat(3)
const EMAIL = 'jane.doe@mailhost.org'

interface Chunk {
  source: string
  path: string
  file: string
  epoch: number
  seq: number
  epochStart?: string
  bytes: [number, number]
  lines: [number, number]
  sha256: string
  prefixSha256: string
  redactions?: Record<string, number>
  pemOpen?: boolean
}

interface Manifest {
  format: string
  capturedAt: string
  redactions: Record<string, number>
  deferred?: { path: string; pendingBytes: number; reason: string }[]
  chunks: Chunk[]
}

let root: string
let sources: string
let live: string

/**
 * Runs one capture over the test's source directory.
 * @param extra - further CLI arguments.
 * @param liveDir - the capture directory.
 * @returns the tool's stdout.
 */
function capture(extra: string[] = [], liveDir = live): string {
  return execFileSync(process.execPath, [tool, '--live', liveDir, '--source', `test:all=${sources}`, '--settle-seconds', '60', ...extra], { encoding: 'utf8' })
}

/** Every run manifest in capture order. */
function manifests(liveDir = live): Manifest[] {
  const runs = join(liveDir, 'runs')
  return readdirSync(runs).sort().flatMap(day => readdirSync(join(runs, day)).sort().map(name => JSON.parse(readFileSync(join(runs, day, name), 'utf8')) as Manifest))
}

/** The chunks of one source file, in capture order. */
function chunksOf(path: string, liveDir = live): Chunk[] {
  return manifests(liveDir).flatMap(manifest => manifest.chunks).filter(chunk => chunk.path === path)
}

/** One chunk's stored text. */
function stored(chunk: Chunk, liveDir = live): string {
  return gunzipSync(readFileSync(join(liveDir, chunk.file))).toString('latin1')
}

/** Ages a file past the settle time. */
function settle(path: string): void {
  const past = new Date(Date.now() - 3_600_000)
  utimesSync(path, past, past)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'capture-live-'))
  sources = join(root, 'sources')
  live = join(root, 'live')
  mkdirSync(sources, { recursive: true })
})

afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('live transcript capture', () => {
  it('appends only the whole lines written since the last run, in contiguous byte and line ranges', () => {
    const log = join(sources, 'session.jsonl')
    writeFileSync(log, '{"n":1}\n{"n":2}\n')
    capture()
    appendFileSync(log, '{"n":3}\n{"n":')
    expect(capture()).toContain('captured 1 chunks')
    const [first, second] = chunksOf(log)
    expect(first).toMatchObject({ epoch: 1, seq: 1, bytes: [0, 16], lines: [0, 2] })
    expect(second).toMatchObject({ epoch: 1, seq: 2, bytes: [16, 24], lines: [2, 3] })
    expect(stored(second!)).toBe('{"n":3}\n')
    expect(second!.sha256).toBe(createHash('sha256').update('{"n":3}\n').digest('hex'))
    expect(second!.prefixSha256).toBe(createHash('sha256').update('{"n":1}\n{"n":2}\n{"n":3}\n').digest('hex'))
    // The unterminated line waits until the file settles, then is taken whole.
    expect(capture()).toContain('nothing new')
    settle(log)
    capture()
    expect(chunksOf(log).at(-1)).toMatchObject({ seq: 3, bytes: [24, 29] })
    expect(chunksOf(log).map(chunk => stored(chunk)).join('')).toBe(readFileSync(log, 'latin1'))
    // An unchanged file writes no manifest.
    const runs = manifests().length
    expect(capture()).toContain('nothing new')
    expect(manifests()).toHaveLength(runs)
  })

  it('begins a new epoch at byte 0 when the file no longer starts with the captured bytes, leaving the old chunks', () => {
    const log = join(sources, 'orchestrator.jsonl')
    writeFileSync(log, '{"a":1}\n{"a":2}\n')
    capture()
    const [old] = chunksOf(log)
    const oldBytes = readFileSync(join(live, old!.file))
    writeFileSync(log, '{"b":1}\n{"b":2}\n{"b":3}\n')
    expect(capture()).toContain(`new epoch 2 for ${log}`)
    const chunks = chunksOf(log)
    expect(chunks).toHaveLength(2)
    expect(chunks[1]).toMatchObject({ epoch: 2, seq: 1, bytes: [0, 24], lines: [0, 3] })
    expect(chunks[1]!.epochStart).toContain('no longer match epoch 1')
    expect(stored(chunks[1]!)).toBe('{"b":1}\n{"b":2}\n{"b":3}\n')
    expect(readFileSync(join(live, old!.file))).toEqual(oldBytes)
    expect(chunks[1]!.file).not.toBe(old!.file)
    // A shorter file is a new epoch as well.
    writeFileSync(log, '{"c":1}\n')
    capture()
    expect(chunksOf(log).at(-1)).toMatchObject({ epoch: 3, bytes: [0, 8] })
  })

  it('masks and counts every credential shape, keeps an accepted placeholder, and masks a PEM block a chunk boundary splits', () => {
    const transcript = join(sources, 'agent.jsonl')
    writeFileSync(transcript, [
      JSON.stringify({ text: `key ${FAKE_OPENROUTER} and ${FAKE_AWS}` }),
      JSON.stringify({ text: `fixture ${PLACEHOLDER}` }),
      JSON.stringify({ text: `read server.key\n-----BEGIN RSA PRIVATE KEY-----\n${PEM_BODY}\n-----END RSA PRIVATE KEY-----\ndone` }),
      '',
    ].join('\n'))
    const cycle = join(sources, 'cycle.log')
    writeFileSync(cycle, `step one\n-----BEGIN OPENSSH PRIVATE KEY-----\n${PEM_BODY}\n`)
    const accept = createHash('sha256').update(PLACEHOLDER).digest('hex')
    capture(['--accept-hit', accept])
    appendFileSync(cycle, `${PEM_BODY}\n-----END OPENSSH PRIVATE KEY-----\nstep two\n`)
    capture(['--accept-hit', accept])

    const [agent] = chunksOf(transcript)
    const agentText = stored(agent!)
    expect(agentText).not.toContain(FAKE_OPENROUTER)
    expect(agentText).not.toContain(FAKE_AWS)
    expect(agentText).not.toContain(PEM_BODY)
    expect(agentText).toContain('[REDACTED-OPENROUTER-KEY]')
    expect(agentText).toContain('[REDACTED-AWS-ACCESS-KEY]')
    expect(agentText).toContain('[REDACTED-PRIVATE-KEY]')
    expect(agentText).toContain(PLACEHOLDER)
    for (const line of agentText.split('\n').filter(Boolean)) expect(() => { JSON.parse(line) }).not.toThrow()
    expect(agent!.redactions).toEqual({ 'private-key': 1, 'openrouter-key': 1, 'aws-access-key': 1 })

    const [head, tail] = chunksOf(cycle)
    expect(stored(head!)).toBe('step one\n[REDACTED-PRIVATE-KEY]\n')
    expect(head!.pemOpen).toBe(true)
    expect(stored(tail!)).toBe('[REDACTED-PRIVATE-KEY]\nstep two\n')
    expect(tail!.pemOpen).toBeUndefined()
    const [first, second] = manifests()
    expect(first!.redactions).toEqual({ 'private-key': 2, 'openrouter-key': 1, 'aws-access-key': 1 })
    expect(second!.redactions).toEqual({ 'private-key': 1 })
  })

  it('masks e-mail addresses and the newer credential shapes in a JSONL chunk and counts each class in the chunk and run manifests', () => {
    const transcript = join(sources, 'session.jsonl')
    const hf = `hf_${'Ab1'.repeat(12)}`
    const awsSecret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYFAKEKEY012'
    writeFileSync(transcript, [
      JSON.stringify({ type: 'system', content: `# userEmail\nThe user's email address is ${EMAIL}.` }),
      JSON.stringify({ text: `git log\nAuthor: Jane <${EMAIL}>\nHF_TOKEN=${hf}\n${FAKE_AWS},${awsSecret}` }),
      '',
    ].join('\n'))
    capture()
    const [chunk] = chunksOf(transcript)
    const text = stored(chunk!)
    expect(text).not.toContain(EMAIL)
    expect(text).not.toContain(hf)
    expect(text).not.toContain(awsSecret)
    expect(text).toContain("The user's email address is [REDACTED-EMAIL].")
    for (const line of text.split('\n').filter(Boolean)) expect(() => { JSON.parse(line) }).not.toThrow()
    const counts = { email: 2, 'huggingface-token': 1, 'aws-secret-key': 1, 'aws-access-key': 1 }
    expect(chunk!.redactions).toEqual(counts)
    expect(manifests()[0]!.redactions).toEqual(counts)
  })

  it('reads its state from the manifests alone, so a copy of the committed tree resumes where the last run stopped', () => {
    const log = join(sources, 'subagent.jsonl')
    writeFileSync(log, '{"x":1}\n')
    capture()
    const restored = join(root, 'restored-live')
    cpSync(live, restored, { recursive: true })
    appendFileSync(log, '{"x":2}\n')
    capture([], restored)
    const chunks = chunksOf(log, restored)
    expect(chunks.map(chunk => chunk.bytes)).toEqual([[0, 8], [8, 16]])
    expect(stored(chunks[1]!, restored)).toBe('{"x":2}\n')
  })

  it('takes at most --max-file-bytes per file per run at a line end and defers the rest', () => {
    const log = join(sources, 'big.log')
    writeFileSync(log, `${'a'.repeat(9)}\n`.repeat(10))
    const output = capture(['--max-file-bytes', '35'])
    expect(output).toContain(`deferred ${log}: took 30 of 100 new bytes`)
    expect(manifests()[0]!.deferred).toEqual([{ path: log, pendingBytes: 70, reason: 'file ceiling' }])
    capture(['--max-file-bytes', '1000'])
    expect(chunksOf(log).map(chunk => chunk.bytes)).toEqual([[0, 30], [30, 100]])
  })

  it('feeds the dataset tool, which reassembles the session from its chunks', () => {
    const projects = join(sources, 'projects', '-repo')
    const session = 'sess-1'
    mkdirSync(join(projects, session, 'subagents'), { recursive: true })
    const line = (type: string, text: string, at: string) => `${JSON.stringify({ type, sessionId: session, uuid: `${type}-${at}`, timestamp: at, message: { role: type, content: [{ type: 'text', text }] } })}\n`
    writeFileSync(join(projects, `${session}.jsonl`), line('user', 'build it', '2026-09-28T20:00:00Z'))
    writeFileSync(join(projects, session, 'subagents', 'agent-abc.jsonl'), line('user', 'sub task', '2026-09-28T20:01:00Z') + line('assistant', 'done', '2026-09-28T20:02:00Z'))
    capture()
    appendFileSync(join(projects, `${session}.jsonl`), line('assistant', 'built', '2026-09-28T20:05:00Z'))
    capture()
    const out = join(root, 'dataset')
    execFileSync(process.execPath, [dataset, live, out, '--session', session], { encoding: 'utf8' })
    const agents = readFileSync(join(out, 'agents.jsonl'), 'utf8').trim().split('\n').map(raw => JSON.parse(raw) as { id: string; kind: string; turns: number })
    expect(agents.map(({ id, kind, turns }) => ({ id, kind, turns }))).toEqual([
      { id: session, kind: 'orchestrator', turns: 2 },
      { id: 'abc', kind: 'subagent', turns: 2 },
    ])
  })
})
