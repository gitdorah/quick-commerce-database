import { useState } from 'react';
import { api, post } from '../api.js';
import OrderCard from '../components/OrderCard.jsx';
import StatTile from '../components/StatTile.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useToast } from '../components/Toast.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { formatCompactCurrency } from '../format.js';
import { useResource } from '../hooks.js';

const COLUMNS = ['Confirmed', 'Preparing', 'Out for Delivery', 'Delivered', 'Cancelled'];

const NEXT_ACTION = {
  Confirmed: 'Start preparing',
  Preparing: 'Dispatch',
  'Out for Delivery': 'Mark delivered',
};

export default function OpsOrders() {
  const { stores } = useSession();
  const notify = useToast();
  const [storeFilter, setStoreFilter] = useState('');
  const summary = useResource(() => api('/ops/summary'), [], { pollMs: 5000 });
  const orders = useResource(
    () => api(`/orders${storeFilter ? `?storeId=${storeFilter}` : ''}`),
    [storeFilter],
    { pollMs: 5000 },
  );
  const [busy, setBusy] = useState(null);

  async function act(order, action) {
    setBusy(order.OrderID);
    try {
      const result = await post(`/orders/${order.OrderID}/${action}`);
      notify(`Order #${order.OrderID} → ${result.OrderStatus}`, 'success');
    } catch (err) {
      notify(`Order #${order.OrderID}: ${err.message}`, 'error');
    } finally {
      setBusy(null);
      orders.reload();
      summary.reload();
    }
  }

  const stats = summary.data;
  const list = orders.data ?? [];

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Orders board</h1>
          <p className="muted">
            Dispatching an order consumes its reserved stock (AdvanceOrderStatus). Refreshes every 5
            seconds.
          </p>
        </div>
        <label className="field field-inline">
          <span>Dark store</span>
          <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.DarkStoreID} value={s.DarkStoreID}>
                {s.Location}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="stat-row">
        <StatTile label="Open orders" value={stats?.OpenOrders ?? '–'} note="Confirmed, preparing or out" />
        <StatTile label="Orders today" value={stats?.OrdersToday ?? '–'} />
        <StatTile
          label="Order value"
          value={stats ? formatCompactCurrency(stats.OrderValue) : '–'}
          note="All non-cancelled orders"
        />
        <StatTile
          label="Available stock value"
          value={stats ? formatCompactCurrency(stats.AvailableInventoryValue) : '–'}
          note="At catalogue prices"
        />
        <StatTile
          label="Low-stock lines"
          value={stats?.LowStockItems ?? '–'}
          note="Under 10 available (LowStockView)"
          tone={stats?.LowStockItems ? 'warning' : undefined}
        />
      </div>

      {orders.error && <div className="notice notice-critical">{orders.error.message}</div>}

      <div className={`board${orders.loading && orders.data ? ' refreshing' : ''}`}>
        {COLUMNS.map((status) => {
          const column = list.filter((order) => order.Status === status);
          return (
            <section key={status} className="board-column" aria-label={status}>
              <header>
                <StatusBadge status={status} />
                <span className="muted small">{column.length}</span>
              </header>
              {column.length === 0 && <p className="muted small empty">No orders</p>}
              {column.map((order) => (
                <OrderCard
                  key={order.OrderID}
                  order={order}
                  compact
                  showCustomer
                  actions={
                    (NEXT_ACTION[status] || status === 'Confirmed') && (
                      <>
                        {NEXT_ACTION[status] && (
                          <button
                            className="button button-primary button-small"
                            disabled={busy === order.OrderID}
                            onClick={() => act(order, 'advance')}
                          >
                            {NEXT_ACTION[status]}
                          </button>
                        )}
                        {status === 'Confirmed' && (
                          <button
                            className="button button-ghost button-small"
                            disabled={busy === order.OrderID}
                            onClick={() => act(order, 'cancel')}
                          >
                            Cancel
                          </button>
                        )}
                      </>
                    )
                  }
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
