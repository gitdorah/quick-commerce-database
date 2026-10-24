
-- ============================================================================
-- PROJECT: Quick Commerce Database
-- FILE: 07_test_quick_commerce.sql
-- DBMS: MySQL 8.0+
--
-- PURPOSE:
-- End-to-end checks of the views, procedures and triggers. Every check states
-- its expected result on an "EXPECTED:" line.
--
-- Part C deliberately triggers errors, so run the file with --force to keep
-- going after each expected failure:
--   mysql -u root -p --force QuickCommerceDB < database/07_test_quick_commerce.sql
-- ============================================================================

USE QuickCommerceDB;


-- ============================================================================
-- PART A: VIEWS
-- ============================================================================

-- EXPECTED: one row per store and product (4 stores x 8 products = 32 rows).
SELECT COUNT(*) AS StoreProductRows
FROM AvailableInventoryView;

-- EXPECTED: every order with its customer, store, unit count and total.
SELECT *
FROM OrderSummaryView
ORDER BY OrderID;

-- EXPECTED: only store/product pairs with fewer than 10 available units.
SELECT *
FROM LowStockView
ORDER BY AvailableQuantity, DarkStoreLocation;


-- ============================================================================
-- PART B: PLACE AND CANCEL AN ORDER
-- ============================================================================

-- Milk (product 1) at Andheri (store 1) before the order.
SELECT AvailableQuantity INTO @milk_before
FROM AvailableInventoryView
WHERE DarkStoreID = 1 AND ProductID = 1;

-- EXPECTED: a result row with a new OrderID, 'Confirmed', 2 units reserved.
CALL PlaceOrder(1, 1, 1, 2);

-- The order just placed (this script runs in a single session).
SELECT MAX(OrderID) INTO @order_id
FROM `Order`;

-- EXPECTED: Status 'Confirmed', TotalUnits 2.
SELECT OrderID, Status, TotalUnits, OrderTotal
FROM OrderSummaryView
WHERE OrderID = @order_id;

-- EXPECTED: AvailableQuantity is 2 less than @milk_before.
SELECT @milk_before AS MilkBefore, AvailableQuantity AS MilkAfterOrder
FROM AvailableInventoryView
WHERE DarkStoreID = 1 AND ProductID = 1;

-- EXPECTED: a result row with the same OrderID and 'Cancelled'.
CALL CancelOrder(@order_id);

-- EXPECTED: Status 'Cancelled'.
SELECT OrderID, Status
FROM `Order`
WHERE OrderID = @order_id;

-- EXPECTED: AvailableQuantity is back to @milk_before.
SELECT @milk_before AS MilkBefore, AvailableQuantity AS MilkAfterCancel
FROM AvailableInventoryView
WHERE DarkStoreID = 1 AND ProductID = 1;


-- ============================================================================
-- PART C: BUSINESS RULES THAT MUST REJECT INVALID OPERATIONS
-- Each statement below is expected to fail with the error shown, and none of
-- them changes any data.
-- ============================================================================

-- EXPECTED: ERROR 1644 (45000): Order quantity must be positive
CALL PlaceOrder(1, 1, 1, 0);

-- EXPECTED: ERROR 1644 (45000): Insufficient available stock or inventory record missing
CALL PlaceOrder(1, 1, 1, 100000);

-- EXPECTED: ERROR 1644 (45000): Only confirmed orders can be cancelled
-- (order 1 is Delivered in the sample data)
CALL CancelOrder(1);

-- EXPECTED: ERROR 1644 (45000): Only confirmed orders can be cancelled
-- (the order from Part B is already Cancelled)
CALL CancelOrder(@order_id);

-- EXPECTED: ERROR 1644 (45000): Order does not exist
CALL CancelOrder(999999);

-- EXPECTED: ERROR 1644 (45000): Order item quantity must be greater than zero
-- (trigger ValidateOrderItem)
INSERT INTO OrderItem (OrderID, ProductID, Quantity)
VALUES (1, 1, 0);

-- EXPECTED: ERROR 1644 (45000): Inventory quantity cannot be negative
-- (trigger ValidateInventoryUpdate)
UPDATE Inventory
SET Quantity = -1
WHERE DarkStoreID = 1 AND ProductID = 1 AND StateID = 1;

-- EXPECTED: unchanged by Part C - still equal to @milk_before.
SELECT @milk_before AS MilkBefore, AvailableQuantity AS MilkAfterPartC
FROM AvailableInventoryView
WHERE DarkStoreID = 1 AND ProductID = 1;
