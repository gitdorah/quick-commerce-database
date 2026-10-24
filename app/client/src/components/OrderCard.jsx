import { useState } from 'react';
import { formatCurrency, formatDateTime, plural } from '../format.js';
import StatusBadge from './StatusBadge.jsx';

export default function OrderCard({ order, actions, compact = false, showCustomer = false }) {
  const [expanded, setExpanded] = useState(!compact);

  return (
    <article className={`card order-card${compact ? ' order-card-compact' : ''}`}>
      <header className="order-head">
        <div>
          <div className="order-id">Order #{order.OrderID}</div>
          <div className="muted small">
            {formatDateTime(order.OrderDate)} · {order.DarkStoreLocation}
            {showCustomer && ` · ${order.CustomerName}`}
          </div>
        </div>
        {!compact && <StatusBadge status={order.Status} />}
      </header>

      {compact && (
        <button className="link-button small" onClick={() => setExpanded((open) => !open)}>
          {expanded ? 'Hide' : 'Show'} {plural(order.items?.length ?? 0, 'line')}
        </button>
      )}

      {expanded && (
        <ul className="order-lines">
          {(order.items ?? []).map((item, index) => (
            <li key={index}>
              <span>
                {item.Quantity} × {item.ProductName}
              </span>
              <span className="muted">{formatCurrency(item.LineTotal)}</span>
            </li>
          ))}
        </ul>
      )}

      <footer className="order-foot">
        <span className="muted small">{plural(order.TotalUnits, 'unit')}</span>
        <strong>{formatCurrency(order.OrderTotal)}</strong>
      </footer>

      {actions && <div className="order-actions">{actions}</div>}
    </article>
  );
}
