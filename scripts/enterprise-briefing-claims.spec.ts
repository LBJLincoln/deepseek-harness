import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CLAIMS_PATH, claimProblems, readPage, renderBriefingPage, renderClaimsRegister } from './enterprise-briefing-claims.ts'
import { BRIEFING_FIXTURE } from './enterprise-briefing.ts'

const root = resolve(import.meta.dirname, '..')

function cite(label: string, card = `Source ${label}`): string {
  return `<span class="bf-cite"><a class="bf-cite__label" href="#n">${label}</a><span class="bf-cite__card" role="tooltip">${card}</span></span>`
}

const PAGE = `<div data-briefing>
  <nav><a>01 Contents</a></nav>
  <header class="bf-cover"><span class="bf-eyebrow">As of 28 Sep</span><p class="bf-cover__claim">A pilot. It has 3 units.</p></header>
  <section>
    <h2>One</h2>
    <h3>Shipped${cite('1.1')}</h3>
    <p>Seven seats${cite('1.2')}. Then 2 more follow. The ticket T-0012 and SHA-256 name nothing.</p>
    <div class="bf-table"><div role="row" class="bf-table__row bf-table__row--head"><span role="columnheader">Ticket</span></div>
      <div role="row" class="bf-table__row"><span role="cell"><b>T-0012</b></span><span role="cell">5 of 6</span></div></div>
    <div class="bf-kpi"><span class="bf-kpi__label">Open</span><span class="bf-kpi__value">39${cite('1.3')}</span><span class="bf-kpi__detail">in the queue</span></div>
    <figure class="bf-chart"><p>99 plotted</p></figure>
    <details class="bf-notes"><summary>Sources</summary><ol>
      <li class="bf-note" id="note-1-1"><span class="bf-note__label">1.1</span><span class="bf-note__body"><span class="bf-note__unknown">Unknown: not read. </span><span class="bf-note__computation">Count.</span> <span class="bf-note__paths"><span><a href="x"><code>data/a.json</code></a></span><span> · <a href="https://ci/1">ci/1</a></span></span></span></li>
    </ol></details>
  </section>
  <section><h2>Two</h2><p>The engine signs ${cite('2.1', 'the principal (Human)')}. It ran 4 times.</p></section>
</div>`

describe('the claims register', () => {
  it('reads each sentence with its own notes, its paragraph\'s or its heading\'s, and each note with what it read', () => {
    const reading = readPage(PAGE)
    expect(reading.claims.map(claim => [claim.section, claim.text, claim.notes, claim.cited])).toEqual([
      ['Cover', 'A pilot.', [], 'none'],
      ['Cover', 'It has 3 units.', [], 'none'],
      ['One', 'Seven seats.', ['1.2'], 'sentence'],
      ['One', 'Then 2 more follow.', ['1.2'], 'paragraph'],
      ['One', 'The ticket T-0012 and SHA-256 name nothing.', ['1.2'], 'paragraph'],
      ['One', 'T-0012 | 5 of 6', ['1.1'], 'heading'],
      ['One', 'Open · 39 · in the queue', ['1.3'], 'sentence'],
      ['Two', 'The engine signs.', ['2.1'], 'sentence'],
      ['Two', 'It ran 4 times.', ['2.1'], 'paragraph'],
    ])
    expect(reading.notes).toEqual([{ label: '1.1', computation: 'Count.', paths: ['data/a.json'], urls: ['https://ci/1'], unknown: 'not read' }])
  })

  it('refuses a forbidden phrase anywhere in the page, hover cards included, and a number no note sources', () => {
    expect(claimProblems(readPage(PAGE))).toEqual([
      'the page contains the forbidden phrase "(human)"',
      'a sentence states a number with no source note (Cover): It has 3 units.',
    ])
  })

  it('renders the committed page with no problem, and the committed register from it', { timeout: 120_000 }, () => {
    const reading = readPage(renderBriefingPage(root))
    expect(claimProblems(reading)).toEqual([])
    const briefing = JSON.parse(readFileSync(join(root, BRIEFING_FIXTURE), 'utf8')) as { asOf: string }
    expect(readFileSync(join(root, CLAIMS_PATH), 'utf8')).toBe(renderClaimsRegister(reading, briefing.asOf))
  })
})
