import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { findProduct, type Product } from '../data/products';

export interface CartLine {
  product: Product;
  qty: number;
}

interface CartApi {
  lines: CartLine[];
  add: (product: Product) => void;
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  count: number;
}

const CartContext = createContext<CartApi | null>(null);
const STORAGE_KEY = 'pebble-cart';

function loadCart(): CartLine[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { id: string; qty: number }[] | null;
    const raw = saved ?? [{ id: 'p2', qty: 1 }];
    return raw.flatMap(({ id, qty }) => {
      const product = findProduct(id);
      return product ? [{ product, qty }] : [];
    });
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(loadCart);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines.map((l) => ({ id: l.product.id, qty: l.qty }))));
  }, [lines]);

  const api: CartApi = {
    lines,
    add: (product) =>
      setLines((prev) => {
        const existing = prev.find((l) => l.product.id === product.id);
        if (existing) return prev.map((l) => (l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l));
        return [...prev, { product, qty: 1 }];
      }),
    setQty: (productId, qty) =>
      setLines((prev) => prev.map((l) => (l.product.id === productId ? { ...l, qty: Math.max(1, qty) } : l))),
    remove: (productId) => setLines((prev) => prev.filter((l) => l.product.id !== productId)),
    clear: () => setLines([]),
    count: lines.reduce((n, l) => n + l.qty, 0),
  };

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
