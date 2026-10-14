-- ============================================================================
-- PROJECT: Quick Commerce Inventory Database
-- FILE: sql_queries.sql
-- DBMS: MySQL 8.0+
--
-- DESCRIPTION:
-- This file contains SQL queries for analysing customer orders, product sales,
-- dark-store inventory, and inventory consistency in a quick-commerce platform.
--
-- PREREQUISITES:
--   1. Create the QuickCommerceDB database and its tables.
--   2. Insert the sample data into the tables.
--   3. Execute this file against QuickCommerceDB.
--
-- TOPICS COVERED:
--   A. JOIN operations
--   B. Aggregate functions
--   C. Subqueries
--   D. Inventory availability analysis
--
-- NOTE:
-- These queries analyse data. Query 12 checks stock availability but does not
-- reserve stock or prevent overselling by itself. Inventory reservation must
-- be implemented using an atomic transaction.
-- ============================================================================

USE QuickCommerceDB;


-- ============================================================================
-- A. QUERIES USING JOIN OPERATIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- QUERY 1: Display customer orders with product details
-- CONCEPTS: INNER JOIN, calculated column, ORDER BY
-- PURPOSE:
-- Combines Order, Customer, OrderItem, and Product to show each order line,
-- including customer name, product, quantity, unit price, and line total.
-- NOTE: ItemTotal is calculated using the current Product.Price.
-- ----------------------------------------------------------------------------

SELECT
    o.OrderID,
    c.Name AS CustomerName,
    o.OrderDate,
    o.Status,
    p.Name AS ProductName,
    oi.Quantity,
    p.Price AS UnitPrice,
    oi.Quantity * p.Price AS ItemTotal
FROM `Order` AS o
INNER JOIN Customer AS c
    ON o.CustomerID = c.CustomerID
INNER JOIN OrderItem AS oi
    ON o.OrderID = oi.OrderID
INNER JOIN Product AS p
    ON oi.ProductID = p.ProductID
ORDER BY
    o.OrderID,
    oi.OrderItemID;


-- ----------------------------------------------------------------------------
-- QUERY 2: Display available inventory at each dark store
-- CONCEPTS: Multiple INNER JOINs, WHERE, ORDER BY
-- PURPOSE:
-- Shows the sellable quantity of each product at each dark store.
-- Reserved, damaged, and in-transit stock are excluded.
-- ----------------------------------------------------------------------------

SELECT
    ds.DarkStoreID,
    ds.Location AS DarkStoreLocation,
    p.ProductID,
    p.Name AS ProductName,
    i.Quantity AS AvailableQuantity
FROM Inventory AS i
INNER JOIN DarkStore AS ds
    ON i.DarkStoreID = ds.DarkStoreID
INNER JOIN Product AS p
    ON i.ProductID = p.ProductID
INNER JOIN InventoryState AS s
    ON i.StateID = s.StateID
WHERE s.StateName = 'Available'
ORDER BY
    ds.Location,
    p.Name;


-- ----------------------------------------------------------------------------
-- QUERY 3: Display orders with customer and fulfillment-store information
-- CONCEPTS: INNER JOIN, ORDER BY
-- PURPOSE:
-- Identifies the customer who placed each order and the dark store assigned
-- to fulfill it.
-- ----------------------------------------------------------------------------

SELECT
    o.OrderID,
    c.Name AS CustomerName,
    ds.Location AS DarkStoreLocation,
    o.OrderDate,
    o.Status
FROM `Order` AS o
INNER JOIN Customer AS c
    ON o.CustomerID = c.CustomerID
INNER JOIN DarkStore AS ds
    ON o.DarkStoreID = ds.DarkStoreID
ORDER BY
    o.OrderDate,
    o.OrderID;


-- ============================================================================
-- B. QUERIES USING AGGREGATE FUNCTIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- QUERY 4: Count the total orders placed by each customer
-- CONCEPTS: COUNT(), LEFT JOIN, GROUP BY, ORDER BY
-- PURPOSE:
-- Counts the orders placed by every customer. LEFT JOIN ensures that customers
-- with no orders would also appear, with a count of zero.
-- ----------------------------------------------------------------------------

SELECT
    c.CustomerID,
    c.Name AS CustomerName,
    COUNT(o.OrderID) AS TotalOrders
FROM Customer AS c
LEFT JOIN `Order` AS o
    ON c.CustomerID = o.CustomerID
GROUP BY
    c.CustomerID,
    c.Name
ORDER BY
    TotalOrders DESC,
    c.Name;


-- ----------------------------------------------------------------------------
-- QUERY 5: Calculate the total quantity ordered for each product
-- CONCEPTS: SUM(), INNER JOIN, GROUP BY, ORDER BY
-- PURPOSE:
-- Adds the quantities recorded in OrderItem for each product.
-- NOTE: This includes every order status in the sample database; it is a
-- quantity-ordered report, not necessarily a completed-sales report.
-- ----------------------------------------------------------------------------

SELECT
    p.ProductID,
    p.Name AS ProductName,
    SUM(oi.Quantity) AS TotalQuantityOrdered
FROM Product AS p
INNER JOIN OrderItem AS oi
    ON p.ProductID = oi.ProductID
GROUP BY
    p.ProductID,
    p.Name
ORDER BY
    TotalQuantityOrdered DESC,
    p.Name;


-- ----------------------------------------------------------------------------
-- QUERY 6: Calculate total inventory quantity by stock state
-- CONCEPTS: SUM(), INNER JOIN, GROUP BY, ORDER BY
-- PURPOSE:
-- Summarises the quantities recorded as Available, Reserved, Damaged, and
-- In-Transit across all dark stores.
-- ----------------------------------------------------------------------------

SELECT
    s.StateName AS InventoryState,
    SUM(i.Quantity) AS TotalQuantity
FROM Inventory AS i
INNER JOIN InventoryState AS s
    ON i.StateID = s.StateID
GROUP BY
    s.StateID,
    s.StateName
ORDER BY
    TotalQuantity DESC;


-- ----------------------------------------------------------------------------
-- QUERY 7: Estimate the value of available inventory at each dark store
-- CONCEPTS: SUM(), joins, WHERE, GROUP BY, ORDER BY
-- PURPOSE:
-- Multiplies available units by the current product price and sums the result
-- for each store. Reserved, damaged, and in-transit quantities are excluded.
-- NOTE: This is an estimate based on catalogue prices, not accounting cost.
-- ----------------------------------------------------------------------------

SELECT
    ds.DarkStoreID,
    ds.Location AS DarkStoreLocation,
    SUM(i.Quantity * p.Price) AS AvailableInventoryValue
FROM Inventory AS i
INNER JOIN DarkStore AS ds
    ON i.DarkStoreID = ds.DarkStoreID
INNER JOIN Product AS p
    ON i.ProductID = p.ProductID
INNER JOIN InventoryState AS s
    ON i.StateID = s.StateID
WHERE s.StateName = 'Available'
GROUP BY
    ds.DarkStoreID,
    ds.Location
ORDER BY
    AvailableInventoryValue DESC;


-- ============================================================================
-- C. QUERIES USING SUBQUERIES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- QUERY 8: Find products priced above the average catalogue price
-- CONCEPTS: Scalar subquery, AVG(), WHERE
-- PURPOSE:
-- Compares each product's price with the average price of all products.
-- ----------------------------------------------------------------------------

SELECT
    p.ProductID,
    p.Name AS ProductName,
    p.Price
FROM Product AS p
WHERE p.Price > (
    SELECT AVG(Price)
    FROM Product
)
ORDER BY
    p.Price DESC;


-- ----------------------------------------------------------------------------
-- QUERY 9: Find customers with more orders than the average customer
-- CONCEPTS: Nested subquery, COUNT(), AVG(), GROUP BY, HAVING
-- PURPOSE:
-- Compares each customer's order count with the average order count among
-- customers who have placed at least one order.
-- ----------------------------------------------------------------------------

SELECT
    c.CustomerID,
    c.Name AS CustomerName,
    COUNT(o.OrderID) AS TotalOrders
FROM Customer AS c
INNER JOIN `Order` AS o
    ON c.CustomerID = o.CustomerID
GROUP BY
    c.CustomerID,
    c.Name
HAVING COUNT(o.OrderID) > (
    SELECT AVG(CustomerOrderCounts.OrderCount)
    FROM (
        SELECT
            COUNT(*) AS OrderCount
        FROM `Order`
        GROUP BY CustomerID
    ) AS CustomerOrderCounts
)
ORDER BY
    TotalOrders DESC,
    c.Name;


-- ----------------------------------------------------------------------------
-- QUERY 10: Find products with no available stock at any dark store
-- CONCEPTS: Correlated subquery, NOT EXISTS, joins
-- PURPOSE:
-- Lists products for which no positive-quantity Available inventory row exists
-- at any dark store. A product with only reserved, damaged, or in-transit stock
-- is treated as having no currently available stock.
-- ----------------------------------------------------------------------------

SELECT
    p.ProductID,
    p.Name AS ProductName
FROM Product AS p
WHERE NOT EXISTS (
    SELECT 1
    FROM Inventory AS i
    INNER JOIN InventoryState AS s
        ON i.StateID = s.StateID
    WHERE i.ProductID = p.ProductID
      AND s.StateName = 'Available'
      AND i.Quantity > 0
)
ORDER BY
    p.Name;


-- ----------------------------------------------------------------------------
-- QUERY 11: Find below-average available inventory quantities
-- CONCEPTS: Scalar subquery, AVG(), joins, WHERE
-- PURPOSE:
-- Identifies store-product inventory records whose available quantity is
-- below the average quantity per Available inventory record across all stores.
-- This can help flag stock that may need replenishment.
-- ----------------------------------------------------------------------------

SELECT
    ds.Location AS DarkStoreLocation,
    p.Name AS ProductName,
    i.Quantity AS AvailableQuantity
FROM Inventory AS i
INNER JOIN DarkStore AS ds
    ON i.DarkStoreID = ds.DarkStoreID
INNER JOIN Product AS p
    ON i.ProductID = p.ProductID
INNER JOIN InventoryState AS s
    ON i.StateID = s.StateID
WHERE s.StateName = 'Available'
  AND i.Quantity < (
      SELECT AVG(i2.Quantity)
      FROM Inventory AS i2
      INNER JOIN InventoryState AS s2
          ON i2.StateID = s2.StateID
      WHERE s2.StateName = 'Available'
  )
ORDER BY
    i.Quantity ASC,
    ds.Location,
    p.Name;


-- ============================================================================
-- D. INVENTORY AVAILABILITY ANALYSIS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- QUERY 12: Check stock availability for each order item at its assigned store
-- CONCEPTS: INNER JOIN, LEFT JOIN, CASE, COALESCE()
-- PURPOSE:
-- Compares the quantity requested in each order item with the Available
-- quantity at the order's assigned dark store.
--
-- INTERPRETATION:
--   Sufficient Stock   = available quantity is at least the requested quantity
--   Insufficient Stock = available quantity is less than the requested amount
--
-- IMPORTANT:
-- This is a diagnostic SELECT query only. It does not reserve or decrement
-- inventory and cannot, by itself, prevent overselling under concurrent orders.
-- Use a conditional UPDATE inside a transaction for actual stock reservation.
-- ----------------------------------------------------------------------------

SELECT
    o.OrderID,
    ds.Location AS DarkStoreLocation,
    p.Name AS ProductName,
    oi.Quantity AS OrderedQuantity,
    COALESCE(i.Quantity, 0) AS AvailableQuantity,
    CASE
        WHEN COALESCE(i.Quantity, 0) >= oi.Quantity
            THEN 'Sufficient Stock'
        ELSE 'Insufficient Stock'
    END AS StockStatus
FROM `Order` AS o
INNER JOIN DarkStore AS ds
    ON o.DarkStoreID = ds.DarkStoreID
INNER JOIN OrderItem AS oi
    ON o.OrderID = oi.OrderID
INNER JOIN Product AS p
    ON oi.ProductID = p.ProductID
LEFT JOIN InventoryState AS s
    ON s.StateName = 'Available'
LEFT JOIN Inventory AS i
    ON i.DarkStoreID = o.DarkStoreID
   AND i.ProductID = oi.ProductID
   AND i.StateID = s.StateID
ORDER BY
    o.OrderID,
    p.Name;
