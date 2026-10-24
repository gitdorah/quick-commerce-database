import { Router } from 'express';
import { callProcedure, pool } from '../db.js';
import { HttpError } from '../errors.js';
import { positiveInt, requiredText } from '../validate.js';

const router = Router();

router.get('/customers', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT CustomerID, Name, Contact FROM Customer ORDER BY Name',
  );
  res.json(rows);
});

router.post('/customers', async (req, res) => {
  const name = requiredText(req.body?.name, 'name', 100);
  const contact = requiredText(req.body?.contact, 'contact', 15);
  const [customer] = await callProcedure('RegisterCustomer', [name, contact]);
  res.status(201).json(customer);
});

router.get('/stores', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT DarkStoreID, Location, Address, Capacity FROM DarkStore ORDER BY DarkStoreID',
  );
  res.json(rows);
});

// The storefront catalogue for one store: every product with its sellable stock.
router.get('/stores/:id/catalog', async (req, res) => {
  const storeId = positiveInt(req.params.id, 'store id');
  const [rows] = await pool.query(
    `SELECT
         v.ProductID,
         v.ProductName,
         v.Price,
         p.Description,
         v.AvailableQuantity
     FROM AvailableInventoryView AS v
     INNER JOIN Product AS p
         ON p.ProductID = v.ProductID
     WHERE v.DarkStoreID = ?
     ORDER BY v.ProductName`,
    [storeId],
  );
  if (rows.length === 0) throw new HttpError(404, 'Dark store not found');
  res.json(rows);
});

export default router;
