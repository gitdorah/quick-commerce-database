import { formatCurrency, plural } from '../format.js';
import { ProductImage, Stepper } from './ProductCard.jsx';

export default function Cart({ lines, customer, darkStore, placing, onChange, onCheckout, onClear }) {
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.quantity * line.product.Price, 0);
  const shortLines = lines.filter((line) => line.quantity > line.product.AvailableQuantity);

  return (
    <aside className="card cart" aria-label="Cart">
      <div className="cart-header">
        <h2>Cart</h2>
        {lines.length > 0 && (
          <button className="link-button" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="muted empty">Your cart is empty. Add items from the {darkStore?.Location} store.</p>
      ) : (
        <ul className="cart-lines">
          {lines.map(({ product, quantity }) => (
            <li key={product.ProductID}>
              <ProductImage product={product} className="product-art cart-thumb" />
              <div>
                <div className="cart-name">{product.ProductName}</div>
                <div className="muted small">
                  {formatCurrency(product.Price)} each
                  {quantity > product.AvailableQuantity && (
                    <span className="text-critical"> · only {product.AvailableQuantity} left</span>
                  )}
                </div>
              </div>
              <Stepper
                value={quantity}
                max={product.AvailableQuantity}
                onChange={(next) => onChange(product.ProductID, next)}
                label={`Quantity of ${product.ProductName}`}
              />
              <div className="cart-line-total">{formatCurrency(quantity * product.Price)}</div>
            </li>
          ))}
        </ul>
      )}

      <div className="cart-summary">
        <div className="muted small">{plural(units, 'item')}</div>
        <div className="cart-total">
          <span>Total</span>
          <strong>{formatCurrency(total)}</strong>
        </div>
        <button
          className="button button-primary button-block"
          disabled={lines.length === 0 || !customer || placing}
          onClick={onCheckout}
        >
          {placing ? 'Reserving stock…' : 'Place order'}
        </button>
        <p className="muted small">
          {customer ? `For ${customer.Name}, from the ${darkStore?.Location} dark store. ` : ''}
          Checkout reserves every item in one transaction, or none.
          {shortLines.length > 0 && ' Some quantities exceed current stock and will be rejected.'}
        </p>
      </div>
    </aside>
  );
}
