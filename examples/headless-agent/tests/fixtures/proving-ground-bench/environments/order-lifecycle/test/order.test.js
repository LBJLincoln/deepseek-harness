import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_TYPES, Order, STATES, allowedTypes, isTerminal } from '../src/index.js';

/** Deterministic 32-bit PRNG so generated command sequences replay identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build the happy-path order used by several cases. */
function deliveredOrder() {
  const order = new Order({ id: 'o-1', createdAt: 100 });
  order.apply({ type: 'addItem', commandId: 'c1', at: 100, sku: 'apple', qty: 2, unitPriceCents: 150 });
  order.apply({ type: 'addItem', commandId: 'c2', at: 101, sku: 'pear', qty: 1, unitPriceCents: 300 });
  order.apply({ type: 'pay', commandId: 'c3', at: 102, amountCents: 600 });
  order.apply({ type: 'pack', commandId: 'c4', at: 103 });
  order.apply({ type: 'ship', commandId: 'c5', at: 104, carrier: 'ups', tracking: 'zz9' });
  order.apply({ type: 'deliver', commandId: 'c6', at: 105 });
  return order;
}

test('construction validates its identity and clock', () => {
  assert.throws(() => new Order(null), { name: 'TypeError', message: 'init must be an object' });
  assert.throws(() => new Order({ id: '' }), { name: 'TypeError', message: 'init.id must be a non-empty string' });
  assert.throws(() => new Order({ id: 'o', createdAt: -1 }), { name: 'TypeError' });
  assert.throws(() => new Order({ id: 'o', createdAt: 1.5 }), { name: 'TypeError' });
  const order = new Order({ id: 'o' });
  assert.equal(order.id, 'o');
  assert.equal(order.state, 'created');
  assert.equal(order.clockMs, 0);
  assert.deepEqual(order.snapshot(), {
    id: 'o',
    state: 'created',
    items: [],
    totalCents: 0,
    paidCents: 0,
    refundedCents: 0,
    clockMs: 0,
    seq: 0,
  });
});

test('malformed commands throw instead of being recorded', () => {
  const order = new Order({ id: 'o' });
  assert.throws(() => order.apply(null), { name: 'TypeError', message: 'command must be an object' });
  assert.throws(() => order.apply({ type: 'fly', commandId: 'c', at: 1 }), {
    name: 'TypeError',
    message: 'unknown command type: fly',
  });
  assert.throws(() => order.apply({ type: 'pack', at: 1 }), {
    name: 'TypeError',
    message: 'command must carry a non-empty commandId',
  });
  assert.throws(() => order.apply({ type: 'pack', commandId: 'c', at: -1 }), { name: 'TypeError' });
  assert.throws(() => order.apply({ type: 'pack', commandId: 'c', at: 'now' }), { name: 'TypeError' });
  assert.equal(order.audit.length, 0);
});

test('the happy path walks the machine and records every step', () => {
  const order = deliveredOrder();
  assert.equal(order.state, 'delivered');
  assert.equal(order.totalCents, 600);
  assert.equal(order.paidCents, 600);
  assert.equal(order.refundedCents, 0);
  assert.equal(order.clockMs, 105);
  assert.deepEqual(order.items, [
    { sku: 'apple', qty: 2, unitPriceCents: 150 },
    { sku: 'pear', qty: 1, unitPriceCents: 300 },
  ]);
  assert.deepEqual(order.shipment, { carrier: 'ups', tracking: 'zz9' });
  assert.equal(order.deliveredAt, 105);
  const audit = order.audit;
  assert.equal(audit.length, 6);
  assert.deepEqual(audit.map((entry) => entry.seq), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(audit.map((entry) => entry.to), ['created', 'created', 'paid', 'packed', 'shipped', 'delivered']);
  assert.deepEqual(audit.map((entry) => entry.from), ['created', 'created', 'created', 'paid', 'packed', 'shipped']);
  assert.equal(audit.every((entry) => entry.ok === true), true);
  assert.equal(audit.every((entry) => !('code' in entry)), true);
});

test('the audit trail is a copy, not the live array', () => {
  const order = deliveredOrder();
  const audit = order.audit;
  audit.push({ seq: 99 });
  audit[0].type = 'tampered';
  assert.equal(order.audit.length, 6);
  assert.equal(order.audit[0].type, 'addItem');
  const items = order.items;
  items[0].qty = 99;
  assert.equal(order.items[0].qty, 2);
});

test('guards reject commands the state does not allow', () => {
  const order = new Order({ id: 'o' });
  const packed = order.apply({ type: 'pack', commandId: 'p', at: 1 });
  assert.equal(packed.ok, false);
  assert.equal(packed.code, 'BAD_STATE');
  assert.equal(packed.state, 'created');
  assert.equal(packed.seq, 1);
  assert.equal(packed.replayed, false);
  assert.equal(typeof packed.message, 'string');
  assert.ok(packed.message.length > 0);
  assert.deepEqual(order.audit[0], {
    seq: 1,
    commandId: 'p',
    type: 'pack',
    at: 1,
    from: 'created',
    to: 'created',
    ok: false,
    code: 'BAD_STATE',
  });
});

test('field and business guards use distinct codes', () => {
  const order = new Order({ id: 'o' });
  const cases = [
    [{ type: 'pay', commandId: 'a1', at: 1, amountCents: 0 }, 'EMPTY_ORDER'],
    [{ type: 'pay', commandId: 'a2', at: 1, amountCents: -5 }, 'BAD_AMOUNT'],
    [{ type: 'addItem', commandId: 'a3', at: 1, sku: '', qty: 1, unitPriceCents: 1 }, 'MISSING_FIELD'],
    [{ type: 'addItem', commandId: 'a4', at: 1, sku: 'x', qty: 0, unitPriceCents: 1 }, 'BAD_AMOUNT'],
    [{ type: 'addItem', commandId: 'a5', at: 1, sku: 'x', qty: 1.5, unitPriceCents: 1 }, 'BAD_AMOUNT'],
    [{ type: 'addItem', commandId: 'a6', at: 1, sku: 'x', qty: 1, unitPriceCents: -1 }, 'BAD_AMOUNT'],
    [{ type: 'removeItem', commandId: 'a7', at: 1, sku: 'ghost' }, 'NO_SUCH_ITEM'],
  ];
  for (const [command, code] of cases) {
    const result = order.apply(command);
    assert.equal(result.code, code, `${command.type} -> ${code}`);
  }
  assert.equal(order.apply({ type: 'addItem', commandId: 'b1', at: 2, sku: 'x', qty: 1, unitPriceCents: 250 }).ok, true);
  assert.equal(
    order.apply({ type: 'addItem', commandId: 'b2', at: 2, sku: 'x', qty: 3, unitPriceCents: 250 }).code,
    'DUPLICATE_SKU',
  );
  assert.equal(order.apply({ type: 'pay', commandId: 'b3', at: 3, amountCents: 249 }).code, 'AMOUNT_MISMATCH');
  assert.equal(order.apply({ type: 'pay', commandId: 'b4', at: 3, amountCents: 250 }).ok, true);
  assert.equal(order.state, 'paid');
  assert.equal(order.audit.length, 11);
});

test('shipping requires carrier and tracking', () => {
  const order = new Order({ id: 'o' });
  order.apply({ type: 'addItem', commandId: 'i', at: 1, sku: 'x', qty: 1, unitPriceCents: 100 });
  order.apply({ type: 'pay', commandId: 'p', at: 2, amountCents: 100 });
  order.apply({ type: 'pack', commandId: 'k', at: 3 });
  assert.equal(order.apply({ type: 'ship', commandId: 's1', at: 4, tracking: 't' }).code, 'MISSING_FIELD');
  assert.equal(order.apply({ type: 'ship', commandId: 's2', at: 4, carrier: 'c' }).code, 'MISSING_FIELD');
  assert.equal(order.state, 'packed');
  assert.equal(order.shipment, null);
  assert.equal(order.apply({ type: 'ship', commandId: 's3', at: 4, carrier: 'c', tracking: 't' }).ok, true);
  assert.equal(order.state, 'shipped');
});

test('refunds accumulate and close the order exactly once', () => {
  const order = deliveredOrder();
  assert.equal(order.apply({ type: 'refund', commandId: 'r0', at: 106, amountCents: 0 }).code, 'BAD_AMOUNT');
  assert.equal(order.apply({ type: 'refund', commandId: 'r1', at: 106, amountCents: 200 }).ok, true);
  assert.equal(order.state, 'delivered');
  assert.equal(order.refundedCents, 200);
  assert.equal(order.apply({ type: 'refund', commandId: 'r2', at: 107, amountCents: 401 }).code, 'REFUND_TOO_LARGE');
  assert.equal(order.apply({ type: 'refund', commandId: 'r3', at: 107, amountCents: 400 }).ok, true);
  assert.equal(order.state, 'refunded');
  assert.equal(order.refundedCents, order.paidCents);
  assert.equal(order.apply({ type: 'refund', commandId: 'r4', at: 108, amountCents: 1 }).code, 'BAD_STATE');
});

test('cancelling refunds whatever was captured', () => {
  const fresh = new Order({ id: 'o' });
  assert.equal(fresh.apply({ type: 'cancel', commandId: 'c', at: 1, reason: 'changed mind' }).ok, true);
  assert.equal(fresh.state, 'cancelled');
  assert.equal(fresh.refundedCents, 0);

  const paid = new Order({ id: 'o2' });
  paid.apply({ type: 'addItem', commandId: 'i', at: 1, sku: 'x', qty: 2, unitPriceCents: 700 });
  paid.apply({ type: 'pay', commandId: 'p', at: 2, amountCents: 1400 });
  assert.equal(paid.apply({ type: 'cancel', commandId: 'c1', at: 3, reason: '' }).code, 'MISSING_FIELD');
  assert.equal(paid.apply({ type: 'cancel', commandId: 'c2', at: 3, reason: 'out of stock' }).ok, true);
  assert.equal(paid.state, 'cancelled');
  assert.equal(paid.refundedCents, 1400);
  assert.equal(paid.paidCents, 1400);
});

test('a terminal order refuses every command', () => {
  const order = new Order({ id: 'o' });
  order.apply({ type: 'cancel', commandId: 'c', at: 1, reason: 'done' });
  assert.equal(isTerminal(order.state), true);
  const before = order.snapshot();
  let index = 0;
  for (const type of COMMAND_TYPES) {
    index += 1;
    const result = order.apply({
      type,
      commandId: `t${index}`,
      at: 2,
      sku: 'x',
      qty: 1,
      unitPriceCents: 1,
      amountCents: 1,
      carrier: 'c',
      tracking: 't',
      reason: 'r',
    });
    assert.equal(result.code, 'BAD_STATE', `${type} is refused`);
  }
  assert.equal(order.state, before.state);
  assert.equal(order.audit.length, 1 + COMMAND_TYPES.length);
});

test('a repeated command id replays its recorded outcome', () => {
  const order = new Order({ id: 'o' });
  const command = { type: 'addItem', commandId: 'once', at: 5, sku: 'x', qty: 1, unitPriceCents: 90 };
  const first = order.apply(command);
  assert.deepEqual(first, { ok: true, state: 'created', seq: 1, replayed: false });
  const again = order.apply({ ...command, at: 900, qty: 77 });
  assert.deepEqual(again, { ok: true, state: 'created', seq: 1, replayed: true });
  assert.equal(order.audit.length, 1);
  assert.equal(order.clockMs, 5);
  assert.deepEqual(order.items, [{ sku: 'x', qty: 1, unitPriceCents: 90 }]);

  const rejected = order.apply({ type: 'pack', commandId: 'nope', at: 6 });
  const rejectedAgain = order.apply({ type: 'pack', commandId: 'nope', at: 7 });
  assert.equal(rejected.replayed, false);
  assert.equal(rejectedAgain.replayed, true);
  assert.equal(rejectedAgain.code, 'BAD_STATE');
  assert.equal(rejectedAgain.seq, rejected.seq);
  assert.equal(order.audit.length, 2);
});

test('time never runs backwards', () => {
  const order = new Order({ id: 'o', createdAt: 100 });
  const late = order.apply({ type: 'addItem', commandId: 'x', at: 150, sku: 's', qty: 1, unitPriceCents: 5 });
  assert.equal(late.ok, true);
  assert.equal(order.clockMs, 150);
  const early = order.apply({ type: 'pack', commandId: 'y', at: 120 });
  assert.equal(early.code, 'CLOCK_REGRESSION');
  assert.equal(order.clockMs, 150);
  assert.equal(order.audit[1].at, 150, 'the entry is stamped with the order clock');
  const equal = order.apply({ type: 'removeItem', commandId: 'z', at: 150, sku: 's' });
  assert.equal(equal.ok, true, 'the same instant is allowed');
  assert.deepEqual(order.audit.map((entry) => entry.at), [150, 150, 150]);
});

test('replay reproduces a sequentially built order', () => {
  const commands = [
    { type: 'addItem', commandId: 'c1', at: 1, sku: 'b', qty: 1, unitPriceCents: 100 },
    { type: 'addItem', commandId: 'c2', at: 2, sku: 'a', qty: 2, unitPriceCents: 50 },
    { type: 'pack', commandId: 'c3', at: 3 },
    { type: 'pay', commandId: 'c4', at: 4, amountCents: 200 },
    { type: 'pack', commandId: 'c5', at: 5 },
  ];
  const stepwise = new Order({ id: 'o' });
  for (const command of commands) stepwise.apply(command);
  const replayed = Order.replay({ id: 'o' }, commands);
  assert.deepEqual(replayed.snapshot(), stepwise.snapshot());
  assert.deepEqual(replayed.audit, stepwise.audit);
  assert.equal(replayed.state, 'packed');
  assert.throws(() => Order.replay({ id: 'o' }, 'nope'), { name: 'TypeError' });
});

test('generated command sequences preserve every invariant', () => {
  const pick = mulberry32(86420);
  const skus = ['a', 'b', 'c'];
  for (let round = 0; round < 120; round += 1) {
    const commands = [];
    let clock = 0;
    for (let step = 0; step < 24; step += 1) {
      clock += pick() < 0.15 ? -3 : Math.floor(pick() * 4);
      const type = COMMAND_TYPES[Math.floor(pick() * COMMAND_TYPES.length)];
      commands.push({
        type,
        commandId: `r${round}s${step}`,
        at: Math.max(0, clock),
        sku: skus[Math.floor(pick() * skus.length)],
        qty: 1 + Math.floor(pick() * 3),
        unitPriceCents: Math.floor(pick() * 500),
        amountCents: Math.floor(pick() * 1500),
        carrier: pick() < 0.9 ? 'dhl' : '',
        tracking: 'trk',
        reason: 'because',
      });
    }
    const order = new Order({ id: `o${round}` });
    const results = commands.map((command) => order.apply(command));

    assert.ok(STATES.includes(order.state), 'state stays in the machine');
    assert.ok(order.refundedCents <= order.paidCents, 'refunds never exceed payments');
    assert.equal(
      order.totalCents,
      order.items.reduce((sum, item) => sum + item.qty * item.unitPriceCents, 0),
      'the total matches the items',
    );
    const audit = order.audit;
    assert.equal(audit.length, commands.length, 'every command leaves exactly one entry');
    audit.forEach((entry, index) => {
      assert.equal(entry.seq, index + 1, 'sequence numbers are contiguous');
      assert.equal(entry.from, index === 0 ? 'created' : audit[index - 1].to, 'states chain');
      assert.ok(index === 0 || entry.at >= audit[index - 1].at, 'time never goes backwards');
      assert.equal(entry.ok === false, 'code' in entry, 'only rejections carry a code');
      if (entry.ok) assert.ok(allowedTypes(entry.from).includes(entry.type), 'accepted commands were allowed');
    });
    assert.equal(results.filter((result) => result.replayed).length, 0, 'fresh ids are never replays');

    const snapshot = order.snapshot();
    const auditBefore = order.audit;
    for (const command of commands) {
      assert.equal(order.apply(command).replayed, true, 'a second pass replays');
    }
    assert.deepEqual(order.snapshot(), snapshot, 'a second pass changes nothing');
    assert.deepEqual(order.audit, auditBefore, 'a second pass records nothing');
    assert.deepEqual(Order.replay({ id: `o${round}` }, commands).snapshot(), snapshot, 'replay agrees');
  }
});
