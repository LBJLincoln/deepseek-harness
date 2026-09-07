import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_TYPES, STATES, TERMINAL_STATES, allowedTypes, isTerminal } from '../src/index.js';

test('the vocabulary is fixed and frozen', () => {
  assert.deepEqual([...STATES], ['created', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded']);
  assert.deepEqual([...COMMAND_TYPES].sort(), [
    'addItem',
    'cancel',
    'deliver',
    'pack',
    'pay',
    'refund',
    'removeItem',
    'ship',
  ]);
  assert.deepEqual([...TERMINAL_STATES].sort(), ['cancelled', 'refunded']);
  assert.equal(Object.isFrozen(STATES), true);
  assert.equal(Object.isFrozen(COMMAND_TYPES), true);
  assert.equal(Object.isFrozen(TERMINAL_STATES), true);
});

test('each state accepts exactly the documented commands', () => {
  const table = {
    created: ['addItem', 'cancel', 'pay', 'removeItem'],
    paid: ['cancel', 'pack'],
    packed: ['cancel', 'ship'],
    shipped: ['deliver'],
    delivered: ['refund'],
    cancelled: [],
    refunded: [],
  };
  for (const [state, expected] of Object.entries(table)) {
    assert.deepEqual(allowedTypes(state), expected, `allowedTypes(${state})`);
  }
  for (const state of STATES) {
    for (const type of allowedTypes(state)) {
      assert.ok(COMMAND_TYPES.includes(type), `${type} is a known command`);
    }
  }
  assert.throws(() => allowedTypes('shipping'), { name: 'TypeError', message: 'unknown state: shipping' });
});

test('terminal states are exactly those with no commands', () => {
  for (const state of STATES) {
    assert.equal(isTerminal(state), allowedTypes(state).length === 0, `isTerminal(${state})`);
    assert.equal(isTerminal(state), TERMINAL_STATES.includes(state), `${state} agrees with the list`);
  }
  assert.throws(() => isTerminal('nope'), { name: 'TypeError' });
});

test('mutating the exported lists cannot change the machine', () => {
  assert.throws(() => {
    STATES.push('archived');
  });
  assert.equal(STATES.length, 7);
  const copy = allowedTypes('created');
  copy.push('deliver');
  assert.deepEqual(allowedTypes('created'), ['addItem', 'cancel', 'pay', 'removeItem']);
});
