/** Runtime constructors and protocol constants for the completion-standard domain. */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { CheckId as CheckIdType, StandardId as StandardIdType } from './types.ts'
import type { VerificationErrorCode } from './domain.ts'

/** Version of every durable verification change payload. */
export const VERIFICATION_CHANGE_VERSION = 1

const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * Whether a string is a lower-kebab-case identifier.
 * @param value - candidate identifier.
 * @returns `true` only for `[a-z][a-z0-9]*(-[a-z0-9]+)*`.
 */
export function isKebabCase(value: string): boolean {
  return KEBAB_CASE.test(value)
}

/**
 * Brand a string as a standard id.
 * @param id - raw standard identifier.
 * @returns the same string with the compile-time brand.
 */
export function StandardId(id: string): StandardIdType {
  return id as StandardIdType
}

/**
 * Brand a string as a check id.
 * @param id - raw check identifier.
 * @returns the same string with the compile-time brand.
 */
export function CheckId(id: string): CheckIdType {
  return id as CheckIdType
}

/** Error returned by the completion-standard domain boundary. */
export class VerificationError extends HarnessError {
  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: VerificationErrorCode) {
    super(message, code)
  }
}
