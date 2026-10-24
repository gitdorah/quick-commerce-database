const STATUS_CLASS = {
  Confirmed: 'status-confirmed',
  Preparing: 'status-preparing',
  'Out for Delivery': 'status-dispatched',
  Delivered: 'status-delivered',
  Cancelled: 'status-cancelled',
};

export default function StatusBadge({ status }) {
  return <span className={`badge ${STATUS_CLASS[status] ?? ''}`}>{status}</span>;
}

export function StockBadge({ available }) {
  if (available <= 0) return <span className="badge badge-critical">Out of stock</span>;
  if (available < 10) return <span className="badge badge-warning">Only {available} left</span>;
  return <span className="badge badge-good">{available} in stock</span>;
}
