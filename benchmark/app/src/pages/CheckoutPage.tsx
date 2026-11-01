import { useState } from 'react';
import { useCart } from '../hooks/useCart';
import { postJson } from '../lib/api';
import { cartTotal, formatMoney } from '../lib/money';
import { Button } from '../components/Button';
import { CartSummary } from '../components/CartSummary';
import { EmptyState } from '../components/EmptyState';
import { Link } from '../components/Link';
import '../styles/checkout.css';

export function CheckoutPage() {
  const { lines, clear } = useCart();
  const [busy, setBusy] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  if (orderId)
    return (
      <EmptyState title={`Thanks! Your order ${orderId} is placed.`} hint="We will email you when it ships." action={<Link href="/orders">See your orders</Link>} />
    );
  if (lines.length === 0) return <EmptyState title="Nothing to check out" action={<Link href="/products">Start shopping</Link>} />;

  const placeOrder = async () => {
    setBusy(true);
    try {
      const res = await postJson<{ orderId: string }>('/api/checkout', { items: lines.map((l) => ({ id: l.product.id, qty: l.qty })) });
      clear();
      setOrderId(res.orderId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="checkout">
      <h1>Checkout</h1>
      <form className="checkout-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          Full name
          <input name="name" defaultValue="Sam Rivera" />
        </label>
        <label>
          Address
          <input name="address" defaultValue="12 Elm Street, Springfield" />
        </label>
        <label>
          Delivery
          <select name="delivery" defaultValue="standard">
            <option value="standard">Standard (3 to 5 days)</option>
            <option value="express">Express (next day)</option>
          </select>
        </label>
      </form>
      <aside>
        <CartSummary lines={lines} />
        <div className="checkout-actions">
          <Link href="/cart">Back to cart</Link>
          <Button className={busy ? 'is-busy' : ''} onClick={placeOrder}>
            Place order · {formatMoney(cartTotal(lines))}
          </Button>
        </div>
      </aside>
    </div>
  );
}
