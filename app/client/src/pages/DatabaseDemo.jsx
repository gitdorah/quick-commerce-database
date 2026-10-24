import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, post } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { useResource } from '../hooks.js';

const SCENARIOS = [
  {
    key: 'commit',
    title: 'COMMIT',
    summary: 'Place a one-unit order by hand. The order, its line and the stock movement become permanent together.',
    outline: `START TRANSACTION;
INSERT INTO \`Order\` ...;
INSERT INTO OrderItem ...;
UPDATE Inventory ...;  -- move 1 unit
COMMIT;`,
  },
  {
    key: 'rollback',
    title: 'ROLLBACK',
    summary: 'The same steps, but the customer abandons checkout. Every change is undone, as if nothing happened.',
    outline: `START TRANSACTION;
INSERT INTO \`Order\` ...;
INSERT INTO OrderItem ...;
UPDATE Inventory ...;
ROLLBACK;`,
  },
  {
    key: 'savepoint',
    title: 'SAVEPOINT',
    summary: 'A two-line order. The customer removes the second item, so only that line is rolled back before COMMIT.',
    outline: `START TRANSACTION;
INSERT order + line 1;
SAVEPOINT after_first_line;
INSERT line 2;
ROLLBACK TO SAVEPOINT after_first_line;
COMMIT;`,
  },
];

function StepLog({ result, scenario, productName }) {
  const showLines = result.steps.some((step) => step.lines !== null);
  return (
    <div className="step-log">
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Step</th>
            <th className="num">Available</th>
            <th className="num">Reserved</th>
            <th className="num">Orders</th>
            {showLines && <th className="num">Lines</th>}
          </tr>
        </thead>
        <tbody>
          {result.steps.map((step, index) => (
            <tr key={index}>
              <td className="muted">{index + 1}</td>
              <td className="step-name">{step.step}</td>
              <td className="num">{step.available}</td>
              <td className="num">{step.reserved}</td>
              <td className="num">{step.orders}</td>
              {showLines && <td className="num">{step.lines ?? '–'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Stock columns track {productName}
        {scenario === 'savepoint' && ' (the second product, whose line is rolled back)'}.
        {result.orderId && (
          <>
            {' '}
            Order #{result.orderId} was saved; cancel it from the <Link to="/ops">Orders board</Link> if you like.
          </>
        )}
      </p>
    </div>
  );
}

function TransactionsPanel() {
  const { customer, stores } = useSession();
  const notify = useToast();
  const [storeId, setStoreId] = useState(null);
  const [productId, setProductId] = useState(null);
  const [secondProductId, setSecondProductId] = useState(null);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null);

  const darkStoreId = storeId ?? stores[0]?.DarkStoreID;
  const catalog = useResource(
    () => (darkStoreId ? api(`/stores/${darkStoreId}/catalog`) : Promise.resolve([])),
    [darkStoreId],
  );
  const inStock = (catalog.data ?? []).filter((p) => p.AvailableQuantity > 0);
  const first = inStock.find((p) => p.ProductID === productId) ?? inStock[0];
  const second =
    inStock.find((p) => p.ProductID === secondProductId && p.ProductID !== first?.ProductID) ??
    inStock.find((p) => p.ProductID !== first?.ProductID);

  useEffect(() => {
    setProductId(null);
    setSecondProductId(null);
    setResults({});
  }, [darkStoreId]);

  async function run(scenario) {
    setRunning(scenario);
    try {
      const result = await post(`/demo/transactions/${scenario}`, {
        customerId: customer.CustomerID,
        darkStoreId,
        productId: first.ProductID,
        secondProductId: second?.ProductID,
      });
      setResults((current) => ({ ...current, [scenario]: result }));
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setRunning(null);
      catalog.reload();
    }
  }

  return (
    <section className="demo-section">
      <div className="section-head">
        <h2>Transaction control</h2>
        <p className="muted">
          The scenarios from <code>database/04_transaction_management.sql</code>, run as stored
          procedures. Each step shows what the transaction sees at that moment.
        </p>
      </div>

      <div className="card demo-controls">
        <label className="field">
          <span>Dark store</span>
          <select value={darkStoreId ?? ''} onChange={(e) => setStoreId(Number(e.target.value))}>
            {stores.map((s) => (
              <option key={s.DarkStoreID} value={s.DarkStoreID}>
                {s.Location}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Product</span>
          <select value={first?.ProductID ?? ''} onChange={(e) => setProductId(Number(e.target.value))}>
            {inStock.map((p) => (
              <option key={p.ProductID} value={p.ProductID}>
                {p.ProductName} ({p.AvailableQuantity})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Second product (savepoint)</span>
          <select value={second?.ProductID ?? ''} onChange={(e) => setSecondProductId(Number(e.target.value))}>
            {inStock
              .filter((p) => p.ProductID !== first?.ProductID)
              .map((p) => (
                <option key={p.ProductID} value={p.ProductID}>
                  {p.ProductName} ({p.AvailableQuantity})
                </option>
              ))}
          </select>
        </label>
        <p className="muted small">Orders are placed as {customer?.Name ?? '…'}.</p>
      </div>

      <div className="scenario-grid">
        {SCENARIOS.map((scenario) => {
          const tracked = scenario.key === 'savepoint' ? second : first;
          return (
            <article key={scenario.key} className="card scenario">
              <div className="scenario-about">
                <header>
                  <h3>{scenario.title}</h3>
                  <button
                    className="button button-primary button-small"
                    disabled={!!running || !first || (scenario.key === 'savepoint' && !second) || !customer}
                    onClick={() => run(scenario.key)}
                  >
                    {running === scenario.key ? 'Running…' : 'Run'}
                  </button>
                </header>
                <p className="small">{scenario.summary}</p>
                <pre className="code">
                  <code>{scenario.outline}</code>
                </pre>
              </div>
              {results[scenario.key] ? (
                <StepLog
                  result={results[scenario.key]}
                  scenario={scenario.key}
                  productName={tracked?.ProductName ?? 'the product'}
                />
              ) : (
                <p className="muted small step-placeholder">Run it to see each step.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SecurityPanel() {
  const security = useResource(() => api('/demo/security'), []);
  const guards = useResource(() => api('/demo/guards'), []);
  const [outcomes, setOutcomes] = useState({});
  const grants = security.data?.grants ?? [];
  const procedures = grants
    .map((grant) => grant.match(/EXECUTE ON PROCEDURE `[^`]+`\.`([^`]+)`/i)?.[1])
    .filter(Boolean);

  async function tryGuard(guard) {
    const outcome = await post(`/demo/guards/${guard.id}`).catch((err) => ({
      blocked: false,
      message: err.message,
    }));
    setOutcomes((current) => ({ ...current, [guard.id]: outcome }));
  }

  return (
    <section className="demo-section">
      <div className="section-head">
        <h2>Security</h2>
        <p className="muted">
          The app connects as a least-privilege account from{' '}
          <code>database/05_database_security.sql</code>. It can read, and it can change data only
          through stored procedures.
        </p>
      </div>

      <div className="security-grid">
        <article className="card security-card">
          <div className="eyebrow">Connected as</div>
          <h3>{security.data?.account ?? '…'}</h3>
          <ul className="grant-list">
            <li>
              <strong>SELECT</strong> on every table and view in QuickCommerceDB
            </li>
            <li>
              <strong>EXECUTE</strong> on {procedures.length} stored procedures:{' '}
              <span className="muted">{procedures.join(', ')}</span>
            </li>
          </ul>
          <details>
            <summary>SHOW GRANTS output</summary>
            <pre className="code">
              <code>{grants.join('\n')}</code>
            </pre>
          </details>
          <p className="muted small">
            No INSERT, UPDATE or DELETE on any table. A separate <code>qc_reporting</code> account
            can read only the three views.
          </p>
        </article>

        <article className="card security-card">
          <div className="eyebrow">Guard rails</div>
          <h3>Try something that should be refused</h3>
          <ul className="guard-list">
            {(guards.data ?? []).map((guard) => {
              const outcome = outcomes[guard.id];
              return (
                <li key={guard.id}>
                  <div className="guard-head">
                    <div>
                      <div className="guard-label">{guard.label}</div>
                      <code className="small">{guard.sql}</code>
                    </div>
                    <button className="button button-ghost button-small" onClick={() => tryGuard(guard)}>
                      Try
                    </button>
                  </div>
                  {outcome && (
                    <p className={`guard-outcome ${outcome.blocked ? 'text-good' : 'text-critical'}`}>
                      <span aria-hidden="true">{outcome.blocked ? '✓ Refused · ' : '✕ Allowed · '}</span>
                      {outcome.message}
                      <span className="muted"> — {guard.enforcedBy}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </article>
      </div>
    </section>
  );
}

export default function DatabaseDemo() {
  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Transactions &amp; security</h1>
          <p className="muted">
            Week 10 of the project, live: transaction control, user privileges and the business rules
            that reject invalid operations.
          </p>
        </div>
      </div>
      <TransactionsPanel />
      <SecurityPanel />
    </div>
  );
}
