import { Router } from 'express';
import { callProcedure, pool } from '../db.js';
import { HttpError } from '../errors.js';
import { positiveInt } from '../validate.js';

const router = Router();

// ----------------------------------------------------------------------------
// Transaction control: COMMIT, ROLLBACK and SAVEPOINT (06_application_procedures.sql)
// ----------------------------------------------------------------------------

const SCENARIOS = {
  commit: 'DemoCommit',
  rollback: 'DemoRollback',
  savepoint: 'DemoSavepoint',
};

router.post('/transactions/:scenario', async (req, res) => {
  const procedure = SCENARIOS[req.params.scenario];
  if (!procedure) throw new HttpError(404, 'Unknown scenario');

  const args = [
    positiveInt(req.body?.customerId, 'customerId'),
    positiveInt(req.body?.darkStoreId, 'darkStoreId'),
    positiveInt(req.body?.productId, 'productId'),
  ];
  if (req.params.scenario === 'savepoint') {
    args.push(positiveInt(req.body?.secondProductId, 'secondProductId'));
  }

  const [result] = await callProcedure(procedure, args);
  const steps = typeof result.Steps === 'string' ? JSON.parse(result.Steps) : result.Steps;
  res.json({ steps, orderId: result.OrderID });
});

// ----------------------------------------------------------------------------
// Security: the privileges of the account the application runs as
// ----------------------------------------------------------------------------

router.get('/security', async (req, res) => {
  const [[{ account }]] = await pool.query('SELECT CURRENT_USER() AS account');
  const [grants] = await pool.query('SHOW GRANTS');
  res.json({ account, grants: grants.map((row) => Object.values(row)[0]) });
});

// Fixed statements that must be refused, either by missing privileges or by
// the business rules in the procedures and triggers. None accepts input and
// none would change data even if it were allowed (WHERE matches no rows,
// failed procedures roll back).
const GUARDS = [
  {
    id: 1,
    label: 'Change stock directly, bypassing the procedures',
    sql: 'UPDATE Inventory SET Quantity = 999 WHERE InventoryID = 0',
    enforcedBy: 'Privileges: qc_app has no UPDATE',
  },
  {
    id: 2,
    label: 'Delete customer records',
    sql: 'DELETE FROM Customer WHERE CustomerID = 0',
    enforcedBy: 'Privileges: qc_app has no DELETE',
  },
  {
    id: 3,
    label: 'Order zero units',
    sql: 'CALL PlaceOrder(1, 1, 1, 0)',
    enforcedBy: 'PlaceOrder validation',
  },
  {
    id: 4,
    label: 'Order more milk than Andheri has',
    sql: 'CALL PlaceOrder(1, 1, 1, 100000)',
    enforcedBy: 'PlaceOrder conditional UPDATE + ROW_COUNT()',
  },
  {
    id: 5,
    label: 'Cancel an order that was already delivered',
    sql: 'CALL CancelOrder(1)',
    enforcedBy: 'CancelOrder status check',
  },
];

router.get('/guards', (req, res) => {
  res.json(GUARDS);
});

router.post('/guards/:id', async (req, res) => {
  const guard = GUARDS.find((candidate) => candidate.id === Number(req.params.id));
  if (!guard) throw new HttpError(404, 'Unknown guard');

  try {
    await pool.query(guard.sql);
    res.json({ blocked: false, message: 'The statement was allowed' });
  } catch (err) {
    if (!err.errno) throw err;
    res.json({
      blocked: true,
      message: `ERROR ${err.errno} (${err.sqlState}): ${err.sqlMessage}`,
    });
  }
});

export default router;
