import { useEffect, useState } from 'react';
import { api, post } from '../api.js';
import RequestTimeline from '../components/RequestTimeline.jsx';
import StatTile from '../components/StatTile.jsx';
import { useToast } from '../components/Toast.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { plural } from '../format.js';
import { useResource } from '../hooks.js';

const MODES = {
  atomic: {
    label: 'Atomic · PlaceOrder',
    summary:
      'Each request runs CALL PlaceOrder on its own connection against the real Inventory table.',
    sql: `UPDATE Inventory
SET Quantity = Quantity - p_Quantity
WHERE DarkStoreID = p_DarkStoreID
  AND ProductID = p_ProductID
  AND StateID = v_AvailableStateID
  AND Quantity >= p_Quantity;

IF ROW_COUNT() = 0 THEN
    SIGNAL SQLSTATE '45000' ...;   -- reject
END IF;`,
    why: 'The check and the decrement are one statement. InnoDB locks the row, so competing transactions queue and each re-checks Quantity >= p_Quantity against the latest committed value.',
  },
  naive: {
    label: 'Naive · check-then-act',
    summary:
      'Each request runs CALL SimulateNaiveOrder against the OversellSandbox table, never your real inventory.',
    sql: `SELECT StockLevel INTO v_StockSeen      -- no lock
FROM OversellSandbox WHERE SandboxID = 1;

DO SLEEP(0.1);                           -- app/network latency

IF v_StockSeen >= p_Quantity THEN        -- stale check
    UPDATE OversellSandbox
    SET StockLevel = v_StockSeen - p_Quantity;   -- lost update
END IF;`,
    why: 'Every transaction reads the same stock before any of them writes, so all of them pass the check. Each then overwrites the stock with its own stale arithmetic.',
  },
};

function RunResult({ run, onCleanup, cleaning }) {
  const oversold = run.oversoldUnits > 0;
  return (
    <section className={`card run-result run-${run.mode}`}>
      <header className="run-head">
        <div className="eyebrow">{MODES[run.mode].label}</div>
        <h2>
          {run.accepted} of {plural(run.concurrency, 'order')} accepted
          {run.mode === 'naive' && ` for ${plural(run.stockBefore, 'unit')}`}
        </h2>
        <p className={oversold ? 'text-critical' : 'text-good'}>
          <span aria-hidden="true">{oversold ? '⚠ ' : '✓ '}</span>
          {oversold
            ? `Oversold by ${plural(run.oversoldUnits, 'unit')}.`
            : 'No overselling: every accepted unit was in stock.'}
        </p>
      </header>

      <div className="stat-row stat-row-compact">
        <StatTile label="Stock before" value={run.stockBefore} />
        <StatTile label="Units requested" value={run.unitsRequested} note={`${run.concurrency} × ${run.quantityEach}`} />
        <StatTile label="Units accepted" value={run.unitsAccepted} />
        <StatTile label="Units oversold" value={run.oversoldUnits} tone={oversold ? 'critical' : 'good'} />
        <StatTile label="Stock after" value={run.stockAfter} />
      </div>

      <p className={`consistency ${run.consistent ? 'text-good' : 'text-critical'}`}>
        <span aria-hidden="true">{run.consistent ? '✓ ' : '✕ '}</span>
        {run.mode === 'atomic'
          ? run.consistent
            ? `Consistent: Available fell ${run.stockBefore} → ${run.stockAfter} and Reserved rose ${run.reservedBefore} → ${run.reservedAfter}, both by exactly the ${plural(run.unitsAccepted, 'unit')} accepted.`
            : 'Inventory changed by a different amount than was accepted; other activity may have touched this product during the run.'
          : run.consistent
            ? 'The stock fell by exactly the units sold this time. Try more concurrent requests to expose the race.'
            : `Lost update: ${plural(run.unitsAccepted, 'unit')} sold, yet the stock only fell ${run.stockBefore} → ${run.stockAfter}, because each transaction wrote a value computed from its own stale read.`}
      </p>

      <RequestTimeline run={run} />

      {run.mode === 'atomic' && run.orderIds.length > 0 && (
        <div className="run-cleanup">
          <button className="button button-ghost" disabled={cleaning} onClick={() => onCleanup(run)}>
            {cleaning
              ? 'Cleaning up…'
              : `Cancel ${plural(run.orderIds.length, 'test order')} and restore Available to ${run.originalAvailable}`}
          </button>
        </div>
      )}
    </section>
  );
}

export default function StressTest() {
  const { stores, customers, customer } = useSession();
  const notify = useToast();
  const [form, setForm] = useState({
    darkStoreId: null,
    productId: null,
    customerId: null,
    concurrency: 10,
    quantityEach: 1,
    setStock: true,
    setStockTo: 2,
  });
  const [runs, setRuns] = useState({ atomic: null, naive: null });
  const [running, setRunning] = useState(null);
  const [cleaning, setCleaning] = useState(false);

  const darkStoreId = form.darkStoreId ?? stores[0]?.DarkStoreID;
  const customerId = form.customerId ?? customer?.CustomerID;
  const catalog = useResource(
    () => (darkStoreId ? api(`/stores/${darkStoreId}/catalog`) : Promise.resolve([])),
    [darkStoreId],
  );
  const products = catalog.data ?? [];
  const productId = form.productId ?? products[0]?.ProductID;
  const product = products.find((p) => p.ProductID === productId);

  useEffect(() => {
    setForm((current) => ({ ...current, productId: null }));
  }, [darkStoreId]);

  const update = (field) => (event) => {
    const { type, checked, value } = event.target;
    setForm((current) => ({
      ...current,
      [field]: type === 'checkbox' ? checked : Number(value),
    }));
  };

  async function run(mode) {
    setRunning(mode);
    try {
      const result = await post('/stress-test', {
        mode,
        customerId,
        darkStoreId,
        productId,
        concurrency: form.concurrency,
        quantityEach: form.quantityEach,
        setStockTo: form.setStock ? form.setStockTo : undefined,
      });
      // Remember the target so clean-up restores this product even if the form changes.
      setRuns((current) => ({ ...current, [mode]: { ...result, darkStoreId, productId } }));
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setRunning(null);
      catalog.reload();
    }
  }

  async function cleanup(atomicRun) {
    setCleaning(true);
    try {
      const result = await post('/stress-test/cleanup', {
        orderIds: atomicRun.orderIds,
        darkStoreId: atomicRun.darkStoreId,
        productId: atomicRun.productId,
        restoreAvailableTo: atomicRun.originalAvailable,
      });
      notify(
        `Cancelled ${plural(result.cancelled.length, 'order')}; Available restored to ${result.restoredAvailableTo}`,
        'success',
      );
      setRuns((current) => ({ ...current, atomic: null }));
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setCleaning(false);
      catalog.reload();
    }
  }

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Oversell stress test</h1>
          <p className="muted">
            Fire many orders at the same item at the same instant, and compare an atomic reservation
            with a naive read-then-write.
          </p>
        </div>
      </div>

      <div className="stress-layout">
        <form className="card stress-form" onSubmit={(e) => e.preventDefault()}>
          <h2>Scenario</h2>
          <label className="field">
            <span>Dark store</span>
            <select value={darkStoreId ?? ''} onChange={update('darkStoreId')}>
              {stores.map((s) => (
                <option key={s.DarkStoreID} value={s.DarkStoreID}>
                  {s.Location}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Product</span>
            <select value={productId ?? ''} onChange={update('productId')}>
              {products.map((p) => (
                <option key={p.ProductID} value={p.ProductID}>
                  {p.ProductName} ({p.AvailableQuantity} available)
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Orders placed as</span>
            <select value={customerId ?? ''} onChange={update('customerId')}>
              {customers.map((c) => (
                <option key={c.CustomerID} value={c.CustomerID}>
                  {c.Name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>
              Concurrent requests: <strong>{form.concurrency}</strong>
            </span>
            <input type="range" min="2" max="50" value={form.concurrency} onChange={update('concurrency')} />
          </label>
          <label className="field">
            <span>Units per order</span>
            <input type="number" min="1" max="100" value={form.quantityEach} onChange={update('quantityEach')} />
          </label>

          <label className="checkbox">
            <input type="checkbox" checked={form.setStock} onChange={update('setStock')} />
            Set the stock level before the run
          </label>
          {form.setStock && (
            <label className="field">
              <span>Stock level</span>
              <input type="number" min="0" value={form.setStockTo} onChange={update('setStockTo')} />
            </label>
          )}
          <p className="muted small">
            {form.setStock
              ? `Atomic runs set the real Available count of ${product?.ProductName ?? 'this product'} with RecordStockCount; use the clean-up button afterwards to restore it. Naive runs only set the sandbox.`
              : `Runs start from the current Available count (${product?.AvailableQuantity ?? '–'}).`}
          </p>

          <div className="stress-buttons">
            <button
              className="button button-primary"
              disabled={!!running || !productId}
              onClick={() => run('atomic')}
            >
              {running === 'atomic' ? 'Running…' : 'Run atomic'}
            </button>
            <button className="button button-danger" disabled={!!running || !productId} onClick={() => run('naive')}>
              {running === 'naive' ? 'Running…' : 'Run naive'}
            </button>
          </div>
        </form>

        <div className="stress-results">
          {!runs.atomic && !runs.naive && (
            <div className="card empty-state">
              <p>
                Run both modes with the same scenario. With 2 units in stock and 10 concurrent
                orders, the atomic procedure accepts exactly 2. The naive version accepts nearly all
                of them.
              </p>
            </div>
          )}
          {['atomic', 'naive'].map(
            (mode) => runs[mode] && <RunResult key={mode} run={runs[mode]} onCleanup={cleanup} cleaning={cleaning} />,
          )}
        </div>
      </div>

      <div className="explain-grid">
        {Object.entries(MODES).map(([key, mode]) => (
          <section key={key} className="card explain">
            <div className="eyebrow">{mode.label}</div>
            <p>{mode.summary}</p>
            <pre className="code">
              <code>{mode.sql}</code>
            </pre>
            <p className="small">{mode.why}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
