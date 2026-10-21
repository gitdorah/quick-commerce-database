
USE QuickCommerceDB;

-- Test A1: Available stock at every store.
SELECT *
FROM AvailableInventoryView
ORDER BY DarkStoreID, ProductID;

-- Test A2: Order summaries and calculated totals.
SELECT *
FROM OrderSummaryView
ORDER BY OrderID;

-- Test A3: Products with fewer than 10 available units.
SELECT *
FROM LowStockView
ORDER BY AvailableQuantity, DarkStoreLocation;


-- Place an order for two units of milk at Andheri.
CALL PlaceOrder(1, 1, 1, 2);

-- Inspect the latest order.
SELECT *
FROM OrderSummaryView
ORDER BY OrderID DESC
LIMIT 1;

-- Verify milk inventory at Andheri.
SELECT *
FROM AvailableInventoryView
WHERE DarkStoreID = 1
  AND ProductID = 1;


-- Replace 6 with the OrderID created in Test B.
CALL CancelOrder(6);

-- Verify that the order is cancelled.
SELECT OrderID, Status
FROM `Order`
WHERE OrderID = 6;

-- Verify that milk availability is restored.
SELECT *
FROM AvailableInventoryView
WHERE DarkStoreID = 1
  AND ProductID = 1;

-- Verify the reserved milk quantity.
SELECT
    ds.Location,
    p.Name AS ProductName,
    s.StateName,
    i.Quantity
FROM Inventory AS i
JOIN DarkStore AS ds
    ON i.DarkStoreID = ds.DarkStoreID
JOIN Product AS p
    ON i.ProductID = p.ProductID
JOIN InventoryState AS s
    ON i.StateID = s.StateID
WHERE i.DarkStoreID = 1
  AND i.ProductID = 1
  AND s.StateName IN ('Available', 'Reserved');
