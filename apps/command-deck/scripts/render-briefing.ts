/**
 * Prints the static markup of the client briefing's body, rendered by React's
 * server renderer from `public/fixtures/briefing.json`, so a check can read the
 * page's text without a Next.js build. Run it through tsx with
 * `TSX_TSCONFIG_PATH=apps/command-deck/tsconfig.render.json`, which compiles the
 * deck's JSX to the automatic runtime.
 */

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Briefing } from '../components/briefing/Briefing.tsx'
import { BRIEFING_SCHEMA, type Briefing as BriefingData } from '../components/briefing/types.ts'

const data = JSON.parse(readFileSync(new URL('../public/fixtures/briefing.json', import.meta.url), 'utf8')) as BriefingData
if (data.schema !== BRIEFING_SCHEMA) throw new Error(`render-briefing: briefing.json has schema ${data.schema}; this page reads ${BRIEFING_SCHEMA}`)
// @types/react-dom resolves its own @types/react (18.3.31) while the deck pins 18.3.12, so the element's type is
// restated as the renderer's parameter; the value is the one React element either declaration describes.
const page = createElement(Briefing, { data }) as unknown as Parameters<typeof renderToStaticMarkup>[0]
process.stdout.write(renderToStaticMarkup(page))
