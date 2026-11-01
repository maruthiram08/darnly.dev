import { useCart } from '../hooks/useCart';
import { CartItem } from '../components/CartItem';
import { CartSummary } from '../components/CartSummary';
import { EmptyState } from '../components/EmptyState';
import { Link } from '../components/Link';

export function CartPage() {
  const { lines } = useCart();
  if (lines.length === 0) return <EmptyState title="Your cart is empty" action={<Link href="/products">Start shopping</Link>} />;
  return (
    <div className="cart-page">
      <h1>Your cart</h1>
      <ul className="cart-list">
        {lines.map((l) => (
          <CartItem key={l.product.id} line={l} />
        ))}
      </ul>
      <aside>
        <CartSummary lines={lines} />
        <Link href="/checkout" className="btn btn-primary btn-md">
          Go to checkout
        </Link>
      </aside>
    </div>
  );
}
