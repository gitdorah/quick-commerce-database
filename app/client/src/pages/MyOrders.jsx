import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, post } from '../api.js';
import OrderCard from '../components/OrderCard.jsx';
import SessionBar from '../components/SessionBar.jsx';
import { useToast } from '../components/Toast.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { useResource } from '../hooks.js';

export default function MyOrders() {
  const { customer } = useSession();
  const notify = useToast();
  const customerId = customer?.CustomerID;
  const orders = useResource(
    () => (customerId ? api(`/orders?customerId=${customerId}`) : Promise.resolve([])),
    [customerId],
    { pollMs: 5000 },
  );
  const [busy, setBusy] = useState(null);

  async function cancel(order) {
    setBusy(order.OrderID);
    try {
      await post(`/orders/${order.OrderID}/cancel`);
      notify(`Order #${order.OrderID} cancelled; its stock is back on the shelf`, 'success');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(null);
      orders.reload();
    }
  }

  const list = orders.data ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My orders</h1>
          <p className="muted">
            From OrderSummaryView. Only confirmed orders can be cancelled (CancelOrder).
          </p>
        </div>
      </div>

      <SessionBar />

      {orders.error && <div className="notice notice-critical">{orders.error.message}</div>}

      {!orders.loading && list.length === 0 && (
        <div className="card empty-state">
          <p>{customer?.Name ?? 'This customer'} has no orders yet.</p>
          <Link className="button button-primary" to="/">
            Start shopping
          </Link>
        </div>
      )}

      <div className="order-list">
        {list.map((order) => (
          <OrderCard
            key={order.OrderID}
            order={order}
            actions={
              order.Status === 'Confirmed' && (
                <button
                  className="button button-danger"
                  disabled={busy === order.OrderID}
                  onClick={() => cancel(order)}
                >
                  {busy === order.OrderID ? 'Cancelling…' : 'Cancel order'}
                </button>
              )
            }
          />
        ))}
      </div>
    </div>
  );
}
