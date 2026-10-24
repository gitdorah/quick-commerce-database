import { performance } from 'node:perf_hooks';
import { Router } from 'express';
import mysql from 'mysql2/promise';
import { appConnectionOptions } from '../config.js';
import { callProcedure, pool } from '../db.js';
import { intInRange, nonNegativeInt, oneOf, optional, positiveInt } from '../validate.js';

const router = Router();

async function readStock(darkStoreId, productId) {
  const [[stock]] = await pool.query(
    `SELECT
         COALESCE(SUM(CASE WHEN s.StateName = 'Available' THEN i.Quantity END), 0) AS Available,
         COALESCE(SUM(CASE WHEN s.StateName = 'Reserved' THEN i.Quantity END), 0) AS Reserved
     FROM Inventory AS i
     INNER JOIN InventoryState AS s
         ON s.StateID = i.StateID
     WHERE i.DarkStoreID = ?
       AND i.ProductID = ?`,
    [darkStoreId, productId],
  );
  return stock;
}

async function readSandbox() {
  const [[sandbox]] = await pool.query(
    'SELECT StockLevel, UnitsSold, OrdersAccepted FROM OversellSandbox WHERE SandboxID = 1',
  );
  return sandbox;
}

/**
 * Opens one connection per request, waits until every connection is ready and
 * then sends all the CALLs at once, so they genuinely compete inside MySQL
 * rather than queueing behind a small connection pool.
 */
async function fireConcurrently(count, sql, args) {
  const connections = await Promise.all(
    Array.from({ length: count }, () => mysql.createConnection(appConnectionOptions())),
  );
  try {
    const started = performance.now();
    return await Promise.all(
      connections.map(async (connection, index) => {
        const sentAt = performance.now() - started;
        try {
          const [results] = await connection.query(sql, args);
          return {
            request: index + 1,
            ok: true,
            result: results[0][0],
            sentAtMs: round(sentAt),
            durationMs: round(performance.now() - started - sentAt),
          };
        } catch (err) {
          return {
            request: index + 1,
            ok: false,
            error: err.sqlMessage ?? err.message,
            sentAtMs: round(sentAt),
            durationMs: round(performance.now() - started - sentAt),
          };
        }
      }),
    );
  } finally {
    await Promise.allSettled(connections.map((connection) => connection.end()));
  }
}

function round(ms) {
  return Math.round(ms * 10) / 10;
}

// Atomic mode: N concurrent CALL PlaceOrder against the real Inventory table.
async function runAtomic({ customerId, darkStoreId, productId, concurrency, quantityEach, setStockTo }) {
  const original = await readStock(darkStoreId, productId);
  if (setStockTo !== undefined) {
    await callProcedure('RecordStockCount', [darkStoreId, productId, setStockTo]);
  }
  const before = await readStock(darkStoreId, productId);

  const requests = await fireConcurrently(concurrency, 'CALL PlaceOrder(?, ?, ?, ?)', [
    customerId,
    darkStoreId,
    productId,
    quantityEach,
  ]);

  const after = await readStock(darkStoreId, productId);
  const accepted = requests.filter((request) => request.ok);
  const unitsAccepted = accepted.length * quantityEach;

  return {
    mode: 'atomic',
    concurrency,
    quantityEach,
    unitsRequested: concurrency * quantityEach,
    originalAvailable: original.Available,
    stockBefore: before.Available,
    stockAfter: after.Available,
    reservedBefore: before.Reserved,
    reservedAfter: after.Reserved,
    accepted: accepted.length,
    rejected: requests.length - accepted.length,
    unitsAccepted,
    oversoldUnits: Math.max(0, unitsAccepted - before.Available),
    // Every accepted unit left Available and arrived in Reserved; nothing was lost.
    consistent:
      before.Available - after.Available === unitsAccepted &&
      after.Reserved - before.Reserved === unitsAccepted,
    orderIds: accepted.map((request) => request.result.OrderID),
    requests,
  };
}

// Naive mode: N concurrent check-then-act orders against OversellSandbox only.
async function runNaive({ darkStoreId, productId, concurrency, quantityEach, setStockTo }) {
  const startingStock = setStockTo ?? (await readStock(darkStoreId, productId)).Available;
  await callProcedure('ResetOversellSandbox', [startingStock]);

  const requests = await fireConcurrently(concurrency, 'CALL SimulateNaiveOrder(?)', [
    quantityEach,
  ]);
  for (const request of requests) {
    if (request.ok && !request.result.Accepted) {
      request.ok = false;
      request.error = `Rejected: saw only ${request.result.StockSeen} in stock`;
    }
  }

  const sandbox = await readSandbox();
  const accepted = requests.filter((request) => request.ok);
  const unitsAccepted = sandbox.UnitsSold;

  return {
    mode: 'naive',
    concurrency,
    quantityEach,
    unitsRequested: concurrency * quantityEach,
    stockBefore: startingStock,
    stockAfter: sandbox.StockLevel,
    accepted: accepted.length,
    rejected: requests.length - accepted.length,
    unitsAccepted,
    oversoldUnits: Math.max(0, unitsAccepted - startingStock),
    // With lost updates the stock drop no longer matches the units sold.
    consistent: startingStock - sandbox.StockLevel === unitsAccepted,
    orderIds: [],
    requests,
  };
}

router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const mode = oneOf(body.mode ?? 'atomic', 'mode', ['atomic', 'naive']);
  const options = {
    darkStoreId: positiveInt(body.darkStoreId, 'darkStoreId'),
    productId: positiveInt(body.productId, 'productId'),
    concurrency: intInRange(body.concurrency, 'concurrency', 2, 50),
    quantityEach: intInRange(body.quantityEach, 'quantityEach', 1, 100),
    setStockTo: optional(body.setStockTo, nonNegativeInt, 'setStockTo'),
  };

  if (mode === 'atomic') {
    options.customerId = positiveInt(body.customerId, 'customerId');
    res.json(await runAtomic(options));
  } else {
    res.json(await runNaive(options));
  }
});

// Cancels the orders an atomic run created and optionally restores the count.
router.post('/cleanup', async (req, res) => {
  const orderIds = Array.isArray(req.body?.orderIds) ? req.body.orderIds : [];
  const cancelled = [];
  for (const [index, id] of orderIds.slice(0, 50).entries()) {
    const orderId = positiveInt(id, `orderIds[${index}]`);
    await callProcedure('CancelOrder', [orderId]);
    cancelled.push(orderId);
  }

  const restoreTo = optional(req.body?.restoreAvailableTo, nonNegativeInt, 'restoreAvailableTo');
  if (restoreTo !== undefined) {
    await callProcedure('RecordStockCount', [
      positiveInt(req.body?.darkStoreId, 'darkStoreId'),
      positiveInt(req.body?.productId, 'productId'),
      restoreTo,
    ]);
  }

  res.json({ cancelled, restoredAvailableTo: restoreTo ?? null });
});

export default router;
