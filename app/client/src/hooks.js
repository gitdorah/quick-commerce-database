import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data with `load()` whenever `deps` change, optionally re-polling.
 * Earlier responses never overwrite later ones, and data from the previous
 * load is kept while a refetch is in flight.
 */
export function useResource(load, deps = [], { pollMs } = {}) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  const loadRef = useRef(load);
  loadRef.current = load;
  const latestRequest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const data = await loadRef.current();
      if (request === latestRequest.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (request === latestRequest.current) {
        setState((previous) => ({ ...previous, error, loading: false }));
      }
    }
  }, []);

  useEffect(() => {
    setState((previous) => ({ ...previous, loading: true }));
    reload();
    if (!pollMs) return undefined;
    const timer = setInterval(reload, pollMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs, reload]);

  return { ...state, reload };
}
