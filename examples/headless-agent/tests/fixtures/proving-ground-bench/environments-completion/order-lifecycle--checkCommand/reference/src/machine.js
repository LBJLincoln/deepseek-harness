/**
 * The order state machine: the vocabulary of states and commands, and which
 * commands each state accepts.
 */

/** Every state an order can occupy, in lifecycle order. */
export const STATES = Object.freeze([
  'created',
  'paid',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
]);

/** Every command an order accepts. */
export const COMMAND_TYPES = Object.freeze([
  'addItem',
  'removeItem',
  'pay',
  'pack',
  'ship',
  'deliver',
  'cancel',
  'refund',
]);

/** States that accept no further command. */
export const TERMINAL_STATES = Object.freeze(['cancelled', 'refunded']);

const ALLOWED = Object.freeze({
  created: Object.freeze(['addItem', 'removeItem', 'pay', 'cancel']),
  paid: Object.freeze(['pack', 'cancel']),
  packed: Object.freeze(['ship', 'cancel']),
  shipped: Object.freeze(['deliver']),
  delivered: Object.freeze(['refund']),
  cancelled: Object.freeze([]),
  refunded: Object.freeze([]),
});

/**
 * Commands a state accepts.
 *
 * @param {string} state State to look up.
 * @returns {string[]} Allowed command types in ascending order.
 */
export function allowedTypes(state) {
  if (!STATES.includes(state)) throw new TypeError(`unknown state: ${state}`);
  return [...ALLOWED[state]].sort();
}

/**
 * Report whether a state accepts no further command.
 *
 * @param {string} state State to look up.
 * @returns {boolean} True for a terminal state.
 */
export function isTerminal(state) {
  if (!STATES.includes(state)) throw new TypeError(`unknown state: ${state}`);
  return TERMINAL_STATES.includes(state);
}
