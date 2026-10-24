import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useResource } from '../hooks.js';

const SessionContext = createContext(null);

// The selection is a per-browser convenience; the app works without storage.
function readStoredId(key) {
  try {
    return Number(window.localStorage.getItem(key)) || null;
  } catch {
    return null;
  }
}

function storeId(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage unavailable (private mode, blocked site data): keep it in memory.
  }
}

/**
 * There is no login in this demo: the shopper picks which customer they are
 * and which dark store serves them.
 */
export function SessionProvider({ children }) {
  const customers = useResource(() => api('/customers'), []);
  const stores = useResource(() => api('/stores'), []);
  const [customerId, setCustomerIdState] = useState(() => readStoredId('qc.customerId'));
  const [darkStoreId, setDarkStoreIdState] = useState(() => readStoredId('qc.darkStoreId'));

  const setCustomerId = useCallback((id) => {
    setCustomerIdState(id);
    storeId('qc.customerId', id);
  }, []);

  const setDarkStoreId = useCallback((id) => {
    setDarkStoreIdState(id);
    storeId('qc.darkStoreId', id);
  }, []);

  const value = useMemo(() => {
    const customerList = customers.data ?? [];
    const storeList = stores.data ?? [];
    return {
      customers: customerList,
      stores: storeList,
      customer: customerList.find((c) => c.CustomerID === customerId) ?? customerList[0] ?? null,
      darkStore: storeList.find((s) => s.DarkStoreID === darkStoreId) ?? storeList[0] ?? null,
      setCustomerId,
      setDarkStoreId,
      reloadCustomers: customers.reload,
      loading: customers.loading || stores.loading,
      error: customers.error || stores.error,
    };
  }, [customers, stores, customerId, darkStoreId, setCustomerId, setDarkStoreId]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
