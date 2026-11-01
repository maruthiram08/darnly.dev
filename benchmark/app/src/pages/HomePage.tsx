import { PRODUCTS } from '../data/products';
import { ProductGrid } from '../components/ProductGrid';
import { Link } from '../components/Link';

export function HomePage() {
  return (
    <>
      <section className="hero">
        <h1>Small things, made well.</h1>
        <p>Everyday goods for home, office and outdoors. Free shipping on orders over $50.</p>
        <Link href="/products" className="btn btn-primary btn-md">
          Browse the shop
        </Link>
      </section>
      <h2 className="section-title">Popular this week</h2>
      <ProductGrid products={PRODUCTS.slice(0, 4)} />
    </>
  );
}
