# Real-Time Inventory Consistency in Quick-Commerce Databases

Quick-commerce platforms (like Blinkit, Zepto, Instamart) promise ultra-fast 10–15 minute delivery by operating dense networks of **dark stores** (micro-warehouses ~2,000–5,000 sq ft, located within ~1–3 km of customers).  These stores stock only high-velocity SKUs (5,000–10,000 items) and must keep inventory data accurate in real time.  In such systems, database tables typically link Customers → Orders → OrderItems → DarkStore → Product → Inventory.  Inventory data is often split into multiple “states” to track stock precisely:  

- **Available:** On-shelf stock that can be sold.  
- **Reserved:** Stock soft-locked for pending orders (e.g. held in carts).  
- **Damaged:** Unsellable or expired stock.  
- **In-Transit:** Stock moving between warehouses and dark stores.  

Inventory accuracy is critical – as one design guide puts it, “Inventory accuracy is the backbone of quick commerce. A customer should never be able to order something that’s out of stock”.  In practice, the database must update available and reserved counts immediately on each order, cart addition or cancellation.  Non-functional requirements therefore include **99%+ inventory accuracy** and **zero overselling under peak traffic**.  

## Drawbacks: Concurrency & Overselling

A key DBMS drawback in quick commerce is handling **high concurrency** on inventory updates.  For example, suppose a dark store has only 2 units of milk left. If three customers simultaneously place orders for milk, the database may briefly read “stock=2” for each transaction and allow all three orders.  This *overselling* occurs because concurrent transactions read stale inventory and then all decrement the same stock.  In technical terms, concurrent threads are “conflicting” over the same data.  Without proper locking or atomic operations, the system may temporarily allow inventory to go negative or require later order cancellations.  

Inadequate isolation or missing atomicity leads to *lost-update* or *dirty-read* problems.  For instance, if two transactions run in parallel without isolation, each might see the old stock count before either writes.  To prevent this, one must enforce ACID properties on inventory updates.  In practice, many systems use Redis or in-memory caches for speed, but even there **the updates must be atomic**:  as the InstaMock design notes, using a Lua script in Redis ensures “no race conditions. Multiple concurrent checkout requests cannot oversell inventory”.  In short, *we must avoid conflicting modifications of the same row by concurrent threads*, otherwise overselling or underselling anomalies will occur.  

## Solutions: Transactional Inventory Management

To fix these issues, databases use transactional and locking strategies.  Possible approaches include:  

- **Strict ACID transactions:** Use SQL transactions with appropriate isolation (e.g. `SELECT ... FOR UPDATE`) so each order’s inventory check-and-update is atomic.  However, pure pessimistic locking can hurt throughput under peak load.  
- **Optimistic locking:** Add a `version` column to the inventory table and do updates only if the version hasn’t changed.  For example, one system “adds a field: VERSION… and implements a simple optimistic lock” so that only one transaction wins if multiple try to decrement the same stock.  Failed updates are retried.  
- **Atomic caches (Redis):** Keep real-time stock in Redis hash or sorted set.  Run a single Lua script that checks available stock and decrements it in one operation.  E.g., the script `if available>=requested then HINCRBY... end` makes the change atomic, preventing oversells.  
- **Reservation workflow:** Implement soft and hard reserves.  On “add to cart”, do a *soft reserve* (decrement available, increment reserved) with a TTL (e.g. 10 min).  On checkout, convert to a *hard reserve* and attempt payment.  If payment fails or TTL expires, rollback by moving reserved stock back to available.  This ensures only paid carts consume stock.  
- **Distributed locks:** In complex systems, use a distributed lock service (or Redis lock) to serialize inventory updates across processes.  For example, grabbing a key like `lock:SKU123` before updating stock.  

These measures correspond to the **business requirement** that *“the system must maintain real-time, transactionally consistent inventory across concurrent orders and prevent any product from being oversold.”*  This goal is often stated explicitly: e.g. a system design guide lists “Consistency: No overselling during peak traffic” as a nonfunctional requirement.  In practice, teams combine tactics (optimistic updates, cache locks, queueing orders) to meet this goal.  

## Conclusion

In summary, quick-commerce platforms rely on a fast, always-consistent inventory database.  Without proper DBMS techniques (transactions, locks, atomic updates), concurrent orders can corrupt stock counts and force cancellations.  By enforcing ACID updates or equivalent atomic reservations, the system prevents overselling and maintains accurate stock visibility.  As one analysis of Blinkit’s architecture emphasizes, **“real-time processing enables ultra-fast deliveries”** and “speed is the product” in quick commerce.  Ensuring transactional consistency in the inventory database directly supports these business goals: it reduces failed orders and stockouts, and thus makes the promised 10-minute delivery reliable and trustworthy for customers.

**Sources:** Industry system-design guides and database-engineering blogs on quick-commerce inventory and concurrency.

## Running the Application

The `app/` folder contains a full-stack application built on this database: a Node.js (Express) API and a React (Vite) client. The API connects **only** as the least-privilege `qc_app` account from `database_security.sql`, which holds `SELECT` and `EXECUTE` privileges and nothing else. Every write therefore goes through a stored procedure.

### Prerequisites

- Node.js 20 or newer
- MySQL 8.0 or newer, running locally

### Setup

```bash
cd app
cp .env.example .env        # then fill in DB_ADMIN_PASSWORD (your MySQL root password)
npm install
npm run db:setup            # rebuilds QuickCommerceDB from the SQL files in this folder
npm run dev                 # API on http://localhost:4000, app on http://localhost:5173
```

`npm run db:setup` **drops and recreates `QuickCommerceDB`**. It runs these files in order:

1. `create_db_insert_data.sql`
2. `advanced_database_programming.sql`
3. `database_security.sql`
4. `application_procedures.sql`

It skips their demonstration `SELECT`/`CALL`/`SHOW` statements, so no test order is created. It then sets the `qc_app` password from `.env`. If `qc_app` can't log in over TCP, set `DB_SOCKET` (for example `/tmp/mysql.sock`) in `.env`.

For a single-port production build, run `npm run build && npm start` and open http://localhost:4000.

### What's in the app

| Page | What it shows | Database objects used |
|---|---|---|
| **Shop** (`/`) | Choose a customer and dark store, browse live stock, check out a multi-item cart | `AvailableInventoryView`, `PlaceCartOrder`, `RegisterCustomer` |
| **My orders** (`/orders`) | A customer's orders, and cancelling confirmed ones | `OrderSummaryView`, `CancelOrder` |
| **Orders board** (`/ops`) | KPIs, plus orders moved Confirmed → Preparing → Out for Delivery → Delivered | `AdvanceOrderStatus`, `LowStockView` |
| **Inventory** (`/ops/inventory`) | Stock by state per store: restock, mark damaged, receive in-transit stock, record a stock count | `RestockInventory`, `MoveInventoryState`, `RecordStockCount` |
| **Stress test** (`/stress`) | Fires up to 50 simultaneous orders at one item. It compares the atomic `PlaceOrder` with a naive check-then-act version that oversells and loses updates (run on a sandbox table) | `PlaceOrder`, `SimulateNaiveOrder`, `OversellSandbox` |
| **Reports** (`/reports`) | Runs the 12 queries in `sql_queries.sql`, read directly from that file | — |

### Database additions for the application

`application_procedures.sql` adds:

- the procedures listed above, plus `EXECUTE` grants for `qc_app`
- the `OversellSandbox` demo table
- a one-time reconciliation step. The sample orders 2, 3 and 5 were inserted without reserved stock, so the step moves each shortfall from Available to Reserved, as `PlaceOrder` would have done. Without it, those orders could not be cancelled or dispatched.

When an order is dispatched (Out for Delivery), its reserved stock is consumed.

### Tests

```bash
cd app
npm test     # rebuilds the database, then runs the API integration tests
```

The tests cover:
- atomic cart reservation and rollback
- cancellation
- dispatch consuming reserved stock
- inventory maintenance
- the zero-oversell guarantee under 10 concurrent orders
- the naive oversell demo
- every report query
- `qc_app` being unable to modify tables directly

### Notes

- There is no authentication. This is a local demonstration, and anyone who can open the app can use the operations pages.
- `npm run db:setup` and `npm test` reset the database to the sample data.
