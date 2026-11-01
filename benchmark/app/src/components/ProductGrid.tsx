import type { Product } from '../data/products';
import { ProductCard } from './ProductCard';
import { EmptyState } from './EmptyState';

export function ProductGrid({ products }: { products: Product[] }) {
  if (products.length === 0) return <EmptyState title="No products found" hint="Try a different search or category." />;
  return (
    <div className="product-grid">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
