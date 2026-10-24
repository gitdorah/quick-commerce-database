import { useState } from 'react';
import { post } from '../api.js';
import { useSession } from '../context/SessionContext.jsx';
import { useToast } from './Toast.jsx';

function NewCustomerForm({ onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      onCreated(await post('/customers', { name, contact }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
      </label>
      <label>
        <span>Contact</span>
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          placeholder="10 digits"
          maxLength={10}
          required
        />
      </label>
      <button className="button button-primary" disabled={saving}>
        {saving ? 'Saving…' : 'Register'}
      </button>
      <button type="button" className="button button-ghost" onClick={onCancel}>
        Cancel
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}

/** Customer and dark-store pickers shown on the customer-facing pages. */
export default function SessionBar() {
  const { customers, stores, customer, darkStore, setCustomerId, setDarkStoreId, reloadCustomers } =
    useSession();
  const notify = useToast();
  const [adding, setAdding] = useState(false);

  async function handleCreated(created) {
    await reloadCustomers();
    setCustomerId(created.CustomerID);
    setAdding(false);
    notify(`Welcome, ${created.Name} (customer #${created.CustomerID})`, 'success');
  }

  return (
    <div className="session-bar">
      <label className="field">
        <span>Shopping as</span>
        <select
          value={customer?.CustomerID ?? ''}
          onChange={(e) => setCustomerId(Number(e.target.value))}
        >
          {customers.map((c) => (
            <option key={c.CustomerID} value={c.CustomerID}>
              {c.Name} · {c.Contact}
            </option>
          ))}
        </select>
      </label>
      {!adding && (
        <button className="button button-ghost" onClick={() => setAdding(true)}>
          + New customer
        </button>
      )}
      <label className="field">
        <span>Delivering from</span>
        <select
          value={darkStore?.DarkStoreID ?? ''}
          onChange={(e) => setDarkStoreId(Number(e.target.value))}
        >
          {stores.map((s) => (
            <option key={s.DarkStoreID} value={s.DarkStoreID}>
              {s.Location} dark store — {s.Address}
            </option>
          ))}
        </select>
      </label>
      {adding && <NewCustomerForm onCreated={handleCreated} onCancel={() => setAdding(false)} />}
    </div>
  );
}
