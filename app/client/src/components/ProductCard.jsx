import { useState } from 'react';
import { formatCurrency } from '../format.js';
import { StockBadge } from './StatusBadge.jsx';

export function Stepper({ value, max, onChange, label }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} aria-label="Decrease quantity">
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/**
 * Illustration from public/products/<ProductID>.svg, falling back to an
 * initials tile for products that have no image yet.
 */
export function ProductImage({ product, className = 'product-art' }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={className} data-tone={product.ProductID % 6} aria-hidden="true">
      {failed ? (
        initials(product.ProductName)
      ) : (
        <img
          src={`/products/${product.ProductID}.svg`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export default function ProductCard({ product, inCart, onChange }) {
  const available = product.AvailableQuantity;
  return (
    <article className={`card product-card${available <= 0 ? ' sold-out' : ''}`}>
      <ProductImage product={product} />
      <div className="product-body">
        <h3>{product.ProductName}</h3>
        <p className="muted small">{product.Description}</p>
      </div>
      <div className="product-footer">
        <div>
          <div className="price">{formatCurrency(product.Price)}</div>
          <StockBadge available={available} />
        </div>
        {inCart > 0 ? (
          <Stepper
            value={inCart}
            max={available}
            onChange={onChange}
            label={`Quantity of ${product.ProductName}`}
          />
        ) : (
          <button className="button button-primary" disabled={available <= 0} onClick={() => onChange(1)}>
            Add
          </button>
        )}
      </div>
    </article>
  );
}
