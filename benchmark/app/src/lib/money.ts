import type { CartLine } from '../hooks/useCart';

const FREE_SHIPPING_FROM = 50;
const SHIPPING_FEE = 5;

export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function lineTotal(line: CartLine): number {
  return line.product.price * line.qty;
}

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.product.price, 0);
}

export function shippingFor(subtotal: number): number {
  if (subtotal === 0) return 0;
  return subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE;
}

export function cartTotal(lines: CartLine[]): number {
  const subtotal = cartSubtotal(lines);
  return subtotal + shippingFor(subtotal);
}
