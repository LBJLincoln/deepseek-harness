/**
 * The frame state the pipeline's parts share.
 *
 * The comet layer writes it and the gates, rails and rings read it sixty times
 * a second, so it is a mutable object held in a ref rather than React state:
 * an arrival must brighten a gate on the next frame, not on the next render.
 */

/** One expanding ring waiting for a free slot in the gate ring pool. */
export interface RingRequest {
  /** Scene x of the gate the ring expands at. */
  x: number
  /** Hex colour of the ring. */
  color: string
  /** Lifetime, in milliseconds. */
  life: number
  /** Radius the ring reaches at the end of its life. */
  radius: number
}

/** Everything the pipeline's parts hand each other between frames. */
export interface PipelineHeat {
  /** Last arrival per stage id, in `performance.now()` milliseconds. */
  gates: Map<string, number>
  /** Rings the comet layer has asked for and the ring pool has not drained yet. */
  rings: RingRequest[]
  /** Whether a merge has landed, which leaves the Integration gate lit. */
  merged: boolean
  /** Whether the followed run has finished, which holds the Integration gate. */
  completed: boolean
}

/**
 * A fresh frame-state object for one mounted pipeline.
 * @returns The shared state, with nothing warm and nothing queued.
 */
export function createHeat(): PipelineHeat {
  return { gates: new Map(), rings: [], merged: false, completed: false }
}
