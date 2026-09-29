/**
 * The names a person reads for a run (`deck/display-name.ts`), over the run
 * slugs the committed records and a deck-started review carry.
 */
import { describe, expect, it } from 'vitest'
import type { Run } from '../deck/contract.ts'
import { displayName, subjectName, targetName } from '../deck/display-name.ts'

/** The runs the committed replay carried on 2026-09-29, as `runs.json` lists them. */
const RUNS: Run[] = [
  { id: '2026-09-19-nodegoat-2', kind: 'code-safety', name: '2026-09-19-nodegoat-2', startedAt: '2026-09-19T20:49:38.490Z', endedAt: '2026-09-19T21:10:03.684Z', status: 'completed', path: 'data/code-safety/2026-09-19-nodegoat-2' },
  { id: '2026-09-19-dvja', kind: 'code-safety', name: '2026-09-19-dvja', startedAt: '2026-09-19T19:52:48.808Z', endedAt: '2026-09-19T20:16:23.041Z', status: 'completed', path: 'data/code-safety/2026-09-19-dvja' },
  { id: '2026-09-19-bench-h3-baseline-sonnet-t5', kind: 'fleet', name: '2026-09-19-bench-h3-baseline-sonnet-t5', startedAt: '2026-09-19T18:16:25.944Z', endedAt: '2026-09-19T19:02:23.356Z', status: 'completed', path: 'data/proving-ground/2026-09-19-bench-h3-baseline-sonnet-t5' },
  { id: '2026-09-19-bench-e7-attempts-5-t5-2', kind: 'experiment', name: '2026-09-19-bench-e7-attempts-5-t5-2', startedAt: '2026-09-19T16:37:07.132Z', endedAt: '2026-09-19T18:16:19.904Z', status: 'completed', path: 'data/proving-ground/2026-09-19-bench-e7-attempts-5-t5-2' },
  { id: '2026-09-19-csv-tools-program', kind: 'program', name: '2026-09-19-csv-tools-program', startedAt: '2026-09-19T10:55:12.975Z', endedAt: '2026-09-19T11:00:48.688Z', status: 'completed', path: 'data/proving-ground/2026-09-19-csv-tools-program' },
]

describe('displayName', () => {
  it('names each committed run by its subject, what it was, its day and how long it took', () => {
    expect(RUNS.map(displayName)).toEqual([
      'OWASP NodeGoat · security review · 19 Sep 2026 · 20 min',
      'DVJA, the Damn Vulnerable Java Application · security review · 19 Sep 2026 · 24 min',
      'H3 baseline sonnet t5 · benchmark fleet · 19 Sep 2026 · 46 min',
      'E7 attempts 5 t5 · benchmark experiment · 19 Sep 2026 · 1 h 39 min',
      'CSV tools · program run · 19 Sep 2026 · 6 min',
    ])
  })

  it('reads a review started from the deck by its target and its timestamp', () => {
    expect(displayName({ name: 'NodeGoat-2026-09-19T20-49-35', kind: 'code-safety' })).toBe('OWASP NodeGoat · security review · 19 Sep 2026')
    expect(subjectName('webgoat-2026-09-28T10-00-00')).toBe('Webgoat')
  })

  it('names an arm of an experiment on a known subject in parentheses', () => {
    expect(subjectName('2026-09-27-nodegoat-12-base-d')).toBe('OWASP NodeGoat (base d)')
    expect(subjectName('2026-09-22-nodegoat-4-improved')).toBe('OWASP NodeGoat (improved)')
    expect(subjectName('2026-09-21-nodegoat-3')).toBe('OWASP NodeGoat')
    expect(subjectName('2026-09-27-readme-rows-program')).toBe('README rows')
  })

  it('names a review target by its checkout, never by the path it was read from', () => {
    expect(targetName('<targets>/NodeGoat')).toBe('OWASP NodeGoat')
    expect(targetName('<home>/enterprise-scratch/dsh-subagent-providers/repo')).toBe('dsh-subagent-providers')
  })

  it('leaves out what a review read without its run does not record', () => {
    expect(displayName({ name: '2026-09-19-nodegoat-2' })).toBe('OWASP NodeGoat · 19 Sep 2026')
    expect(displayName({ name: 'plain' })).toBe('Plain')
  })
})
