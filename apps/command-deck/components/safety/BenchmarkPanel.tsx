'use client'

import { type ReactNode } from 'react'
import type { Comparison, ComparisonTier } from '@/deck/contract'

/** The bar colour per tier: the enterprise reads as the certified accent, the model amber, the scanner muted. */
const TIER_COLOR: Record<string, string> = {
  enterprise: '#4fd1c5',
  'single-model': '#f0b429',
  semgrep: '#7a8699',
}

/**
 * One tier's row: a recall bar scaled to the known-issue count, with the counts
 * and whether every finding was verified beside it.
 * @param props.tier - The tier to draw.
 * @param props.known - The ground truth's issue count, the bar's full width.
 * @returns The row.
 */
function TierRow({ tier, known }: { tier: ComparisonTier; known: number }): ReactNode {
  const color = TIER_COLOR[tier.id] ?? '#7a8699'
  const pct = Math.round((tier.found / known) * 100)
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontWeight: 600 }}>{tier.name}</span>
        <span className="mono" style={{ fontSize: 12, opacity: 0.8 }}>{tier.found}/{known} · {tier.findings} findings · {tier.wall}</span>
      </div>
      <div style={{ position: 'relative', height: 20, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, opacity: 0.85, transition: 'width 600ms ease' }} />
        <span className="mono" style={{ position: 'absolute', right: 8, top: 2, fontSize: 12, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>{pct}%</span>
      </div>
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 3 }}>
        {tier.kind}
        {' · '}
        {tier.verified
          ? <span style={{ color: '#4fd1c5' }}>every finding verified</span>
          : <span style={{ color: '#f0b429' }}>unverified</span>}
      </div>
    </div>
  )
}

/** A cell in the matrix: caught or missed. */
function Mark({ on }: { on: boolean }): ReactNode {
  return <span style={{ color: on ? '#4fd1c5' : 'rgba(255,255,255,0.25)' }}>{on ? '✓' : '·'}</span>
}

/**
 * The benchmark tab: how the enterprise scores against a scanner and a single
 * model on the same target and ground truth, with the issue matrix and the
 * gaps the comparison hands the improvement loop.
 * @param props.comparison - The target's comparison record.
 * @returns The panel.
 */
export function BenchmarkPanel({ comparison }: { comparison: Comparison }): ReactNode {
  return (
    <div>
      <p style={{ fontSize: 13, opacity: 0.85, marginTop: 0 }}>
        {comparison.target} at {comparison.revision.slice(0, 7)}, {comparison.knownIssues} known issues.
        {' '}
        The single model and the enterprise run the same model; only the harness differs.
      </p>
      {comparison.tiers.map(tier => <TierRow key={tier.id} tier={tier} known={comparison.knownIssues} />)}

      <h4 style={{ margin: '18px 0 8px' }}>Issue by issue</h4>
      <table className="mono" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', opacity: 0.7 }}>
            <th style={{ padding: '2px 4px' }}>issue</th>
            <th style={{ padding: '2px 4px' }}>class</th>
            <th style={{ padding: '2px 6px', textAlign: 'center' }}>scan</th>
            <th style={{ padding: '2px 6px', textAlign: 'center' }}>model</th>
            <th style={{ padding: '2px 6px', textAlign: 'center' }}>ent.</th>
          </tr>
        </thead>
        <tbody>
          {comparison.matrix.map(row => (
            <tr key={row.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <td style={{ padding: '2px 4px' }}>{row.id}</td>
              <td style={{ padding: '2px 4px', opacity: 0.7 }}>{row.category.slice(0, 26)}</td>
              <td style={{ padding: '2px 6px', textAlign: 'center' }}><Mark on={row.semgrep} /></td>
              <td style={{ padding: '2px 6px', textAlign: 'center' }}><Mark on={row.singleModel} /></td>
              <td style={{ padding: '2px 6px', textAlign: 'center' }}><Mark on={row.enterprise} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 style={{ margin: '18px 0 8px' }}>What the comparison hands the loop</h4>
      <ul style={{ fontSize: 12, opacity: 0.85, paddingLeft: 18, lineHeight: 1.5 }}>
        <li>Both the model and the enterprise miss: <span className="mono">{comparison.bothModelsMiss.join(', ') || 'none'}</span></li>
        <li>The single pass caught, the departments missed: <span className="mono">{comparison.singleModelOnly.join(', ') || 'none'}</span> — the loop's targets.</li>
        <li>The enterprise caught, the single pass missed: <span className="mono">{comparison.enterpriseOnly.join(', ') || 'none'}</span></li>
      </ul>
    </div>
  )
}
