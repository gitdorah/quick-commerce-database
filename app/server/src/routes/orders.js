import { Router } from 'express';
import { callProcedure, pool } from '../db.js';
import { HttpError } from '../errors.js';
import { ORDER_STATUSES, cartItems, oneOf, optional, positiveInt } from '../validate.js';

const router = Router();

// Attaches the order lines to each OrderSummaryView row.
async function withItems(orders) {
  if (orders.length === 0) return orders;
  const [items] = await pool.query(
    `SELECT
         oi.OrderID,
         oi.ProductID,
         p.Name AS ProductName,
         oi.Quantity,
         p.Price AS UnitPrice,
         oi.Quantity * p.Price AS LineTotal
     FROM OrderItem AS oi
     INNER JOIN Product AS p
         ON p.ProductID = oi.ProductID
     WHERE oi.OrderID IN (?)
     ORDER BY oi.OrderItemID`,
    [orders.map((order) => order.OrderID)],
  );
  return orders.map((order) => ({
    ...order,
    items: items.filter((item) => item.OrderID === order.OrderID),
  }));
}

router.get('/', async (req, res) => {
  const filters = [];
  const params = [];

  const customerId = optional(req.query.customerId, positiveInt, 'customerId');
  if (customerId) {
    filters.push('CustomerID = ?');
    params.push(customerId);
  }
  const storeId = optional(req.query.storeId, positiveInt, 'storeId');
  if (storeId) {
    filters.push('DarkStoreID = ?');
    params.push(storeId);
  }
  if (req.query.status) {
    filters.push('Status = ?');
    params.push(oneOf(req.query.status, 'status', ORDER_STATUSES));
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const [orders] = await pool.query(
    `SELECT * FROM OrderSummaryView ${where} ORDER BY OrderID DESC LIMIT 200`,
    params,
  );
  res.json(await withItems(orders));
});

router.get('/:id', async (req, res) => {
  const orderId = positiveInt(req.params.id, 'order id');
  const [orders] = await pool.query('SELECT * FROM OrderSummaryView WHERE OrderID = ?', [orderId]);
  if (orders.length === 0) throw new HttpError(404, 'Order not found');
  const [order] = await withItems(orders);
  res.json(order);
});

// Checkout: all lines are reserved atomically by PlaceCartOrder, or none are.
router.post('/', async (req, res) => {
  const customerId = positiveInt(req.body?.customerId, 'customerId');
  const darkStoreId = positiveInt(req.body?.darkStoreId, 'darkStoreId');
  const items = cartItems(req.body?.items);
  const [order] = await callProcedure('PlaceCartOrder', [
    customerId,
    darkStoreId,
    JSON.stringify(items),
  ]);
  res.status(201).json(order);
});

router.post('/:id/cancel', async (req, res) => {
  const orderId = positiveInt(req.params.id, 'order id');
  const [result] = await callProcedure('CancelOrder', [orderId]);
  res.json(result);
});

router.post('/:id/advance', async (req, res) => {
  const orderId = positiveInt(req.params.id, 'order id');
  const [result] = await callProcedure('AdvanceOrderStatus', [orderId]);
  res.json(result);
});

export default router;
