/**
 * The HTML face of one publication: a self-contained document that references
 * no external resource, carries both themes through one token set, and prints
 * every figure in tabular numerals so a column of rates reads as a column.
 *
 * The page states the same facts as the JSON document and adds no figure of its
 * own. A stale publication prints the staleness notice in place of every
 * measurement — not beside it, because a banner over a table of numbers is read
 * as decoration and the numbers are read as current.
 *
 * @module @deepseek-ai/dsh-observatory/render
 */

import type {
  ObservatoryDocument,
  ObservatoryPublishedRow,
  ObservatoryRanking,
  ObservatoryWithheld,
} from './types.ts'

/** The sentence a page with no paired experiment prints where a ranking would be. */
export const NO_RANKING_SENTENCE
  = 'No ranking is published without a paired experiment: a route pair is ranked only under one ExperimentResult verdict.'

/** The sentence a stale page prints in place of every measurement. */
export const STALE_SENTENCE
  = 'This page is stale. The newest session it folded is older than the staleness threshold, so every figure it would show is withheld until the next fold.'

/** Column headings, in the order the honest column set is published. */
const COLUMNS: readonly string[] = [
  'Route',
  'Implementer',
  'Environment',
  'District',
  'Isolation',
  'Certificate executor',
  'Composition digest',
  'Held out',
  'Tamper',
  'Resolved',
  'Parity',
  'Cost per certified session',
]

/** Whole units one duration is stated in, largest first. */
const DURATION_UNITS: readonly (readonly [string, number])[] = [
  ['h', 3_600_000],
  ['min', 60_000],
  ['s', 1000],
]

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Escape one value for HTML text and attribute content. Every string the page
 * prints comes from a session log, so none of it is trusted markup.
 * @param value - the text to escape.
 * @returns the text with every HTML-significant character replaced.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ESCAPES[character] as string)
}

/**
 * State one duration in the largest whole unit that divides it.
 * @param ms - the duration in milliseconds.
 * @returns the duration with its unit, in milliseconds when no larger unit divides it.
 */
export function duration(ms: number): string {
  for (const [unit, size] of DURATION_UNITS) {
    if (ms >= size && ms % size === 0) return `${ms / size} ${unit}`
  }
  return `${ms} ms`
}

/** One instant as an ISO 8601 UTC string, which is what the page prints for a time. */
function instant(ms: number): string {
  return new Date(ms).toISOString()
}

/** One fraction as a percentage with one decimal. */
function percent(value: number): string {
  return `${(value * 100).toFixed(1)} %`
}

/** The tamper cell: no verdict at all, the tampered sessions of the row, or none. */
function tamperCell(row: ObservatoryPublishedRow): string {
  if (row.tamper === 'not-instrumented') return 'not instrumented'
  return row.tamper === 'tampered' ? `tampered ${row.tampered} of ${row.runs}` : 'no tamper'
}

/** The certificate rate cell; a row that recorded no run states that instead of a rate of zero. */
function resolvedCell(row: ObservatoryPublishedRow): string {
  return row.runs === 0 ? 'no run' : `${percent(row.resolved)} (${row.certified}/${row.runs})`
}

/** The cost cell: the mean beside the one digest that priced it, or the reason there is none. */
function costCell(row: ObservatoryPublishedRow): string {
  if (row.costEurPerCertified === undefined || row.pricingDigest === undefined) return 'not published'
  return `€${row.costEurPerCertified.toFixed(6)} · ${row.pricingDigest}`
}

/** The twelve cells of one published row, in column order. */
function cells(row: ObservatoryPublishedRow): readonly string[] {
  return [
    `${row.provider}/${row.model}`,
    row.implementer,
    row.environmentId,
    row.district ?? 'none',
    row.isolation,
    row.certificateExecutors.length === 0 ? 'no certificate' : row.certificateExecutors.join(', '),
    row.compositionSha256 ?? 'pending',
    row.heldOut ? 'yes' : 'no',
    tamperCell(row),
    resolvedCell(row),
    row.parity === undefined ? 'none' : percent(row.parity),
    costCell(row),
  ]
}

/** One table row of the scoreboard. */
function rowHtml(row: ObservatoryPublishedRow): string {
  return `<tr>${cells(row).map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
}

/** The scoreboard table, or the sentence that this fold published no row. */
function tableHtml(rows: readonly ObservatoryPublishedRow[]): string {
  if (rows.length === 0) return '<p class="empty">No row survived this fold: every session was withheld, unstamped, or unreadable.</p>'
  const head = COLUMNS.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join('')
  return [
    '<div class="scroll">',
    '<table>',
    `<thead><tr>${head}</tr></thead>`,
    `<tbody>${rows.map(rowHtml).join('')}</tbody>`,
    '</table>',
    '</div>',
  ].join('')
}

/** One ranking as a list item naming its plan digest, its arms, and its verdict. */
function rankingHtml(ranking: ObservatoryRanking): string {
  const arms = `${ranking.baseline.provider}/${ranking.baseline.model} versus ${ranking.candidate.provider}/${ranking.candidate.model}`
  const delta = `delta ${percent(ranking.delta)}`
  return `<li><code>${escapeHtml(ranking.digest)}</code> — ${escapeHtml(arms)}: <strong>${escapeHtml(ranking.verdict)}</strong>, ${escapeHtml(delta)}</li>`
}

/** The rankings section, or the sentence that stands in for one. */
function rankingsHtml(rankings: readonly ObservatoryRanking[]): string {
  const body = rankings.length === 0
    ? `<p class="empty">${escapeHtml(NO_RANKING_SENTENCE)}</p>`
    : `<ul class="rankings">${rankings.map(rankingHtml).join('')}</ul>`
  return `<section><h2>Rankings</h2>${body}</section>`
}

/** The counts of what this fold kept out of its rows. */
function withheldHtml(withheld: ObservatoryWithheld): string {
  const districts = withheld.districts.length === 0 ? 'none' : withheld.districts.join(', ')
  const lines = [
    `Withheld districts: ${districts}.`,
    `District rows withheld: ${withheld.districtRows} (${withheld.districtSessions} sessions).`,
    `Held-out rows withheld: ${withheld.heldOutRows} (${withheld.heldOutSessions} sessions).`,
  ]
  return `<section><h2>Withheld</h2><p>${escapeHtml(lines.join(' '))}</p></section>`
}

/** The provenance line both states print: when this fold ran, how old its newest session is, and how often it refolds. */
function metaHtml(document: ObservatoryDocument): string {
  const newest = document.newestSessionAt === undefined
    ? 'No session was folded.'
    : `Newest folded session: ${instant(document.newestSessionAt)}.`
  const line = [
    `Folded at ${instant(document.foldedAt)}.`,
    newest,
    `Batch refresh interval: ${duration(document.refreshIntervalMs)}.`,
    `Stale after ${duration(document.staleAfterMs)}.`,
  ].join(' ')
  return `<p class="meta">${escapeHtml(line)}</p>`
}

/** The stylesheet: one token set per theme, tabular numerals, and a table that scrolls inside its own box. */
const STYLE = `:root{color-scheme:light dark;--bg:#fbfbf9;--fg:#1b1b18;--muted:#5c5c55;--line:#dcdcd4;--head:#f2f2ec;--warn:#8a3d00;--warn-bg:#fdf1e5}
@media (prefers-color-scheme:dark){:root{--bg:#16181c;--fg:#e8e8e3;--muted:#a3a39b;--line:#333740;--head:#1e2127;--warn:#f0b48a;--warn-bg:#2c1d12}}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1.25rem;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:76rem;margin:0 auto}
h1{font-size:1.5rem;margin:0 0 .25rem}
h2{font-size:1.05rem;margin:2rem 0 .5rem}
p{margin:.5rem 0}
.meta{color:var(--muted)}
.empty{color:var(--muted)}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:.45rem .6rem;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{background:var(--head);font-weight:600}
td:nth-child(7){font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:normal;overflow-wrap:anywhere}
tbody tr:last-child td{border-bottom:none}
.stale{border:1px solid var(--warn);background:var(--warn-bg);color:var(--warn);border-radius:6px;padding:1rem}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere}
ul.rankings{padding-left:1.2rem}`

/**
 * Render one publication as a self-contained HTML document.
 * @param document - the JSON face of the same publication.
 * @returns the page; a stale document renders the staleness notice in place of every measurement.
 */
export function renderHtml(document: ObservatoryDocument): string {
  const body = document.stale
    ? `<section class="stale"><h2>Stale</h2><p>${escapeHtml(STALE_SENTENCE)}</p></section>`
    : [
      `<section><h2>Rows</h2>${tableHtml(document.rows)}</section>`,
      rankingsHtml(document.rankings),
      withheldHtml(document.withheld),
    ].join('')
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Observatory</title>',
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<main>',
    '<h1>Observatory</h1>',
    metaHtml(document),
    body,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
