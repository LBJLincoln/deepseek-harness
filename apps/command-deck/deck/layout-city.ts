/**
 * The code city's layout.
 *
 * Directories become districts on a grid, files become blocks inside their
 * district. Block footprint is constant and height carries size, so a large
 * file reads as a tower rather than as a sprawl — which keeps the finding
 * beacons above each block separable at a glance.
 *
 * The layout also carries the two values the night-city material needs per
 * building: the fraction of its windows that are lit, which rises with file
 * size, and a window-pattern seed derived from the file path, so one file
 * lights the same windows in every render and in every session.
 */

import type { SafetyTarget, TargetFile } from './contract.ts'

/** One file, placed. */
export interface CityBlock {
  path: string
  language: string
  bytes: number
  x: number
  z: number
  /** Block height in scene units. */
  height: number
  /** Square footprint side in scene units. */
  size: number
  /** Position in `CityLayout.blocks`, which is the instance order of the building mesh. */
  index: number
  /** Directory this block stands in, as `CityDistrict.path` names it. */
  district: string
  /** Fraction of the building's windows that are lit, rising with file size. */
  lit: number
  /** Window-pattern seed in `[0, 1)`, derived from the file path. */
  seed: number
}

/** One directory, placed, with the plate under its blocks. */
export interface CityDistrict {
  path: string
  x: number
  z: number
  width: number
  depth: number
  blocks: CityBlock[]
  /** The language most of the district's files are written in; it colours the district outline. */
  language: string
}

/** The laid-out city. */
export interface CityLayout {
  districts: CityDistrict[]
  /** Every block in one flat list; the order is the building mesh's instance order. */
  blocks: CityBlock[]
  /** Every block by path, for finding placement and selection. */
  byPath: Map<string, CityBlock>
  /** Half-extent of the city footprint, for camera framing. */
  extent: number
}

/** Footprint of one file block. */
const BLOCK = 3.2

/** Gap between blocks inside a district. */
const BLOCK_GAP = 1.5

/** Gap between districts. */
const DISTRICT_GAP = 6

/** Height of the smallest block, so an empty file is still visible. */
const MIN_HEIGHT = 1.4

/** Height of the largest block; every other height scales between the two. */
const MAX_HEIGHT = 17

/** Lit-window fraction of the smallest file. */
const MIN_LIT = 0.08

/** Lit-window fraction of the largest file. */
const MAX_LIT = 0.44

/**
 * Directory of one repository-relative path.
 * @param path - Repository-relative file path.
 * @returns The directory, or `/` for a file at the repository root.
 */
function directoryOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '/' : path.slice(0, cut)
}

/**
 * The window-pattern seed of one file, as an FNV-1a hash folded into `[0, 1)`.
 * @param path - Repository-relative file path.
 * @returns A stable seed for that path.
 */
function seedOf(path: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return ((hash >>> 0) % 4_096) / 4_096
}

/**
 * The language most of a district's files are written in.
 * @param files - The district's files.
 * @returns The most frequent language, ties broken by name.
 */
function dominantLanguage(files: readonly TargetFile[]): string {
  const counts = new Map<string, number>()
  for (const file of files) counts.set(file.language, (counts.get(file.language) ?? 0) + 1)
  return [...counts.entries()]
    .sort((left, right) => (right[1] - left[1]) || left[0].localeCompare(right[0]))[0]?.[0] ?? 'Other'
}

/**
 * Lay out the reviewed repository as a city.
 * @param target - The target the feed reported.
 * @returns Districts, the flat block list, the path index, and the footprint extent.
 */
export function layoutCity(target: SafetyTarget): CityLayout {
  const groups = new Map<string, TargetFile[]>()
  for (const file of target.files) {
    const directory = directoryOf(file.path)
    const list = groups.get(directory) ?? []
    list.push(file)
    groups.set(directory, list)
  }

  const largest = target.files.reduce((acc, file) => Math.max(acc, file.bytes), 1)
  const ordered = [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]))

  // Districts are laid on a near-square grid, widest first along each row.
  const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length)))
  const districts: CityDistrict[] = []
  const blocks: CityBlock[] = []
  const byPath = new Map<string, CityBlock>()

  const sized = ordered.map(([path, files]) => {
    const side = Math.max(1, Math.ceil(Math.sqrt(files.length)))
    const width = (side * BLOCK) + ((side - 1) * BLOCK_GAP) + 3
    return { path, files, side, width }
  })

  const rows: (typeof sized)[] = []
  for (let start = 0; start < sized.length; start += columns) rows.push(sized.slice(start, start + columns))

  const rowDepths = rows.map(row => row.reduce((acc, entry) => Math.max(acc, entry.width), 0))
  const totalDepth = rowDepths.reduce((acc, depth) => acc + depth + DISTRICT_GAP, -DISTRICT_GAP)

  let cursorZ = -totalDepth / 2

  for (const [rowIndex, row] of rows.entries()) {
    const rowDepth = rowDepths[rowIndex] ?? 0
    const rowWidth = row.reduce((acc, entry) => acc + entry.width + DISTRICT_GAP, -DISTRICT_GAP)
    let cursorX = -rowWidth / 2

    for (const entry of row) {
      const originX = cursorX + (entry.width / 2)
      const originZ = cursorZ + (rowDepth / 2)
      const span = (entry.side * BLOCK) + ((entry.side - 1) * BLOCK_GAP)
      const districtBlocks: CityBlock[] = entry.files.map((file, ordinal) => {
        const column = ordinal % entry.side
        const rowInDistrict = Math.floor(ordinal / entry.side)
        const scale = Math.log1p(file.bytes) / Math.log1p(largest)
        const block: CityBlock = {
          path: file.path,
          language: file.language,
          bytes: file.bytes,
          x: originX - (span / 2) + (BLOCK / 2) + (column * (BLOCK + BLOCK_GAP)),
          z: originZ - (span / 2) + (BLOCK / 2) + (rowInDistrict * (BLOCK + BLOCK_GAP)),
          height: MIN_HEIGHT + (scale * (MAX_HEIGHT - MIN_HEIGHT)),
          size: BLOCK,
          index: blocks.length,
          district: entry.path,
          lit: MIN_LIT + (scale * (MAX_LIT - MIN_LIT)),
          seed: seedOf(file.path),
        }
        blocks.push(block)
        byPath.set(file.path, block)
        return block
      })

      districts.push({
        path: entry.path,
        x: originX,
        z: originZ,
        width: entry.width,
        depth: entry.width,
        blocks: districtBlocks,
        language: dominantLanguage(entry.files),
      })
      cursorX += entry.width + DISTRICT_GAP
    }
    cursorZ += rowDepth + DISTRICT_GAP
  }

  const extent = districts.reduce(
    (acc, district) => Math.max(
      acc,
      Math.abs(district.x) + (district.width / 2),
      Math.abs(district.z) + (district.depth / 2),
    ),
    10,
  )

  return { districts, blocks, byPath, extent }
}
