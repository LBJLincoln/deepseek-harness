/**
 * Account taxonomy and the sign convention shared by every balance.
 *
 * Amounts are integer cents. A positive amount is a debit and a negative amount
 * is a credit, so a balanced entry sums to zero.
 */

/** Error raised for invalid ledger input. */
export class LedgerError extends Error {
  /**
   * @param {string} code Stable machine-readable reason.
   * @param {string} message Human-readable detail.
   */
  constructor(code, message) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

/** Every account type the ledger understands. */
export const ACCOUNT_TYPES = Object.freeze(['asset', 'liability', 'equity', 'income', 'expense']);

/**
 * The side on which a type of account normally carries a positive balance.
 *
 * @param {string} type Account type.
 * @returns {'debit'|'credit'} Normal side.
 */
export function normalSide(type) {
  throw new Error('not implemented');
}

/**
 * Convert a debit-positive balance into the account's own convention.
 *
 * @param {string} type Account type.
 * @param {number} signedCents Debit-positive balance.
 * @returns {number} Balance in the account's normal direction.
 */
export function toNormal(type, signedCents) {
  throw new Error('not implemented');
}
