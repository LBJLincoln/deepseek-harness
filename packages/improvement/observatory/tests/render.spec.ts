/**
 * The HTML face: the honest column set in one table, `resolved` and `parity`
 * under their own headings, `pending` where no composition digest covers a row,
 * the no-ranking sentence where no verdict earns a ranking, and the staleness
 * notice in place of every figure once the fold is too old.
 */

import { describe, expect, it } from 'vitest'
import {
  duration,
  escapeHtml,
  NO_RANKING_SENTENCE,
  publishDocument,
  renderHtml,
  STALE_SENTENCE,
} from '@deepseek-ai/dsh-observatory'
import { experiment, row, snapshot } from './row.ts'

const DIGEST = 'a'.repeat(64)
const COMPOSITION = 'c'.repeat(64)

/** The page one snapshot renders at the given instant against a one-minute threshold. */
function page(overrides: Parameters<typeof snapshot>[0] = {}, now = 1_000_500): string {
  return renderHtml(publishDocument(snapshot(overrides), now, 60_000))
}

describe('escapeHtml', () => {
  it('escapes every HTML-significant character of a logged value', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
  })
})

describe('duration', () => {
  it('states a duration in the largest whole unit that divides it', () => {
    expect(duration(7_200_000)).toBe('2 h')
    expect(duration(900_000)).toBe('15 min')
    expect(duration(90_000)).toBe('90 s')
    expect(duration(1500)).toBe('1500 ms')
  })
})

describe('renderHtml', () => {
  it('names the fold time, the newest folded session, and the batch refresh interval', () => {
    const html = page({ rows: [row()] })
    expect(html).toContain('Folded at 1970-01-01T00:16:40.500Z.')
    expect(html).toContain('Newest folded session: 1970-01-01T00:16:40.000Z.')
    expect(html).toContain('Batch refresh interval: 15 min.')
    expect(html).toContain('Stale after 1 min.')
  })

  it('publishes resolved and parity as two columns under their own names', () => {
    const html = page({ rows: [row({ runs: 4, certified: 1, certificateRate: 0.25, parity: 0.75 })] })
    expect(html).toContain('<th scope="col">Resolved</th>')
    expect(html).toContain('<th scope="col">Parity</th>')
    expect(html).toContain('<td>25.0 % (1/4)</td>')
    expect(html).toContain('<td>75.0 %</td>')
    // The two never collapse into the figure a merged score would print.
    expect(html).not.toContain('50.0 %')
  })

  it('states none where a row measured no cases and no run where a row recorded none', () => {
    const html = page({ rows: [row({ runs: 0, errors: 2, certified: 0, certificateRate: 0 })] })
    expect(html).toContain('<td>no run</td>')
    expect(html).toContain('<td>not instrumented</td>')
    expect(html).toContain('<td>none</td>')
  })

  it('prints pending where no composition digest covers the row and the digest where one does', () => {
    expect(page({ rows: [row()] })).toContain('<td>pending</td>')
    expect(page({ rows: [row({ compositionSha256: COMPOSITION })] })).toContain(`<td>${COMPOSITION}</td>`)
  })

  it('flags the held-out split of a row a deployment chose to publish', () => {
    expect(page({ rows: [row({ heldOut: true })] })).toContain('<td>yes</td>')
    expect(page({ rows: [row()] })).toContain('<td>no</td>')
  })

  it('prints the district of a districted row and names a row outside every district', () => {
    expect(page({ rows: [row({ district: 'proving-ground' })] })).toContain('<td>proving-ground</td>')
    expect(page({ rows: [row()] })).toContain('<td>none</td>')
  })

  it('prints the certificate executor of the row and names a row that certified nothing', () => {
    expect(page({ rows: [row()] })).toContain('<td>runner</td>')
    expect(page({ rows: [row({ certificateExecutors: [] })] })).toContain('<td>no certificate</td>')
  })

  it('prints the tampered sessions of a row beside its runs', () => {
    expect(page({ rows: [row({ runs: 4, tampered: 1 })] })).toContain('<td>tampered 1 of 4</td>')
    expect(page({ rows: [row()] })).toContain('<td>no tamper</td>')
  })

  it('prints the cost beside its pricing digest and states nothing where the rule withholds it', () => {
    const priced = page({ rows: [row({ costEurPerCertified: 0.000_12, pricingDigests: [DIGEST] })] })
    expect(priced).toContain(`<td>€0.000120 · ${DIGEST}</td>`)
    expect(page({ rows: [row()] })).toContain('<td>not published</td>')
  })

  it('prints the no-ranking sentence until a verdict earns a ranking', () => {
    expect(page({ rows: [row()] })).toContain(escapeHtml(NO_RANKING_SENTENCE))
    const ranked = page({
      rows: [row({ model: 'left' }), row({ model: 'right' })],
      experiments: [experiment('left', 'right', 'promote')],
    })
    expect(ranked).not.toContain(escapeHtml(NO_RANKING_SENTENCE))
    expect(ranked).toContain('cli-mock/left versus cli-mock/right')
    expect(ranked).toContain('<strong>promote</strong>')
  })

  it('states what withholding removed from a current page', () => {
    const html = renderHtml(publishDocument({
      ...snapshot({ rows: [row()] }),
      withheld: { districts: ['workshop'], districtRows: 1, districtSessions: 4, heldOutRows: 2, heldOutSessions: 3 },
    }, 1_000_500, 60_000))
    expect(html).toContain('Withheld districts: workshop.')
    expect(html).toContain('District rows withheld: 1 (4 sessions).')
    expect(html).toContain('Held-out rows withheld: 2 (3 sessions).')
    expect(renderHtml(publishDocument(snapshot({ rows: [row()] }), 1_000_500, 60_000)))
      .toContain('Withheld districts: none.')
  })

  it('names an empty fold rather than printing a table with no row', () => {
    expect(page()).toContain('No row survived this fold')
  })

  it('replaces every figure with the staleness notice once the fold is too old', () => {
    const stale = page({
      rows: [row({ runs: 4, certified: 1, certificateRate: 0.25, parity: 0.75, costEurPerCertified: 0.000_12, pricingDigests: [DIGEST] })],
      experiments: [experiment('cli-mock', 'cli-mock', 'promote')],
    }, 1_000_000 + 60_001)
    expect(stale).toContain(escapeHtml(STALE_SENTENCE))
    expect(stale).not.toContain('<table>')
    expect(stale).not.toContain('25.0 %')
    expect(stale).not.toContain('75.0 %')
    expect(stale).not.toContain(DIGEST)
    expect(stale).not.toContain('promote')
    // The provenance the notice is about survives, so a reader can see how old the page is.
    expect(stale).toContain('Newest folded session: 1970-01-01T00:16:40.000Z.')
  })

  it('states that no session was folded when the store held none', () => {
    const { newestSessionAt: _absent, ...empty } = snapshot()
    expect(renderHtml(publishDocument(empty, 1_000_500, 60_000))).toContain('No session was folded.')
  })

  it('references no external resource and carries both themes through one token set', () => {
    const html = page({ rows: [row()] })
    expect(html).not.toMatch(/(?:src|href)=/)
    expect(html).toContain('@media (prefers-color-scheme:dark)')
    expect(html).toContain('font-variant-numeric:tabular-nums')
  })

  it('escapes a logged value that spells markup', () => {
    expect(page({ rows: [row({ environmentId: 'smoke:<script>' })] })).toContain('<td>smoke:&lt;script&gt;</td>')
  })
})
