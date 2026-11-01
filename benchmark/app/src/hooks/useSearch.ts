import { useMemo } from 'react';
import type { Product } from '../data/products';

export function useSearch(products: Product[], query: string, category: string) {
  return useMemo(() => {
    const q = query.trim();
    return products.filter((p) => {
      if (category !== 'all' && p.category !== category) return false;
      if (!q) return true;
      return p.name.includes(q) || p.description.includes(q);
    });
  }, [products, query, category]);
}
