
-- ============================================================================
-- PROJECT: Quick Commerce Database
-- FILE: 06_application_procedures.sql
-- DBMS: MySQL 8.0+
--
-- FEATURES:
-- 1. Multi-item cart checkout with atomic stock reservation
-- 2. Order status progression that consumes reserved stock at dispatch
-- 3. Inventory maintenance: restock, state transfer, stock-count correction
-- 4. Customer registration
-- 5. A deliberately unsafe "check-then-act" order on a sandbox table,
--    used by the application's oversell stress test (teaching demo only)
-- 6. COMMIT / ROLLBACK / SAVEPOINT demonstrations with a step-by-step log,
--    used by the application's "Transactions & security" page
-- 7. EXECUTE grants for the qc_app application account
-- 8. One-time reconciliation of reservations for the sample orders
--
-- PREREQUISITE:
-- Run 01_create_db_insert_data.sql, 03_advanced_database_programming.sql and
-- 05_database_security.sql first.
-- ============================================================================

USE QuickCommerceDB;

-- ============================================================================
-- PART A: SUPPORTING TABLE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE: OversellSandbox
-- PURPOSE:
-- Holds a single stock counter for the unsafe-order demonstration so that the
-- lost updates it produces never touch the real Inventory table.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS OversellSandbox (
    SandboxID INT PRIMARY KEY,
    StockLevel INT NOT NULL,
    UnitsSold INT NOT NULL DEFAULT 0,
    OrdersAccepted INT NOT NULL DEFAULT 0
);

INSERT INTO OversellSandbox (SandboxID, StockLevel)
VALUES (1, 0)
ON DUPLICATE KEY UPDATE SandboxID = SandboxID;


-- ============================================================================
-- PART B: STORED PROCEDURES
-- ============================================================================

DELIMITER $$

-- ----------------------------------------------------------------------------
-- PROCEDURE 1: PlaceCartOrder
-- PURPOSE:
-- Creates one order containing several products and reserves stock for each.
--
-- INPUT:
-- p_Items is a JSON array such as [{"productId": 1, "quantity": 2}, ...].
--
-- BUSINESS RULES:
-- 1. The cart must contain at least one line with a positive quantity.
-- 2. Every product is reserved, or nothing is: one short line rolls back all.
-- 3. Products are locked in ascending ProductID order so that two concurrent
--    carts sharing products cannot deadlock each other.
-- 4. The order is created only after every reservation succeeds.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS PlaceCartOrder$$

CREATE PROCEDURE PlaceCartOrder(
    IN p_CustomerID INT,
    IN p_DarkStoreID INT,
    IN p_Items JSON
)
BEGIN
    DECLARE v_AvailableStateID INT;
    DECLARE v_ReservedStateID INT;
    DECLARE v_OrderID INT;
    DECLARE v_ProductID INT;
    DECLARE v_Quantity INT;
    DECLARE v_InvalidLines INT;
    DECLARE v_ProductName VARCHAR(100);
    DECLARE v_Message VARCHAR(255);
    DECLARE v_Done BOOLEAN DEFAULT FALSE;

    -- Combine duplicate lines and process products in a fixed order.
    DECLARE cart_lines CURSOR FOR
        SELECT jt.ProductID, SUM(jt.Quantity)
        FROM JSON_TABLE(
            p_Items, '$[*]'
            COLUMNS (
                ProductID INT PATH '$.productId',
                Quantity INT PATH '$.quantity'
            )
        ) AS jt
        GROUP BY jt.ProductID
        ORDER BY jt.ProductID;

    DECLARE CONTINUE HANDLER FOR NOT FOUND
        SET v_Done = TRUE;

    -- Roll back every change if any SQL error occurs.
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    -- Validate the cart before taking any locks.
    IF p_Items IS NULL
       OR JSON_TYPE(p_Items) <> 'ARRAY'
       OR JSON_LENGTH(p_Items) = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cart must contain at least one item';
    END IF;

    SELECT COUNT(*) INTO v_InvalidLines
    FROM JSON_TABLE(
        p_Items, '$[*]'
        COLUMNS (
            ProductID INT PATH '$.productId',
            Quantity INT PATH '$.quantity'
        )
    ) AS jt
    WHERE jt.ProductID IS NULL
       OR jt.Quantity IS NULL
       OR jt.Quantity <= 0;

    IF v_InvalidLines > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT =
                'Every cart item needs a product and a positive quantity';
    END IF;

    START TRANSACTION;

    SELECT StateID INTO v_AvailableStateID
    FROM InventoryState
    WHERE StateName = 'Available';

    SELECT StateID INTO v_ReservedStateID
    FROM InventoryState
    WHERE StateName = 'Reserved';

    OPEN cart_lines;

    line_loop: LOOP
        FETCH cart_lines INTO v_ProductID, v_Quantity;

        IF v_Done THEN
            LEAVE line_loop;
        END IF;

        -- Atomically reserve stock only if sufficient stock exists.
        UPDATE Inventory
        SET Quantity = Quantity - v_Quantity
        WHERE DarkStoreID = p_DarkStoreID
          AND ProductID = v_ProductID
          AND StateID = v_AvailableStateID
          AND Quantity >= v_Quantity;

        IF ROW_COUNT() = 0 THEN
            SET v_ProductName = (
                SELECT Name FROM Product WHERE ProductID = v_ProductID
            );
            SET v_Message = CONCAT(
                'Insufficient stock for ',
                COALESCE(v_ProductName, CONCAT('product #', v_ProductID))
            );
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = v_Message;
        END IF;

        INSERT INTO Inventory
            (DarkStoreID, ProductID, StateID, Quantity)
        VALUES
            (p_DarkStoreID, v_ProductID, v_ReservedStateID, v_Quantity)
        ON DUPLICATE KEY UPDATE
            Quantity = Quantity + v_Quantity;
    END LOOP;

    CLOSE cart_lines;

    -- Create the order only after every reservation succeeds.
    INSERT INTO `Order`
        (OrderDate, Status, CustomerID, DarkStoreID)
    VALUES
        (NOW(), 'Confirmed', p_CustomerID, p_DarkStoreID);

    SET v_OrderID = LAST_INSERT_ID();

    INSERT INTO OrderItem (OrderID, ProductID, Quantity)
    SELECT v_OrderID, jt.ProductID, SUM(jt.Quantity)
    FROM JSON_TABLE(
        p_Items, '$[*]'
        COLUMNS (
            ProductID INT PATH '$.productId',
            Quantity INT PATH '$.quantity'
        )
    ) AS jt
    GROUP BY jt.ProductID;

    COMMIT;

    SELECT
        OrderID,
        Status AS OrderStatus,
        TotalUnits,
        OrderTotal
    FROM OrderSummaryView
    WHERE OrderID = v_OrderID;
END$$


-- ----------------------------------------------------------------------------
-- PROCEDURE 2: AdvanceOrderStatus
-- PURPOSE:
-- Moves an order to the next fulfilment stage:
-- Confirmed -> Preparing -> Out for Delivery -> Delivered.
--
-- BUSINESS RULES:
-- 1. Delivered and Cancelled orders cannot be advanced.
-- 2. On dispatch (Out for Delivery) the goods leave the store, so the order's
--    reserved stock is consumed.
-- 3. The order row is locked so that concurrent advances cannot skip a stage.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS AdvanceOrderStatus$$

CREATE PROCEDURE AdvanceOrderStatus(
    IN p_OrderID INT
)
BEGIN
    DECLARE v_OrderStatus VARCHAR(30);
    DECLARE v_NextStatus VARCHAR(30);
    DECLARE v_DarkStoreID INT;
    DECLARE v_ProductID INT;
    DECLARE v_Quantity INT;
    DECLARE v_ReservedStateID INT;
    DECLARE v_Message VARCHAR(255);
    DECLARE v_Done BOOLEAN DEFAULT FALSE;

    DECLARE order_items CURSOR FOR
        SELECT ProductID, Quantity
        FROM OrderItem
        WHERE OrderID = p_OrderID;

    DECLARE CONTINUE HANDLER FOR NOT FOUND
        SET v_Done = TRUE;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- Lock the order row and retrieve its status and store.
    SELECT Status, DarkStoreID
    INTO v_OrderStatus, v_DarkStoreID
    FROM `Order`
    WHERE OrderID = p_OrderID
    FOR UPDATE;

    IF v_Done = TRUE THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Order does not exist';
    END IF;

    SET v_NextStatus = CASE v_OrderStatus
        WHEN 'Confirmed' THEN 'Preparing'
        WHEN 'Preparing' THEN 'Out for Delivery'
        WHEN 'Out for Delivery' THEN 'Delivered'
        ELSE NULL
    END;

    IF v_NextStatus IS NULL THEN
        SET v_Message = CONCAT(v_OrderStatus, ' orders cannot be advanced');
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = v_Message;
    END IF;

    IF v_NextStatus = 'Out for Delivery' THEN
        SELECT StateID INTO v_ReservedStateID
        FROM InventoryState
        WHERE StateName = 'Reserved';

        OPEN order_items;

        item_loop: LOOP
            FETCH order_items INTO v_ProductID, v_Quantity;

            IF v_Done THEN
                LEAVE item_loop;
            END IF;

            -- The picked goods leave the store: release the reservation.
            UPDATE Inventory
            SET Quantity = Quantity - v_Quantity
            WHERE DarkStoreID = v_DarkStoreID
              AND ProductID = v_ProductID
              AND StateID = v_ReservedStateID
              AND Quantity >= v_Quantity;

            IF ROW_COUNT() = 0 THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT =
                        'Reserved inventory is insufficient for dispatch';
            END IF;
        END LOOP;

        CLOSE order_items;
    END IF;

    UPDATE `Order`
    SET Status = v_NextStatus
    WHERE OrderID = p_OrderID;

    COMMIT;

    SELECT
        p_OrderID AS OrderID,
        v_OrderStatus AS PreviousStatus,
        v_NextStatus AS OrderStatus;
END$$


-- ----------------------------------------------------------------------------
-- PROCEDURE 3: RestockInventory
-- PURPOSE:
-- Records an inbound delivery by adding units to available stock.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS RestockInventory$$

CREATE PROCEDURE RestockInventory(
    IN p_DarkStoreID INT,
    IN p_ProductID INT,
    IN p_Quantity INT
)
BEGIN
    DECLARE v_AvailableStateID INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_Quantity IS NULL OR p_Quantity <= 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Restock quantity must be positive';
    END IF;

    START TRANSACTION;

    SELECT StateID INTO v_AvailableStateID
    FROM InventoryState
    WHERE StateName = 'Available';

    INSERT INTO Inventory
        (DarkStoreID, ProductID, StateID, Quantity)
    VALUES
        (p_DarkStoreID, p_ProductID, v_AvailableStateID, p_Quantity)
    ON DUPLICATE KEY UPDATE
        Quantity = Quantity + p_Quantity;

    COMMIT;

    SELECT
        p_DarkStoreID AS DarkStoreID,
        p_ProductID AS ProductID,
        p_Quantity AS QuantityAdded;
END$$


-- ----------------------------------------------------------------------------
-- PROCEDURE 4: MoveInventoryState
-- PURPOSE:
-- Transfers units between two inventory states at one store, for example
-- Available -> Damaged (spoilage) or In-Transit -> Available (receiving).
--
-- BUSINESS RULES:
-- 1. The source state must hold at least the quantity being moved.
-- 2. The decrement and the increment are committed together.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS MoveInventoryState$$

CREATE PROCEDURE MoveInventoryState(
    IN p_DarkStoreID INT,
    IN p_ProductID INT,
    IN p_FromState VARCHAR(50),
    IN p_ToState VARCHAR(50),
    IN p_Quantity INT
)
BEGIN
    DECLARE v_FromStateID INT;
    DECLARE v_ToStateID INT;
    DECLARE v_Message VARCHAR(255);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_Quantity IS NULL OR p_Quantity <= 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Quantity to move must be positive';
    END IF;

    SET v_FromStateID = (
        SELECT StateID FROM InventoryState WHERE StateName = p_FromState
    );
    SET v_ToStateID = (
        SELECT StateID FROM InventoryState WHERE StateName = p_ToState
    );

    IF v_FromStateID IS NULL OR v_ToStateID IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Unknown inventory state';
    END IF;

    IF v_FromStateID = v_ToStateID THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Source and target states must differ';
    END IF;

    START TRANSACTION;

    UPDATE Inventory
    SET Quantity = Quantity - p_Quantity
    WHERE DarkStoreID = p_DarkStoreID
      AND ProductID = p_ProductID
      AND StateID = v_FromStateID
      AND Quantity >= p_Quantity;

    IF ROW_COUNT() = 0 THEN
        SET v_Message = CONCAT('Insufficient ', p_FromState, ' stock to move');
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = v_Message;
    END IF;

    INSERT INTO Inventory
        (DarkStoreID, ProductID, StateID, Quantity)
    VALUES
        (p_DarkStoreID, p_ProductID, v_ToStateID, p_Quantity)
    ON DUPLICATE KEY UPDATE
        Quantity = Quantity + p_Quantity;

    COMMIT;

    SELECT
        p_DarkStoreID AS DarkStoreID,
        p_ProductID AS ProductID,
        p_FromState AS FromState,
        p_ToState AS ToState,
        p_Quantity AS QuantityMoved;
END$$


-- ----------------------------------------------------------------------------
-- PROCEDURE 5: RecordStockCount
-- PURPOSE:
-- Applies a physical stock count by setting available stock to the counted
-- value. The previous value is returned so the variance can be reviewed.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS RecordStockCount$$

CREATE PROCEDURE RecordStockCount(
    IN p_DarkStoreID INT,
    IN p_ProductID INT,
    IN p_CountedQuantity INT
)
BEGIN
    DECLARE v_AvailableStateID INT;
    DECLARE v_PreviousQuantity INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_CountedQuantity IS NULL OR p_CountedQuantity < 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Counted quantity cannot be negative';
    END IF;

    START TRANSACTION;

    SELECT StateID INTO v_AvailableStateID
    FROM InventoryState
    WHERE StateName = 'Available';

    -- Lock the current row (if any) so the variance is exact.
    SELECT COALESCE(MAX(Quantity), 0) INTO v_PreviousQuantity
    FROM Inventory
    WHERE DarkStoreID = p_DarkStoreID
      AND ProductID = p_ProductID
      AND StateID = v_AvailableStateID
    FOR UPDATE;

    INSERT INTO Inventory
        (DarkStoreID, ProductID, StateID, Quantity)
    VALUES
        (p_DarkStoreID, p_ProductID, v_AvailableStateID, p_CountedQuantity)
    ON DUPLICATE KEY UPDATE
        Quantity = p_CountedQuantity;

    COMMIT;

    SELECT
        v_PreviousQuantity AS PreviousQuantity,
        p_CountedQuantity AS CountedQuantity,
        p_CountedQuantity - v_PreviousQuantity AS Variance;
END$$


-- ----------------------------------------------------------------------------
-- PROCEDURE 6: RegisterCustomer
-- PURPOSE:
-- Adds a customer after validating the name and 10-digit contact number.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS RegisterCustomer$$

CREATE PROCEDURE RegisterCustomer(
    IN p_Name VARCHAR(100),
    IN p_Contact VARCHAR(15)
)
BEGIN
    IF p_Name IS NULL OR TRIM(p_Name) = '' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Customer name is required';
    END IF;

    IF p_Contact IS NULL OR p_Contact NOT REGEXP '^[0-9]{10}$' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Contact must be a 10-digit phone number';
    END IF;

    INSERT INTO Customer (Name, Contact)
    VALUES (TRIM(p_Name), p_Contact);

    SELECT
        LAST_INSERT_ID() AS CustomerID,
        TRIM(p_Name) AS Name,
        p_Contact AS Contact;
END$$


-- ----------------------------------------------------------------------------
-- PROCEDURE 7: ResetOversellSandbox
-- PURPOSE:
-- Prepares the sandbox counter before an unsafe-order demonstration.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS ResetOversellSandbox$$

CREATE PROCEDURE ResetOversellSandbox(
    IN p_StockLevel INT
)
BEGIN
    IF p_StockLevel IS NULL OR p_StockLevel < 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Sandbox stock cannot be negative';
    END IF;

    UPDATE OversellSandbox
    SET StockLevel = p_StockLevel,
        UnitsSold = 0,
        OrdersAccepted = 0
    WHERE SandboxID = 1;
END$$


-- ----------------------------------------------------------------------------
-- PROCEDURE 8: SimulateNaiveOrder
-- PURPOSE:
-- TEACHING DEMO ONLY. Reproduces the overselling bug described in README.md:
-- the stock is read without a lock, checked in application logic, and then
-- overwritten with a value computed from that stale read.
--
-- Under concurrency every caller sees the same stock level, so more orders
-- are accepted than there are units (overselling), and the final stock level
-- reflects only one of the decrements (lost update). It writes only to
-- OversellSandbox, never to Inventory.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS SimulateNaiveOrder$$

CREATE PROCEDURE SimulateNaiveOrder(
    IN p_Quantity INT
)
BEGIN
    DECLARE v_StockSeen INT;
    DECLARE v_Accepted BOOLEAN DEFAULT FALSE;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_Quantity IS NULL OR p_Quantity <= 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Order quantity must be positive';
    END IF;

    START TRANSACTION;

    -- UNSAFE: a plain read takes no lock, so concurrent callers can all
    -- observe the same stock level.
    SELECT StockLevel INTO v_StockSeen
    FROM OversellSandbox
    WHERE SandboxID = 1;

    -- Widen the race window, as application or network latency would.
    DO SLEEP(0.1);

    IF v_StockSeen >= p_Quantity THEN
        -- UNSAFE: overwrite with a value computed from the stale read.
        UPDATE OversellSandbox
        SET StockLevel = v_StockSeen - p_Quantity,
            UnitsSold = UnitsSold + p_Quantity,
            OrdersAccepted = OrdersAccepted + 1
        WHERE SandboxID = 1;

        SET v_Accepted = TRUE;
    END IF;

    COMMIT;

    SELECT
        v_Accepted AS Accepted,
        v_StockSeen AS StockSeen;
END$$


-- ----------------------------------------------------------------------------
-- PROCEDURES 9-13: TRANSACTION CONTROL DEMONSTRATION
-- PURPOSE:
-- The COMMIT, ROLLBACK and SAVEPOINT scenarios of
-- 04_transaction_management.sql, packaged so the application's
-- "Transactions & security" page can run them and show each step.
--
-- Every step is recorded in a JSON variable rather than a table: variables
-- are not affected by ROLLBACK, so the log survives the rollback it records.
-- Each demonstration moves only one unit of stock per order line.
-- ----------------------------------------------------------------------------

-- Helper: appends a step with the current stock of one product, the total
-- number of orders and (optionally) the number of lines in one order.
-- Inside a transaction it sees that transaction's uncommitted changes.
DROP PROCEDURE IF EXISTS DemoLogStep$$

CREATE PROCEDURE DemoLogStep(
    INOUT p_Log JSON,
    IN p_Step VARCHAR(200),
    IN p_DarkStoreID INT,
    IN p_ProductID INT,
    IN p_OrderID INT
)
BEGIN
    DECLARE v_Available INT;
    DECLARE v_Reserved INT;
    DECLARE v_Orders INT;
    DECLARE v_Lines INT;

    SELECT
        COALESCE(SUM(CASE WHEN s.StateName = 'Available' THEN i.Quantity END), 0),
        COALESCE(SUM(CASE WHEN s.StateName = 'Reserved' THEN i.Quantity END), 0)
    INTO v_Available, v_Reserved
    FROM Inventory AS i
    INNER JOIN InventoryState AS s
        ON i.StateID = s.StateID
    WHERE i.DarkStoreID = p_DarkStoreID
      AND i.ProductID = p_ProductID;

    SELECT COUNT(*) INTO v_Orders FROM `Order`;

    SELECT COUNT(*) INTO v_Lines FROM OrderItem WHERE OrderID = p_OrderID;

    SET p_Log = JSON_ARRAY_APPEND(
        COALESCE(p_Log, JSON_ARRAY()), '$',
        JSON_OBJECT(
            'step', p_Step,
            'available', v_Available,
            'reserved', v_Reserved,
            'orders', v_Orders,
            'lines', IF(p_OrderID IS NULL, NULL, v_Lines)
        )
    );
END$$


-- Helper: adds a one-unit order line and moves that unit from Available to
-- Reserved, failing if the store has no available unit.
DROP PROCEDURE IF EXISTS DemoAddOrderLine$$

CREATE PROCEDURE DemoAddOrderLine(
    IN p_OrderID INT,
    IN p_DarkStoreID INT,
    IN p_ProductID INT
)
BEGIN
    INSERT INTO OrderItem (OrderID, ProductID, Quantity)
    VALUES (p_OrderID, p_ProductID, 1);

    UPDATE Inventory AS i
    INNER JOIN InventoryState AS s
        ON i.StateID = s.StateID
    SET i.Quantity = i.Quantity - 1
    WHERE i.DarkStoreID = p_DarkStoreID
      AND i.ProductID = p_ProductID
      AND s.StateName = 'Available'
      AND i.Quantity >= 1;

    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'The chosen product is out of stock at this store';
    END IF;

    INSERT INTO Inventory (DarkStoreID, ProductID, StateID, Quantity)
    SELECT p_DarkStoreID, p_ProductID, StateID, 1
    FROM InventoryState
    WHERE StateName = 'Reserved'
    ON DUPLICATE KEY UPDATE Quantity = Inventory.Quantity + 1;
END$$


-- COMMIT: the order, its line and the stock movement are saved together.
DROP PROCEDURE IF EXISTS DemoCommit$$

CREATE PROCEDURE DemoCommit(
    IN p_CustomerID INT,
    IN p_DarkStoreID INT,
    IN p_ProductID INT
)
BEGIN
    DECLARE v_Log JSON DEFAULT JSON_ARRAY();
    DECLARE v_OrderID INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    CALL DemoLogStep(v_Log, 'Before START TRANSACTION', p_DarkStoreID, p_ProductID, NULL);

    START TRANSACTION;

    INSERT INTO `Order` (OrderDate, Status, CustomerID, DarkStoreID)
    VALUES (NOW(), 'Confirmed', p_CustomerID, p_DarkStoreID);
    SET v_OrderID = LAST_INSERT_ID();
    CALL DemoLogStep(v_Log, 'INSERT INTO `Order` (not yet committed)', p_DarkStoreID, p_ProductID, v_OrderID);

    CALL DemoAddOrderLine(v_OrderID, p_DarkStoreID, p_ProductID);
    CALL DemoLogStep(v_Log, 'Add line: 1 unit Available -> Reserved', p_DarkStoreID, p_ProductID, v_OrderID);

    COMMIT;
    CALL DemoLogStep(v_Log, 'COMMIT: all changes are permanent', p_DarkStoreID, p_ProductID, v_OrderID);

    SELECT v_Log AS Steps, v_OrderID AS OrderID;
END$$


-- ROLLBACK: the same steps, then every change is undone.
DROP PROCEDURE IF EXISTS DemoRollback$$

CREATE PROCEDURE DemoRollback(
    IN p_CustomerID INT,
    IN p_DarkStoreID INT,
    IN p_ProductID INT
)
BEGIN
    DECLARE v_Log JSON DEFAULT JSON_ARRAY();
    DECLARE v_OrderID INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    CALL DemoLogStep(v_Log, 'Before START TRANSACTION', p_DarkStoreID, p_ProductID, NULL);

    START TRANSACTION;

    INSERT INTO `Order` (OrderDate, Status, CustomerID, DarkStoreID)
    VALUES (NOW(), 'Confirmed', p_CustomerID, p_DarkStoreID);
    SET v_OrderID = LAST_INSERT_ID();
    CALL DemoLogStep(v_Log, 'INSERT INTO `Order` (not yet committed)', p_DarkStoreID, p_ProductID, v_OrderID);

    CALL DemoAddOrderLine(v_OrderID, p_DarkStoreID, p_ProductID);
    CALL DemoLogStep(v_Log, 'Add line: 1 unit Available -> Reserved', p_DarkStoreID, p_ProductID, v_OrderID);

    ROLLBACK;
    CALL DemoLogStep(v_Log, 'ROLLBACK: the order, line and stock movement are undone', p_DarkStoreID, p_ProductID, v_OrderID);

    SELECT v_Log AS Steps, NULL AS OrderID;
END$$


-- SAVEPOINT: a two-line order where only the second line is undone.
-- The log tracks the second product, whose reservation is rolled back.
DROP PROCEDURE IF EXISTS DemoSavepoint$$

CREATE PROCEDURE DemoSavepoint(
    IN p_CustomerID INT,
    IN p_DarkStoreID INT,
    IN p_ProductID INT,
    IN p_SecondProductID INT
)
BEGIN
    DECLARE v_Log JSON DEFAULT JSON_ARRAY();
    DECLARE v_OrderID INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_ProductID = p_SecondProductID THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Choose two different products';
    END IF;

    CALL DemoLogStep(v_Log, 'Before START TRANSACTION', p_DarkStoreID, p_SecondProductID, NULL);

    START TRANSACTION;

    INSERT INTO `Order` (OrderDate, Status, CustomerID, DarkStoreID)
    VALUES (NOW(), 'Confirmed', p_CustomerID, p_DarkStoreID);
    SET v_OrderID = LAST_INSERT_ID();

    CALL DemoAddOrderLine(v_OrderID, p_DarkStoreID, p_ProductID);
    CALL DemoLogStep(v_Log, 'INSERT order and line 1 (first product)', p_DarkStoreID, p_SecondProductID, v_OrderID);

    SAVEPOINT after_first_line;
    CALL DemoLogStep(v_Log, 'SAVEPOINT after_first_line', p_DarkStoreID, p_SecondProductID, v_OrderID);

    CALL DemoAddOrderLine(v_OrderID, p_DarkStoreID, p_SecondProductID);
    CALL DemoLogStep(v_Log, 'Add line 2: 1 unit Available -> Reserved', p_DarkStoreID, p_SecondProductID, v_OrderID);

    ROLLBACK TO SAVEPOINT after_first_line;
    CALL DemoLogStep(v_Log, 'ROLLBACK TO SAVEPOINT: line 2 is undone', p_DarkStoreID, p_SecondProductID, v_OrderID);

    COMMIT;
    CALL DemoLogStep(v_Log, 'COMMIT: the order is saved with line 1 only', p_DarkStoreID, p_SecondProductID, v_OrderID);

    SELECT v_Log AS Steps, v_OrderID AS OrderID;
END$$

DELIMITER ;


-- ============================================================================
-- PART C: APPLICATION ACCOUNT PRIVILEGES
-- The procedures run with their definer's rights, so qc_app can modify data
-- only through them; it holds no INSERT, UPDATE or DELETE privileges.
-- ============================================================================

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.PlaceCartOrder
TO 'qc_app'@'localhost';

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.AdvanceOrderStatus
TO 'qc_app'@'localhost';

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.RestockInventory
TO 'qc_app'@'localhost';

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.MoveInventoryState
TO 'qc_app'@'localhost';

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.RecordStockCount
TO 'qc_app'@'localhost';

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.RegisterCustomer
TO 'qc_app'@'localhost';

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.ResetOversellSandbox
TO 'qc_app'@'localhost';

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.SimulateNaiveOrder
TO 'qc_app'@'localhost';

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.DemoCommit
TO 'qc_app'@'localhost';

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.DemoRollback
TO 'qc_app'@'localhost';

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.DemoSavepoint
TO 'qc_app'@'localhost';


-- ============================================================================
-- PART D: RECONCILE SAMPLE-ORDER RESERVATIONS
-- The sample orders in 01_create_db_insert_data.sql were inserted directly, so
-- some open orders have no matching reserved stock. Without this step they
-- could not be cancelled or dispatched. For every open order line, any
-- shortfall is moved from Available to Reserved, exactly as PlaceOrder would
-- have done. Re-running this part is harmless: the shortfall is then zero.
-- ============================================================================

CREATE TEMPORARY TABLE ReservationShortfall AS
SELECT
    o.DarkStoreID,
    oi.ProductID,
    SUM(oi.Quantity) - COALESCE(MAX(r.Quantity), 0) AS Shortfall
FROM `Order` AS o
INNER JOIN OrderItem AS oi
    ON o.OrderID = oi.OrderID
INNER JOIN InventoryState AS rs
    ON rs.StateName = 'Reserved'
LEFT JOIN Inventory AS r
    ON r.DarkStoreID = o.DarkStoreID
   AND r.ProductID = oi.ProductID
   AND r.StateID = rs.StateID
WHERE o.Status IN ('Confirmed', 'Preparing')
GROUP BY
    o.DarkStoreID,
    oi.ProductID
HAVING Shortfall > 0;

UPDATE Inventory AS a
INNER JOIN InventoryState AS s
    ON a.StateID = s.StateID
   AND s.StateName = 'Available'
INNER JOIN ReservationShortfall AS sf
    ON sf.DarkStoreID = a.DarkStoreID
   AND sf.ProductID = a.ProductID
SET a.Quantity = a.Quantity - sf.Shortfall;

INSERT INTO Inventory
    (DarkStoreID, ProductID, StateID, Quantity)
SELECT
    sf.DarkStoreID,
    sf.ProductID,
    s.StateID,
    sf.Shortfall
FROM ReservationShortfall AS sf
INNER JOIN InventoryState AS s
    ON s.StateName = 'Reserved'
ON DUPLICATE KEY UPDATE
    Quantity = Inventory.Quantity + sf.Shortfall;

DROP TEMPORARY TABLE ReservationShortfall;
