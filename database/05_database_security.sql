
-- ============================================================================
-- PROJECT: Quick Commerce Database
-- FILE: 05_database_security.sql
-- DBMS: MySQL 8.0+
--
-- PURPOSE:
-- Least-privilege accounts. No account used by an application or a report
-- holds INSERT, UPDATE or DELETE on any table.
--
--   qc_app        The ordering application. Reads tables and views, and may
--                 change data only by executing the stored procedures, which
--                 enforce the business rules. (The application's extra
--                 procedures are granted in 06_application_procedures.sql.)
--   qc_reporting  A reporting / analytics user. Reads the three views only;
--                 it cannot see the base tables (e.g. customer contacts) and
--                 cannot change anything.
--
-- REQUIREMENT:
-- Run as a MySQL account with CREATE USER and GRANT OPTION privileges,
-- after 01 and 03. Replace the placeholder passwords before real use;
-- `npm run db:setup` in app/ sets qc_app's password from app/.env.
-- ============================================================================

USE QuickCommerceDB;


-- ----------------------------------------------------------------------------
-- 1. Application account
-- ----------------------------------------------------------------------------

CREATE USER IF NOT EXISTS 'qc_app'@'localhost'
IDENTIFIED BY 'ReplaceWithStrongPassword_2026!';

-- Read access to tables and views.
GRANT SELECT ON QuickCommerceDB.*
TO 'qc_app'@'localhost';

-- Controlled order placement and cancellation.
GRANT EXECUTE ON PROCEDURE QuickCommerceDB.PlaceOrder
TO 'qc_app'@'localhost';

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.CancelOrder
TO 'qc_app'@'localhost';


-- ----------------------------------------------------------------------------
-- 2. Reporting account (views only)
-- ----------------------------------------------------------------------------

CREATE USER IF NOT EXISTS 'qc_reporting'@'localhost'
IDENTIFIED BY 'ReplaceWithReportingPassword_2026!';

GRANT SELECT ON QuickCommerceDB.AvailableInventoryView
TO 'qc_reporting'@'localhost';

GRANT SELECT ON QuickCommerceDB.OrderSummaryView
TO 'qc_reporting'@'localhost';

GRANT SELECT ON QuickCommerceDB.LowStockView
TO 'qc_reporting'@'localhost';


-- ----------------------------------------------------------------------------
-- 3. Inspect the privileges
-- ----------------------------------------------------------------------------

SHOW GRANTS FOR 'qc_app'@'localhost';
SHOW GRANTS FOR 'qc_reporting'@'localhost';


-- ----------------------------------------------------------------------------
-- 4. Verify the restrictions
-- Log in as each account (e.g. `mysql -u qc_app -p QuickCommerceDB`) and try
-- the statements below. They are commented out because this script runs as
-- an administrator.
-- ----------------------------------------------------------------------------

-- As qc_app:
--   CALL PlaceOrder(1, 1, 1, 1);             -- allowed: business rules apply
--   UPDATE Inventory SET Quantity = 999;     -- ERROR 1142: UPDATE command denied
--   DELETE FROM Customer;                    -- ERROR 1142: DELETE command denied

-- As qc_reporting:
--   SELECT * FROM LowStockView;              -- allowed
--   SELECT * FROM Customer;                  -- ERROR 1142: SELECT command denied
--   CALL PlaceOrder(1, 1, 1, 1);             -- ERROR 1370: execute command denied
