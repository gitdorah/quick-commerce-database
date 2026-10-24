// Integration tests for the API against a freshly rebuilt QuickCommerceDB.
// `npm test` runs scripts/setup-db.js first, so these tests start from the seed
// data. They run in order and build on each other's state.

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import mysql from 'mysql2/promise';
import { appConnectionOptions } from '../src/config.js';
import { pool } from '../src/db.js';
import { createApp } from '../src/index.js';

const ANDHERI = 1;
const BANDRA = 2;
const POWAI = 3;
const MILK = 1;
const BREAD = 2;
const CHIPS = 3;
const COLA = 4;
const MAGGI = 6;
const SURF = 7;

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await pool.end();
});

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function stock(storeId, productId) {
  const { body } = await api(`/inventory?storeId=${storeId}`);
  return body.find((row) => row.ProductID === productId);
}

test('seed reservations are reconciled for open orders', async () => {
  const maggi = await stock(ANDHERI, MAGGI);
  assert.equal(maggi.Available, 46);
  assert.equal(maggi.Reserved, 4);
});

let cartOrderId;

test('cart checkout reserves every line and merges duplicate products', async () => {
  const { status, body } = await api('/orders', {
    method: 'POST',
    body: {
      customerId: 2,
      darkStoreId: ANDHERI,
      items: [
        { productId: MILK, quantity: 2 },
        { productId: CHIPS, quantity: 1 },
        { productId: MILK, quantity: 1 },
      ],
    },
  });
  assert.equal(status, 201);
  assert.equal(body.OrderStatus, 'Confirmed');
  assert.equal(body.TotalUnits, 4);
  assert.equal(body.OrderTotal, 3 * 62 + 20);
  cartOrderId = body.OrderID;

  const milk = await stock(ANDHERI, MILK);
  assert.equal(milk.Available, 25 - 3);
  assert.equal(milk.Reserved, 3 + 3);

  const order = await api(`/orders/${cartOrderId}`);
  assert.deepEqual(
    order.body.items.map((item) => [item.ProductID, item.Quantity]).sort(),
    [[MILK, 3], [CHIPS, 1]],
  );
});

test('a cart with one short line is rejected and reserves nothing', async () => {
  const breadBefore = await stock(ANDHERI, BREAD);
  const { status, body } = await api('/orders', {
    method: 'POST',
    body: {
      customerId: 2,
      darkStoreId: ANDHERI,
      items: [
        { productId: BREAD, quantity: 1 },
        { productId: COLA, quantity: 999 },
      ],
    },
  });
  assert.equal(status, 409);
  assert.match(body.error, /Insufficient stock for Coca Cola/);
  assert.deepEqual(await stock(ANDHERI, BREAD), breadBefore);
});

test('invalid requests are rejected before reaching the database', async () => {
  assert.equal((await api('/orders', { method: 'POST', body: { customerId: 1, darkStoreId: 1, items: [] } })).status, 400);
  assert.equal(
    (await api('/orders', { method: 'POST', body: { customerId: 1, darkStoreId: 1, items: [{ productId: 1, quantity: 0 }] } })).status,
    400,
  );
  assert.equal(
    (await api('/orders', { method: 'POST', body: { customerId: 999, darkStoreId: 1, items: [{ productId: 1, quantity: 1 }] } })).status,
    400,
  );
});

test('cancelling an order returns its stock to Available', async () => {
  const { status, body } = await api(`/orders/${cartOrderId}/cancel`, { method: 'POST' });
  assert.equal(status, 200);
  assert.equal(body.OrderStatus, 'Cancelled');

  const milk = await stock(ANDHERI, MILK);
  assert.equal(milk.Available, 25);
  assert.equal(milk.Reserved, 3);
});

test('sample orders can be cancelled after reconciliation', async () => {
  const { status } = await api('/orders/5/cancel', { method: 'POST' });
  assert.equal(status, 200);
});

test('advancing to Out for Delivery consumes reserved stock', async () => {
  const placed = await api('/orders', {
    method: 'POST',
    body: { customerId: 3, darkStoreId: POWAI, items: [{ productId: SURF, quantity: 1 }] },
  });
  const orderId = placed.body.OrderID;
  assert.deepEqual(
    [(await stock(POWAI, SURF)).Available, (await stock(POWAI, SURF)).Reserved],
    [14, 3],
  );

  assert.equal((await api(`/orders/${orderId}/advance`, { method: 'POST' })).body.OrderStatus, 'Preparing');
  assert.equal((await api(`/orders/${orderId}/cancel`, { method: 'POST' })).status, 409);
  assert.equal(
    (await api(`/orders/${orderId}/advance`, { method: 'POST' })).body.OrderStatus,
    'Out for Delivery',
  );
  assert.equal((await stock(POWAI, SURF)).Reserved, 2);
  assert.equal((await api(`/orders/${orderId}/advance`, { method: 'POST' })).body.OrderStatus, 'Delivered');

  const final = await api(`/orders/${orderId}/advance`, { method: 'POST' });
  assert.equal(final.status, 409);
  assert.equal(final.body.error, 'Delivered orders cannot be advanced');
});

test('inventory maintenance procedures move stock between states', async () => {
  await api('/inventory/restock', { method: 'POST', body: { darkStoreId: POWAI, productId: SURF, quantity: 6 } });
  assert.equal((await stock(POWAI, SURF)).Available, 20);

  await api('/inventory/move', {
    method: 'POST',
    body: { darkStoreId: POWAI, productId: SURF, fromState: 'Available', toState: 'Damaged', quantity: 5 },
  });
  const moved = await stock(POWAI, SURF);
  assert.deepEqual([moved.Available, moved.Damaged], [15, 5]);

  const tooMany = await api('/inventory/move', {
    method: 'POST',
    body: { darkStoreId: POWAI, productId: SURF, fromState: 'In-Transit', toState: 'Available', quantity: 1 },
  });
  assert.equal(tooMany.status, 409);

  const counted = await api('/inventory/count', {
    method: 'POST',
    body: { darkStoreId: POWAI, productId: SURF, quantity: 12 },
  });
  assert.deepEqual(counted.body, { PreviousQuantity: 15, CountedQuantity: 12, Variance: -3 });
});

test('atomic stress test never oversells', async () => {
  const { body } = await api('/stress-test', {
    method: 'POST',
    body: {
      mode: 'atomic',
      customerId: 1,
      darkStoreId: BANDRA,
      productId: COLA,
      concurrency: 10,
      quantityEach: 1,
      setStockTo: 2,
    },
  });
  assert.equal(body.accepted, 2);
  assert.equal(body.rejected, 8);
  assert.equal(body.oversoldUnits, 0);
  assert.equal(body.stockAfter, 0);
  assert.equal(body.consistent, true);
  assert.equal(body.orderIds.length, 2);

  const cleanup = await api('/stress-test/cleanup', {
    method: 'POST',
    body: {
      orderIds: body.orderIds,
      darkStoreId: BANDRA,
      productId: COLA,
      restoreAvailableTo: body.originalAvailable,
    },
  });
  assert.deepEqual(cleanup.body.cancelled, body.orderIds);
  assert.equal((await stock(BANDRA, COLA)).Available, body.originalAvailable);
});

test('naive stress test oversells, but only in the sandbox', async () => {
  const before = await stock(BANDRA, COLA);
  const { body } = await api('/stress-test', {
    method: 'POST',
    body: { mode: 'naive', darkStoreId: BANDRA, productId: COLA, concurrency: 10, quantityEach: 1, setStockTo: 2 },
  });
  assert.ok(body.accepted > 2, `expected overselling, got ${body.accepted} accepted`);
  assert.ok(body.oversoldUnits > 0);
  assert.equal(body.consistent, false);
  assert.deepEqual(await stock(BANDRA, COLA), before);
});

test('every query in 02_sql_queries.sql runs from the Reports API', async () => {
  const list = await api('/reports');
  assert.equal(list.body.length, 12);
  for (const report of list.body) {
    const { status, body } = await api(`/reports/${report.id}`);
    assert.equal(status, 200, `report ${report.id}`);
    assert.ok(body.columns.length > 0, `report ${report.id} has columns`);
  }
});

test('qc_app cannot modify tables directly', async () => {
  const connection = await mysql.createConnection(appConnectionOptions());
  try {
    await assert.rejects(connection.query('UPDATE Inventory SET Quantity = 0'), { errno: 1142 });
  } finally {
    await connection.end();
  }
});

// ---------------------------------------------------------------------------
// Transactions & security page
// ---------------------------------------------------------------------------

async function orderCount() {
  const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM `Order`');
  return row.n;
}

const demoTarget = { customerId: 2, darkStoreId: ANDHERI, productId: MILK };

test('ROLLBACK demo shows uncommitted changes, then leaves nothing behind', async () => {
  const ordersBefore = await orderCount();
  const milkBefore = await stock(ANDHERI, MILK);

  const { status, body } = await api('/demo/transactions/rollback', { method: 'POST', body: demoTarget });
  assert.equal(status, 200);
  const inside = body.steps.at(-2);
  const last = body.steps.at(-1);
  assert.equal(inside.orders, ordersBefore + 1);
  assert.equal(inside.available, milkBefore.Available - 1);
  assert.equal(last.orders, ordersBefore);
  assert.equal(last.available, milkBefore.Available);

  assert.equal(await orderCount(), ordersBefore);
  assert.deepEqual(await stock(ANDHERI, MILK), milkBefore);
});

test('COMMIT demo saves an order that can then be cancelled', async () => {
  const milkBefore = await stock(ANDHERI, MILK);
  const { body } = await api('/demo/transactions/commit', { method: 'POST', body: demoTarget });
  assert.ok(body.orderId);
  assert.equal(body.steps.at(-1).lines, 1);
  assert.equal((await stock(ANDHERI, MILK)).Available, milkBefore.Available - 1);

  assert.equal((await api(`/orders/${body.orderId}/cancel`, { method: 'POST' })).status, 200);
  assert.deepEqual(await stock(ANDHERI, MILK), milkBefore);
});

test('SAVEPOINT demo keeps the first line and undoes the second', async () => {
  const breadBefore = await stock(ANDHERI, BREAD);
  const { body } = await api('/demo/transactions/savepoint', {
    method: 'POST',
    body: { ...demoTarget, secondProductId: BREAD },
  });
  const order = await api(`/orders/${body.orderId}`);
  assert.deepEqual(order.body.items.map((item) => item.ProductID), [MILK]);
  assert.deepEqual(await stock(ANDHERI, BREAD), breadBefore);
  await api(`/orders/${body.orderId}/cancel`, { method: 'POST' });
});

test('every guard rail is refused by MySQL', async () => {
  const { body: guards } = await api('/demo/guards');
  const expected = ['1142', '1142', 'Order quantity must be positive', 'Insufficient available stock', 'Only confirmed orders'];
  for (const [index, guard] of guards.entries()) {
    const { body } = await api(`/demo/guards/${guard.id}`, { method: 'POST' });
    assert.equal(body.blocked, true, guard.label);
    assert.match(body.message, new RegExp(expected[index]), guard.label);
  }
});

test('the security endpoint reports qc_app and its grants', async () => {
  const { body } = await api('/demo/security');
  assert.match(body.account, /^qc_app@/);
  assert.ok(body.grants.some((grant) => /EXECUTE ON PROCEDURE .*placeorder/i.test(grant)));
  assert.ok(!body.grants.some((grant) => /\b(INSERT|UPDATE|DELETE)\b/.test(grant)));
});
