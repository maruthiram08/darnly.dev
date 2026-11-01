import { useOrders } from '../hooks/useOrders';
import { OrderRow } from '../components/OrderRow';
import { EmptyState } from '../components/EmptyState';
import { Link } from '../components/Link';

export function OrdersPage() {
  const { orders, loading } = useOrders();
  if (loading) return <p>Loading your orders…</p>;
  if (orders.length === 0) return <EmptyState title="You have no orders yet" action={<Link href="/products">Start shopping</Link>} />;
  return (
    <>
      <h1>Your orders</h1>
      <table className="orders">
        <thead>
          <tr>
            <th>Order</th>
            <th>Date</th>
            <th>Items</th>
            <th>Total</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
        </tbody>
      </table>
    </>
  );
}
