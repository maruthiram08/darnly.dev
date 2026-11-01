import type { CartLine } from '../hooks/useCart';
import { useCart } from '../hooks/useCart';
import { formatMoney, lineTotal } from '../lib/money';
import { imageUrl } from '../lib/format';
import { QuantityPicker } from './QuantityPicker';
import { Button } from './Button';

export function CartItem({ line }: { line: CartLine }) {
  const { setQty, remove } = useCart();
  return (
    <li className="cart-item">
      <img src={imageUrl(line.product.id)} alt="" width={80} height={55} />
      <div className="cart-item__name">{line.product.name}</div>
      <QuantityPicker value={line.qty} onChange={(n) => setQty(line.product.id, n)} />
      <div className="cart-item__price">{formatMoney(lineTotal(line))}</div>
      <Button variant="ghost" size="sm" onClick={() => remove(line.product.id)}>
        Remove
      </Button>
    </li>
  );
}
