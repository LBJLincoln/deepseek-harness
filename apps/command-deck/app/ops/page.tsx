import type { ReactNode } from 'react'
import { OpsView } from '@/components/ops/OpsView'

/**
 * `/ops` — the Operations Center: every agent working now, what needs
 * attention, and the enterprise's day.
 * @returns The Operations view.
 */
export default function OpsPage(): ReactNode {
  return <OpsView />
}
