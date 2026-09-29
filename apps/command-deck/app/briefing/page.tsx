import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Briefing } from '@/components/briefing/Briefing'
import { BRIEFING_SCHEMA, type Briefing as BriefingData } from '@/components/briefing/types'
import briefing from '@/public/fixtures/briefing.json'
import '@/components/briefing/briefing.css'

export const metadata: Metadata = {
  title: 'Client briefing — Daliesk',
  description: 'The Daliesk agent enterprise’s pilot for executive review: where it stands, the operating model, the pilot record, measured quality, data handling and governance, economics, limits and the proposed engagement, every figure with its source.',
}

/**
 * `/briefing` — the client briefing, rendered at build time from the
 * committed `public/fixtures/briefing.json` that `pnpm run enterprise:briefing`
 * writes. A file of another schema is refused with its version rather than
 * read field by field.
 * @returns the briefing.
 */
export default function BriefingPage(): ReactNode {
  const data = briefing as unknown as BriefingData
  if (data.schema !== BRIEFING_SCHEMA) {
    return <p className="bf-refused">briefing.json has schema {String(data.schema)}; this page reads schema {BRIEFING_SCHEMA}. Rebuild it with pnpm run enterprise:briefing.</p>
  }
  return <Briefing data={data} />
}
