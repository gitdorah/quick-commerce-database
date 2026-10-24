import { useState } from 'react';
import { api } from '../api.js';
import StockActions from '../components/StockActions.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { formatCurrency } from '../format.js';
import { useResource } from '../hooks.js';

const STATE_COLUMNS = [
  ['Available', 'Available'],
  ['Reserved', 'Reserved'],
  ['Damaged', 'Damaged'],
  ['InTransit', 'In-Transit'],
];

export default function OpsInventory() {
  const { stores } = useSession();
  const [selectedStore, setSelectedStore] = useState(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState(null);
  const storeId = selectedStore ?? stores[0]?.DarkStoreID;

  const inventory = useResource(
    () => (storeId ? api(`/inventory?storeId=${storeId}`) : Promise.resolve([])),
    [storeId],
    { pollMs: 10000 },
  );

  const rows = (inventory.data ?? []).filter((row) => !lowOnly || row.LowStock);
  const totals = STATE_COLUMNS.map(([key]) => rows.reduce((sum, row) => sum + row[key], 0));
  const lowCount = (inventory.data ?? []).filter((row) => row.LowStock).length;

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p className="muted">
            Stock by state for each dark store. Low stock comes from LowStockView (under 10 available).
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Dark store">
          {stores.map((store) => (
            <button
              key={store.DarkStoreID}
              role="tab"
              aria-selected={store.DarkStoreID === storeId}
              className={store.DarkStoreID === storeId ? 'active' : ''}
              onClick={() => setSelectedStore(store.DarkStoreID)}
            >
              {store.Location}
            </button>
          ))}
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low stock only ({lowCount})
        </label>
      </div>

      {inventory.error && <div className="notice notice-critical">{inventory.error.message}</div>}

      <div className={`card table-wrap${inventory.loading && inventory.data ? ' refreshing' : ''}`}>
        <table className="data-table inventory-table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Price</th>
              {STATE_COLUMNS.map(([key, label]) => (
                <th key={key} className="num">
                  {label}
                </th>
              ))}
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ProductID} className={row.LowStock ? 'row-low' : ''}>
                <td>
                  <div className="product-cell">
                    <span className="cell-title">{row.ProductName}</span>
                    {row.LowStock && (
                      <span className="badge badge-warning">
                        {row.Available === 0 && row.Reserved + row.Damaged + row.InTransit === 0
                          ? 'Not stocked'
                          : 'Low stock'}
                      </span>
                    )}
                  </div>
                </td>
                <td className="num">{formatCurrency(row.Price)}</td>
                {STATE_COLUMNS.map(([key]) => (
                  <td key={key} className={`num${row[key] === 0 ? ' muted' : ''}`}>
                    {row[key]}
                  </td>
                ))}
                <td className="actions-cell">
                  <button className="button button-ghost button-small" onClick={() => setEditing(row)}>
                    Adjust
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total units</th>
              <th />
              {totals.map((total, index) => (
                <th key={index} className="num">
                  {total}
                </th>
              ))}
              <th />
            </tr>
          </tfoot>
        </table>
      </div>

      {editing && (
        <StockActions row={editing} onClose={() => setEditing(null)} onDone={inventory.reload} />
      )}
    </div>
  );
}
