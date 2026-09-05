/**
 * Durable Tool event vocabulary shared with type-only consumers.
 *
 * @module @deepseek-ai/dsh-tools/types
 */

import type { CallId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'

/**
 * Privileged authorities a tool may declare about itself, keyed by their own
 * name. Merge-extensible: a package shipping a tool whose authority is not one
 * of these declares it here by declaration merging, so a tool added later is
 * covered by its own declaration instead of by a name list held elsewhere.
 *
 * An authority states what the tool reaches beyond the workspace; a session
 * whose role forbids it may neither compose nor call the tool. Every member is
 * denied to an `implementer` session, and an unrecognised member is denied
 * too — a new authority is privileged until something says otherwise.
 */
export interface ToolAuthorityMap {
  /** The tool reads durable session events. */
  'session-log': 'session-log'
  /** The tool mounts or evaluates code in the live runtime. */
  'plugin-mount': 'plugin-mount'
  /** The tool reports the live composition. */
  'runtime-introspection': 'runtime-introspection'
}

/** Every declared tool authority; widens as packages add entries to {@link ToolAuthorityMap}. */
export type ToolAuthority = ToolAuthorityMap[keyof ToolAuthorityMap]

/** Payload recorded when one nested Code Mode Tool dispatch starts. */
export interface CodeDispatchStartEventData {
  rootCallId: CallId
  parentCallId: CallId
  subCallId: CallId
  name: string
  arguments: unknown
}

/** Payload recorded when one nested Code Mode Tool dispatch settles. */
export interface CodeDispatchEventData extends CodeDispatchStartEventData {
  isError: boolean
  content: ContentBlock[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One sub-dispatch STARTING inside a `run_code` program: the parent
     * `run_code` call id, the deterministic sub-call id (`<parent>:code:<n>`,
     * numbered in submission order), and the tool `name` with its
     * JSON-normalized `arguments` — the exact value dispatched, normalized
     * BEFORE dispatch, so this append can never fail on payload shape.
     * Appended when the scheduler actually starts the call (not at
     * submission), so a start means the tool body pipeline was entered; a
     * call abandoned in the queue logs nothing. Log-only: `deriveMessages()`
     * ignores it; UIs use it for live per-sub-call running state and pair it
     * with `tool/code-dispatch` by `subCallId` (timing = the two events'
     * `time` fields).
     */
    'tool/code-dispatch-start': CodeDispatchStartEventData
    /**
     * One bridged sub-dispatch SETTLING: the pairing ids (matching the
     * `tool/code-dispatch-start` with the same `subCallId`), the tool `name`
     * with the same JSON-normalized `arguments`, and the sub-call's complete
     * model-facing outcome in `tool/result`'s own vocabulary
     * (`content` + `isError`), so UIs render a sub-call through the exact
     * code path that renders a native call. Every started sub-call settles
     * with exactly one of these (abort included: the aborted pipeline result
     * is an `isError` outcome).
     * Log-only: `deriveMessages()` ignores it, so sub-calls never re-enter
     * model context; persistence and UIs get every call. Appended inside the
     * parent `run_code`'s execution (the bridge drains in-flight dispatches
     * before returning), so its execution-enclosure relation holds by
     * construction.
     */
    'tool/code-dispatch': CodeDispatchEventData
  }
}
