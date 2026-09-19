import type { ReactNode } from 'react'
import { ProcessView } from '@/components/process/ProcessView'

/**
 * `/process` — the program pipeline and its timeline.
 * @returns The Process view.
 */
export default function ProcessPage(): ReactNode {
  return <ProcessView />
}
