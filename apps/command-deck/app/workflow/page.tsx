import type { ReactNode } from 'react'
import { WorkflowView } from '@/components/workflow/WorkflowView'

/**
 * `/workflow` — the followed run's session graph and its playback transport.
 * @returns The Workflow view.
 */
export default function WorkflowPage(): ReactNode {
  return <WorkflowView />
}
