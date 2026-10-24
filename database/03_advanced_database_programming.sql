
-- ============================================================================
-- PROJECT: Quick Commerce Database
-- FILE: advanced_database_programming.sql
-- DBMS: MySQL 8.0+
--
-- FEATURES:
-- 1. Stored procedures for order placement and cancellation
-- 2. Triggers for business-rule validation
-- 3. Views for inventory, order summaries, and low-stock monitoring
--
-- PREREQUISITE:
-- Run the database creation, table creation, and sample-data SQL first.
-- ============================================================================

USE QuickCommerceDB;

-- ============================================================================
-- PART A: STORED PROCEDURES
-- ============================================================================

DELIMITER $$

-- ----------------------------------------------------------------------------
-- PROCEDURE 1: PlaceOrder
-- PURPOSE:
-- Creates an order and reserves inventory for one product.
--
-- BUSINESS RULES:
-- 1. Quantity must be positive.
-- 2. Available inventory cannot fall below zero.
-- 3. Available stock decreases and reserved stock increases atomically.
-- 4. If any operation fails, the transaction is rolled back.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS PlaceOrder$$

CREATE PROCEDURE PlaceOrder(
    IN p_CustomerID INT,
    IN p_DarkStoreID INT,
    IN p_ProductID INT,
    IN p_Quantity INT
)
BEGIN
    DECLARE v_AvailableStateID INT;
    DECLARE v_ReservedStateID INT;
    DECLARE v_OrderID INT;

    -- Roll back every change if any SQL error occurs.
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    -- Validate the requested quantity.
    IF p_Quantity IS NULL OR p_Quantity <= 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Order quantity must be positive';
    END IF;

    START TRANSACTION;

    -- Retrieve the inventory-state identifiers.
    SELECT StateID INTO v_AvailableStateID
    FROM InventoryState
    WHERE StateName = 'Available';

    SELECT StateID INTO v_ReservedStateID
    FROM InventoryState
    WHERE StateName = 'Reserved';

    -- Atomically reserve stock only if sufficient stock exists.
    -- Concurrent requests must compete for the same inventory row.
    UPDATE Inventory
    SET Quantity = Quantity - p_Quantity
    WHERE DarkStoreID = p_DarkStoreID
      AND ProductID = p_ProductID
      AND StateID = v_AvailableStateID
      AND Quantity >= p_Quantity;

    -- An affected-row count of zero means the reservation failed.
    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT =
                'Insufficient available stock or inventory record missing';
    END IF;

    -- Increase reserved stock, creating the row if necessary.
    INSERT INTO Inventory
        (DarkStoreID, ProductID, StateID, Quantity)
    VALUES
        (p_DarkStoreID, p_ProductID, v_ReservedStateID, p_Quantity)
    ON DUPLICATE KEY UPDATE
        Quantity = Quantity + p_Quantity;

    -- Create the order only after the inventory reservation succeeds.
    INSERT INTO `Order`
        (OrderDate, Status, CustomerID, DarkStoreID)
    VALUES
        (NOW(), 'Confirmed', p_CustomerID, p_DarkStoreID);

    SET v_OrderID = LAST_INSERT_ID();

    -- Create the order line.
    INSERT INTO OrderItem (OrderID, ProductID, Quantity)
    VALUES (v_OrderID, p_ProductID, p_Quantity);

    COMMIT;

    -- Return the newly created order ID.
    SELECT
        v_OrderID AS OrderID,
        'Confirmed' AS OrderStatus,
        p_Quantity AS QuantityReserved;
END$$


-- ----------------------------------------------------------------------------
-- PROCEDURE 2: CancelOrder
-- PURPOSE:
-- Cancels a confirmed order and returns its reserved stock to availability.
--
-- BUSINESS RULES:
-- 1. Only confirmed orders can be cancelled.
-- 2. Reserved stock is reduced by the order-item quantities.
-- 3. Available stock is restored.
-- 4. All changes are committed together or rolled back together.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS CancelOrder$$

CREATE PROCEDURE CancelOrder(
    IN p_OrderID INT
)
BEGIN
    DECLARE v_OrderStatus VARCHAR(30);
    DECLARE v_DarkStoreID INT;
    DECLARE v_ProductID INT;
    DECLARE v_Quantity INT;
    DECLARE v_ReservedStateID INT;
    DECLARE v_AvailableStateID INT;
    DECLARE v_Done BOOLEAN DEFAULT FALSE;

    -- Process every product belonging to the order.
    DECLARE order_items CURSOR FOR
        SELECT ProductID, Quantity
        FROM OrderItem
        WHERE OrderID = p_OrderID;

    -- End cursor processing when no more order items remain.
    DECLARE CONTINUE HANDLER FOR NOT FOUND
        SET v_Done = TRUE;

    -- Roll back all modifications if an SQL error occurs.
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- Lock the order row and retrieve its status and store.
    SET v_Done = FALSE;

    SELECT Status, DarkStoreID
    INTO v_OrderStatus, v_DarkStoreID
    FROM `Order`
    WHERE OrderID = p_OrderID
    FOR UPDATE;

    IF v_Done = TRUE THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Order does not exist';
    END IF;

    IF v_OrderStatus <> 'Confirmed' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT =
                'Only confirmed orders can be cancelled';
    END IF;

    SELECT StateID INTO v_ReservedStateID
    FROM InventoryState
    WHERE StateName = 'Reserved';

    SELECT StateID INTO v_AvailableStateID
    FROM InventoryState
    WHERE StateName = 'Available';

    OPEN order_items;

    item_loop: LOOP
        FETCH order_items INTO v_ProductID, v_Quantity;

        IF v_Done THEN
            LEAVE item_loop;
        END IF;

        -- Remove the cancelled quantity from reserved stock.
        UPDATE Inventory
        SET Quantity = Quantity - v_Quantity
        WHERE DarkStoreID = v_DarkStoreID
          AND ProductID = v_ProductID
          AND StateID = v_ReservedStateID
          AND Quantity >= v_Quantity;

        IF ROW_COUNT() = 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT =
                    'Reserved inventory is insufficient for cancellation';
        END IF;

        -- Restore the cancelled quantity to available stock.
        INSERT INTO Inventory
            (DarkStoreID, ProductID, StateID, Quantity)
        VALUES
            (v_DarkStoreID, v_ProductID,
             v_AvailableStateID, v_Quantity)
        ON DUPLICATE KEY UPDATE
            Quantity = Quantity + v_Quantity;
    END LOOP;

    CLOSE order_items;

    -- Mark the order as cancelled.
    UPDATE `Order`
    SET Status = 'Cancelled'
    WHERE OrderID = p_OrderID;

    COMMIT;

    SELECT
        p_OrderID AS OrderID,
        'Cancelled' AS OrderStatus;
END$$

DELIMITER ;


-- ============================================================================
-- PART B: TRIGGERS
-- ============================================================================

DELIMITER $$

-- ----------------------------------------------------------------------------
-- TRIGGER 1: ValidateOrderItem
-- PURPOSE:
-- Rejects invalid order-item quantities before insertion.
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS ValidateOrderItem$$

CREATE TRIGGER ValidateOrderItem
BEFORE INSERT ON OrderItem
FOR EACH ROW
BEGIN
    IF NEW.Quantity IS NULL OR NEW.Quantity <= 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT =
                'Order item quantity must be greater than zero';
    END IF;
END$$


-- ----------------------------------------------------------------------------
-- TRIGGER 2: ValidateInventoryInsert
-- PURPOSE:
-- Prevents negative inventory quantities during insertion.
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS ValidateInventoryInsert$$

CREATE TRIGGER ValidateInventoryInsert
BEFORE INSERT ON Inventory
FOR EACH ROW
BEGIN
    IF NEW.Quantity IS NULL OR NEW.Quantity < 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT =
                'Inventory quantity cannot be negative';
    END IF;
END$$


-- ----------------------------------------------------------------------------
-- TRIGGER 3: ValidateInventoryUpdate
-- PURPOSE:
-- Prevents inventory updates from producing negative quantities.
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS ValidateInventoryUpdate$$

CREATE TRIGGER ValidateInventoryUpdate
BEFORE UPDATE ON Inventory
FOR EACH ROW
BEGIN
    IF NEW.Quantity IS NULL OR NEW.Quantity < 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT =
                'Inventory quantity cannot be negative';
    END IF;
END$$

DELIMITER ;


-- ============================================================================
-- PART C: VIEWS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- VIEW 1: AvailableInventoryView
-- PURPOSE:
-- Shows available stock for every product at every dark store.
-- Products with no Available inventory row appear with quantity zero.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW AvailableInventoryView AS
SELECT
    ds.DarkStoreID,
    ds.Location AS DarkStoreLocation,
    p.ProductID,
    p.Name AS ProductName,
    p.Price,
    COALESCE(i.Quantity, 0) AS AvailableQuantity
FROM DarkStore AS ds
CROSS JOIN Product AS p
LEFT JOIN InventoryState AS s
    ON s.StateName = 'Available'
LEFT JOIN Inventory AS i
    ON i.DarkStoreID = ds.DarkStoreID
   AND i.ProductID = p.ProductID
   AND i.StateID = s.StateID;


-- ----------------------------------------------------------------------------
-- VIEW 2: OrderSummaryView
-- PURPOSE:
-- Combines order, customer, dark-store, and order-item information.
-- Calculates the order total using the current catalogue prices.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW OrderSummaryView AS
SELECT
    o.OrderID,
    o.OrderDate,
    o.Status,
    c.CustomerID,
    c.Name AS CustomerName,
    ds.DarkStoreID,
    ds.Location AS DarkStoreLocation,
    COUNT(oi.OrderItemID) AS NumberOfOrderItems,
    COALESCE(SUM(oi.Quantity), 0) AS TotalUnits,
    COALESCE(SUM(oi.Quantity * p.Price), 0.00) AS OrderTotal
FROM `Order` AS o
INNER JOIN Customer AS c
    ON o.CustomerID = c.CustomerID
INNER JOIN DarkStore AS ds
    ON o.DarkStoreID = ds.DarkStoreID
LEFT JOIN OrderItem AS oi
    ON o.OrderID = oi.OrderID
LEFT JOIN Product AS p
    ON oi.ProductID = p.ProductID
GROUP BY
    o.OrderID,
    o.OrderDate,
    o.Status,
    c.CustomerID,
    c.Name,
    ds.DarkStoreID,
    ds.Location;


-- ----------------------------------------------------------------------------
-- VIEW 3: LowStockView
-- PURPOSE:
-- Identifies product-store combinations with fewer than 10 available units.
-- The threshold is an example business rule and can be adjusted.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW LowStockView AS
SELECT
    DarkStoreID,
    DarkStoreLocation,
    ProductID,
    ProductName,
    AvailableQuantity
FROM AvailableInventoryView
WHERE AvailableQuantity < 10;


-- ============================================================================
-- PART D: TEST THE IMPLEMENTATION
-- Run these statements separately after creating the procedures, triggers,
-- and views. Review the result before attempting any additional tests.
-- ============================================================================

-- Test 1: View available inventory.
SELECT *
FROM AvailableInventoryView
ORDER BY DarkStoreID, ProductID;

-- Test 2: View order summaries.
SELECT *
FROM OrderSummaryView
ORDER BY OrderID;

-- Test 3: Identify low-stock products.
SELECT *
FROM LowStockView
ORDER BY AvailableQuantity, DarkStoreLocation;

-- Test 4: Place an order for two units of milk at Andheri.
-- CustomerID = 1, DarkStoreID = 1, ProductID = 1.
-- Expected: a new confirmed order and two units reserved.
CALL PlaceOrder(1, 1, 1, 2);

-- Test 5: Inspect the latest order.
SELECT *
FROM OrderSummaryView
ORDER BY OrderID DESC
LIMIT 1;

-- Test 6: Cancel the order created in Test 4.
-- Replace 6 with the OrderID returned by Test 4, if different.
-- CALL CancelOrder(6);

-- Test 7: Verify the inventory after reservation/cancellation.
SELECT *
FROM AvailableInventoryView
WHERE DarkStoreID = 1
  AND ProductID = 1;
