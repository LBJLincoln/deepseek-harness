# Implement describeOmitted in @deepseek-ai/dsh-output-retention

`src/index.js` is the JavaScript build of `packages/util/output-retention/src/index.ts`, the module of the DeepSeek Harness repository published as `@deepseek-ai/dsh-output-retention`. Every export of the module is in place except `describeOmitted`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Standardized, false-precision-safe wording for one {@link Omitted} value —
 * the "may standardize omission wording" half the library owns. `exact` prints
 * the count (`Omitted 3 items`); `unknown` prints NO count because the caller
 * did not provide one. `none` is the empty string.
 *
 * @param omitted The omission metadata from a retainer result.
 * @param unit The noun for the omitted quantity (`items`, `bytes`, `chars`, `lines`).
 * @returns A neutral clause (no trailing space), or `''` when nothing was omitted.
 */
export function describeOmitted(omitted: Omitted, unit: RetentionNotice['unit']): string

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation, so implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/index.js` erased them.

```ts
/**
 * How much content the retainer omitted.
 *
 * `exact` is the normal retainer shape: every unit/byte was observed, so the
 * omitted count is precise. `unknown` is reserved for a caller that omits
 * without a count; the retainers themselves never return it.
 */
export type Omitted =
  | { kind: 'none' }
  | { kind: 'exact'; count: number }
  | { kind: 'unknown' }

/**
 * The caller receives this after each `push()`.
 */
export interface PushDecision {
  /** Was this whole unit / all of this chunk's bytes retained (nothing dropped)? */
  kept: boolean
  /** Cumulative: has the retainer omitted anything due to the budget yet? */
  truncated: boolean
}

/**
 * Final result for ordered logical units.
 *
 * `seen` means units OBSERVED by the retainer, not necessarily the total in the
 * upstream source. `kept` is `items.length`, surfaced explicitly so a notice
 * formatter need not re-count.
 */
export interface RetainedItems<T> {
  items: T[]
  truncated: boolean
  seen: number
  kept: number
  omitted: Omitted
}

/**
 * Final result for text streams.
 *
 * The returned `text` is safe to hand to a formatter: the retainer adds no
 * tool-specific headers, exit markers, XML tags, or recovery instructions, and
 * `omittedBytes` counts BYTES (not characters or lines) — text retention is
 * byte-oriented for process/body safety. UTF-8 boundaries at each cut are
 * preserved, so `text` never carries a replacement char introduced by the cut
 * itself.
 */
export interface RetainedText {
  text: string
  truncated: boolean
  omittedBytes: Omitted
}

/** Item retention strategy. Only `head` in v1; windows/grouped budgets wait for a second consumer. */
export type ItemRetentionStrategy = {
  /** Keep the first `maxItems` units. Use for `glob`, `grep`, and web sources. */
  kind: 'head'
  maxItems: number
}

/** Text retention strategy: keep a prefix, a suffix, or both, counted in bytes. */
export type TextRetentionStrategy =
  | {
    /** Keep the first `maxBytes` bytes. */
    kind: 'head'
    maxBytes: number
  }
  | {
    /** Keep the final `maxBytes` bytes. Requires reading to the end. */
    kind: 'tail'
    maxBytes: number
  }
  | {
    /** Keep a stable prefix and suffix, omitting the middle. Requires reading to the end. */
    kind: 'headTail'
    headBytes: number
    tailBytes: number
  }

/**
 * A neutral, tool-agnostic description of one retention outcome — the input to
 * {@link formatRetentionNotice}. It carries the mechanical facts (strategy,
 * unit, limit, kept count, {@link Omitted}); the tool supplies the recovery
 * words, because only the tool knows the recovery action ("narrow the pattern",
 * "fetch a more specific URL", "read the spill file").
 */
export interface RetentionNotice {
  /** Tool/scope label, e.g. `grep`, `web_fetch`, `bash stdout`. */
  scope: string
  strategy: 'head' | 'tail' | 'headTail'
  unit: 'items' | 'bytes' | 'chars' | 'lines'
  limit: number | { head: number; tail: number }
  kept: number
  omitted: Omitted
}
```
