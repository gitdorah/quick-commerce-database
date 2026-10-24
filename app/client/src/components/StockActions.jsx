import { useEffect, useRef, useState } from 'react';
import { post } from '../api.js';
import { useToast } from './Toast.jsx';

// Each action maps to one stored procedure behind the inventory API.
const ACTIONS = {
  restock: {
    label: 'Restock',
    help: 'Add an inbound delivery to Available stock (RestockInventory).',
    endpoint: '/inventory/restock',
    min: 1,
    done: (q, row) => `Added ${q} to ${row.ProductName}`,
  },
  damage: {
    label: 'Mark damaged',
    help: 'Move units from Available to Damaged (MoveInventoryState).',
    endpoint: '/inventory/move',
    extra: { fromState: 'Available', toState: 'Damaged' },
    min: 1,
    max: (row) => row.Available,
    done: (q, row) => `Marked ${q} × ${row.ProductName} as damaged`,
  },
  receive: {
    label: 'Receive in-transit',
    help: 'Move arrived units from In-Transit to Available (MoveInventoryState).',
    endpoint: '/inventory/move',
    extra: { fromState: 'In-Transit', toState: 'Available' },
    min: 1,
    max: (row) => row.InTransit,
    done: (q, row) => `Received ${q} × ${row.ProductName}`,
  },
  count: {
    label: 'Stock count',
    help: 'Set Available to the physically counted quantity (RecordStockCount).',
    endpoint: '/inventory/count',
    min: 0,
    done: (q, row) => `${row.ProductName} counted at ${q}`,
  },
};

export default function StockActions({ row, onClose, onDone }) {
  const dialogRef = useRef(null);
  const notify = useToast();
  const [action, setAction] = useState('restock');
  const [quantity, setQuantity] = useState('10');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const spec = ACTIONS[action];
  const max = spec.max?.(row);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const amount = Number(quantity);
      await post(spec.endpoint, {
        darkStoreId: row.DarkStoreID,
        productId: row.ProductID,
        quantity: amount,
        ...spec.extra,
      });
      notify(spec.done(amount, row), 'success');
      onDone();
      dialogRef.current?.close();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose}>
      <form onSubmit={submit}>
        <h2>{row.ProductName}</h2>
        <p className="muted small">
          {row.DarkStoreLocation} · Available {row.Available} · Reserved {row.Reserved} · Damaged{' '}
          {row.Damaged} · In-Transit {row.InTransit}
        </p>

        <div className="segmented" role="radiogroup" aria-label="Stock action">
          {Object.entries(ACTIONS).map(([key, candidate]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={action === key}
              className={action === key ? 'active' : ''}
              onClick={() => {
                setAction(key);
                setError('');
                if (key === 'count') setQuantity(String(row.Available));
              }}
            >
              {candidate.label}
            </button>
          ))}
        </div>

        <p className="small">{spec.help}</p>

        <label className="field">
          <span>{action === 'count' ? 'Counted quantity' : 'Quantity'}</span>
          <input
            type="number"
            min={spec.min}
            max={max}
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
            autoFocus
          />
        </label>
        {max !== undefined && <p className="muted small">At most {max} can be moved.</p>}
        {error && <p className="form-error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" className="button button-ghost" onClick={() => dialogRef.current?.close()}>
            Close
          </button>
          <button className="button button-primary" disabled={saving}>
            {saving ? 'Saving…' : spec.label}
          </button>
        </div>
      </form>
    </dialog>
  );
}
