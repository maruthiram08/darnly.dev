import { useState } from 'react';
import { findProduct } from '../data/products';
import { formatMoney } from '../lib/money';
import { imageUrl, stars } from '../lib/format';
import { useCart } from '../hooks/useCart';
import { useToast } from '../hooks/useToast';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { Link } from '../components/Link';

const SIZE_CHART: Record<string, string> = { S: '120 x 150 cm', M: '130 x 170 cm', L: '150 x 200 cm', XL: '180 x 220 cm' };

export function ProductPage({ id }: { id: string }) {
  const product = findProduct(id);
  const { add } = useCart();
  const toast = useToast();
  const [size, setSize] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  if (!product) return <EmptyState title="Product not found" action={<Link href="/products">Back to the shop</Link>} />;

  return (
    <div className="product-page">
      <img src={imageUrl(product.id)} alt={product.name} width={480} height={330} />
      <div>
        <h1>{product.name}</h1>
        <p className="rating">{stars(product.rating)}</p>
        <p className="price price-lg">{formatMoney(product.price)}</p>
        <p>{product.description}</p>
        {product.sizes && (
          <div className="sizes">
            <div className="sizes__row">
              {product.sizes.map((s) => (
                <button key={s} className={s === size ? 'size active' : 'size'} onClick={() => setSize(s)}>
                  {s}
                </button>
              ))}
            </div>
            <button className="link-button" onClick={() => setGuideOpen(true)}>
              Size guide
            </button>
          </div>
        )}
        <Button
          onClick={() => {
            add(product);
            toast(`${product.name} added to your cart.`);
          }}
        >
          Add to cart
        </Button>
      </div>
      <Modal title="Size guide" open={guideOpen} onClose={() => setGuideOpen(false)}>
        <table className="size-chart">
          <tbody>
            {(product.sizes ?? []).map((s) => (
              <tr key={s}>
                <th>{s}</th>
                <td>{SIZE_CHART[s]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </div>
  );
}
