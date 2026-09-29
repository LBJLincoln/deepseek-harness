/**
 * The claims register of the Command Deck's client briefing, and the checks the page must pass before it ships.
 *
 * The register lists every sentence of the rendered `/briefing` page with the source notes it cites, and every note
 * with its computation and the paths or URLs it read; `pnpm run enterprise:briefing` writes it beside
 * `briefing.json` as {@link CLAIMS_PATH}, so the cycle commits the two together. This module writes nothing and
 * imports nothing from the builder at run time, which loads it while its own evaluation is still pending. The checks fail on any of the
 * {@link FORBIDDEN_PHRASES} anywhere in the page's text, notes and hover cards included, and on a sentence that states
 * a number while neither the sentence, its paragraph nor the heading above the paragraph cites a note.
 *
 * The page is rendered by React's server renderer in a child process (`apps/command-deck/scripts/render-briefing.ts`
 * under tsx with the deck's automatic-runtime JSX configuration), so the register reads the text the static export
 * shows without a Next.js build.
 *
 * @module enterprise-briefing-claims
 */

import { execFileSync } from 'node:child_process'

import { JSDOM } from 'jsdom'

/** The claims register, relative to the repository root. */
export const CLAIMS_PATH = 'apps/command-deck/public/fixtures/briefing-claims.md'

/**
 * Phrases the page must never contain, compared without regard to case: claims the pilot's record does not support
 * (that unattended cycles ship, that shipped work is verified by CI, that a client's code stays on the machine) and a
 * sign-off presented as a person's.
 */
const FORBIDDEN_PHRASES = ['unattended cycles ship', 'CI-verified', 'never leaves', '(human)'] as const

const RENDER_SCRIPT = 'apps/command-deck/scripts/render-briefing.ts'
const RENDER_TSCONFIG = 'apps/command-deck/tsconfig.render.json'

/** The elements whose own text is one paragraph of the register; a nested one is read on its own. */
const BLOCKS = 'p, li, dd, .bf-kpi, .bf-org__node, [role="row"]'
/** Headings whose citations cover the paragraphs under them. */
const HEADINGS = 'h3, h4'
/** Page furniture that states no claim: navigation, charts drawn from a cited figure, labels and the notes themselves. */
const FURNITURE = [
  'nav', '.bf-bar', '.bf-chart', '.bf-notes', '.bf-footer', '.bf-eyebrow', '.bf-section__number', '.bf-phase__step', '.bf-flow__index',
  '.bf-dataflow__head', '.bf-table__row--head', '.bf-controls-table__row--head',
].join(', ')

/** A digit sequence standing alone, not part of an identifier such as `T-0012`, `SHA-256` or a commit id. */
const NUMBER = /(?<![\w-])\d[\d,.]*(?![\w-])/
const MARKER = /\s*⟦([^⟧]+)⟧/g

/** One source note of the page. */
interface ClaimNote {
  label: string
  computation: string
  paths: string[]
  urls: string[]
  /** The reason, for a figure the builder could not compute. */
  unknown: string | null
}

/** One sentence of the page. */
interface Claim {
  /** The section's heading, `Cover` before the first section. */
  section: string
  text: string
  /** The labels of the notes that source it. */
  notes: string[]
  /** Where the notes come from: the sentence itself, its paragraph, the heading above it, or nowhere. */
  cited: 'sentence' | 'paragraph' | 'heading' | 'none'
}

/** What the checks and the register read from the rendered page. */
interface PageReading {
  claims: Claim[]
  notes: ClaimNote[]
  /** The page's whole text, notes and hover cards included. */
  text: string
}

/**
 * Render the briefing page from the committed `briefing.json`.
 * @param root - repository root.
 * @returns the page's static markup.
 * @throws when the renderer exits non-zero, such as for a `briefing.json` of another schema.
 */
export function renderBriefingPage(root: string): string {
  return execFileSync(process.execPath, ['--import', 'tsx/esm', RENDER_SCRIPT], {
    cwd: root,
    env: { ...process.env, TSX_TSCONFIG_PATH: RENDER_TSCONFIG },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * An element's text: running text as written, and an element made only of child elements (a KPI's label, value and
 * detail; a diagram's lines) as its children's texts joined by ` · `.
 */
function spaced(element: Element): string {
  const running = [...element.childNodes].some(node => node.nodeType === node.TEXT_NODE && (node.textContent ?? '').trim() !== '')
  if (running || element.children.length === 0) return normalize(element.textContent)
  return [...element.children].map(spaced).filter(part => part !== '').join(' · ')
}

/** The text of a paragraph without the paragraphs nested in it; a table row reads as its cells joined by ` | `. */
function ownText(element: Element): string {
  const copy = element.cloneNode(true) as Element
  for (const nested of copy.querySelectorAll(BLOCKS)) nested.remove()
  if (copy.matches('[role="row"]')) return [...copy.children].map(spaced).filter(cell => cell !== '').join(' | ')
  return spaced(copy)
}

function labelsIn(text: string): string[] {
  return [...text.matchAll(MARKER)].map(match => match[1] ?? '')
}

function withoutMarkers(text: string): string {
  return normalize(text.replace(MARKER, '')).replace(/\s+([.,;:])/g, '$1')
}

/**
 * Split a paragraph into sentences: after a full stop, question or exclamation mark followed by a space and a capital,
 * a digit, an opening quote or bracket.
 */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?](?:\s*⟦[^⟧]+⟧)*)\s+(?=[A-Z0-9“"(])/).filter(sentence => sentence.trim() !== '')
}

/**
 * Read the rendered page: its source notes, its sentences with the notes each cites, and its whole text.
 * @param html - the page's static markup.
 * @returns the reading.
 */
export function readPage(html: string): PageReading {
  const { document } = new JSDOM(html).window
  const page = document.querySelector('[data-briefing]') ?? document.body
  const text = normalize(page.textContent)
  const notes: ClaimNote[] = [...page.querySelectorAll('li.bf-note')].map((item) => {
    const unknown = normalize(item.querySelector('.bf-note__unknown')?.textContent ?? '')
    return {
      label: normalize(item.querySelector('.bf-note__label')?.textContent ?? ''),
      computation: normalize(item.querySelector('.bf-note__computation')?.textContent ?? ''),
      paths: [...item.querySelectorAll('.bf-note__paths code')].map(code => normalize(code.textContent)),
      urls: [...item.querySelectorAll('.bf-note__paths a')].filter(link => link.querySelector('code') === null).map(link => link.getAttribute('href') ?? ''),
      unknown: unknown === '' ? null : unknown.replace(/^Unknown:\s*/, '').replace(/\.$/, ''),
    }
  })
  for (const card of page.querySelectorAll('.bf-cite__card')) card.remove()
  for (const cite of page.querySelectorAll('.bf-cite')) cite.replaceWith(document.createTextNode(` ⟦${normalize(cite.textContent)}⟧`))
  for (const furniture of page.querySelectorAll(FURNITURE)) furniture.remove()

  const claims: Claim[] = []
  let section = 'Cover'
  let heading: string[] = []
  for (const element of page.querySelectorAll(`h2, ${HEADINGS}, ${BLOCKS}`)) {
    if (element.matches('h2')) {
      section = normalize(element.textContent)
      heading = []
      continue
    }
    if (element.matches(HEADINGS)) {
      heading = labelsIn(element.textContent)
      continue
    }
    const paragraph = ownText(element)
    if (paragraph === '') continue
    const inParagraph = labelsIn(paragraph)
    for (const sentence of sentences(paragraph)) {
      const own = labelsIn(sentence)
      const [notesOf, cited]: [string[], Claim['cited']] = own.length > 0
        ? [own, 'sentence']
        : inParagraph.length > 0 ? [inParagraph, 'paragraph'] : heading.length > 0 ? [heading, 'heading'] : [[], 'none']
      claims.push({ section, text: withoutMarkers(sentence), notes: [...new Set(notesOf)], cited })
    }
  }
  return { claims, notes, text }
}

/**
 * What stops the page from shipping.
 * @param reading - the page's reading.
 * @returns one line per forbidden phrase found and per sentence that states a number with no note; empty when none.
 */
export function claimProblems(reading: PageReading): string[] {
  const lower = reading.text.toLowerCase()
  const problems: string[] = FORBIDDEN_PHRASES.filter(phrase => lower.includes(phrase.toLowerCase())).map(phrase => `the page contains the forbidden phrase "${phrase}"`)
  for (const claim of reading.claims) {
    if (claim.cited === 'none' && NUMBER.test(claim.text)) problems.push(`a sentence states a number with no source note (${claim.section}): ${claim.text}`)
  }
  return problems
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|')
}

/**
 * Render the claims register.
 * @param reading - the page's reading.
 * @param asOf - the briefing's `asOf`.
 * @returns the Markdown, ending in one newline.
 */
export function renderClaimsRegister(reading: PageReading, asOf: string): string {
  const lines = [
    '# Client briefing: claims register',
    '',
    `Every sentence of the Command Deck's client briefing (\`/briefing\`), rendered from \`briefing.json\` with its committed records as of ${asOf}, with the source notes it cites; then every note with its computation and what it read. A sentence with no note of its own takes the notes of its paragraph or of the heading above it, as the Cited column states; \`none\` marks a sentence no note sources, such as a lead, a requirement or a statement of method, and no such sentence states a number. \`pnpm run enterprise:briefing\` writes this file with \`briefing.json\` and fails when the page holds a forbidden phrase or a sentence that states a number with no note.`,
    '',
    '## Claims',
    '',
    '| # | Section | Sentence | Notes | Cited |',
    '| --- | --- | --- | --- | --- |',
    ...reading.claims.map((claim, index) => `| ${index + 1} | ${cell(claim.section)} | ${cell(claim.text)} | ${claim.notes.join(', ') || 'none'} | ${claim.cited} |`),
    '',
    '## Notes',
    '',
    '| Note | Computation | Read from |',
    '| --- | --- | --- |',
    ...reading.notes.map((note) => {
      const computation = note.unknown === null ? note.computation : `Unknown: ${note.unknown}. ${note.computation}`
      const sources = [...note.paths.map(path => `\`${path}\``), ...note.urls.map(url => `<${url}>`)].join(', ')
      return `| ${note.label} | ${cell(computation)} | ${cell(sources) || 'none'} |`
    }),
  ]
  return `${lines.join('\n')}\n`
}

/**
 * Render the page from the committed `briefing.json`, check it, and render its claims register.
 * @param root - repository root.
 * @param asOf - the briefing's `asOf`.
 * @returns the problems found, and the register, which the caller writes only when there are none.
 */
export function checkClaims(root: string, asOf: string): { problems: string[]; register: string } {
  const reading = readPage(renderBriefingPage(root))
  return { problems: claimProblems(reading), register: renderClaimsRegister(reading, asOf) }
}
