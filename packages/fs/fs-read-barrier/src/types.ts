/**
 * Vocabulary of the filesystem read-barrier decider.
 * @module @deepseek-ai/dsh-fs-read-barrier/types
 */

import type { Session } from '@deepseek-ai/dsh-session'

/**
 * Minimal structural view of a tool execution this plugin needs to find the
 * session a read runs for. `@deepseek-ai/dsh-tools`' `ToolExecution` carries
 * these fields, so a read executor passes its `exec` straight through as the
 * opaque `object` actor on `fs/read-intent` and this plugin narrows it without
 * importing `dsh-tools` or `dsh-agent`.
 */
export interface FsReadBarrierActor {
  /** The agent on whose behalf the call runs, when there is one. */
  agent?: {
    /** The session whose role the barrier resolves and whose log records a refusal. */
    session?: Session
  }
}
