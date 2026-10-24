import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, post } from '../api.js';
import Cart from '../components/Cart.jsx';
import ProductCard from '../components/ProductCard.jsx';
import SessionBar from '../components/SessionBar.jsx';
import { useToast } from '../components/Toast.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { formatCurrency } from '../format.js';
import { useResource } from '../hooks.js';

export default function Storefront() {
  const { customer, darkStore } = useSession();
  const notify = useToast();
  const storeId = darkStore?.DarkStoreID;
  const catalog = useResource(
    () => (storeId ? api(`/stores/${storeId}/catalog`) : Promise.resolve([])),
    [storeId],
    { pollMs: 10000 },
  );
  const [cart, setCart] = useState({});
  const [search, setSearch] = useState('');
  const [placing, setPlacing] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);

  // A cart belongs to one dark store.
  useEffect(() => {
    setCart({});
    setLastOrder(null);
  }, [storeId]);

  const products = catalog.data ?? [];
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? products.filter((p) => `${p.ProductName} ${p.Description}`.toLowerCase().includes(term))
      : products;
  }, [products, search]);

  const lines = products
    .filter((product) => cart[product.ProductID])
    .map((product) => ({ product, quantity: cart[product.ProductID] }));

  function setQuantity(productId, quantity) {
    setCart((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[productId];
      else next[productId] = quantity;
      return next;
    });
  }

  async function checkout() {
    setPlacing(true);
    try {
      const order = await post('/orders', {
        customerId: customer.CustomerID,
        darkStoreId: storeId,
        items: lines.map(({ product, quantity }) => ({ productId: product.ProductID, quantity })),
      });
      setCart({});
      setLastOrder(order);
      notify(`Order #${order.OrderID} confirmed · ${formatCurrency(order.OrderTotal)}`, 'success');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setPlacing(false);
      catalog.reload();
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Shop</h1>
          <p className="muted">Live stock from AvailableInventoryView. Delivery in about 10 minutes.</p>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search products"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search products"
        />
      </div>

      <SessionBar />

      {lastOrder && (
        <div className="notice notice-good">
          <span aria-hidden="true">✓</span>
          <span>
            Order #{lastOrder.OrderID} is confirmed: {lastOrder.TotalUnits} units reserved for{' '}
            {formatCurrency(lastOrder.OrderTotal)}. <Link to="/orders">Track it in My orders</Link>.
          </span>
        </div>
      )}

      {catalog.error && <div className="notice notice-critical">{catalog.error.message}</div>}

      <div className="shop-layout">
        <section className={`product-grid${catalog.loading && catalog.data ? ' refreshing' : ''}`}>
          {visible.map((product) => (
            <ProductCard
              key={product.ProductID}
              product={product}
              inCart={cart[product.ProductID] ?? 0}
              onChange={(quantity) => setQuantity(product.ProductID, quantity)}
            />
          ))}
          {!catalog.loading && visible.length === 0 && (
            <p className="muted empty">No products match “{search}”.</p>
          )}
        </section>

        <Cart
          lines={lines}
          customer={customer}
          darkStore={darkStore}
          placing={placing}
          onChange={setQuantity}
          onCheckout={checkout}
          onClear={() => setCart({})}
        />
      </div>
    </div>
  );
}
