/**
 * Tests for the writable-root derivation: the mode's meaning as a canonical
 * allow-list. Pinned here so the fs fence and the Seatbelt profile — both
 * deriving from `writableRoots` — cannot drift. The denied read roots are
 * normalized the same way, so every backend dialect matches resolved paths.
 */

import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalPath, normalizeDeniedReadRoots, writableRoots } from '@deepseek-ai/dsh-sandbox'

describe('canonicalPath', () => {
  it('resolves symlinks (an existing path realpaths)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-roots-'))
    expect(canonicalPath(dir)).toBe(realpathSync.native(dir))
  })

  it('returns the spelling as-is when the path cannot be resolved (conservative — matches nothing until it exists)', () => {
    expect(canonicalPath('/does/not/exist/anywhere-xyz')).toBe('/does/not/exist/anywhere-xyz')
  })
})

describe('writableRoots', () => {
  it('read-only grants nothing', () => {
    expect(writableRoots({ mode: 'read-only', workspaceRoot: process.cwd(), deniedReadRoots: [] })).toEqual([])
  })

  it('workspace-write grants the workspace root plus the platform temp areas, canonical and deduplicated', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-ws-'))
    const roots = writableRoots({ mode: 'workspace-write', workspaceRoot: ws, deniedReadRoots: [] })
    expect(roots).toContain(realpathSync.native(ws))
    expect(roots).toContain(canonicalPath('/tmp'))
    expect(roots).toContain(realpathSync.native(tmpdir()))
    // Deduplicated after canonicalization (/tmp and os.tmpdir() may coincide).
    expect(new Set(roots).size).toBe(roots.length)
  })
})

describe('normalizeDeniedReadRoots', () => {
  it('answers canonical absolute directories in first-seen order, without duplicates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-denied-'))
    const canonical = realpathSync.native(dir)
    expect(normalizeDeniedReadRoots([dir, `${dir}${sep}.`, join(dir, 'child', '..'), tmpdir()]))
      .toEqual([canonical, realpathSync.native(tmpdir())])
  })

  it('resolves a relative spelling against the process cwd rather than passing it through', () => {
    expect(normalizeDeniedReadRoots(['.'])).toEqual([canonicalPath(process.cwd())])
  })

  it('answers nothing for a policy that denies nothing', () => {
    expect(normalizeDeniedReadRoots([])).toEqual([])
  })
})
