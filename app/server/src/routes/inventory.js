import { Router } from 'express';
import { callProcedure, pool } from '../db.js';
import { INVENTORY_STATES, nonNegativeInt, oneOf, optional, positiveInt } from '../validate.js';

const router = Router();

// Every product at every store with its quantity in each inventory state.
// LowStock comes from LowStockView so the threshold lives in the database.
router.get('/', async (req, res) => {
  const storeId = optional(req.query.storeId, positiveInt, 'storeId') ?? null;
  const [rows] = await pool.query(
    `SELECT
         ds.DarkStoreID,
         ds.Location AS DarkStoreLocation,
         p.ProductID,
         p.Name AS ProductName,
         p.Price,
         COALESCE(SUM(CASE WHEN s.StateName = 'Available' THEN i.Quantity END), 0) AS Available,
         COALESCE(SUM(CASE WHEN s.StateName = 'Reserved' THEN i.Quantity END), 0) AS Reserved,
         COALESCE(SUM(CASE WHEN s.StateName = 'Damaged' THEN i.Quantity END), 0) AS Damaged,
         COALESCE(SUM(CASE WHEN s.StateName = 'In-Transit' THEN i.Quantity END), 0) AS InTransit,
         MAX(ls.ProductID IS NOT NULL) AS LowStock
     FROM DarkStore AS ds
     CROSS JOIN Product AS p
     LEFT JOIN Inventory AS i
         ON i.DarkStoreID = ds.DarkStoreID
        AND i.ProductID = p.ProductID
     LEFT JOIN InventoryState AS s
         ON s.StateID = i.StateID
     LEFT JOIN LowStockView AS ls
         ON ls.DarkStoreID = ds.DarkStoreID
        AND ls.ProductID = p.ProductID
     WHERE ? IS NULL OR ds.DarkStoreID = ?
     GROUP BY
         ds.DarkStoreID,
         ds.Location,
         p.ProductID,
         p.Name,
         p.Price
     ORDER BY
         ds.DarkStoreID,
         p.Name`,
    [storeId, storeId],
  );
  res.json(rows.map((row) => ({ ...row, LowStock: Boolean(row.LowStock) })));
});

function target(body) {
  return [
    positiveInt(body?.darkStoreId, 'darkStoreId'),
    positiveInt(body?.productId, 'productId'),
  ];
}

router.post('/restock', async (req, res) => {
  const quantity = positiveInt(req.body?.quantity, 'quantity');
  const [result] = await callProcedure('RestockInventory', [...target(req.body), quantity]);
  res.json(result);
});

router.post('/move', async (req, res) => {
  const fromState = oneOf(req.body?.fromState, 'fromState', INVENTORY_STATES);
  const toState = oneOf(req.body?.toState, 'toState', INVENTORY_STATES);
  const quantity = positiveInt(req.body?.quantity, 'quantity');
  const [result] = await callProcedure('MoveInventoryState', [
    ...target(req.body),
    fromState,
    toState,
    quantity,
  ]);
  res.json(result);
});

router.post('/count', async (req, res) => {
  const counted = nonNegativeInt(req.body?.quantity, 'quantity');
  const [result] = await callProcedure('RecordStockCount', [...target(req.body), counted]);
  res.json(result);
});

export default router;
