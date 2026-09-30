CREATE DATABASE QuickCommerceDB;
USE QuickCommerceDB;

-- =========================================
-- 1. CUSTOMER
-- =========================================

CREATE TABLE Customer (
    CustomerID INT PRIMARY KEY AUTO_INCREMENT,
    Name VARCHAR(100) NOT NULL,
    Contact VARCHAR(15) NOT NULL
);

INSERT INTO Customer (Name, Contact) VALUES
('Aarav Mehta', '9876543210'),
('Riya Sharma', '9823456712'),
('Kabir Shah', '9765432189'),
('Ananya Patel', '9812345678'),
('Vihaan Joshi', '9898765432');


-- =========================================
-- 2. DARK_STORE
-- =========================================

CREATE TABLE DarkStore (
    DarkStoreID INT PRIMARY KEY AUTO_INCREMENT,
    Location VARCHAR(100) NOT NULL,
    Address VARCHAR(255),
    Capacity INT NOT NULL
);

INSERT INTO DarkStore (Location, Address, Capacity) VALUES
('Andheri', 'Andheri West, Mumbai', 5000),
('Bandra', 'Bandra East, Mumbai', 4500),
('Powai', 'Hiranandani, Powai, Mumbai', 4000),
('Dadar', 'Dadar West, Mumbai', 3500);


-- =========================================
-- 3. PRODUCT
-- =========================================

CREATE TABLE Product (
    ProductID INT PRIMARY KEY AUTO_INCREMENT,
    Name VARCHAR(100) NOT NULL,
    Price DECIMAL(10,2) NOT NULL,
    Description VARCHAR(255)
);

INSERT INTO Product (Name, Price, Description) VALUES
('Amul Taaza Milk 1L', 62.00, 'Fresh toned milk'),
('Britannia Bread 400g', 45.00, 'White sandwich bread'),
('Lay''s Classic Salted 50g', 20.00, 'Classic salted potato chips'),
('Coca Cola 750ml', 40.00, 'Carbonated soft drink'),
('Tata Salt 1kg', 30.00, 'Iodized packaged salt'),
('Maggi 2-Minute Noodles 70g', 15.00, 'Instant noodles'),
('Surf Excel Matic 2kg', 320.00, 'Liquid detergent'),
('Parle-G Biscuits 800g', 85.00, 'Glucose biscuits');


-- =========================================
-- 4. INVENTORY_STATE
-- =========================================

CREATE TABLE InventoryState (
    StateID INT PRIMARY KEY AUTO_INCREMENT,
    StateName VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO InventoryState (StateName) VALUES
('Available'),
('Reserved'),
('Damaged'),
('In-Transit');


-- =========================================
-- 5. ORDER
-- =========================================

CREATE TABLE `Order` (
    OrderID INT PRIMARY KEY AUTO_INCREMENT,
    OrderDate DATETIME NOT NULL,
    Status VARCHAR(30) NOT NULL,
    CustomerID INT NOT NULL,
    DarkStoreID INT NOT NULL,

    FOREIGN KEY (CustomerID)
        REFERENCES Customer(CustomerID),

    FOREIGN KEY (DarkStoreID)
        REFERENCES DarkStore(DarkStoreID)
);

INSERT INTO `Order`
(OrderDate, Status, CustomerID, DarkStoreID) VALUES
('2026-09-30 09:15:00', 'Delivered', 1, 1),
('2026-09-30 09:22:00', 'Preparing', 2, 2),
('2026-09-30 09:31:00', 'Confirmed', 3, 1),
('2026-09-30 09:42:00', 'Out for Delivery', 4, 3),
('2026-09-30 09:55:00', 'Confirmed', 5, 4);


-- =========================================
-- 6. ORDER_ITEM
-- =========================================

CREATE TABLE OrderItem (
    OrderItemID INT PRIMARY KEY AUTO_INCREMENT,
    OrderID INT NOT NULL,
    ProductID INT NOT NULL,
    Quantity INT NOT NULL,

    FOREIGN KEY (OrderID)
        REFERENCES `Order`(OrderID),

    FOREIGN KEY (ProductID)
        REFERENCES Product(ProductID),

    CHECK (Quantity > 0)
);

INSERT INTO OrderItem
(OrderID, ProductID, Quantity) VALUES
(1, 1, 2),
(1, 2, 1),
(2, 3, 3),
(2, 4, 2),
(3, 1, 1),
(3, 6, 4),
(4, 5, 2),
(4, 7, 1),
(5, 8, 2),
(5, 3, 1);


-- =========================================
-- 7. INVENTORY
-- =========================================

CREATE TABLE Inventory (
    InventoryID INT PRIMARY KEY AUTO_INCREMENT,
    DarkStoreID INT NOT NULL,
    ProductID INT NOT NULL,
    StateID INT NOT NULL,
    Quantity INT NOT NULL,

    FOREIGN KEY (DarkStoreID)
        REFERENCES DarkStore(DarkStoreID),

    FOREIGN KEY (ProductID)
        REFERENCES Product(ProductID),

    FOREIGN KEY (StateID)
        REFERENCES InventoryState(StateID),

    CHECK (Quantity >= 0),

    UNIQUE (DarkStoreID, ProductID, StateID)
);

INSERT INTO Inventory
(DarkStoreID, ProductID, StateID, Quantity) VALUES

-- Andheri Store
(1, 1, 1, 25),   -- Milk - Available
(1, 1, 2, 3),    -- Milk - Reserved
(1, 2, 1, 40),   -- Bread - Available
(1, 3, 1, 60),   -- Chips - Available
(1, 4, 1, 35),   -- Coca Cola - Available
(1, 6, 1, 50),   -- Maggi - Available
(1, 6, 3, 2),    -- Maggi - Damaged

-- Bandra Store
(2, 1, 1, 20),   -- Milk - Available
(2, 2, 1, 30),   -- Bread - Available
(2, 3, 1, 45),   -- Chips - Available
(2, 3, 2, 5),    -- Chips - Reserved
(2, 4, 1, 25),   -- Coca Cola - Available
(2, 5, 1, 35),   -- Salt - Available
(2, 8, 4, 20),   -- Parle-G - In-Transit

-- Powai Store
(3, 1, 1, 18),   -- Milk - Available
(3, 2, 1, 25),   -- Bread - Available
(3, 5, 1, 40),   -- Salt - Available
(3, 7, 1, 15),   -- Surf Excel - Available
(3, 7, 2, 2),    -- Surf Excel - Reserved

-- Dadar Store
(4, 3, 1, 50),   -- Chips - Available
(4, 5, 1, 30),   -- Salt - Available
(4, 6, 1, 45),   -- Maggi - Available
(4, 8, 1, 25),   -- Parle-G - Available
(4, 8, 3, 1);    -- Parle-G - Damaged
