
-- ============================================================
-- FILE: database_security.sql
-- PURPOSE: Configure least-privilege application access
-- REQUIREMENT: Run using a MySQL account with user-management
--              and GRANT privileges.
-- ============================================================

USE QuickCommerceDB;

-- Create a dedicated application account.
-- Replace the example password before running this script.
CREATE USER IF NOT EXISTS 'qc_app'@'localhost'
IDENTIFIED BY 'ReplaceWithStrongPassword_2026!';

-- Allow read-only access to database tables and views.
GRANT SELECT ON QuickCommerceDB.*
TO 'qc_app'@'localhost';

-- Allow controlled order placement and cancellation.
GRANT EXECUTE ON PROCEDURE QuickCommerceDB.PlaceOrder
TO 'qc_app'@'localhost';

GRANT EXECUTE ON PROCEDURE QuickCommerceDB.CancelOrder
TO 'qc_app'@'localhost';

-- Inspect the privileges granted to the account.
SHOW GRANTS FOR 'qc_app'@'localhost';
