/**
 * Which file of the reviewed repository each logged tool call opened.
 *
 * The feed places no target file on an event: a tool call carries its arguments
 * and its result in `detail`, and the paths in there are absolute paths on the
 * feed's machine, inside the per-department worktree copies the departments
 * read. The review's inventory (`SafetyTarget.files`) is repository-relative.
 * The two are joined by suffix: an inventory path that one of the event's paths
 * ends on, longest first, is the file the event touched.
 *
 * Only `tool` events are read, and only the admitted window, so scrubbing the
 * timeline moves the trail with it.
 */

'use client'

import { useMemo } from 'react'
import type { RunEvent, SafetyTarget } from '@/deck/contract'
import { eventsUpTo, useDeck } from '@/deck/store'
import { touchColor } from './charters.ts'

/** One inventory file and the most recent event that opened it. */
interface Touch {
  path: string
  /** The acting department's colour; the flare is drawn in it. */
  color: string
  /** Sequence number of that event. A new number restarts the flare. */
  seq: number
}

/** What the admitted events say about the target's files. */
export interface ReadTrail {
  /** The most recent touch per inventory path. */
  byPath: ReadonlyMap<string, Touch>
  /** How many distinct inventory files the admitted events have opened. */
  opened: number
  /** How many files the review's inventory holds. */
  total: number
  /** The last file touched; the only one a reduced-motion city highlights. */
  last: Touch | undefined
}

/**
 * The inventory, indexed for suffix matching, with the per-event resolution
 * cache that belongs to it.
 */
interface PathIndex {
  byBasename: Map<string, string[]>
  /** Resolution per event object; `null` records an event that names no inventory file. */
  resolved: WeakMap<RunEvent, string | null>
  total: number
}

/** Paths a tool's `detail` carries: the tagged path a file tool reports, else bare absolute tokens. */
const TAGGED_PATH = /<path>([^<]+)<\/path>/g

/** An absolute path as it appears inside a tool result, such as a grep hit list. */
const ABSOLUTE_PATH = /\/[\w.][\w./+-]*/g

/** The empty trail, used before a review has loaded. */
const NO_TRAIL: ReadTrail = { byPath: new Map(), opened: 0, total: 0, last: undefined }

/**
 * Index the review's inventory by file name.
 * @param target - The reviewed repository as the feed reports it.
 * @returns The index, carrying its own resolution cache.
 */
function indexTarget(target: SafetyTarget): PathIndex {
  const byBasename = new Map<string, string[]>()
  for (const file of target.files) {
    const basename = file.path.slice(file.path.lastIndexOf('/') + 1)
    const group = byBasename.get(basename)
    if (group === undefined) byBasename.set(basename, [file.path])
    else group.push(file.path)
  }
  return { byBasename, resolved: new WeakMap(), total: target.files.length }
}

/**
 * The paths one tool event names.
 * @param detail - The event's `detail`.
 * @returns The tagged paths when the tool reported any, else every absolute token.
 */
function pathsIn(detail: string): string[] {
  const tagged = [...detail.matchAll(TAGGED_PATH)].map(match => (match[1] ?? '').trim())
  return tagged.length > 0 ? tagged : (detail.match(ABSOLUTE_PATH) ?? [])
}

/**
 * The inventory file one event opened.
 *
 * An event resolves to the longest inventory path that one of its own paths
 * ends on, so `…/repo/program-<digest>-access/app/routes/index.js` resolves to
 * `app/routes/index.js` and a department's own `REPORTING.md` resolves to
 * nothing. The answer is cached on the event.
 * @param event - The event to resolve.
 * @param index - The indexed inventory.
 * @returns The inventory path, or `undefined` when the event names none.
 */
function resolveEvent(event: RunEvent, index: PathIndex): string | undefined {
  const cached = index.resolved.get(event)
  if (cached !== undefined) return cached ?? undefined

  let best: string | undefined
  if (event.detail !== undefined) {
    for (const candidate of pathsIn(event.detail)) {
      const basename = candidate.slice(candidate.lastIndexOf('/') + 1)
      for (const path of index.byBasename.get(basename) ?? []) {
        if (candidate !== path && !candidate.endsWith(`/${path}`)) continue
        if (best === undefined || path.length > best.length) best = path
      }
    }
  }
  index.resolved.set(event, best ?? null)
  return best
}

/**
 * Fold the admitted events into the trail.
 * @param events - The events the timeline admits, in arrival order.
 * @param index - The indexed inventory.
 * @returns The most recent touch per file, and the counters over it.
 */
function foldTrail(events: readonly RunEvent[], index: PathIndex): ReadTrail {
  const byPath = new Map<string, Touch>()
  let last: Touch | undefined
  for (const event of events) {
    if (event.kind !== 'tool') continue
    const path = resolveEvent(event, index)
    if (path === undefined) continue
    const previous = byPath.get(path)
    if (previous !== undefined && previous.seq > event.seq) continue
    const touch: Touch = { path, color: touchColor(event.agentId), seq: event.seq }
    byPath.set(path, touch)
    if (last === undefined || touch.seq >= last.seq) last = touch
  }
  return { byPath, opened: byPath.size, total: index.total, last }
}

/**
 * The read trail of the followed run over one review's inventory.
 * @param target - The reviewed repository, or `undefined` before it has loaded.
 * @returns The trail; empty while no review is loaded.
 */
export function useReadTrail(target: SafetyTarget | undefined): ReadTrail {
  const events = useDeck(state => state.events)
  const cursor = useDeck(state => state.cursor)
  const index = useMemo(() => (target === undefined ? undefined : indexTarget(target)), [target])
  return useMemo(
    () => (index === undefined ? NO_TRAIL : foldTrail(eventsUpTo(events, cursor), index)),
    [events, cursor, index],
  )
}
