// Reads the live transcript capture under data/transcripts/live/, as written by
// capture-live.mjs: the run manifests, the per-file capture state they imply,
// and the source files reassembled from their gzip chunks. Node built-ins only.
//
// Layout under <live>:
//   runs/<YYYY-MM-DD>/<run>.json   one immutable manifest per capture run that
//                                  wrote anything; `chunks` lists every chunk
//                                  the run wrote
//   <source>/<first capture date>/<file key>/e<epoch>/<capture date>/<seq>.<ext>.gz
//                                  one immutable chunk: the bytes [start, end)
//                                  of one source file in one epoch, redacted
//
// A source file's epoch is the unbroken byte sequence the capture has seen it
// grow through. When a file no longer starts with the bytes already captured
// (a restore rewrote it), the capture begins the next epoch at byte 0 and the
// earlier epochs stay as they were.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

/** The `format` field of every run manifest this module reads. */
export const LIVE_FORMAT = 'dsh-live-transcripts/1'

/**
 * Reads every run manifest in capture order.
 * @param {string} liveDir the live capture directory
 * @returns {Array<Record<string, any>>} parsed manifests, oldest first
 */
export function readRuns(liveDir) {
  const runsDir = join(liveDir, 'runs')
  if (!existsSync(runsDir)) return []
  const paths = []
  for (const day of readdirSync(runsDir).sort()) {
    for (const name of readdirSync(join(runsDir, day)).sort()) {
      if (name.endsWith('.json')) paths.push(join(runsDir, day, name))
    }
  }
  return paths.map((path) => {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    if (manifest.format !== LIVE_FORMAT) throw new Error(`${path}: format ${manifest.format}, expected ${LIVE_FORMAT}`)
    return manifest
  })
}

/**
 * Folds the run manifests into the capture state of every source file: the
 * last chunk captured of its latest epoch.
 * @param {Array<Record<string, any>>} runs manifests from readRuns
 * @returns {Map<string, Record<string, any>>} source path to its latest chunk entry
 */
export function captureState(runs) {
  const state = new Map()
  for (const run of runs) {
    for (const chunk of run.chunks) {
      const previous = state.get(chunk.path)
      if (previous === undefined || chunk.epoch > previous.epoch || (chunk.epoch === previous.epoch && chunk.seq > previous.seq)) {
        state.set(chunk.path, chunk)
      }
    }
  }
  return state
}

/**
 * Reassembles every captured source file, epoch by epoch, from its chunks.
 * @param {string} liveDir the live capture directory
 * @param {(chunk: Record<string, any>) => boolean} [select] keeps only the chunks it accepts
 * @returns {Map<string, { source: string, epochs: { epoch: number, bytes: Buffer }[] }>} source path to its epochs in order
 */
export function reassemble(liveDir, select = () => true) {
  const byPath = new Map()
  for (const run of readRuns(liveDir)) {
    for (const chunk of run.chunks) {
      if (!select(chunk)) continue
      const entry = byPath.get(chunk.path) ?? { source: chunk.source, chunks: [] }
      entry.chunks.push(chunk)
      byPath.set(chunk.path, entry)
    }
  }
  const files = new Map()
  for (const [path, { source, chunks }] of byPath) {
    chunks.sort((left, right) => left.epoch - right.epoch || left.seq - right.seq)
    const epochs = []
    for (const chunk of chunks) {
      let current = epochs.at(-1)
      if (current === undefined || current.epoch !== chunk.epoch) {
        current = { epoch: chunk.epoch, parts: [], end: 0 }
        epochs.push(current)
      }
      if (chunk.bytes[0] !== current.end) {
        throw new Error(`${path}: epoch ${chunk.epoch} chunk ${chunk.seq} starts at byte ${chunk.bytes[0]}, the epoch holds ${current.end}`)
      }
      current.parts.push(gunzipSync(readFileSync(join(liveDir, chunk.file))))
      current.end = chunk.bytes[1]
    }
    files.set(path, { source, epochs: epochs.map(({ epoch, parts }) => ({ epoch, bytes: Buffer.concat(parts) })) })
  }
  return files
}
