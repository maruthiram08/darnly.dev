import type { Product } from '../data/products';
import { formatMoney } from '../lib/money';
import { imageUrl, stars } from '../lib/format';
import { useCart } from '../hooks/useCart';
import { Button } from './Button';
import { Link } from './Link';

export function ProductCard({ product }: { product: Product }) {
  const { add } = useCart();
  return (
    <article className="product-card">
      <Link href={`/products/${product.id}`} className="product-card__image">
        <img src={imageUrl(product.id)} alt={product.name} width={320} height={220} />
      </Link>
      <div className="product-card__body">
        <h3 className="product-card__title">{product.name}</h3>
        <div className="product-card__meta">
          <span className="rating" title={`${product.rating} out of 5`}>
            {stars(product.rating)}
          </span>
          <span className="price">{formatMoney(product.price)}</span>
        </div>
        <Button size="sm" onClick={() => add(product)}>
          Add to cart
        </Button>
      </div>
    </article>
  );
}
