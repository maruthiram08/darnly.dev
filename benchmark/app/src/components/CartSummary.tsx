import type { CartLine } from '../hooks/useCart';
import { cartSubtotal, cartTotal, formatMoney, shippingFor } from '../lib/money';

export function CartSummary({ lines }: { lines: CartLine[] }) {
  const subtotal = cartSubtotal(lines);
  const shipping = shippingFor(subtotal);
  return (
    <dl className="cart-summary">
      <div>
        <dt>Subtotal</dt>
        <dd data-testid="subtotal">{formatMoney(subtotal)}</dd>
      </div>
      <div>
        <dt>Shipping</dt>
        <dd>{shipping === 0 ? 'Free' : formatMoney(shipping)}</dd>
      </div>
      <div className="cart-summary__total">
        <dt>Total</dt>
        <dd data-testid="total">{formatMoney(cartTotal(lines))}</dd>
      </div>
    </dl>
  );
}
