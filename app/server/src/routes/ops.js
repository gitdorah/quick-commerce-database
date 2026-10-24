import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

router.get('/summary', async (req, res) => {
  const [[summary]] = await pool.query(
    `SELECT
         (SELECT COUNT(*)
          FROM \`Order\`
          WHERE Status IN ('Confirmed', 'Preparing', 'Out for Delivery')) AS OpenOrders,
         (SELECT COUNT(*)
          FROM \`Order\`
          WHERE DATE(OrderDate) = CURDATE()) AS OrdersToday,
         (SELECT COUNT(*) FROM LowStockView) AS LowStockItems,
         (SELECT COALESCE(SUM(OrderTotal), 0)
          FROM OrderSummaryView
          WHERE Status <> 'Cancelled') AS OrderValue,
         (SELECT COALESCE(SUM(i.Quantity * p.Price), 0)
          FROM Inventory AS i
          INNER JOIN Product AS p
              ON i.ProductID = p.ProductID
          INNER JOIN InventoryState AS s
              ON i.StateID = s.StateID
          WHERE s.StateName = 'Available') AS AvailableInventoryValue`,
  );
  res.json(summary);
});

export default router;
