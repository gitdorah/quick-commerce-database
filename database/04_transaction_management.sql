
-- ============================================================================
-- PROJECT: Quick Commerce Database
-- FILE: 04_transaction_management.sql
-- DBMS: MySQL 8.0+
--
-- PURPOSE:
-- Demonstrate COMMIT, ROLLBACK and SAVEPOINT on the real order and inventory
-- tables. Each scenario places (part of) an order by hand, the way the
-- PlaceOrder procedure does internally:
--   1. insert the Order row,
--   2. insert its OrderItem rows,
--   3. move the ordered units from Available to Reserved stock.
-- These steps must succeed or fail together, which is what a transaction
-- guarantees.
--
-- SCENARIOS (Andheri dark store, customer Riya Sharma):
--   Test 1  COMMIT    - an order and its reservation are saved together.
--   Test 2  ROLLBACK  - an abandoned order leaves no trace.
--   Test 3  SAVEPOINT - one line of a two-line order is undone, the rest kept.
--
-- PREREQUISITE:
-- Run 01, 03, 05 and 06 first (or `npm run db:setup` in app/).
-- The script can be re-run; Tests 1 and 3 each leave one new Confirmed order,
-- which CancelOrder can cancel like any other order.
-- ============================================================================

USE QuickCommerceDB;

-- Inventory-state identifiers used by every scenario.
SELECT StateID INTO @available FROM InventoryState WHERE StateName = 'Available';
SELECT StateID INTO @reserved FROM InventoryState WHERE StateName = 'Reserved';

SET @store = 1;      -- Andheri
SET @customer = 2;   -- Riya Sharma
SET @milk = 1;       -- Amul Taaza Milk 1L
SET @bread = 2;      -- Britannia Bread 400g


-- ----------------------------------------------------------------------------
-- TEST 1: COMMIT
-- An order for 2 units of milk. The order, its line and the stock movement
-- are made permanent together by one COMMIT.
-- ----------------------------------------------------------------------------

-- Before: milk stock at Andheri.
SELECT s.StateName, i.Quantity
FROM Inventory AS i
INNER JOIN InventoryState AS s ON i.StateID = s.StateID
WHERE i.DarkStoreID = @store AND i.ProductID = @milk
  AND s.StateName IN ('Available', 'Reserved')
ORDER BY s.StateID;

START TRANSACTION;

INSERT INTO `Order` (OrderDate, Status, CustomerID, DarkStoreID)
VALUES (NOW(), 'Confirmed', @customer, @store);

SET @order_id = LAST_INSERT_ID();

INSERT INTO OrderItem (OrderID, ProductID, Quantity)
VALUES (@order_id, @milk, 2);

UPDATE Inventory
SET Quantity = Quantity - 2
WHERE DarkStoreID = @store AND ProductID = @milk AND StateID = @available;

UPDATE Inventory
SET Quantity = Quantity + 2
WHERE DarkStoreID = @store AND ProductID = @milk AND StateID = @reserved;

COMMIT;

-- Expected: the order exists with one line, Available is 2 lower and
-- Reserved is 2 higher than before.
SELECT OrderID, Status, NumberOfOrderItems, TotalUnits, OrderTotal
FROM OrderSummaryView
WHERE OrderID = @order_id;

SELECT s.StateName, i.Quantity
FROM Inventory AS i
INNER JOIN InventoryState AS s ON i.StateID = s.StateID
WHERE i.DarkStoreID = @store AND i.ProductID = @milk
  AND s.StateName IN ('Available', 'Reserved')
ORDER BY s.StateID;


-- ----------------------------------------------------------------------------
-- TEST 2: ROLLBACK
-- The same steps for 3 loaves of bread, but the customer abandons checkout
-- before payment. ROLLBACK undoes the order, its line and the stock movement.
-- ----------------------------------------------------------------------------

-- Before: order count and bread stock.
SELECT COUNT(*) AS OrdersBefore FROM `Order`;

SELECT s.StateName, COALESCE(i.Quantity, 0) AS Quantity
FROM InventoryState AS s
LEFT JOIN Inventory AS i
    ON i.StateID = s.StateID AND i.DarkStoreID = @store AND i.ProductID = @bread
WHERE s.StateName IN ('Available', 'Reserved')
ORDER BY s.StateID;

START TRANSACTION;

INSERT INTO `Order` (OrderDate, Status, CustomerID, DarkStoreID)
VALUES (NOW(), 'Confirmed', @customer, @store);

SET @abandoned_order_id = LAST_INSERT_ID();

INSERT INTO OrderItem (OrderID, ProductID, Quantity)
VALUES (@abandoned_order_id, @bread, 3);

UPDATE Inventory
SET Quantity = Quantity - 3
WHERE DarkStoreID = @store AND ProductID = @bread AND StateID = @available;

INSERT INTO Inventory (DarkStoreID, ProductID, StateID, Quantity)
VALUES (@store, @bread, @reserved, 3)
ON DUPLICATE KEY UPDATE Quantity = Quantity + 3;

-- Inside the transaction the changes are visible to this session...
SELECT COUNT(*) AS OrdersInsideTransaction FROM `Order`;

ROLLBACK;

-- Expected: the order count and the bread stock match the "before" values,
-- and the abandoned order does not exist.
SELECT COUNT(*) AS OrdersAfterRollback FROM `Order`;

SELECT COUNT(*) AS AbandonedOrderRows
FROM `Order`
WHERE OrderID = @abandoned_order_id;

SELECT s.StateName, COALESCE(i.Quantity, 0) AS Quantity
FROM InventoryState AS s
LEFT JOIN Inventory AS i
    ON i.StateID = s.StateID AND i.DarkStoreID = @store AND i.ProductID = @bread
WHERE s.StateName IN ('Available', 'Reserved')
ORDER BY s.StateID;


-- ----------------------------------------------------------------------------
-- TEST 3: SAVEPOINT
-- A two-line order: 1 milk, then 2 bread. Before checkout the customer removes
-- the bread. ROLLBACK TO SAVEPOINT undoes only the bread line and its stock
-- movement; COMMIT then saves the order with the milk line alone.
-- ----------------------------------------------------------------------------

START TRANSACTION;

INSERT INTO `Order` (OrderDate, Status, CustomerID, DarkStoreID)
VALUES (NOW(), 'Confirmed', @customer, @store);

SET @order_id = LAST_INSERT_ID();

-- Line 1: milk.
INSERT INTO OrderItem (OrderID, ProductID, Quantity)
VALUES (@order_id, @milk, 1);

UPDATE Inventory
SET Quantity = Quantity - 1
WHERE DarkStoreID = @store AND ProductID = @milk AND StateID = @available;

UPDATE Inventory
SET Quantity = Quantity + 1
WHERE DarkStoreID = @store AND ProductID = @milk AND StateID = @reserved;

SAVEPOINT after_first_line;

-- Line 2: bread.
INSERT INTO OrderItem (OrderID, ProductID, Quantity)
VALUES (@order_id, @bread, 2);

UPDATE Inventory
SET Quantity = Quantity - 2
WHERE DarkStoreID = @store AND ProductID = @bread AND StateID = @available;

INSERT INTO Inventory (DarkStoreID, ProductID, StateID, Quantity)
VALUES (@store, @bread, @reserved, 2)
ON DUPLICATE KEY UPDATE Quantity = Quantity + 2;

-- Two lines exist at this point.
SELECT COUNT(*) AS LinesBeforeSavepointRollback
FROM OrderItem
WHERE OrderID = @order_id;

-- The customer removes the bread: undo only line 2.
ROLLBACK TO SAVEPOINT after_first_line;

COMMIT;

-- Expected: the order has exactly one line (milk), and the bread stock is
-- the same as after Test 2.
SELECT oi.OrderID, p.Name AS ProductName, oi.Quantity
FROM OrderItem AS oi
INNER JOIN Product AS p ON oi.ProductID = p.ProductID
WHERE oi.OrderID = @order_id;

SELECT p.Name AS ProductName, s.StateName, i.Quantity
FROM Inventory AS i
INNER JOIN InventoryState AS s ON i.StateID = s.StateID
INNER JOIN Product AS p ON i.ProductID = p.ProductID
WHERE i.DarkStoreID = @store
  AND i.ProductID IN (@milk, @bread)
  AND s.StateName IN ('Available', 'Reserved')
ORDER BY p.ProductID, s.StateID;
