import type { Order } from '../hooks/useOrders';
import { formatDate, pluralize } from '../lib/format';
import { formatMoney } from '../lib/money';
import { Badge } from './Badge';

export function OrderRow({ order }: { order: Order }) {
  return (
    <tr className="order-row">
      <td>{order.id}</td>
      <td>{formatDate(order.date)}</td>
      <td>{pluralize(order.items, 'item')}</td>
      <td>{formatMoney(order.total)}</td>
      <td>
        <Badge tone={order.status === 'delivered' ? 'green' : order.status === 'shipped' ? 'blue' : 'grey'}>{order.status}</Badge>
      </td>
    </tr>
  );
}
