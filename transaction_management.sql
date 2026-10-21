
-- ============================================================
-- PROJECT: Quick Commerce Database
-- FILE: transaction_management.sql
-- DBMS: MySQL 8.0+
-- PURPOSE: Demonstrate COMMIT, ROLLBACK and SAVEPOINT
-- ============================================================

USE QuickCommerceDB;

-- Create a demonstration-only table for transaction testing.
CREATE TABLE IF NOT EXISTS TransactionDemo (
    DemoID INT PRIMARY KEY,
    Description VARCHAR(100) NOT NULL,
    Amount DECIMAL(10,2) NOT NULL
);

-- Insert a consistent starting record.
-- Re-running this script will not duplicate the record.
INSERT INTO TransactionDemo (DemoID, Description, Amount)
VALUES (1, 'Initial test record', 1000.00)
ON DUPLICATE KEY UPDATE DemoID = VALUES(DemoID);

-- ------------------------------------------------------------
-- TEST 1: COMMIT
-- Purpose: Permanently save a transaction.
-- ------------------------------------------------------------

START TRANSACTION;

INSERT INTO TransactionDemo (DemoID, Description, Amount)
VALUES (2, 'Committed transaction', 500.00);

COMMIT;

-- Expected: DemoID 2 exists after COMMIT.
SELECT *
FROM TransactionDemo
ORDER BY DemoID;


-- ------------------------------------------------------------
-- TEST 2: ROLLBACK
-- Purpose: Undo changes made in the current transaction.
-- ------------------------------------------------------------

START TRANSACTION;

INSERT INTO TransactionDemo (DemoID, Description, Amount)
VALUES (3, 'Rolled-back transaction', 750.00);

-- Undo the insert.
ROLLBACK;

-- Expected: DemoID 3 does not exist.
SELECT *
FROM TransactionDemo
WHERE DemoID = 3;


-- ------------------------------------------------------------
-- TEST 3: SAVEPOINT
-- Purpose: Undo part of a transaction without discarding
--          earlier changes in that same transaction.
-- ------------------------------------------------------------

START TRANSACTION;

-- This change should be retained.
UPDATE TransactionDemo
SET Amount = 1100.00
WHERE DemoID = 1;

-- Mark the point to which we can roll back.
SAVEPOINT BeforeSecondUpdate;

-- This change should be undone.
UPDATE TransactionDemo
SET Amount = 1200.00
WHERE DemoID = 1;

-- Undo only the second update.
ROLLBACK TO SAVEPOINT BeforeSecondUpdate;

-- Save the remaining transaction.
COMMIT;

-- Expected: Amount for DemoID 1 is 1100.00.
SELECT *
FROM TransactionDemo
WHERE DemoID = 1;
